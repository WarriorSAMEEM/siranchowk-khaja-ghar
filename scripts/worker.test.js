
import test from "node:test";
import assert from "node:assert/strict";
import {
    generateKeyPairSync,
    createPublicKey,
    createSign
} from "node:crypto";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import worker from "../cloudflare-worker/worker.js";
import { normalizeNotificationHistoryEntry } from "../js/activity-logger.js";
import { mapAuthErrorMessage, getSafeRedirectTarget } from "../js/customer-auth.js";
import { resolveFirebaseConfig } from "../js/firebase.js";

const PROJECT_ID = "plasma-bounty-474104-m6";
const OWNER_UID = "47SB1i4UL5hlUVPqM1tQoKJFdaM2";
const DATABASE_URL =
    "https://unit-test-default-rtdb.asia-southeast1.firebasedatabase.app";
const ALLOWED_ORIGIN =
    "https://siranchowk-khaja-ghar.pages.dev";

// One shared signing key for every authenticated test.
// This matches the Worker JWK cache behavior.
const FIREBASE_TEST_KEYS = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {
        type: "pkcs8",
        format: "pem"
    },
    publicKeyEncoding: {
        type: "spki",
        format: "pem"
    }
});

const FIREBASE_TEST_JWK = createPublicKey(
    FIREBASE_TEST_KEYS.publicKey
).export({
    format: "jwk"
});

Object.assign(FIREBASE_TEST_JWK, {
    kid: "unit-test-firebase-kid",
    alg: "RS256",
    use: "sig"
});

function createServiceAccount(projectId = PROJECT_ID) {
    const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: {
            type: "pkcs8",
            format: "pem"
        },
        publicKeyEncoding: {
            type: "spki",
            format: "pem"
        }
    });

    return JSON.stringify({
        type: "service_account",
        project_id: projectId,
        client_email:
            `worker-test@${projectId}.iam.gserviceaccount.com`,
        private_key: privateKey
    });
}

function createFirebaseIdentity(projectId = PROJECT_ID, uid = OWNER_UID) {
    const base64url = (value) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");

    const now = Math.floor(Date.now() / 1000);

    const header = base64url({
        alg: "RS256",
        typ: "JWT",
        kid: "unit-test-firebase-kid"
    });

    const payload = base64url({
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        sub: uid,
        iat: now,
        exp: now + 3600,
        auth_time: now,
        email: "worker-test@example.com"
    });

    const signingInput = `${header}.${payload}`;

    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();

    const idToken =
        `${signingInput}.${signer.sign(FIREBASE_TEST_KEYS.privateKey).toString("base64url")}`;

    return {
        idToken,
        jwk: { ...FIREBASE_TEST_JWK }
    };
}

function createEnv() {
    return {
        FIREBASE_PROJECT_ID: PROJECT_ID,
        FIREBASE_DATABASE_URL: DATABASE_URL,
        PRIMARY_OWNER_UID: OWNER_UID,
        ALLOWED_ORIGIN,
        FIREBASE_SERVICE_ACCOUNT_JSON: createServiceAccount()
    };
}

function createRequest(body, token = null) {
    const headers = {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json"
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    return new Request("https://worker.test/", {
        method: "POST",
        headers,
        body: JSON.stringify(body)
    });
}

function createGoogleAndFirebaseMocks({
    identity,
    databaseHandler,
    fcmHandler
}) {
    return async (input, init = {}) => {
        const url = new URL(String(input));
        const method = init.method || "GET";

        if (
            url.hostname === "www.googleapis.com" &&
            url.pathname.includes(
                "/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
            )
        ) {
            return Response.json({
                keys: [identity.jwk]
            });
        }

        if (url.hostname === "oauth2.googleapis.com") {
            return Response.json({
                access_token: "unit-test-access-token",
                expires_in: 3600
            });
        }

        if (url.hostname.endsWith("firebasedatabase.app")) {
            return databaseHandler(url, method, init);
        }

        if (url.hostname === "fcm.googleapis.com") {
            if (fcmHandler) {
                return fcmHandler(url, method, init);
            }

            return Response.json({
                name: "projects/test/messages/1"
            });
        }

        return new Response("Unexpected test request", {
            status: 404
        });
    };
}

test(
    "new-order alert validates requests, sends once, and records dispatch",
    async () => {
        const trackingToken = "a".repeat(48);
        const orderId = "order_test_123";

        const env = createEnv();

        const order = {
            id: orderId,
            customerTrackingToken: trackingToken,
            customerName: "Test Customer",
            orderType: "Pickup",
            summary: "1 x Test Item",
            createdAt: Date.now(),
            pushAlertDispatched: false
        };

        const calls = {
            oauth: 0,
            fcm: 0,
            history: 0
        };

        const originalFetch = globalThis.fetch;

        globalThis.fetch = async (input, init = {}) => {
            const url = new URL(String(input));
            const method = init.method || "GET";

            if (url.hostname === "oauth2.googleapis.com") {
                calls.oauth++;

                return Response.json({
                    access_token: "unit-test-access-token",
                    expires_in: 3600
                });
            }

            if (url.hostname.endsWith("firebasedatabase.app")) {
                if (
                    url.pathname === `/orders/${orderId}.json` &&
                    method === "GET"
                ) {
                    return Response.json(order);
                }

                if (
                    url.pathname === `/orders/${orderId}.json` &&
                    method === "PATCH"
                ) {
                    Object.assign(
                        order,
                        JSON.parse(init.body || "{}")
                    );

                    return new Response(null, {
                        status: 200
                    });
                }

                if (
                    url.pathname === "/adminDevices.json" &&
                    method === "GET"
                ) {
                    return Response.json({
                        device_1: {
                            deviceId: "device_1",
                            uid: OWNER_UID,
                            role: "owner",
                            approvalStatus: "approved",
                            blocked: false,
                            pushStatus: "enabled",
                            fcmToken: "unit-test-fcm-token",
                            preferences: {
                                newOrders: true
                            }
                        }
                    });
                }

                if (
                    url.pathname === "/staff.json" &&
                    method === "GET"
                ) {
                    return Response.json({
                        [OWNER_UID]: {
                            role: "owner",
                            active: true
                        }
                    });
                }

                if (
                    url.pathname === "/rbac/roles.json" &&
                    method === "GET"
                ) {
                    return Response.json({});
                }

                if (
                    url.pathname === "/notificationHistory/admin.json" &&
                    method === "POST"
                ) {
                    calls.history++;

                    return Response.json({
                        name: "history_test"
                    });
                }
            }

            if (url.hostname === "fcm.googleapis.com") {
                calls.fcm++;

                return Response.json({
                    name: "projects/test/messages/1"
                });
            }

            return new Response("Unexpected test request", {
                status: 404
            });
        };

        try {
            const methodResponse = await worker.fetch(
                new Request("https://worker.test/", {
                    method: "GET"
                }),
                env
            );

            assert.equal(methodResponse.status, 405);

            const invalidResponse = await worker.fetch(
                createRequest({
                    type: "new_order_alert",
                    orderId,
                    trackingToken: "short"
                }),
                env
            );

            assert.equal(invalidResponse.status, 400);
            assert.equal(
                calls.oauth,
                0,
                "Invalid public requests must not trigger token exchange"
            );

            const firstResponse = await worker.fetch(
                createRequest({
                    type: "new_order_alert",
                    orderId,
                    trackingToken
                }),
                env
            );

            const firstBody = await firstResponse.json();

            assert.equal(firstResponse.status, 200);
            assert.equal(firstBody.ok, true);
            assert.equal(firstBody.targeted, 1);
            assert.equal(firstBody.sentToProvider, 1);
            assert.equal(order.pushAlertDispatched, true);
            assert.equal(calls.fcm, 1);
            assert.equal(calls.history, 1);

            const duplicateResponse = await worker.fetch(
                createRequest({
                    type: "new_order_alert",
                    orderId,
                    trackingToken
                }),
                env
            );

            const duplicateBody = await duplicateResponse.json();

            assert.equal(duplicateResponse.status, 200);
            assert.equal(duplicateBody.duplicate, true);
            assert.equal(calls.fcm, 1);
            assert.equal(calls.history, 1);
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
);

test(
    "authenticated admin alerts require and verify a Firebase ID token",
    async () => {
        const identity = createFirebaseIdentity();
        const env = createEnv();

        let fcmCalls = 0;

        const originalFetch = globalThis.fetch;

        globalThis.fetch = createGoogleAndFirebaseMocks({
            identity,

            databaseHandler: (url, method) => {
                if (
                    url.pathname === `/staff/${OWNER_UID}.json` &&
                    method === "GET"
                ) {
                    return Response.json({
                        role: "owner",
                        active: true
                    });
                }

                if (
                    url.pathname === "/adminDevices.json" &&
                    method === "GET"
                ) {
                    return Response.json({
                        device_1: {
                            deviceId: "device_1",
                            uid: OWNER_UID,
                            role: "owner",
                            approvalStatus: "approved",
                            blocked: false,
                            pushStatus: "enabled",
                            fcmToken: "unit-test-admin-fcm-token",
                            preferences: {
                                staffAnnouncements: true
                            }
                        }
                    });
                }

                if (
                    url.pathname === "/staff.json" &&
                    method === "GET"
                ) {
                    return Response.json({
                        [OWNER_UID]: {
                            role: "owner",
                            active: true
                        }
                    });
                }

                if (
                    url.pathname === "/rbac/roles.json" &&
                    method === "GET"
                ) {
                    return Response.json({});
                }

                return Response.json(null);
            },

            fcmHandler: () => {
                fcmCalls++;

                return Response.json({
                    name: "projects/test/messages/admin"
                });
            }
        });

        try {
            const noAuthResponse = await worker.fetch(
                createRequest({
                    type: "admin_alert",
                    body: "Test message"
                }),
                env
            );

            assert.equal(noAuthResponse.status, 401);

            const response = await worker.fetch(
                createRequest(
                    {
                        type: "admin_alert",
                        title: "Test",
                        body: "Verified admin alert"
                    },
                    identity.idToken
                ),
                env
            );

            const body = await response.json();

            assert.equal(response.status, 200);
            assert.equal(body.ok, true);
            assert.equal(body.targeted, 1);
            assert.equal(body.sentToProvider, 1);
            assert.equal(fcmCalls, 1);
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
);

test(
    "login_event uses verified identity and writes login history",
    async () => {
        const identity = createFirebaseIdentity();
        const env = createEnv();

        let loginRecord = null;

        const originalFetch = globalThis.fetch;

        globalThis.fetch = createGoogleAndFirebaseMocks({
            identity,

            databaseHandler: (url, method, init) => {
                if (
                    url.pathname === `/staff/${OWNER_UID}.json` &&
                    method === "GET"
                ) {
                    return Response.json({
                        role: "owner",
                        active: true
                    });
                }

                if (
                    url.pathname === `/users/${OWNER_UID}/profile.json` &&
                    method === "GET"
                ) {
                    return Response.json({
                        name: "Test Owner"
                    });
                }

                if (
                    url.pathname === "/loginHistory.json" &&
                    method === "POST"
                ) {
                    loginRecord = JSON.parse(init.body || "{}");

                    return Response.json({
                        name: "login_test"
                    });
                }

                return Response.json(null);
            }
        });

        try {
            const response = await worker.fetch(
                createRequest(
                    {
                        type: "login_event",
                        action: "login",
                        result: "success",
                        method: "password",
                        portal: "admin",
                        uid: "forged-uid",
                        email: "forged@example.com",
                        role: "customer",
                        timestamp: 1
                    },
                    identity.idToken
                ),
                env
            );

            const body = await response.json();

            assert.equal(response.status, 200);
            assert.ok(body.ok || body.success);

            assert.ok(loginRecord);
            assert.equal(loginRecord.uid, OWNER_UID);
            assert.equal(loginRecord.email, "worker-test@example.com");
            assert.notEqual(loginRecord.uid, "forged-uid");
            assert.notEqual(loginRecord.timestamp, 1);
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
);

test(
    "security_event writes an authenticated owner event",
    async () => {
        const identity = createFirebaseIdentity();
        const env = createEnv();

        let securityRecord = null;

        const originalFetch = globalThis.fetch;

        globalThis.fetch = createGoogleAndFirebaseMocks({
            identity,

            databaseHandler: (url, method, init) => {
                if (
                    url.pathname === `/staff/${OWNER_UID}.json` &&
                    method === "GET"
                ) {
                    return Response.json({
                        role: "owner",
                        active: true
                    });
                }

                if (
                    url.pathname === "/securityLogs.json" &&
                    method === "POST"
                ) {
                    securityRecord = JSON.parse(init.body || "{}");

                    return Response.json({
                        name: "security_test"
                    });
                }

                return Response.json(null);
            }
        });

        try {
            const response = await worker.fetch(
                createRequest(
                    {
                        type: "security_event",
                        eventType: "staff_role_changed",
                        target: "test-staff",
                        details: {
                            role: "manager",
                            password: "must-not-be-recorded"
                        },
                        actorUid: "forged-uid",
                        actorRole: "customer"
                    },
                    identity.idToken
                ),
                env
            );

            const body = await response.json();

            assert.equal(response.status, 200);
            assert.ok(body.ok || body.success);

            assert.ok(securityRecord);
            assert.equal(securityRecord.actorUid, OWNER_UID);
            assert.notEqual(securityRecord.actorUid, "forged-uid");

            const serialized = JSON.stringify(securityRecord);

            assert.equal(
                serialized.includes("must-not-be-recorded"),
                false
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
);

function createCustomFirebaseToken({
    aud = PROJECT_ID,
    iss = `https://securetoken.google.com/${PROJECT_ID}`,
    sub = OWNER_UID,
    expOffsetSec = 3600,
    iatOffsetSec = 0
} = {}) {
    const base64url = (value) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const header = base64url({
        alg: "RS256",
        typ: "JWT",
        kid: "unit-test-firebase-kid"
    });
    const payload = base64url({
        aud,
        iss,
        sub,
        iat: now + iatOffsetSec,
        exp: now + expOffsetSec,
        auth_time: now + iatOffsetSec,
        email: "worker-test@example.com"
    });
    const signingInput = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    return `${signingInput}.${signer.sign(FIREBASE_TEST_KEYS.privateKey).toString("base64url")}`;
}

test(
    "CORS preflight allows production and local Vite origins, rejects unauthorized/missing origins, and preserves CORS on errors",
    async () => {
        const env = {
            ...createEnv(),
            ALLOWED_ORIGINS: "https://siranchowk-khaja-ghar.pages.dev,http://127.0.0.1:5173,http://localhost:5173"
        };
        delete env.ALLOWED_ORIGIN;

        const allowedOrigins = [
            "https://siranchowk-khaja-ghar.pages.dev",
            "http://127.0.0.1:5173",
            "http://localhost:5173"
        ];

        for (const origin of allowedOrigins) {
            const preflightRes = await worker.fetch(
                new Request("https://worker.test/", {
                    method: "OPTIONS",
                    headers: {
                        Origin: origin,
                        "Access-Control-Request-Method": "POST",
                        "Access-Control-Request-Headers": "Content-Type, Authorization"
                    }
                }),
                env
            );

            assert.equal(preflightRes.status, 204);
            assert.equal(preflightRes.headers.get("Access-Control-Allow-Origin"), origin);
            assert.notEqual(preflightRes.headers.get("Access-Control-Allow-Origin"), "*");
            assert.match(preflightRes.headers.get("Access-Control-Allow-Methods") || "", /\bPOST\b/);
            assert.match(preflightRes.headers.get("Access-Control-Allow-Methods") || "", /\bOPTIONS\b/);
            assert.match(preflightRes.headers.get("Access-Control-Allow-Headers") || "", /Authorization/);
            assert.match(preflightRes.headers.get("Access-Control-Allow-Headers") || "", /Content-Type/);
            assert.equal(preflightRes.headers.get("Vary"), "Origin");
        }

        const evilPreflight = await worker.fetch(
            new Request("https://worker.test/", {
                method: "OPTIONS",
                headers: { Origin: "https://evil.example" }
            }),
            env
        );
        assert.equal(evilPreflight.status, 403);
        assert.equal(evilPreflight.headers.get("Access-Control-Allow-Origin"), null);

        const missingOriginPreflight = await worker.fetch(
            new Request("https://worker.test/", { method: "OPTIONS" }),
            env
        );
        assert.equal(missingOriginPreflight.status, 403);
        assert.equal(missingOriginPreflight.headers.get("Access-Control-Allow-Origin"), null);

        const badJsonRes = await worker.fetch(
            new Request("https://worker.test/", {
                method: "POST",
                headers: {
                    Origin: "http://127.0.0.1:5173",
                    "Content-Type": "application/json"
                },
                body: "{not-json"
            }),
            env
        );
        assert.equal(badJsonRes.status, 400);
        assert.equal(badJsonRes.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:5173");

        const oversizedRes = await worker.fetch(
            new Request("https://worker.test/", {
                method: "POST",
                headers: {
                    Origin: "http://127.0.0.1:5173",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ type: "login_event", pad: "x".repeat(40000) })
            }),
            env
        );
        assert.equal(oversizedRes.status, 413);
        assert.equal(oversizedRes.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:5173");
    }
);

test(
    "Worker rejects expired, wrong-audience, and tampered Firebase ID tokens with 401 and CORS headers",
    async () => {
        const identity = createFirebaseIdentity();
        const env = {
            ...createEnv(),
            ALLOWED_ORIGINS: "https://siranchowk-khaja-ghar.pages.dev,http://127.0.0.1:5173,http://localhost:5173"
        };
        delete env.ALLOWED_ORIGIN;
        const originalFetch = globalThis.fetch;

        globalThis.fetch = createGoogleAndFirebaseMocks({
            identity,
            databaseHandler: () => Response.json(null)
        });

        try {
            const expiredToken = createCustomFirebaseToken({ expOffsetSec: -120, iatOffsetSec: -600 });
            const wrongAudToken = createCustomFirebaseToken({ aud: "other-project" });
            const tamperedParts = identity.idToken.split(".");
            const tamperedToken = `${tamperedParts[0]}.${tamperedParts[1]}.tamperedSignature`;

            for (const badToken of [expiredToken, wrongAudToken, tamperedToken]) {
                const res = await worker.fetch(
                    new Request("https://worker.test/", {
                        method: "POST",
                        headers: {
                            Origin: "http://127.0.0.1:5173",
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${badToken}`
                        },
                        body: JSON.stringify({ type: "login_event", action: "login", result: "success" })
                    }),
                    env
                );
                assert.equal(res.status, 401);
                assert.equal(res.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:5173");
            }
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
);

test(
    "login_event sanitizes and forwards sessionDurationSec on logout",
    async () => {
        const customerUid = "customer-uid-123";
        const identity = createFirebaseIdentity(PROJECT_ID, customerUid);
        const env = createEnv();
        let capturedRecord = null;
        const originalFetch = globalThis.fetch;

        globalThis.fetch = createGoogleAndFirebaseMocks({
            identity,
            databaseHandler: (url, method, init) => {
                if (url.pathname === `/staff/${customerUid}.json` && method === "GET") {
                    return Response.json(null);
                }
                if (url.pathname === `/users/${customerUid}/profile.json` && method === "GET") {
                    return Response.json({ name: "Sita Thapa" });
                }
                if (url.pathname === "/loginHistory.json" && method === "POST") {
                    capturedRecord = JSON.parse(init.body || "{}");
                    return Response.json({ name: "hist_logout_1" });
                }
                return Response.json(null);
            }
        });

        try {
            const res = await worker.fetch(
                createRequest(
                    {
                        type: "login_event",
                        action: "logout",
                        result: "success",
                        method: "password",
                        portal: "customer",
                        sessionDurationSec: 425
                    },
                    identity.idToken
                ),
                env
            );
            assert.equal(res.status, 200);
            assert.ok(capturedRecord);
            assert.equal(capturedRecord.uid, customerUid);
            assert.equal(capturedRecord.role, "customer");
            assert.equal(capturedRecord.action, "logout");
            assert.equal(capturedRecord.sessionDurationSec, 425);
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
);

test(
    "customer_campaign enforces targetUids, audience segmentation, and opt-in preferences",
    async () => {
        const identity = createFirebaseIdentity();
        const env = createEnv();
        const sentTokens = [];
        const originalFetch = globalThis.fetch;
        const now = Date.now();

        globalThis.fetch = createGoogleAndFirebaseMocks({
            identity,
            databaseHandler: (url, method) => {
                if (url.pathname === `/staff/${OWNER_UID}.json` && method === "GET") {
                    return Response.json({ role: "owner", active: true });
                }
                if (url.pathname === "/users.json" && method === "GET") {
                    return Response.json({
                        cust_repeat_active: {
                            profile: {
                                name: "Active Repeat",
                                lastActiveAt: now - 2 * 86400000,
                                notificationPreferences: { offersOptIn: true }
                            },
                            devices: {
                                d1: { deviceId: "d1", enabled: true, offersOptIn: true, fcmToken: "token-repeat-active" }
                            }
                        },
                        cust_single_active: {
                            profile: {
                                name: "Single Order",
                                lastActiveAt: now - 1 * 86400000,
                                notificationPreferences: { offersOptIn: true }
                            },
                            devices: {
                                d2: { deviceId: "d2", enabled: true, offersOptIn: true, fcmToken: "token-single" }
                            }
                        },
                        cust_opted_out_profile: {
                            profile: {
                                name: "Opted Out Profile",
                                lastActiveAt: now - 1 * 86400000,
                                notificationPreferences: { offersOptIn: false }
                            },
                            devices: {
                                d3: { deviceId: "d3", enabled: true, offersOptIn: true, fcmToken: "token-opted-out" }
                            }
                        }
                    });
                }
                if (url.pathname === "/orders.json" && method === "GET") {
                    return Response.json({
                        o1: { customerUid: "cust_repeat_active", status: "delivered" },
                        o2: { customerUid: "cust_repeat_active", status: "delivered" },
                        o3: { customerUid: "cust_single_active", status: "delivered" },
                        o4: { customerUid: "cust_opted_out_profile", status: "delivered" },
                        o5: { customerUid: "cust_opted_out_profile", status: "delivered" }
                    });
                }
                return Response.json(null);
            },
            fcmHandler: (_url, _method, init) => {
                const payload = JSON.parse(init.body || "{}");
                sentTokens.push(payload?.message?.token);
                return Response.json({ name: "projects/test/messages/campaign" });
            }
        });

        try {
            const res = await worker.fetch(
                createRequest(
                    {
                        type: "customer_campaign",
                        audience: "repeat_buyers",
                        title: "Friday Special",
                        body: "Fresh Chicken Biryani available today.",
                        targetUids: ["cust_repeat_active", "cust_single_active", "cust_opted_out_profile"]
                    },
                    identity.idToken
                ),
                env
            );
            const body = await res.json();
            assert.equal(res.status, 200);
            assert.equal(body.targeted, 1);
            assert.equal(body.sentToProvider, 1);
            assert.deepEqual(sentTokens, ["token-repeat-active"]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
);

test(
    "normalizeNotificationHistoryEntry handles 2-arg (channel, payload), legacy 1-arg objects, and status mapping",
    () => {
        const orderEntry = normalizeNotificationHistoryEntry("orders", {
            id: "ord_123_accepted",
            title: "Order Accepted",
            message: "Your momo is being prepared",
            status: "sent",
            actorUid: "staff-uid-1"
        });
        assert.equal(orderEntry.channel, "orders");
        assert.equal(orderEntry.referenceId, "ord_123_accepted");
        assert.equal(orderEntry.status, "sent_to_provider");
        assert.equal(orderEntry.title, "Order Accepted");
        assert.equal(typeof orderEntry.createdAt, "number");

        const legacyEntry = normalizeNotificationHistoryEntry({
            type: "security",
            title: "RBAC Updated",
            message: "Permissions changed",
            channel: "security",
            status: "created",
            actorUid: "owner-1"
        });
        assert.equal(legacyEntry.channel, "security");
        assert.equal(legacyEntry.status, "created");
        assert.equal(legacyEntry.title, "RBAC Updated");

        const invalidStatusFallback = normalizeNotificationHistoryEntry("campaigns", {
            title: "Promo",
            status: "bogus_status"
        });
        assert.equal(invalidStatusFallback.channel, "campaigns");
        assert.equal(invalidStatusFallback.status, "created");
    }
);

test(
    "Auth helpers map Firebase error codes cleanly and block unsafe external redirects",
    () => {
        assert.match(mapAuthErrorMessage({ code: "auth/wrong-password" }), /Invalid email or password/i);
        assert.match(mapAuthErrorMessage({ code: "auth/popup-blocked" }), /Popup was blocked/i);
        assert.match(mapAuthErrorMessage({ code: "auth/user-token-expired" }), /session has expired/i);
        assert.match(mapAuthErrorMessage({ code: "auth/requires-recent-login" }), /verify your current password/i);
        assert.match(mapAuthErrorMessage({ code: "auth/credential-already-in-use" }), /already linked/i);
        assert.match(mapAuthErrorMessage({ code: "auth/provider-already-linked" }), /already linked/i);

        assert.equal(getSafeRedirectTarget("?redirect=menu.html#specials"), "menu.html#specials");
        assert.equal(getSafeRedirectTarget("?redirect=/contact.html"), "contact.html");
        assert.equal(getSafeRedirectTarget("?redirect=https://evil.example"), "");
        assert.equal(getSafeRedirectTarget("?redirect=//evil.example/phish"), "");
        assert.equal(getSafeRedirectTarget("?redirect=javascript:alert(1)"), "");
        assert.equal(getSafeRedirectTarget("?redirect=admin/admin.html"), "");
    }
);

test(
    "database.rules.json enforces default-deny, server-only loginHistory/securityLogs writes, and strict user sub-node validation",
    () => {
        const testDir = path.dirname(fileURLToPath(import.meta.url));
        const rulesPath = path.resolve(testDir, "..", "database.rules.json");
        const parsed = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
        const rules = parsed.rules;

        assert.equal(rules[".read"], false);
        assert.equal(rules[".write"], false);
        assert.equal(rules.loginHistory.$logId[".write"], false);
        assert.equal(rules.securityLogs.$logId[".write"], false);

        assert.ok(rules.users.$uid.profile[".write"].includes("newData.exists()"));
        const profileValidate = rules.users.$uid.profile[".validate"];
        assert.ok(profileValidate.includes("!newData.hasChild('role')"));
        assert.ok(profileValidate.includes("!newData.hasChild('isAdmin')"));

        assert.ok(rules.users.$uid.devices.$deviceId[".write"].includes("auth.uid === $uid"));
        assert.ok(rules.users.$uid.devices.$deviceId[".validate"].includes("newData.child('enabled').isBoolean()"));

        assert.ok(rules.users.$uid.coupons.$couponId[".validate"].includes("newData.child('used').val() === true"));

        const userOrderWrite = rules.users.$uid.orders.$orderId[".write"];
        // Customer order mirrors are written by the trusted Worker (Admin SDK), never by clients.
        assert.ok(userOrderWrite.includes("data.exists()"));
        assert.ok(!userOrderWrite.includes("!data.exists() && auth.uid === $uid"));
        assert.ok(userOrderWrite.includes("auth.uid === '47SB1i4UL5hlUVPqM1tQoKJFdaM2'"));
        assert.ok(rules.users.$uid.orders.$orderId[".validate"].includes("newData.child('id').val() === $orderId"));

        assert.ok(rules.users.$uid.notifications.$notifId[".validate"].includes("newData.child('id').val() === $notifId"));
    }
);

function collectFilesRecursive(dirPath, exts, out = []) {
    if (!fs.existsSync(dirPath)) return out;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            collectFilesRecursive(full, exts, out);
        } else if (exts.some((ext) => entry.name.endsWith(ext))) {
            out.push(full);
        }
    }
    return out;
}

test(
    "Browser-delivered source files never assign or redefine read-only window/globalThis/self.fetch",
    () => {
        const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
        const browserFiles = [
            ...collectFilesRecursive(path.join(rootDir, "js"), [".js"]),
            ...collectFilesRecursive(path.join(rootDir, "admin"), [".js", ".html"]),
            ...collectFilesRecursive(path.join(rootDir, "public"), [".js", ".html"]),
            ...fs.readdirSync(rootDir)
                .filter((name) => name.endsWith(".html"))
                .map((name) => path.join(rootDir, name))
        ];

        assert.ok(browserFiles.length > 0);
        const mutationPattern = /(?:window|globalThis|self)\.fetch\s*=|Object\.defineProperty\(\s*(?:window|globalThis|self)\s*,\s*['"]fetch['"]/;

        for (const file of browserFiles) {
            const content = fs.readFileSync(file, "utf8");
            assert.equal(
                mutationPattern.test(content),
                false,
                `Disallowed fetch mutation found in ${path.relative(rootDir, file)}`
            );
        }
    }
);

test(
    "Worker enforces per-order rate limiting (429), rejects whitespace sub tokens (401), and allows localhost:3000 by default",
    async () => {
        const defaultOriginEnv = { ...createEnv(), ALLOWED_ORIGIN: "" };
        const preflightRes = await worker.fetch(
            new Request("https://worker.test/", {
                method: "OPTIONS",
                headers: { Origin: "http://localhost:3000" }
            }),
            defaultOriginEnv
        );
        assert.equal(preflightRes.status, 204);
        assert.equal(preflightRes.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");

        const blankSubIdentity = createFirebaseIdentity(PROJECT_ID, "   ");
        const originalFetch = globalThis.fetch;
        globalThis.fetch = createGoogleAndFirebaseMocks({
            identity: blankSubIdentity,
            databaseHandler: (url, method) => {
                if (url.pathname === "/orders/order_rate_limit_1.json" && method === "GET") {
                    return Response.json({
                        id: "order_rate_limit_1",
                        customerTrackingToken: "b".repeat(48),
                        createdAt: Date.now(),
                        pushAlertDispatched: true
                    });
                }
                return Response.json(null);
            }
        });

        try {
            const invalidSubRes = await worker.fetch(
                createRequest({ type: "login_event" }, blankSubIdentity.idToken),
                createEnv()
            );
            assert.equal(invalidSubRes.status, 401);

            const makeRateLimitReq = () =>
                new Request("https://worker.test/", {
                    method: "POST",
                    headers: {
                        Origin: ALLOWED_ORIGIN,
                        "Content-Type": "application/json",
                        "CF-Connecting-IP": "203.0.113.99"
                    },
                    body: JSON.stringify({
                        type: "new_order_alert",
                        orderId: "order_rate_limit_1",
                        trackingToken: "b".repeat(48)
                    })
                });

            for (let i = 0; i < 5; i += 1) {
                const res = await worker.fetch(makeRateLimitReq(), createEnv());
                assert.equal(res.status, 200);
            }

            const blocked = await worker.fetch(makeRateLimitReq(), createEnv());
            assert.equal(blocked.status, 429);
            assert.ok(Number(blocked.headers.get("Retry-After")) >= 1);
            assert.equal(blocked.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
);

test(
    "Repository blocks exposed service-account credentials and disables production source maps",
    () => {
        const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
        assert.equal(fs.existsSync(path.join(rootDir, ".env")), false);
        // public/assets/aistudio is the host-mounted user prompt artifact and is permitted.

        const viteConfig = fs.readFileSync(path.join(rootDir, "vite.config.js"), "utf8");
        assert.match(viteConfig, /sourcemap:\s*false/);

        const scanFiles = [
            ...collectFilesRecursive(path.join(rootDir, "js"), [".js"]),
            ...collectFilesRecursive(path.join(rootDir, "admin"), [".js", ".html"]),
            ...collectFilesRecursive(path.join(rootDir, "public"), [".js", ".html"]),
            path.join(rootDir, "cloudflare-worker", "wrangler.toml"),
            ...fs.readdirSync(rootDir)
                .filter((name) => name.endsWith(".html"))
                .map((name) => path.join(rootDir, name))
        ];

        const secretPattern = /BEGIN PRIVATE KEY|"type"\s*:\s*"service_account"|private_key_id/;
        for (const file of scanFiles) {
            const content = fs.readFileSync(file, "utf8");
            assert.equal(
                secretPattern.test(content),
                false,
                `Potential credential literal found in ${path.relative(rootDir, file)}`
            );
        }
    }
);

test(
    "Worker records admin portal owner logins and flags non-staff admin portal attempts as failed",
    async () => {
        const ownerIdentity = createFirebaseIdentity(PROJECT_ID, OWNER_UID);
        const nonStaffIdentity = createFirebaseIdentity(PROJECT_ID, "non-staff-cust-99");
        const env = createEnv();
        const records = [];
        const originalFetch = globalThis.fetch;

        globalThis.fetch = async (input, init = {}) => {
            const url = new URL(String(input));
            const method = init.method || "GET";
            if (url.hostname === "www.googleapis.com") {
                return Response.json({ keys: [ownerIdentity.jwk] });
            }
            if (url.hostname === "oauth2.googleapis.com") {
                return Response.json({ access_token: "unit-test-access-token", expires_in: 3600 });
            }
            if (url.hostname.endsWith("firebasedatabase.app")) {
                if (url.pathname === `/staff/${OWNER_UID}.json` && method === "GET") {
                    return Response.json({ role: "owner", active: true });
                }
                if (url.pathname === "/staff/non-staff-cust-99.json" && method === "GET") {
                    return Response.json(null);
                }
                if (url.pathname === "/loginHistory.json" && method === "POST") {
                    records.push(JSON.parse(init.body || "{}"));
                    return Response.json({ name: `hist_${records.length}` });
                }
                return Response.json(null);
            }
            return new Response("Unexpected request", { status: 404 });
        };

        try {
            const ownerRes = await worker.fetch(
                createRequest({ type: "login_event", action: "login", portal: "admin", method: "password" }, ownerIdentity.idToken),
                env
            );
            assert.equal(ownerRes.status, 200);
            const ownerBody = await ownerRes.json();
            assert.equal(ownerBody.result, "success");

            const nonStaffRes = await worker.fetch(
                createRequest({ type: "login_event", action: "login", portal: "admin", method: "password" }, nonStaffIdentity.idToken),
                env
            );
            assert.equal(nonStaffRes.status, 200);
            const nonStaffBody = await nonStaffRes.json();
            assert.equal(nonStaffBody.result, "failed");
            assert.equal(nonStaffBody.reason, "not_in_staff_directory");

            assert.equal(records.length, 2);
            assert.equal(records[0].role, "owner");
            assert.equal(records[0].result, "success");
            assert.equal(records[1].role, "unauthorized");
            assert.equal(records[1].result, "failed");
            assert.equal(records[1].reason, "not_in_staff_directory");
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
);

test(
    "resolveFirebaseConfig connects browser builds via firebase-applet-config.json and default RTDB URL while isolating Node tests",
    () => {
        const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
        const appletCfg = JSON.parse(
            fs.readFileSync(path.join(rootDir, "firebase-applet-config.json"), "utf8")
        );

        const browserResolved = resolveFirebaseConfig({}, appletCfg, true);
        assert.equal(browserResolved.projectId, PROJECT_ID);
        assert.equal(browserResolved.apiKey, appletCfg.apiKey);
        assert.equal(browserResolved.appId, appletCfg.appId);
        assert.equal(
            browserResolved.databaseURL,
            "https://plasma-bounty-474104-m6-default-rtdb.asia-southeast1.firebasedatabase.app"
        );

        const overridden = resolveFirebaseConfig(
            {
                VITE_FIREBASE_API_KEY: "override-key",
                VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
                VITE_FIREBASE_DATABASE_URL: "https://custom-db.firebaseio.com"
            },
            appletCfg,
            true
        );
        assert.equal(overridden.apiKey, "override-key");
        assert.equal(overridden.databaseURL, "https://custom-db.firebaseio.com");

        const nodeWithoutEnv = resolveFirebaseConfig({}, appletCfg, false);
        assert.equal(nodeWithoutEnv.apiKey, "");
        assert.equal(nodeWithoutEnv.projectId, "");
        assert.equal(nodeWithoutEnv.databaseURL, "");
    }
);

test(
    "public/firebase-messaging-sw.js restricts notification navigation URLs to same-origin paths",
    () => {
        const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
        const swSource = fs.readFileSync(
            path.join(rootDir, "public", "firebase-messaging-sw.js"),
            "utf8"
        );
        assert.match(swSource, /function sanitizeSameOriginUrl/);
        assert.match(swSource, /parsed\.origin !== self\.location\.origin/);
        assert.match(swSource, /client\.url\.startsWith\(self\.location\.origin\)/);
    }
);

test(
    "Worker serves GET /health with CORS, includes 4173 preview origins by default, and guards /media/upload Content-Type",
    async () => {
        const defaultEnv = { ...createEnv(), ALLOWED_ORIGIN: "" };

        const healthRes = await worker.fetch(
            new Request("https://worker.test/health", {
                method: "GET",
                headers: { Origin: "http://localhost:4173" }
            }),
            defaultEnv
        );
        assert.equal(healthRes.status, 200);
        assert.equal(healthRes.headers.get("Access-Control-Allow-Origin"), "http://localhost:4173");
        const healthBody = await healthRes.json();
        assert.equal(healthBody.ok, true);
        assert.equal(healthBody.success, true);
        assert.equal(healthBody.status, "Worker is running");
        assert.equal(healthBody.projectId, PROJECT_ID);

        const rootGet = await worker.fetch(
            new Request("https://worker.test/", { method: "GET" }),
            defaultEnv
        );
        assert.equal(rootGet.status, 405);

        const previewPreflight = await worker.fetch(
            new Request("https://worker.test/", {
                method: "OPTIONS",
                headers: { Origin: "http://127.0.0.1:4173" }
            }),
            defaultEnv
        );
        assert.equal(previewPreflight.status, 204);
        assert.equal(previewPreflight.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:4173");

        const badUpload = await worker.fetch(
            new Request("https://worker.test/media/upload", {
                method: "POST",
                headers: {
                    Origin: ALLOWED_ORIGIN,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ file: "nope" })
            }),
            createEnv()
        );
        assert.equal(badUpload.status, 400);
        assert.equal(badUpload.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
    }
);

test(
    "Worker delete_comment and delete_repost decrement parent article counters safely",
    async () => {
        const identity = createFirebaseIdentity();
        const env = createEnv();
        const patches = [];
        const originalFetch = globalThis.fetch;

        globalThis.fetch = createGoogleAndFirebaseMocks({
            identity,
            databaseHandler: (url, method, init) => {
                if (url.pathname === `/staff/${OWNER_UID}.json` && method === "GET") {
                    return Response.json({ role: "owner", active: true });
                }
                if (url.pathname === "/articleComments/art1/c1.json" && method === "GET") {
                    return Response.json({ id: "c1", articleId: "art1" });
                }
                if (url.pathname === "/articleReposts/rep1.json" && method === "GET") {
                    return Response.json({ id: "rep1", originalArticleId: "art1" });
                }
                if (url.pathname === "/publishedArticles/art1.json" && method === "GET") {
                    return Response.json({ id: "art1", authorUid: OWNER_UID, commentsCount: 3, repostsCount: 2 });
                }
                if (url.pathname === "/publishedArticles/art1.json" && method === "PATCH") {
                    patches.push(JSON.parse(init.body || "{}"));
                    return Response.json({});
                }
                return Response.json({});
            }
        });

        try {
            const commentRes = await worker.fetch(
                createRequest(
                    { type: "platform_moderate_content", action: "delete_comment", parentId: "art1", targetId: "c1", reason: "Spam" },
                    identity.idToken
                ),
                env
            );
            assert.equal(commentRes.status, 200);
            assert.ok(patches.some((p) => p.commentsCount === 2));

            const repostRes = await worker.fetch(
                createRequest(
                    { type: "platform_moderate_content", action: "delete_repost", targetId: "rep1", reason: "Duplicate" },
                    identity.idToken
                ),
                env
            );
            assert.equal(repostRes.status, 200);
            assert.ok(patches.some((p) => p.repostsCount === 1));
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
);

test(
    "Worker restore_profile requires suspended state, collectApprovedAdminTargets ignores forged device.role, and platform_delete_media enforces moderateContent",
    async () => {
        const modUid = "modSecurity00000000000001";
        const officerUid = "officerSecurity0000000001";
        const creatorUid = "creatorSecurity0000000001";
        const modIdentity = createFirebaseIdentity(PROJECT_ID, modUid);
        const env = createEnv();
        const sentTokens = [];
        const deletedMedia = [];
        const originalFetch = globalThis.fetch;

        globalThis.fetch = createGoogleAndFirebaseMocks({
            identity: modIdentity,
            databaseHandler: (url, method) => {
                if (url.pathname === `/staff/${modUid}.json` && method === "GET") {
                    return Response.json({ role: "moderator", active: true });
                }
                if (url.pathname === `/staff/${officerUid}.json` && method === "GET") {
                    return Response.json({ role: "officer", active: true });
                }
                if (url.pathname === `/staff/${creatorUid}.json` && method === "GET") {
                    return Response.json(null);
                }
                if (url.pathname === "/publicProfiles/pendingUser1.json" && method === "GET") {
                    return Response.json({ uid: "pendingUser1", creatorStatus: "pending" });
                }
                if (url.pathname === "/publicProfiles/suspendedUser1.json" && method === "GET") {
                    return Response.json({ uid: "suspendedUser1", creatorStatus: "suspended" });
                }
                if (url.pathname === "/mediaLibrary/med_creator_1.json") {
                    if (method === "DELETE") {
                        deletedMedia.push("med_creator_1");
                        return Response.json(null);
                    }
                    return Response.json({ id: "med_creator_1", uploaderUid: creatorUid, key: "uploads/c/a.png" });
                }
                if (url.pathname === "/staff.json" && method === "GET") {
                    return Response.json({
                        [OWNER_UID]: { role: "owner", active: true },
                        deactivated_1: { role: "helper", active: false }
                    });
                }
                if (url.pathname === "/adminDevices.json" && method === "GET") {
                    return Response.json({
                        dev_valid_owner: {
                            deviceId: "dev_valid_owner",
                            uid: OWNER_UID,
                            role: "owner",
                            approvalStatus: "approved",
                            blocked: false,
                            pushStatus: "enabled",
                            fcmToken: "valid-owner-token-12345"
                        },
                        dev_forged_deactivated: {
                            deviceId: "dev_forged_deactivated",
                            uid: "deactivated_1",
                            role: "owner",
                            approvalStatus: "approved",
                            blocked: false,
                            pushStatus: "enabled",
                            fcmToken: "forged-disabled-token-123"
                        },
                        dev_forged_orphan: {
                            deviceId: "dev_forged_orphan",
                            uid: "non_staff_uid",
                            role: "owner",
                            approvalStatus: "approved",
                            blocked: false,
                            pushStatus: "enabled",
                            fcmToken: "forged-orphan-token-123"
                        }
                    });
                }
                return Response.json({});
            },
            fcmHandler: (_url, _method, init) => {
                sentTokens.push(JSON.parse(init.body || "{}")?.message?.token);
                return Response.json({ name: "projects/test/messages/sec" });
            }
        });

        try {
            // 1. Moderator cannot approve pending profile via restore_profile (409)
            const pendingRestore = await worker.fetch(
                createRequest(
                    { type: "platform_moderate_content", action: "restore_profile", targetId: "pendingUser1", reason: "Try approve" },
                    modIdentity.idToken
                ),
                env
            );
            assert.equal(pendingRestore.status, 409);

            // Moderator CAN restore suspended profile (200)
            const suspendedRestore = await worker.fetch(
                createRequest(
                    { type: "platform_moderate_content", action: "restore_profile", targetId: "suspendedUser1", reason: "Appeal approved" },
                    modIdentity.idToken
                ),
                env
            );
            assert.equal(suspendedRestore.status, 200);

            // 2. Officer without moderateContent cannot delete creator's media (403)
            const officerToken = createCustomFirebaseToken({ sub: officerUid });
            const officerDel = await worker.fetch(
                createRequest({ type: "platform_delete_media", mediaId: "med_creator_1" }, officerToken),
                env
            );
            assert.equal(officerDel.status, 403);
            assert.equal(deletedMedia.length, 0);

            // Uploader creator CAN delete own media (200)
            const creatorToken = createCustomFirebaseToken({ sub: creatorUid });
            const creatorDel = await worker.fetch(
                createRequest({ type: "platform_delete_media", mediaId: "med_creator_1" }, creatorToken),
                env
            );
            assert.equal(creatorDel.status, 200);
            assert.deepEqual(deletedMedia, ["med_creator_1"]);

            // 3. Tampered device.role === 'owner' on deactivated/orphan staff does not receive admin_alert
            const ownerToken = createCustomFirebaseToken({ sub: OWNER_UID });
            const alertRes = await worker.fetch(
                createRequest({ type: "admin_alert", title: "Security Check", body: "Verified targets only" }, ownerToken),
                env
            );
            assert.equal(alertRes.status, 200);
            assert.deepEqual(sentTokens, ["valid-owner-token-12345"]);

            // 4. Malformed GET /media/%ZZ returns 400 with CORS (not 500) & oversized upload Content-Length returns 413
            const badMediaRes = await worker.fetch(
                new Request("https://worker.test/media/%ZZ", {
                    method: "GET",
                    headers: { Origin: ALLOWED_ORIGIN }
                }),
                env
            );
            assert.equal(badMediaRes.status, 400);
            assert.equal(badMediaRes.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);

            const bigUploadRes = await worker.fetch(
                new Request("https://worker.test/media/upload", {
                    method: "POST",
                    headers: {
                        Origin: ALLOWED_ORIGIN,
                        "Content-Type": "multipart/form-data; boundary=----skg",
                        "Content-Length": "9999999"
                    },
                    body: "x"
                }),
                env
            );
            assert.equal(bigUploadRes.status, 413);
            assert.equal(bigUploadRes.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
);

