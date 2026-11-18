
import test from "node:test";
import assert from "node:assert/strict";
import {
    generateKeyPairSync,
    createPublicKey,
    createSign
} from "node:crypto";

import worker from "../cloudflare-worker/worker.js";

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
