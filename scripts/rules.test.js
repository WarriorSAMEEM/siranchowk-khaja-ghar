// ============================================================================
// Realtime Database Rules tests (database.rules.json)
//
// Engine: `targaryen` (offline rules simulator that evaluates the real
// database.rules.json). This is NOT the official Firebase Emulator. Re-run the
// same scenarios in the Firebase Emulator Suite / Rules Playground before
// publishing (see DEPLOYMENT-GUIDE.md -> "Verify rules before publishing").
//
// Every payload below mirrors what the application code actually writes
// (file references in comments).
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const targaryen = require("targaryen");
const rules = JSON.parse(readFileSync(new URL("../database.rules.json", import.meta.url), "utf8"));

const OWNER = "47SB1i4UL5hlUVPqM1tQoKJFdaM2";
const CUST_A = "custA0000000000000000000001";
const CUST_B = "custB0000000000000000000002";
const ADMIN = "staffAdmin000000000000000001";
const MOD = "staffMod00000000000000000001";
const OFFICER = "staffOfficer000000000000001";
const HELPER = "staffHelper00000000000000001";
const FIRED = "staffDisabled0000000000001";
const NOW = 1_780_000_000_000;
const TOKEN = "a1".repeat(24); // 48 hex chars, same shape as createTrackingToken()
const TOKEN_2 = "b2".repeat(24);
const ORDER_ID = "-OabcdefghijklmnopQR";

const staffRec = (uid, role, active = true) => ({ uid, role, active, name: role, createdAt: NOW, updatedAt: NOW });

function baseData(extra = {}) {
    return {
        staff: {
            [OWNER]: staffRec(OWNER, "owner"),
            [ADMIN]: staffRec(ADMIN, "admin"),
            [MOD]: staffRec(MOD, "moderator"),
            [OFFICER]: staffRec(OFFICER, "officer"),
            [HELPER]: staffRec(HELPER, "helper"),
            [FIRED]: staffRec(FIRED, "officer", false)
        },
        orders: { [ORDER_ID]: guestOrder({ id: ORDER_ID, customerUid: CUST_A }) },
        orderTracking: { [TOKEN]: { orderId: ORDER_ID, status: "pending", updatedAt: NOW } },
        users: {
            [CUST_A]: { profile: profile(CUST_A) },
            [CUST_B]: { profile: profile(CUST_B) }
        },
        adminDevices: {
            devHelper000001: adminDevice("devHelper000001", HELPER, "helper", "approved")
        },
        ...extra
    };
}

const db = (extra) => targaryen.database(rules, baseData(extra), NOW);
const as = (uid, extra) => db(extra).as(uid ? { uid } : null);

function allowed(result) {
    return result.allowed === true;
}
function expectAllow(result, label) {
    assert.ok(allowed(result), `${label} should be ALLOWED but was denied:\n${result.info || ""}`);
}
function expectDeny(result, label) {
    assert.ok(!allowed(result), `${label} should be DENIED but was allowed`);
}

// ---------- payload factories (mirror application code) ----------

// js/order-system.js:706 (guest/signed-in order). Items are an array of {name, quantity}.
function guestOrder(over = {}) {
    return {
        id: ORDER_ID,
        customerName: "Ram Karki",
        customerPhone: "9800000000",
        items: [{ name: "Chicken Momo", quantity: 2 }, { name: "Milk Tea", quantity: 1 }],
        summary: "2 × Chicken Momo, 1 × Milk Tea",
        orderType: "Pickup",
        deliveryAddress: "",
        notes: "",
        status: "pending",
        source: "website",
        currency: "NPR",
        priceStatus: "confirm_at_counter",
        customerTrackingToken: TOKEN,
        createdAt: NOW,
        updatedAt: NOW,
        ...over
    };
}

// js/customer-auth.js:107 fallbackProfile
function profile(uid, over = {}) {
    return {
        uid,
        name: "Test Customer",
        email: "t@example.com",
        phone: "9800000000",
        address: "",
        authProvider: "password",
        emailVerified: false,
        accountStatus: "active",
        loginCount: 1,
        lastLoginAt: NOW,
        lastActiveAt: NOW,
        lastSessionId: "s1",
        notificationPreferences: { orderAlerts: false, offersOptIn: false, browserPermission: "default", updatedAt: NOW },
        createdAt: NOW,
        updatedAt: NOW,
        ...over
    };
}

// js/device-manager.js:236 record
function adminDevice(deviceId, uid, role, approvalStatus, over = {}) {
    return {
        deviceId,
        deviceName: "Chrome on Windows",
        uid,
        staffName: "Staff",
        staffEmail: "s@example.com",
        role,
        deviceType: "desktop",
        browser: "Chrome",
        os: "Windows",
        firstLoginAt: NOW,
        lastActiveAt: NOW,
        pushStatus: "disabled",
        fcmToken: "",
        preferences: { newOrders: true, staffAnnouncements: true },
        approvalStatus,
        blocked: false,
        sessionVersion: 1,
        ...over
    };
}

// js/analytics-tracker.js:299 getCommonEventData() + event extras
function analyticsEvent(over = {}) {
    return {
        eventType: "page_view",
        sessionId: "sess_abcdefgh1234",
        visitorId: "vis_abcdefgh1234",
        isReturning: false,
        authState: "anonymous",
        page: "/",
        pageTitle: "Siranchowk Khaja Ghar",
        referrer: "",
        referrerHost: "",
        device: "mobile",
        browser: "Chrome",
        operatingSystem: "Android",
        screenWidth: 390,
        screenHeight: 844,
        language: "en-US",
        timestamp: new Date(NOW).toISOString(),
        numericTimestamp: NOW,
        ...over
    };
}

// js/analytics-tracker.js:260 sessionPayload
function visitorSession(over = {}) {
    return {
        sessionId: "sess_abcdefgh1234",
        visitorId: "vis_abcdefgh1234",
        startTime: NOW,
        lastActivityAt: NOW,
        estimatedDurationSec: 12,
        pageCount: 1,
        pagesVisited: { home: { path: "/", views: 1, estimatedDurationSec: 12, lastVisitedAt: NOW } },
        landingPage: "/",
        lastPage: "/",
        device: "mobile",
        browser: "Chrome",
        operatingSystem: "Android",
        referrer: "",
        referrerHost: "",
        isReturning: false,
        ...over
    };
}

// js/analytics-tracker.js:283
function visitorProfile(over = {}) {
    return {
        visitorId: "vis_abcdefgh1234",
        firstVisitAt: NOW,
        lastVisitAt: NOW,
        visitCount: 1,
        lastSessionId: "sess_abcdefgh1234",
        device: "mobile",
        browser: "Chrome",
        operatingSystem: "Android",
        ...over
    };
}

// ============================================================================
// 1-6, 21: ORDERS
// ============================================================================
test("orders: only owner/staff can write canonical orders; customer orders go through the trusted Worker", () => {
    const id = "-Onew00000000000000001";
    const order = guestOrder({ id, customerUid: CUST_A, customerEmail: "a@example.com", couponCode: "WELCOME", couponSummary: "10% off" });
    expectDeny(as(null).write(`/orders/${id}`, guestOrder({ id })), "anonymous direct create denied");
    expectDeny(as(CUST_A).write(`/orders/${id}`, order), "customer direct create denied");
    expectDeny(as(OFFICER).write(`/orders/${id}`, order), "staff cannot create canonical orders directly");
    expectAllow(as(OWNER).write(`/orders/${id}`, order), "owner write remains available");
});

test("orders: invalid order data is rejected", () => {
    const path = "/orders/-Onew00000000000000001";
    const mk = (over) => guestOrder({ id: "-Onew00000000000000001", ...over });
    expectDeny(as(OWNER).write(path, mk({ orderType: "Teleport" })), "bad orderType");
    expectDeny(as(OWNER).write(path, mk({ status: "delivered" })), "non-pending create");
    expectDeny(as(OWNER).write(path, mk({ source: "admin" })), "bad source");
    expectDeny(as(OWNER).write(path, mk({ customerName: "" })), "empty name");
    expectDeny(as(OWNER).write(path, mk({ customerName: "x".repeat(81) })), "long name");
    expectDeny(as(OWNER).write(path, mk({ customerPhone: "123" })), "short phone");
    expectDeny(as(OWNER).write(path, mk({ customerTrackingToken: "short" })), "short token");
    expectDeny(as(OWNER).write(path, mk({ items: [{ name: "Momo", quantity: 21 }] })), "qty 21");
    expectDeny(as(OWNER).write(path, mk({ items: [{ name: "Momo", quantity: 0 }] })), "qty 0");
    expectDeny(as(OWNER).write(path, mk({ items: [{ name: "", quantity: 1 }] })), "empty item name");
    expectDeny(as(OWNER).write(path, mk({ id: "someOtherId" })), "id != key");
    expectDeny(as(OWNER).write(path, mk({ currency: "USD" })), "bad currency");
});

test("orders: anonymous and customers cannot read all orders or any single order", () => {
    expectDeny(as(null).read("/orders"), "anon list");
    expectDeny(as(null).read(`/orders/${ORDER_ID}`), "anon single");
    expectDeny(as(CUST_A).read("/orders"), "customer list");
    expectDeny(as(CUST_A).read(`/orders/${ORDER_ID}`), "customer reads even own order by id (they use users/{uid}/orders)");
    expectDeny(as(FIRED).read("/orders"), "deactivated staff");
});

test("orders: customers (and anonymous) cannot modify status or overwrite existing orders", () => {
    expectDeny(as(null).write(`/orders/${ORDER_ID}/status`, "delivered"), "anon status");
    expectDeny(as(CUST_A).write(`/orders/${ORDER_ID}/status`, "cancelled"), "owner-customer status");
    expectDeny(as(CUST_B).write(`/orders/${ORDER_ID}/status`, "cancelled"), "other customer status");
    expectDeny(as(CUST_B).write(`/orders/${ORDER_ID}`, guestOrder({ customerName: "Hijack" })), "overwrite existing");
    expectDeny(as(null).write(`/orders/${ORDER_ID}`, null), "anon delete");
});

test("orders: owner can read and update; staff limited by role", () => {
    expectAllow(as(OWNER).read("/orders"), "owner list");
    // admin/js/orders.js:460
    const upd = { status: "accepted", updatedAt: NOW + 1, updatedByUid: OWNER, updatedByRole: "owner" };
    expectAllow(as(OWNER).update(`/orders/${ORDER_ID}`, upd), "owner update");
    expectAllow(as(HELPER).update(`/orders/${ORDER_ID}`, { ...upd, status: "preparing", updatedByUid: HELPER, updatedByRole: "helper" }), "helper default updateOrders");
    expectDeny(as(HELPER).update(`/orders/${ORDER_ID}`, { ...upd, status: "cancelled" }), "helper cancel");
    expectAllow(as(ADMIN).update(`/orders/${ORDER_ID}`, { ...upd, status: "cancelled" }), "admin cancel");
    expectDeny(as(FIRED).update(`/orders/${ORDER_ID}`, upd), "deactivated staff update");
    expectDeny(as(HELPER).write(`/orders/${ORDER_ID}`, null), "staff delete");
});

test("orders: rbac/roles overrides are honoured by the rules", () => {
    const extra = { rbac: { roles: { officer: { viewOrders: false, updateOrders: false } } } };
    expectDeny(as(OFFICER, extra).read("/orders"), "officer viewOrders=false");
    expectDeny(as(OFFICER, extra).update(`/orders/${ORDER_ID}`, { status: "accepted", updatedAt: NOW + 1 }), "officer updateOrders=false");
});

// ============================================================================
// 4-5: ORDER TRACKING
// ============================================================================
test("orderTracking: customers cannot create tracking records; token holders can read", () => {
    const data = { orders: { "-Onew00000000000000001": guestOrder({ id: "-Onew00000000000000001", customerTrackingToken: TOKEN_2 }) } };
    const tracking = { orderId: "-Onew00000000000000001", status: "pending", updatedAt: NOW };
    expectDeny(as(null, data).write(`/orderTracking/${TOKEN_2}`, tracking), "anonymous tracking create denied");
    expectDeny(as(CUST_A, data).write(`/orderTracking/${TOKEN_2}`, tracking), "customer tracking create denied");
    expectDeny(as(OFFICER, data).write(`/orderTracking/${TOKEN_2}`, tracking), "staff cannot create tracking directly");
    expectAllow(as(OWNER, data).write(`/orderTracking/${TOKEN_2}`, tracking), "owner tracking write remains available");
    expectAllow(as(null).read(`/orderTracking/${TOKEN}`), "read with correct token");
});

test("orderTracking: invalid tokens are rejected and the collection cannot be listed", () => {
    expectDeny(as(null).read("/orderTracking"), "list tracking");
    expectDeny(as(null).read("/orderTracking/shorttoken"), "short token read");
    expectDeny(as(null).write("/orderTracking/shorttoken", { orderId: ORDER_ID, status: "pending", updatedAt: NOW }), "short token write");
});

test("orderTracking: cannot be squatted for an order/token that does not match", () => {
    // Token that is not the token stored on the order -> must be rejected.
    expectDeny(as(null).write(`/orderTracking/${TOKEN_2}`, { orderId: ORDER_ID, status: "pending", updatedAt: NOW }), "token not bound to order");
    expectDeny(as(null).write(`/orderTracking/${TOKEN_2}`, { orderId: "-Odoesnotexist0000000", status: "pending", updatedAt: NOW }), "unknown order");
});

test("orderTracking: customers cannot change status; staff can (and only known fields)", () => {
    expectDeny(as(null).write(`/orderTracking/${TOKEN}/status`, "delivered"), "anon status change");
    expectDeny(as(CUST_A).write(`/orderTracking/${TOKEN}`, { orderId: ORDER_ID, status: "delivered", updatedAt: NOW }), "customer overwrite");
    // admin/js/orders.js:468
    expectAllow(as(OFFICER).update(`/orderTracking/${TOKEN}`, { status: "accepted", updatedAt: NOW + 1, customerMessage: "We accepted your order" }), "staff status");
    expectDeny(as(OFFICER).update(`/orderTracking/${TOKEN}`, { status: "cancelled", updatedAt: NOW + 1 }), "officer cancel (cancelOrders=false)");
    expectDeny(as(HELPER).update(`/orderTracking/${TOKEN}`, { customerPhone: "9800000000" }), "no PII fields allowed on tracking");
    expectAllow(as(OWNER).update(`/orderTracking/${TOKEN}`, { status: "delivered", updatedAt: NOW + 2 }), "owner status");
});

// ============================================================================
// 8-9: USERS / DEVICES / ACTIVITY
// ============================================================================
test("users: A can manage own profile; cannot read or modify B's profile", () => {
    expectAllow(as(CUST_A).read(`/users/${CUST_A}/profile`), "own read");
    expectAllow(as(CUST_A).update(`/users/${CUST_A}/profile`, { name: "New Name", phone: "9811111111", updatedAt: NOW + 1, lastActiveAt: NOW + 1 }), "own update");
    expectAllow(as(CUST_A).write(`/users/${CUST_A}/profile/loginCount`, 2), "loginCount transaction path");
    expectDeny(as(CUST_A).read(`/users/${CUST_B}/profile`), "read B");
    expectDeny(as(CUST_A).read(`/users/${CUST_B}`), "read B root");
    expectDeny(as(CUST_A).read("/users"), "list users");
    expectDeny(as(CUST_A).update(`/users/${CUST_B}/profile`, { name: "Hacked" }), "write B");
    expectDeny(as(null).read(`/users/${CUST_A}/profile`), "anon read");
    expectDeny(as(CUST_A).update(`/users/${CUST_A}/profile`, { role: "admin" }), "self-promote role");
});

test("users: first-time profile creation matches rules", () => {
    expectAllow(as("newcust000000000000000001").write("/users/newcust000000000000000001/profile", profile("newcust000000000000000001")), "create profile");
});

test("users: A manages own devices; cannot touch B's devices; token shape validated", () => {
    // js/notifications-client.js:113
    const dev = { deviceId: "dev_abcdefghijkl", uid: CUST_A, deviceName: "Chrome on Windows", browser: "Chrome", os: "Windows", fcmToken: "dXyZ-123:APA91b_abc", orderAlerts: true, offersOptIn: false, enabled: true, updatedAt: NOW };
    expectAllow(as(CUST_A).write(`/users/${CUST_A}/devices/dev_abcdefghijkl`, dev), "register own device");
    expectAllow(as(CUST_A).update(`/users/${CUST_A}/devices/dev_abcdefghijkl`, { enabled: false, orderAlerts: false, offersOptIn: false, updatedAt: NOW + 1, deviceId: "dev_abcdefghijkl", uid: CUST_A }), "disable own device");
    expectDeny(as(CUST_B).write(`/users/${CUST_A}/devices/dev_abcdefghijkl`, dev), "B writes A's device");
    expectDeny(as(CUST_B).read(`/users/${CUST_A}/devices`), "B reads A's devices");
    expectDeny(as(null).write(`/users/${CUST_A}/devices/dev_abcdefghijkl`, dev), "anon device write");
    expectDeny(as(CUST_A).write(`/users/${CUST_A}/devices/dev_abcdefghijkl`, { ...dev, fcmToken: "x".repeat(5000) }), "oversized fcm token");
    expectDeny(as(CUST_A).write(`/users/${CUST_A}/devices/dev_abcdefghijkl`, { ...dev, fcmToken: "<script>alert(1)</script>" }), "malformed fcm token");
    expectDeny(as(CUST_A).write(`/users/${CUST_A}/devices/dev_abcdefghijkl`, { ...dev, uid: CUST_B }), "uid mismatch");
});

test("users: activity is append-only and bound to the actor", () => {
    // js/activity-logger.js:315
    const act = { id: "-Oact000000000000001", actorUid: CUST_A, type: "login", details: { method: "password" }, timestamp: NOW, sessionId: "s1", browser: "Chrome", os: "Windows", deviceType: "desktop", userAgent: "UA" };
    expectAllow(as(CUST_A).write(`/users/${CUST_A}/activity/-Oact000000000000001`, act), "append own");
    expectDeny(as(CUST_B).write(`/users/${CUST_A}/activity/-Oact000000000000002`, { ...act, id: "-Oact000000000000002" }), "B appends to A");
    const data = { users: { [CUST_A]: { activity: { "-Oact000000000000001": act } } } };
    expectDeny(as(CUST_A, data).write(`/users/${CUST_A}/activity/-Oact000000000000001`, { ...act, type: "edited" }), "edit existing");
    expectDeny(as(CUST_A, data).write(`/users/${CUST_A}/activity/-Oact000000000000001`, null), "delete existing");
});

test("users: customer cannot forge order mirrors or coupon locks; own inbox remains writable", () => {
    const id = ORDER_ID;
    const mirror = { ...guestOrder({ customerUid: CUST_A }), trackingSaved: true };
    expectDeny(as(CUST_A, { users: { [CUST_A]: {} } }).write(`/users/${CUST_A}/orders/${id}`, mirror), "customer cannot forge mirror create");
    expectDeny(as(OFFICER, { users: { [CUST_A]: {} } }).write(`/users/${CUST_A}/orders/${id}`, mirror), "staff cannot create mirror directly");
    expectDeny(as(CUST_A).write(`/users/${CUST_B}/orders/${id}`, mirror), "mirror into B");
    expectDeny(as(CUST_A).write(`/users/${CUST_A}/coupons/c1`, { id: "c1", code: "WELCOME", title: "t", summary: "s", used: true, orderId: id, usedAt: NOW }), "customer cannot forge coupon lock");
    expectAllow(as(CUST_A).write(`/users/${CUST_A}/notifications/ord_${id}_pending`, { id: `ord_${id}_pending`, orderId: id, status: "pending", title: "Order Received", body: "Thanks", createdAt: NOW, read: false }), "inbox");
});

test("users: staff status update mirror + inbox write (admin/js/orders.js:476,179)", () => {
    const data = { users: { [CUST_A]: { profile: profile(CUST_A), orders: { [ORDER_ID]: guestOrder({ customerUid: CUST_A }) } } } };
    expectAllow(as(OFFICER, data).update(`/users/${CUST_A}/orders/${ORDER_ID}`, { status: "accepted", updatedAt: NOW + 1, customerMessage: "ok" }), "mirror status");
    expectAllow(as(OFFICER, data).write(`/users/${CUST_A}/notifications/ord_${ORDER_ID}_accepted`, { id: `ord_${ORDER_ID}_accepted`, orderId: ORDER_ID, status: "accepted", title: "t", body: "b", createdAt: NOW, read: false }), "inbox");
    expectDeny(as(CUST_B, data).update(`/users/${CUST_A}/orders/${ORDER_ID}`, { status: "delivered", updatedAt: NOW + 1 }), "other customer mirror");
});

// ============================================================================
// 10-13: ANALYTICS / VISITORS
// ============================================================================
test("analytics/events: valid events can be created by anonymous visitors", () => {
    expectAllow(as(null).write("/analytics/events/-Oev0000000000000001", analyticsEvent()), "page_view");
    expectAllow(as(null).write("/analytics/events/-Oev0000000000000002", analyticsEvent({ eventType: "add_to_cart", productName: "Momo", quantity: 2 })), "add_to_cart");
    expectAllow(as(null).write("/analytics/events/-Oev0000000000000003", analyticsEvent({ eventType: "order_submitted", orderType: "Pickup", itemCount: 3, authState: "authenticated" })), "order_submitted");
    expectAllow(as(null).write("/analytics/events/-Oev0000000000000004", analyticsEvent({ eventType: "product_view", productName: "Momo", category: "snacks" })), "product_view");
    expectAllow(as(null).write("/analytics/events/-Oev0000000000000005", analyticsEvent({ eventType: "whatsapp_click", label: "Order on WhatsApp" })), "label event");
    // Backward compatibility: older events lack the newer fields.
    expectAllow(as(null).write("/analytics/events/-Oev0000000000000006", { eventType: "page_view", timestamp: new Date(NOW).toISOString(), page: "/", browser: "Chrome" }), "legacy event");
});

test("analytics/events: malformed or abusive events are rejected", () => {
    const p = "/analytics/events/-Oev0000000000000009";
    expectDeny(as(null).write(p, { foo: "bar" }), "missing required");
    expectDeny(as(null).write(p, analyticsEvent({ eventType: "x".repeat(49) })), "long eventType");
    expectDeny(as(null).write(p, analyticsEvent({ page: "p".repeat(300) })), "oversized page");
    expectDeny(as(null).write(p, analyticsEvent({ injected: "payload" })), "unknown field");
    expectDeny(as(null).write(p, analyticsEvent({ screenWidth: "wide" })), "wrong type");
    expectDeny(as(null).write(p, analyticsEvent({ visitorId: "v" })), "visitorId too short");
});

test("analytics/events: events are immutable for visitors; only privileged staff may delete", () => {
    const data = { analytics: { events: { "-Oev0000000000000001": analyticsEvent() } } };
    expectDeny(as(null, data).write("/analytics/events/-Oev0000000000000001", analyticsEvent({ eventType: "tampered" })), "overwrite");
    expectDeny(as(null, data).write("/analytics/events/-Oev0000000000000001", null), "anon delete");
    expectDeny(as(CUST_A, data).write("/analytics/events/-Oev0000000000000001", null), "customer delete");
    expectAllow(as(OWNER, data).write("/analytics/events/-Oev0000000000000001", null), "owner retention delete");
});

test("analytics: unauthorized users cannot read analytics / visitor data", () => {
    const data = {
        analytics: { events: { e1: analyticsEvent() } },
        visitorSessions: { sess_abcdefgh1234: visitorSession() },
        visitorProfiles: { vis_abcdefgh1234: visitorProfile() }
    };
    for (const path of ["/analytics", "/analytics/events", "/visitorSessions", "/visitorSessions/sess_abcdefgh1234", "/visitorProfiles", "/visitorProfiles/vis_abcdefgh1234"]) {
        expectDeny(as(null, data).read(path), `anon read ${path}`);
        expectDeny(as(CUST_A, data).read(path), `customer read ${path}`);
        expectDeny(as(HELPER, data).read(path), `helper read ${path}`);
        expectDeny(as(FIRED, data).read(path), `deactivated staff read ${path}`);
    }
    for (const path of ["/analytics/events", "/visitorSessions", "/visitorProfiles"]) {
        expectAllow(as(OWNER, data).read(path), `owner read ${path}`);
        expectAllow(as(ADMIN, data).read(path), `admin read ${path}`);
    }
});

test("visitorSessions: anonymous creation and updates work; hijack and junk rejected", () => {
    // js/analytics-tracker.js:282 (first flush creates; later flushes update)
    const id = "sess_abcdefgh1234";
    expectAllow(as(null).update(`/visitorSessions/${id}`, visitorSession()), "create");
    const data = { visitorSessions: { [id]: visitorSession() } };
    expectAllow(as(null, data).update(`/visitorSessions/${id}`, visitorSession({ lastActivityAt: NOW + 5000, pageCount: 2, lastPage: "/menu.html" })), "update");
    expectAllow(as(null, data).update(`/visitorSessions/${id}`, { ...visitorSession({ lastActivityAt: NOW + 9000 }), endTime: NOW + 9000 }), "close (endTime)");
    expectDeny(as(null, data).update(`/visitorSessions/${id}`, visitorSession({ visitorId: "vis_someoneElse99" })), "hijack to other visitor");
    expectDeny(as(null).update(`/visitorSessions/${id}`, visitorSession({ sessionId: "other_session_id" })), "id mismatch");
    expectDeny(as(null).update(`/visitorSessions/${id}`, visitorSession({ pageCount: "many" })), "bad type");
    expectDeny(as(null).update(`/visitorSessions/${id}`, { ...visitorSession(), evil: "x" }), "unknown field");
    expectDeny(as(null, data).write(`/visitorSessions/${id}`, null), "anon delete");
});

test("visitorProfiles: anonymous create/update works; first-visit time cannot be rewound; no anon delete", () => {
    const id = "vis_abcdefgh1234";
    expectAllow(as(null).update(`/visitorProfiles/${id}`, visitorProfile()), "create");
    const data = { visitorProfiles: { [id]: visitorProfile() } };
    expectAllow(as(null, data).update(`/visitorProfiles/${id}`, visitorProfile({ lastVisitAt: NOW + 1000, visitCount: 2 })), "update");
    expectDeny(as(null, data).update(`/visitorProfiles/${id}`, visitorProfile({ firstVisitAt: 1 })), "rewind firstVisitAt");
    expectDeny(as(null).update(`/visitorProfiles/${id}`, visitorProfile({ visitorId: "vis_other_visitor" })), "id mismatch");
    expectDeny(as(null, data).write(`/visitorProfiles/${id}`, null), "anon delete");
});

// ============================================================================
// 14-16: PUSH — what the code really uses (adminDevices + users/*/devices)
// NOTE: pushSubscriptions/* and pushNotificationEvents/* are not used anywhere
// in this codebase. Tokens live in adminDevices/{deviceId}/fcmToken and
// users/{uid}/devices/{deviceId}/fcmToken; the Worker writes through the
// service-account REST API (rules are bypassed by design).
// ============================================================================
test("adminDevices: staff can register a NEW device (pending) after the existence check read", () => {
    // device-manager.js:149 get(adminDevices/<new id>) happens BEFORE the set().
    const id = "devNewStaff000001";
    for (const uid of [HELPER, OFFICER, MOD, ADMIN]) {
        expectAllow(as(uid).read(`/adminDevices/${id}`), `${uid} existence check on missing device`);
    }
    const rec = adminDevice(id, OFFICER, "officer", "pending");
    expectAllow(as(OFFICER).write(`/adminDevices/${id}`, rec), "officer register pending");
    expectDeny(as(OFFICER).write(`/adminDevices/${id}`, { ...rec, approvalStatus: "approved" }), "self-approve on create");
    expectDeny(as(OFFICER).write(`/adminDevices/${id}`, { ...rec, uid: HELPER }), "register for another uid");
    expectDeny(as(null).write(`/adminDevices/${id}`, rec), "anon register");
    expectDeny(as(CUST_A).write(`/adminDevices/${id}`, rec), "customer register");
    expectDeny(as(FIRED).write(`/adminDevices/${id}`, adminDevice(id, FIRED, "officer", "pending")), "deactivated staff register");
});

test("adminDevices: owner first-device bootstrap approval works; existing devices stay private", () => {
    const id = "devOwner0000001";
    expectAllow(as(OWNER).read("/adminDevices"), "owner list");
    expectAllow(as(OWNER).write(`/adminDevices/${id}`, adminDevice(id, OWNER, "owner", "approved")), "owner approved device");
    expectDeny(as(OFFICER).read("/adminDevices/devHelper000001"), "officer reads someone else's existing device");
    expectDeny(as(OFFICER).read("/adminDevices"), "officer lists devices");
    expectDeny(as(null).read("/adminDevices"), "anon list devices");
    expectDeny(as(CUST_A).read("/adminDevices/devHelper000001"), "customer reads staff device (FCM token)");
});

test("adminDevices: admin push registration updates (js/notifications-client.js:210) and approval protections", () => {
    const id = "devHelper000001";
    expectAllow(as(HELPER).update(`/adminDevices/${id}`, { pushStatus: "enabled", fcmToken: "dXyZ-123:APA91b_abc", lastActiveAt: NOW + 1 }), "enable push");
    expectAllow(as(HELPER).update(`/adminDevices/${id}`, { pushStatus: "disabled", fcmToken: "" }), "disable push");
    expectAllow(as(HELPER).update(`/adminDevices/${id}`, { lastSessionEndedAt: NOW + 5 }), "mark session ended");
    expectDeny(as(HELPER).update(`/adminDevices/${id}`, { approvalStatus: "approved", blocked: false, sessionVersion: 2 }), "tamper sessionVersion");
    expectDeny(as(HELPER).update(`/adminDevices/${id}`, { blocked: true }), "tamper blocked");
    expectDeny(as(HELPER).update(`/adminDevices/${id}`, { fcmToken: "x".repeat(5000) }), "oversized token");
    expectDeny(as(HELPER).update(`/adminDevices/${id}`, { pushStatus: "<b>hax</b>" }), "bad pushStatus");
    expectDeny(as(OFFICER).update(`/adminDevices/${id}`, { fcmToken: "attacker-token" }), "other staff overwrite token");
    expectDeny(as(CUST_A).update(`/adminDevices/${id}`, { fcmToken: "attacker-token" }), "customer overwrite token");
    // devices.js:201 owner approves
    expectAllow(as(OWNER, { adminDevices: { pend1: adminDevice("pend1", OFFICER, "officer", "pending") } }).update("/adminDevices/pend1", { approvalStatus: "approved", blocked: false, approvedAt: NOW }), "owner approves");
    expectDeny(as(ADMIN, { adminDevices: { pend1: adminDevice("pend1", OFFICER, "officer", "pending") } }).update("/adminDevices/pend1", { approvalStatus: "approved" }), "admin approves (owner only by default)");
});

test("low-stock automation: order staff can raise the admin alert and stamp the item (js/inventory-sync.js:99-112)", () => {
    const data = { inventory: { items: { it1: { id: "it1", name: "Rice", currentStock: 1, minThreshold: 5, unit: "kg" } } } };
    const notif = { id: "-Onotif00000000000001", title: "Low Stock Alert: Rice", body: "Rice is down to 1 kg", targetType: "all", targetDeviceIds: [], senderUid: OFFICER, senderEmail: "o@example.com", category: "low_stock", createdAt: NOW };
    expectAllow(as(OFFICER, data).write("/adminNotifications/-Onotif00000000000001", notif), "officer low_stock alert");
    expectAllow(as(OFFICER, data).update("/inventory/items/it1", { lowStockAlertSentAt: NOW }), "stamp alert time");
    // Not a general broadcast channel:
    expectDeny(as(OFFICER, data).write("/adminNotifications/-Onotif00000000000002", { ...notif, id: "-Onotif00000000000002", category: "announcement" }), "officer arbitrary announcement");
    expectDeny(as(CUST_A, data).write("/adminNotifications/-Onotif00000000000003", notif), "customer");
    expectDeny(as(OFFICER, data).update("/inventory/items/it1", { minThreshold: 0, name: "x" }), "officer edits item definition");
    expectDeny(as(OFFICER, data).write("/inventory/items/it1/currentStock", -4), "negative stock");
    expectAllow(as(OFFICER, data).write("/inventory/items/it1/currentStock", 0), "stock deduction");
});

test("push event paths absent from rules stay default-deny (not used by this app)", () => {
    expectDeny(as(null).write("/pushSubscriptions/customer/x/y", { fcmToken: "a", registeredAt: NOW }), "anon pushSubscriptions");
    expectDeny(as(CUST_A).read("/pushSubscriptions"), "customer pushSubscriptions read");
    expectDeny(as(CUST_A).write("/pushNotificationEvents/adminNewOrders/e1/createdAt", NOW), "customer pushNotificationEvents");
});

// ============================================================================
// ROOT + PUBLIC CONTENT + STAFF MANAGEMENT
// ============================================================================
test("root is default-deny; public catalogue is read-only for the public", () => {
    expectDeny(as(null).read("/"), "root read anon");
    expectDeny(as(OWNER).read("/") , "root read owner (no root .read)");
    expectDeny(as(null).write("/x", 1), "root write anon");
    for (const p of ["/menu_items", "/categories", "/offers", "/announcements/customer", "/settings/business", "/settings/pushPublic", "/inventory/stockAvailability"]) {
        expectAllow(as(null).read(p), `public read ${p}`);
        expectDeny(as(null).write(p, { x: 1 }), `anon write ${p}`);
        expectDeny(as(CUST_A).write(p, { x: 1 }), `customer write ${p}`);
    }
    expectDeny(as(null).read("/staff"), "staff list");
    expectDeny(as(CUST_A).read(`/staff/${OWNER}`), "customer reads owner staff record");
    expectDeny(as(null).read("/loginHistory"), "loginHistory");
    expectDeny(as(OWNER).write("/loginHistory/x", { id: "x" }), "client cannot write loginHistory (Worker only)");
    expectDeny(as(OWNER).write("/securityLogs/x", { id: "x" }), "client cannot write securityLogs (Worker only)");
});

test("staff: primary owner is protected; admins cannot elevate", () => {
    expectAllow(as(OWNER).read("/staff"), "owner list staff");
    expectAllow(as(HELPER).read(`/staff/${HELPER}`), "own staff record (admin/js/auth.js:75)");
    expectDeny(as(HELPER).read(`/staff/${ADMIN}`), "other staff record");
    expectDeny(as(ADMIN).write(`/staff/${OWNER}`, null), "admin deletes owner");
    expectDeny(as(OWNER).write(`/staff/${OWNER}`, null), "owner deletes self");
    expectDeny(as(HELPER).write(`/staff/${HELPER}/role`, "owner"), "helper self-promote");
    expectDeny(as(ADMIN).write("/staff/newadmin", staffRec("newadmin", "admin")), "admin creates admin");
    expectAllow(as(ADMIN).write("/staff/newhelper", staffRec("newhelper", "helper")), "admin creates helper");
    expectAllow(as(OWNER).write("/staff/newadmin", staffRec("newadmin", "admin")), "owner creates admin");
    // admin/js/auth.js:92 owner bootstrap on a fresh database (no staff record at all)
    const fresh = targaryen.database(rules, {}, NOW).as({ uid: OWNER });
    expectAllow(fresh.write(`/staff/${OWNER}`, staffRec(OWNER, "owner")), "fresh-DB owner bootstrap");
});

test("audit/notification history: staff append; customers limited to own order/customer history", () => {
    // js/audit-logger.js:55
    const audit = { id: "-Oaud0000000000000001", actorUid: OFFICER, actorName: "O", actorEmail: "o@x.com", actorRole: "officer", action: "device_registered", target: "d", status: "success", deviceType: "desktop", browser: "Chrome", operatingSystem: "Windows", metadata: {}, timestamp: NOW };
    expectAllow(as(OFFICER).write("/auditLogs/-Oaud0000000000000001", audit), "officer audit");
    expectDeny(as(OFFICER).write("/auditLogs/-Oaud0000000000000002", { ...audit, actorUid: HELPER }), "spoofed actor");
    expectDeny(as(CUST_A).write("/auditLogs/-Oaud0000000000000003", { ...audit, actorUid: CUST_A }), "customer audit");
    expectDeny(as(OFFICER).read("/auditLogs"), "officer reads audit");
    // js/order-system.js:795 customer history entry
    const hist = { id: "h1", channel: "orders", title: "Received", message: "m", type: "order_received", targetAudience: `customer:${CUST_A}`, status: "created", actorUid: CUST_A, createdAt: NOW };
    expectAllow(as(CUST_A).write("/notificationHistory/orders/h1", hist), "customer order history");
    expectDeny(as(CUST_A).write("/notificationHistory/campaigns/h2", { ...hist, id: "h2", channel: "campaigns" }), "customer campaign history");
    expectDeny(as(CUST_A).read("/notificationHistory"), "customer read history");
});

// ============================================================================
// 17-24: GLOBAL CONTENT, CREATOR STUDIO, BADGES & SOCIAL GRAPH RULES
// ============================================================================

const asAuth = (authObj, extra) => db(extra).as(authObj);

function publicProfile(uid, username, over = {}) {
    return {
        uid,
        username,
        displayName: "Creator Name",
        bio: "Food & tech notes from Chitwan",
        visibility: "public",
        creatorStatus: "none",
        followersCount: 0,
        followingCount: 0,
        articlesCount: 0,
        badges: {
            emailVerified: false,
            verifiedCreator: false,
            officialOrg: false,
            expertSpecialist: false
        },
        updatedAt: NOW,
        ...over
    };
}

function publishedArticle(id, authorUid, over = {}) {
    return {
        id,
        slug: `story-${id.toLowerCase()}`,
        title: "Chitwan Food & Engineering Guide",
        category: "food",
        authorUid,
        authorUsername: "creator_a",
        authorName: "Creator A",
        status: "published",
        visibility: "public",
        publishedAt: NOW,
        updatedAt: NOW,
        likesCount: 0,
        commentsCount: 0,
        repostsCount: 0,
        viewsCount: 0,
        sharesCount: 0,
        contentMarkdown: "## Heading\n\nBody text.",
        ...over
    };
}

test("creatorDrafts: strict private per-user isolation (even owner/admin cannot read or write)", () => {
    const draft = { id: "d1", authorUid: CUST_A, title: "My Private Draft", contentMarkdown: "wip", updatedAt: NOW };
    expectAllow(as(CUST_A).write(`/creatorDrafts/${CUST_A}/d1`, draft), "creator saves own draft");
    const data = { creatorDrafts: { [CUST_A]: { d1: draft } } };
    expectAllow(as(CUST_A, data).read(`/creatorDrafts/${CUST_A}`), "creator reads own drafts");
    expectDeny(as(CUST_B, data).read(`/creatorDrafts/${CUST_A}`), "other user reads A's drafts");
    expectDeny(as(ADMIN, data).read(`/creatorDrafts/${CUST_A}`), "admin reads A's private drafts");
    expectDeny(as(OWNER, data).read(`/creatorDrafts/${CUST_A}`), "owner reads A's private drafts");
    expectDeny(as(CUST_B, data).write(`/creatorDrafts/${CUST_A}/d2`, { ...draft, id: "d2" }), "other user writes A's drafts");
    expectDeny(as(CUST_A).write(`/creatorDrafts/${CUST_A}/d3`, { ...draft, id: "d3", authorUid: CUST_B }), "mismatched authorUid");
});

test("userBookmarks: private per-user isolation", () => {
    const bm = { articleId: "art1", slug: "s1", title: "Story", savedAt: NOW };
    expectAllow(as(CUST_A).write(`/userBookmarks/${CUST_A}/art1`, bm), "user saves bookmark");
    const data = { userBookmarks: { [CUST_A]: { art1: bm } } };
    expectAllow(as(CUST_A, data).read(`/userBookmarks/${CUST_A}`), "user reads own bookmarks");
    expectDeny(as(CUST_B, data).read(`/userBookmarks/${CUST_A}`), "other user reads bookmarks");
    expectDeny(as(OWNER, data).read(`/userBookmarks/${CUST_A}`), "owner reads private bookmarks");
    expectDeny(as(null, data).read(`/userBookmarks/${CUST_A}`), "anon reads bookmarks");
});

test("creatorAnalytics: client writes always denied; reads restricted to creator or viewContentAnalytics staff", () => {
    const data = { creatorAnalytics: { [CUST_A]: { summary: { totalViews: 12, readCompletes: 4, totalShares: 2 } } } };
    expectAllow(as(CUST_A, data).read(`/creatorAnalytics/${CUST_A}`), "creator reads own analytics");
    expectAllow(as(ADMIN, data).read(`/creatorAnalytics/${CUST_A}`), "admin (viewContentAnalytics) reads analytics");
    expectAllow(as(OWNER, data).read(`/creatorAnalytics/${CUST_A}`), "owner reads analytics");
    expectDeny(as(CUST_B, data).read(`/creatorAnalytics/${CUST_A}`), "other user reads A's analytics");
    expectDeny(as(MOD, data).read(`/creatorAnalytics/${CUST_A}`), "moderator without viewContentAnalytics");
    expectDeny(as(CUST_A, data).write(`/creatorAnalytics/${CUST_A}/summary/totalViews`, 999), "creator inflates views");
    expectDeny(as(OWNER, data).write(`/creatorAnalytics/${CUST_A}/summary/totalViews`, 999), "client write even as owner");
});

test("publicProfiles: PII blocked, admin badges protected, emailVerified bound to auth token", () => {
    const profA = publicProfile(CUST_A, "creator_a");
    expectAllow(as(CUST_A).write(`/publicProfiles/${CUST_A}`, profA), "user creates own public profile");
    expectDeny(as(CUST_A).write(`/publicProfiles/${CUST_A}`, { ...profA, email: "leak@x.com" }), "reject email PII");
    expectDeny(as(CUST_A).write(`/publicProfiles/${CUST_A}`, { ...profA, phone: "9800000000" }), "reject phone PII");
    expectDeny(as(CUST_A).write(`/publicProfiles/${CUST_A}`, { ...profA, address: "Parsa" }), "reject address PII");
    expectDeny(as(CUST_A).write(`/publicProfiles/${CUST_A}`, { ...profA, creatorStatus: "approved" }), "user self-approves creator");
    expectDeny(as(CUST_A).write(`/publicProfiles/${CUST_A}`, {
        ...profA,
        badges: { ...profA.badges, verifiedCreator: true }
    }), "user self-grants verifiedCreator");
    expectDeny(as(CUST_A).write(`/publicProfiles/${CUST_A}`, {
        ...profA,
        badges: { ...profA.badges, officialOrg: true }
    }), "user self-grants officialOrg");
    expectDeny(as(CUST_A).write(`/publicProfiles/${CUST_A}`, {
        ...profA,
        badges: { ...profA.badges, expertSpecialist: true }
    }), "user self-grants expertSpecialist");
    expectDeny(as(CUST_A).write(`/publicProfiles/${CUST_A}`, {
        ...profA,
        badges: { ...profA.badges, emailVerified: true }
    }), "unverified token cannot claim emailVerified");

    expectAllow(asAuth({ uid: CUST_A, token: { email_verified: true } }).write(`/publicProfiles/${CUST_A}`, {
        ...profA,
        badges: { ...profA.badges, emailVerified: true }
    }), "verified auth token may sync emailVerified");

    const withProf = { publicProfiles: { [CUST_A]: profA } };
    expectAllow(as(ADMIN, withProf).update(`/publicProfiles/${CUST_A}/badges`, { verifiedCreator: true }), "admin grants verifiedCreator");
    expectAllow(as(ADMIN, withProf).update(`/publicProfiles/${CUST_A}`, { specialtyNote: "Halal Culinary Expert" }), "admin sets specialtyNote");
    expectDeny(as(OFFICER, withProf).update(`/publicProfiles/${CUST_A}/badges`, { verifiedCreator: true }), "officer cannot grant badge");
    expectAllow(as(null, withProf).read(`/publicProfiles/${CUST_A}`), "public can read publicProfiles");
});

test("follows & following: self-follow denied; cross-user follow allowed only by follower", () => {
    const data = {
        publicProfiles: {
            [CUST_A]: publicProfile(CUST_A, "creator_a"),
            [CUST_B]: publicProfile(CUST_B, "creator_b")
        }
    };
    expectDeny(as(CUST_A, data).write(`/follows/${CUST_A}/followers/${CUST_A}`, { uid: CUST_A, createdAt: NOW }), "self-follow in follows");
    expectDeny(as(CUST_A, data).write(`/following/${CUST_A}/${CUST_A}`, { uid: CUST_A, createdAt: NOW }), "self-follow in following");
    expectAllow(as(CUST_A, data).write(`/follows/${CUST_B}/followers/${CUST_A}`, { uid: CUST_A, createdAt: NOW }), "A follows B");
    expectAllow(as(CUST_A, data).write(`/following/${CUST_A}/${CUST_B}`, { uid: CUST_B, createdAt: NOW }), "A records following B");
    expectDeny(as(CUST_A, data).write(`/follows/${CUST_B}/followers/${OWNER}`, { uid: OWNER, createdAt: NOW }), "A spoofs follower");
    expectAllow(as(CUST_A, data).write(`/publicProfiles/${CUST_B}/followersCount`, 1), "increment target followersCount by 1");
    expectDeny(as(CUST_A, data).write(`/publicProfiles/${CUST_A}/followersCount`, 1), "increment own followersCount");
});

test("publishedArticles & moderatedArticles: creator approval + moderation boundaries", () => {
    const data = {
        publicProfiles: {
            [CUST_A]: publicProfile(CUST_A, "creator_a", { creatorStatus: "approved" }),
            [CUST_B]: publicProfile(CUST_B, "creator_b", { creatorStatus: "none" })
        }
    };
    const artA = publishedArticle("art1", CUST_A);
    const artB = publishedArticle("art2", CUST_B);
    expectAllow(as(CUST_A, data).write("/publishedArticles/art1", artA), "approved creator publishes");
    expectDeny(as(CUST_B, data).write("/publishedArticles/art2", artB), "unapproved user cannot publish");
    expectDeny(as(CUST_A, data).write("/publishedArticles/art1", { ...artA, viewsCount: 500 }), "creator cannot fake viewsCount on create");

    const withArt = {
        ...data,
        publishedArticles: { art1: artA }
    };
    expectAllow(as(CUST_B, withArt).write("/publishedArticles/art1/likesCount", 1), "reader increments likesCount by 1");
    expectDeny(as(CUST_B, withArt).write("/publishedArticles/art1/likesCount", 50), "reader cannot jump likesCount by 50");
    expectDeny(as(CUST_A, withArt).write("/publishedArticles/art1/viewsCount", 10), "creator cannot mutate viewsCount");
    expectAllow(as(MOD, withArt).write("/moderatedArticles/art1", { ...artA, status: "moderated" }), "moderator moves article to moderatedArticles");
    expectAllow(as(MOD, withArt).write("/publishedArticles/art1", null), "moderator removes hidden article from publishedArticles");
    expectDeny(as(CUST_A, withArt).write("/moderatedArticles/art1", { ...artA, status: "moderated" }), "creator cannot write moderatedArticles");
});

test("creatorApplications & contentReports: lifecycle enforcement", () => {
    const appA = { uid: CUST_A, displayName: "A", username: "creator_a", pitch: "Local Chitwan guides", status: "pending", updatedAt: NOW };
    expectAllow(as(CUST_A).write(`/creatorApplications/${CUST_A}`, appA), "user submits pending application");
    expectDeny(as(CUST_A).write(`/creatorApplications/${CUST_A}`, { ...appA, status: "approved" }), "user cannot self-approve application");
    const suspendedData = { creatorApplications: { [CUST_A]: { ...appA, status: "suspended" } } };
    expectDeny(as(CUST_A, suspendedData).write(`/creatorApplications/${CUST_A}`, appA), "suspended creator cannot overwrite to pending");
    expectAllow(as(ADMIN, suspendedData).update(`/creatorApplications/${CUST_A}`, { status: "approved", updatedAt: NOW + 1 }), "admin updates creatorApplication");

    const rep = { id: "rep1", targetType: "article", targetId: "art1", reporterUid: CUST_A, reason: "Spam link", status: "open", createdAt: NOW };
    expectAllow(as(CUST_A).write("/contentReports/rep1", rep), "authenticated user creates open report");
    expectDeny(as(CUST_A).write("/contentReports/rep2", { ...rep, id: "rep2", reporterUid: CUST_B }), "cannot spoof reporterUid");
    expectDeny(as(CUST_A).read("/contentReports"), "user cannot read all contentReports");
    expectAllow(as(MOD, { contentReports: { rep1: rep } }).read("/contentReports"), "moderator reads contentReports");
});

test("publicProfiles: moderator can suspend and restore profiles without gaining creator approval powers", () => {
    const withCreator = {
        publicProfiles: {
            [CUST_A]: publicProfile(CUST_A, "creator_a", { creatorStatus: "approved" })
        }
    };
    expectAllow(as(MOD, withCreator).update(`/publicProfiles/${CUST_A}`, { creatorStatus: "suspended", updatedAt: NOW + 1 }), "moderator suspends profile");
    expectAllow(as(MOD, { publicProfiles: { [CUST_A]: publicProfile(CUST_A, "creator_a", { creatorStatus: "suspended" }) } }).update(`/publicProfiles/${CUST_A}`, { creatorStatus: "approved", updatedAt: NOW + 2 }), "moderator restores profile");
    expectDeny(as(MOD, withCreator).update(`/publicProfiles/${CUST_A}`, { creatorStatus: "pending", updatedAt: NOW + 3 }), "moderator cannot set pending creatorStatus");
    expectDeny(as(CUST_A, withCreator).update(`/publicProfiles/${CUST_A}`, { creatorStatus: "suspended", updatedAt: NOW + 4 }), "creator cannot change own creatorStatus");
});

test("inventory: manager restock clears lowStockAlertSentAt while order staff can only update stock/alert stamp", () => {
    const data = {
        inventory: {
            items: {
                it1: { id: "it1", name: "Chicken", currentStock: 1, minThreshold: 5, unit: "kg", lowStockAlertSentAt: NOW - 1000 }
            }
        }
    };
    expectAllow(as(ADMIN, data).update("/inventory/items/it1", { lowStockAlertSentAt: null, updatedAt: NOW }), "admin clears lowStockAlertSentAt on restock");
    expectAllow(as(ADMIN, data).write("/inventory/items/it1/currentStock", 10), "admin updates stock");
});

test("security review: moderator cannot approve non-suspended creators and publicProfiles enforces strict key allowlist", () => {
    const noneData = { publicProfiles: { [CUST_A]: publicProfile(CUST_A, "creator_a", { creatorStatus: "none" }) } };
    const pendingData = { publicProfiles: { [CUST_A]: publicProfile(CUST_A, "creator_a", { creatorStatus: "pending" }) } };
    const rejectedData = { publicProfiles: { [CUST_A]: publicProfile(CUST_A, "creator_a", { creatorStatus: "rejected" }) } };

    expectDeny(as(MOD, noneData).update(`/publicProfiles/${CUST_A}`, { creatorStatus: "approved", updatedAt: NOW + 1 }), "moderator approves 'none' creator");
    expectDeny(as(MOD, pendingData).update(`/publicProfiles/${CUST_A}`, { creatorStatus: "approved", updatedAt: NOW + 1 }), "moderator approves 'pending' creator");
    expectDeny(as(MOD, rejectedData).update(`/publicProfiles/${CUST_A}`, { creatorStatus: "approved", updatedAt: NOW + 1 }), "moderator approves 'rejected' creator");
    expectAllow(as(ADMIN, pendingData).update(`/publicProfiles/${CUST_A}`, { creatorStatus: "approved", updatedAt: NOW + 1 }), "admin with manageCreators approves 'pending' creator");

    const profA = publicProfile(CUST_A, "creator_a");
    for (const badKey of ["emailAddress", "phoneNumber", "mobile", "fcmToken", "homeAddress"]) {
        expectDeny(as(CUST_A).write(`/publicProfiles/${CUST_A}`, { ...profA, [badKey]: "sensitive-pii" }), `reject un-allowlisted ${badKey}`);
    }
    expectDeny(as(ADMIN, noneData).update(`/publicProfiles/${CUST_A}/badges`, { customAdmin: true }), "reject arbitrary badge key");
});

test("security review: orders block internal server flags, unknown keys, and non-alphanumeric tracking tokens", () => {
    const path = "/orders/-Onew00000000000000009";
    const mk = (over = {}) => guestOrder({ id: "-Onew00000000000000009", ...over });
    const nonAlphaToken = "!".repeat(48);

    expectDeny(as(OWNER).write(path, mk({ pushAlertDispatched: true })), "guest sets pushAlertDispatched");
    expectDeny(as(OWNER).write(path, mk({ inventoryDeducted: true })), "guest sets inventoryDeducted");
    expectDeny(as(OWNER).write(path, mk({ updatedByUid: OWNER })), "guest spoofs updatedByUid");
    expectDeny(as(OWNER).write(path, mk({ unknownField: "x" })), "guest adds unknown order field");
    expectDeny(as(OWNER).write(path, mk({ items: [{ name: "Momo", quantity: 1, tamperedExtra: 99 }] })), "guest adds unknown item field");
    expectDeny(as(OWNER).write(path, mk({ customerTrackingToken: nonAlphaToken })), "non-alphanumeric 48-char token");
    expectDeny(as(null).read(`/orderTracking/${nonAlphaToken}`), "non-alphanumeric orderTracking read");
});

test("security review: staff cannot forge or escalate adminDevices.role and users read honors RBAC revocation", () => {
    expectDeny(
        as(OFFICER).write("/adminDevices/devOfficerForge1", adminDevice("devOfficerForge1", OFFICER, "owner", "pending")),
        "officer registers device claiming role owner"
    );
    expectDeny(
        as(HELPER).update("/adminDevices/devHelper000001", { role: "owner", lastActiveAt: NOW + 1 }),
        "helper escalates own device role to owner"
    );

    expectAllow(as(MOD).read("/users"), "moderator reads users by default");
    expectDeny(
        as(MOD, { rbac: { roles: { moderator: { viewCustomers: false } } } }).read("/users"),
        "moderator blocked when rbac/roles/moderator/viewCustomers is false"
    );
    expectDeny(
        as(MOD, { staff: { ...baseData().staff, [MOD]: { ...staffRec(MOD, "moderator"), customPermissions: { viewCustomers: false } } } }).read(`/users/${CUST_A}`),
        "moderator blocked when customPermissions.viewCustomers is false"
    );
});
