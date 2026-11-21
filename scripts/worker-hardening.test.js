// Cloudflare Worker hardening tests: secrets/config errors, request validation,
// authorization defaults, FCM token validation and CORS. All network calls are mocked.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createPublicKey, createSign } from "node:crypto";

import worker, { DEFAULT_ROLE_PERMISSIONS, isPlausibleFcmToken } from "../cloudflare-worker/worker.js";
import { DEFAULT_ROLE_PERMISSIONS as CLIENT_DEFAULTS } from "../js/rbac.js";

const PROJECT_ID = "plasma-bounty-474104-m6";
const OWNER_UID = "47SB1i4UL5hlUVPqM1tQoKJFdaM2";
const OFFICER_UID = "officer0000000000000000001";
const CUSTOMER_UID = "customer00000000000000001";
const DATABASE_URL = "https://unit-test-default-rtdb.asia-southeast1.firebasedatabase.app";
const ORIGIN = "https://siranchowk-khaja-ghar.pages.dev";
const GOOD_TOKEN = "dXyZ-123:APA91bExampleTokenValueThatLooksRealEnough_abc";

const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});
const jwk = { ...createPublicKey(keys.publicKey).export({ format: "jwk" }), kid: "kid-1", alg: "RS256", use: "sig" };

function serviceAccountJson(projectId = PROJECT_ID) {
    const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" }
    });
    return JSON.stringify({ type: "service_account", project_id: projectId, client_email: `w@${projectId}.iam.gserviceaccount.com`, private_key: privateKey });
}

function idToken(uid) {
    const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: "RS256", typ: "JWT", kid: "kid-1" });
    const payload = b64({ aud: PROJECT_ID, iss: `https://securetoken.google.com/${PROJECT_ID}`, sub: uid, iat: now, exp: now + 3600, email: "t@example.com" });
    const signer = createSign("RSA-SHA256");
    signer.update(`${head}.${payload}`);
    return `${head}.${payload}.${signer.sign(keys.privateKey).toString("base64url")}`;
}

const makeEnv = (over = {}) => ({
    FIREBASE_PROJECT_ID: PROJECT_ID,
    FIREBASE_DATABASE_URL: DATABASE_URL,
    PRIMARY_OWNER_UID: OWNER_UID,
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
    FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccountJson(),
    ...over
});

let ipCounter = 0;
// Each request gets its own client IP so the Worker's in-memory rate limiter never couples tests.
const req = (body, { token, origin = ORIGIN } = {}) =>
    new Request("https://worker.test/", {
        method: "POST",
        headers: {
            "CF-Connecting-IP": `203.0.113.${(ipCounter++ % 250) + 1}`,
            ...(origin ? { Origin: origin } : {}),
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
    });

/** Install a mocked fetch. `db` maps RTDB paths (e.g. "/staff/uid.json") to JSON values. */
function mockFetch({ db = {}, fcm = () => Response.json({ name: "m/1" }), seen = [] } = {}) {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        seen.push({ url, init });
        if (url.hostname === "www.googleapis.com") return Response.json({ keys: [jwk] });
        if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "tok-unit", expires_in: 3600 });
        if (url.hostname === "fcm.googleapis.com") return fcm(url, init);
        if (url.hostname.endsWith("firebasedatabase.app")) {
            return Response.json(Object.hasOwn(db, url.pathname) ? db[url.pathname] : null);
        }
        return new Response("unexpected", { status: 404 });
    };
    return () => { globalThis.fetch = original; };
}

const officerDb = (extra = {}) => ({
    [`/staff/${OFFICER_UID}.json`]: { role: "officer", active: true },
    ...extra
});

// ---------------------------------------------------------------- secrets
test("missing FIREBASE_SERVICE_ACCOUNT_JSON -> 503 worker_not_configured, safe body, CORS kept", async () => {
    const restore = mockFetch();
    const logged = [];
    const origErr = console.error;
    console.error = (...a) => logged.push(a.join(" "));
    try {
        const env = makeEnv();
        delete env.FIREBASE_SERVICE_ACCOUNT_JSON;
        const res = await worker.fetch(req({ type: "new_order_alert", orderId: "-Oabcdefghijklmn", trackingToken: "a".repeat(48) }), env);
        const text = await res.text();
        assert.equal(res.status, 503);
        assert.equal(JSON.parse(text).code, "worker_not_configured");
        assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
        assert.ok(!/FIREBASE_SERVICE_ACCOUNT_JSON|private_key|BEGIN/.test(text), "response must not name or leak the secret");
        // Operators can see WHICH setting is missing in `wrangler tail`
        assert.ok(logged.some((l) => l.includes("FIREBASE_SERVICE_ACCOUNT_JSON")), "server log names the missing secret");
    } finally {
        console.error = origErr;
        restore();
    }
});

test("invalid / mismatched / malformed service-account secrets all give the same safe 503", async () => {
    const restore = mockFetch();
    const origErr = console.error;
    console.error = () => {};
    try {
        const cases = {
            notJson: "this is not json",
            wrongProject: serviceAccountJson("some-other-project"),
            noKey: JSON.stringify({ project_id: PROJECT_ID, client_email: "x@y.z" }),
            badPem: JSON.stringify({ project_id: PROJECT_ID, client_email: "x@y.z", private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" })
        };
        for (const [name, secret] of Object.entries(cases)) {
            const res = await worker.fetch(
                req({ type: "new_order_alert", orderId: "-Oabcdefghijklmn", trackingToken: "a".repeat(48) }),
                makeEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: secret })
            );
            const text = await res.text();
            assert.equal(res.status, 503, `${name} -> 503`);
            assert.ok(!text.includes("BEGIN") && !text.includes("client_email"), `${name}: no secret material in body`);
        }
    } finally {
        console.error = origErr;
        restore();
    }
});

test("missing plain variables (database URL / project id / owner uid) -> 503, never a crash", async () => {
    const restore = mockFetch();
    const origErr = console.error;
    console.error = () => {};
    try {
        for (const name of ["FIREBASE_DATABASE_URL", "FIREBASE_PROJECT_ID", "PRIMARY_OWNER_UID"]) {
            const env = makeEnv();
            delete env[name];
            const res = await worker.fetch(req({ type: "admin_alert", body: "x" }, { token: idToken(OWNER_UID) }), env);
            assert.equal(res.status, 503, name);
        }
    } finally {
        console.error = origErr;
        restore();
    }
});

test("a rejected credential at Google's token endpoint is reported as a configuration problem", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "oauth2.googleapis.com") return new Response('{"error":"invalid_grant"}', { status: 400 });
        return new Response("unexpected", { status: 404 });
    };
    const origErr = console.error;
    console.error = () => {};
    try {
        const res = await worker.fetch(req({ type: "new_order_alert", orderId: "-Oabcdefghijklmn", trackingToken: "a".repeat(48) }), makeEnv());
        assert.equal(res.status, 503);
        assert.equal((await res.json()).code, "worker_not_configured");
    } finally {
        console.error = origErr;
        globalThis.fetch = original;
    }
});

// ---------------------------------------------------------------- CORS / auth
test("CORS: approved production + local origins pass; others are refused; errors keep CORS headers", async () => {
    const restore = mockFetch();
    try {
        for (const origin of [ORIGIN, "http://localhost:5173"]) {
            const pre = await worker.fetch(new Request("https://worker.test/", { method: "OPTIONS", headers: { Origin: origin } }), makeEnv());
            assert.equal(pre.status, 204);
            assert.equal(pre.headers.get("Access-Control-Allow-Origin"), origin);
        }
        const evil = await worker.fetch(new Request("https://worker.test/", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), makeEnv());
        assert.equal(evil.status, 403);
        assert.equal(evil.headers.get("Access-Control-Allow-Origin"), null);
        const wildcard = await worker.fetch(new Request("https://worker.test/", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), makeEnv({ ALLOWED_ORIGINS: "*" }));
        assert.equal(wildcard.headers.get("Access-Control-Allow-Origin"), null, "'*' in ALLOWED_ORIGINS is ignored");
        const unauth = await worker.fetch(req({ type: "admin_alert", body: "x" }), makeEnv());
        assert.equal(unauth.status, 401);
        assert.equal(unauth.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    } finally {
        restore();
    }
});

test("unauthorized callers are rejected: no token, customer (non-staff) token, deactivated staff", async () => {
    const restore = mockFetch({
        db: {
            [`/staff/${OFFICER_UID}.json`]: { role: "officer", active: false }
        }
    });
    try {
        const env = makeEnv();
        for (const type of ["admin_alert", "customer_order_update", "customer_campaign"]) {
            assert.equal((await worker.fetch(req({ type, body: "x" }), env)).status, 401, `${type} without token`);
            assert.equal((await worker.fetch(req({ type, body: "x", customerUid: CUSTOMER_UID }, { token: idToken(CUSTOMER_UID) }), env)).status, 403, `${type} as customer`);
            assert.equal((await worker.fetch(req({ type, body: "x", customerUid: CUSTOMER_UID }, { token: idToken(OFFICER_UID) }), env)).status, 403, `${type} as deactivated staff`);
        }
        const bad = await worker.fetch(req({ type: "admin_alert", body: "x" }, { token: "a.b.c" }), env);
        assert.equal(bad.status, 401);
    } finally {
        restore();
    }
});

// ---------------------------------------------------------------- request validation
test("untrusted ids cannot traverse RTDB paths (orderId, customerUid)", async () => {
    const seen = [];
    const restore = mockFetch({ seen, db: officerDb() });
    try {
        const env = makeEnv();
        for (const orderId of ["../adminDevices", "x/../../staff", "a b", "a?b=1", "a#b", "short"]) {
            const res = await worker.fetch(req({ type: "new_order_alert", orderId, trackingToken: "a".repeat(48) }), env);
            assert.equal(res.status, 400, `orderId ${JSON.stringify(orderId)}`);
        }
        const res = await worker.fetch(req({ type: "customer_order_update", customerUid: "x/../../staff", body: "hi" }, { token: idToken(OFFICER_UID) }), env);
        assert.equal(res.status, 400);
        assert.ok(!seen.some((s) => s.url.pathname.includes("..") && s.url.hostname.endsWith("firebasedatabase.app")), "no traversal request ever reached the database");
    } finally {
        restore();
    }
});

test("RTDB access token is sent in the Authorization header, never in the URL", async () => {
    const seen = [];
    const order = { id: "-Otest0000000000008", customerTrackingToken: "a".repeat(48), customerName: "R", orderType: "Pickup", summary: "1 x Momo", createdAt: Date.now() };
    const restore = mockFetch({ seen, db: { "/orders/-Otest0000000000008.json": order } });
    try {
        const res = await worker.fetch(req({ type: "new_order_alert", orderId: "-Otest0000000000008", trackingToken: "a".repeat(48) }), makeEnv());
        assert.equal(res.status, 200);
        const dbCalls = seen.filter((s) => s.url.hostname.endsWith("firebasedatabase.app"));
        assert.ok(dbCalls.length >= 2);
        for (const c of dbCalls) {
            assert.ok(!c.url.search.includes("access_token"), "no access_token in query string");
            assert.equal(c.init.headers.Authorization, "Bearer tok-unit");
        }
    } finally {
        restore();
    }
});

test("new_order_alert: wrong tracking token is refused with 403 and nothing is patched or sent", async () => {
    const seen = [];
    const order = { id: "-Otest0000000000009", customerTrackingToken: "a".repeat(48), createdAt: Date.now() };
    const restore = mockFetch({ seen, db: { "/orders/-Otest0000000000009.json": order } });
    try {
        const res = await worker.fetch(req({ type: "new_order_alert", orderId: "-Otest0000000000009", trackingToken: "b".repeat(48) }), makeEnv());
        assert.equal(res.status, 403);
        assert.ok(!seen.some((s) => s.init.method === "PATCH" || s.url.hostname === "fcm.googleapis.com"));
    } finally {
        restore();
    }
});

// ---------------------------------------------------------------- permissions
test("default permissions: officer (no rbac/roles configured) can send customer order updates, as the rules allow", async () => {
    const restore = mockFetch({
        db: officerDb({
            [`/users/${CUSTOMER_UID}/devices.json`]: { d1: { deviceId: "d1", enabled: true, orderAlerts: true, fcmToken: GOOD_TOKEN } }
        })
    });
    try {
        const res = await worker.fetch(req({ type: "customer_order_update", customerUid: CUSTOMER_UID, title: "Order", body: "Accepted" }, { token: idToken(OFFICER_UID) }), makeEnv());
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.sentToProvider, 1);
    } finally {
        restore();
    }
});

test("officer may raise the automatic low_stock admin alert but no other admin broadcast or campaign", async () => {
    const devices = { dev1: { deviceId: "dev1", uid: OWNER_UID, role: "owner", approvalStatus: "approved", blocked: false, pushStatus: "enabled", fcmToken: GOOD_TOKEN, preferences: { low_stock: true } } };
    const restore = mockFetch({ db: officerDb({ "/adminDevices.json": devices, "/staff.json": { [OWNER_UID]: { role: "owner", active: true } } }) });
    try {
        const env = makeEnv();
        const token = idToken(OFFICER_UID);
        const low = await worker.fetch(req({ type: "admin_alert", title: "Low Stock", body: "Rice low", category: "low_stock" }, { token }), env);
        assert.equal(low.status, 200);
        const other = await worker.fetch(req({ type: "admin_alert", title: "Hi", body: "Free money", category: "staffAnnouncements" }, { token }), env);
        assert.equal(other.status, 403);
        const campaign = await worker.fetch(req({ type: "customer_campaign", title: "Sale", body: "x" }, { token }), env);
        assert.equal(campaign.status, 403);
    } finally {
        restore();
    }
});

test("rbac/roles override beats defaults (officer with updateOrders=false is refused)", async () => {
    const restore = mockFetch({ db: officerDb({ "/rbac/roles/officer.json": { updateOrders: false } }) });
    try {
        const res = await worker.fetch(req({ type: "customer_order_update", customerUid: CUSTOMER_UID, body: "x" }, { token: idToken(OFFICER_UID) }), makeEnv());
        assert.equal(res.status, 403);
    } finally {
        restore();
    }
});

test("Worker permission defaults never drift from js/rbac.js", () => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
        for (const [key, value] of Object.entries(perms)) {
            assert.equal(CLIENT_DEFAULTS[role][key], value, `${role}.${key}`);
        }
    }
    assert.deepEqual(Object.keys(DEFAULT_ROLE_PERMISSIONS).sort(), Object.keys(CLIENT_DEFAULTS).sort());
});

// ---------------------------------------------------------------- FCM token validation
test("isPlausibleFcmToken accepts real-looking tokens and rejects junk", () => {
    assert.ok(isPlausibleFcmToken(GOOD_TOKEN));
    for (const bad of ["", "short", "has space in it 1234", "<script>alert(1)</script>", "a".repeat(5000), null, undefined, 42, { a: 1 }]) {
        assert.ok(!isPlausibleFcmToken(bad), String(bad).slice(0, 20));
    }
});

test("devices with malformed FCM tokens are reported as failed and never sent to FCM", async () => {
    let fcmCalls = 0;
    const restore = mockFetch({
        fcm: () => { fcmCalls++; return Response.json({ name: "m/1" }); },
        db: officerDb({
            [`/users/${CUSTOMER_UID}/devices.json`]: {
                good: { deviceId: "good", enabled: true, orderAlerts: true, fcmToken: GOOD_TOKEN },
                bad: { deviceId: "bad", enabled: true, orderAlerts: true, fcmToken: "<img src=x onerror=alert(1)>" }
            }
        })
    });
    try {
        const res = await worker.fetch(req({ type: "customer_order_update", customerUid: CUSTOMER_UID, body: "hello" }, { token: idToken(OFFICER_UID) }), makeEnv());
        const body = await res.json();
        assert.equal(fcmCalls, 1);
        assert.equal(body.sentToProvider, 1);
        assert.equal(body.failed, 1);
        assert.ok(body.deliveryResults.some((r) => r.error === "Invalid FCM token format"));
    } finally {
        restore();
    }
});

test("responses and unexpected errors never contain credentials", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "tok-unit", expires_in: 3600 });
        throw new Error("boom: tok-unit leaked?");
    };
    try {
        const res = await worker.fetch(req({ type: "new_order_alert", orderId: "-Otest0000000000016", trackingToken: "a".repeat(48) }), makeEnv());
        const text = await res.text();
        assert.equal(res.status, 500);
        assert.ok(!text.includes("tok-unit") && !text.includes("boom"));
    } finally {
        globalThis.fetch = original;
    }
});
