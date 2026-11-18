
// ============================================================================
// SIRANCHOWK KHAJA GHAR — CLOUDFLARE WORKER
// FCM HTTP v1 + AUTHENTICATED LOGIN HISTORY + SECURITY LOGGING
// ============================================================================

const JWK_CACHE = { keys: null, expiresAt: 0 };
const TOKEN_CACHE = { token: null, expiresAt: 0 };

const SECURITY_EVENTS = new Set([
    "permission_denied",
    "unauthorized_admin_access",
    "device_approved",
    "device_rejected",
    "device_session_revoked",
    "device_blocked",
    "device_unblocked",
    "device_removed",
    "rbac_matrix_updated",
    "rbac_matrix_reset",
    "staff_activated",
    "staff_disabled",
    "staff_removed",
    "staff_created",
    "staff_role_changed",
    "staff_custom_permissions_updated",
    "blocked_device_login_attempt",
    "rejected_device_login_attempt",
    "device_registered"
]);

const SECURITY_SEVERITY = {
    permission_denied: "warning",
    unauthorized_admin_access: "high",
    device_approved: "info",
    device_rejected: "warning",
    device_session_revoked: "warning",
    device_blocked: "high",
    device_unblocked: "warning",
    device_removed: "warning",
    rbac_matrix_updated: "high",
    rbac_matrix_reset: "high",
    staff_activated: "warning",
    staff_disabled: "high",
    staff_removed: "high",
    staff_created: "info",
    staff_role_changed: "high",
    staff_custom_permissions_updated: "warning",
    blocked_device_login_attempt: "high",
    rejected_device_login_attempt: "warning",
    device_registered: "info"
};

function corsHeaders(env, origin) {
    const allowed = env.ALLOWED_ORIGIN || "*";
    const allowOrigin = allowed === "*" ? "*" : allowed;

    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Vary": "Origin",
        "Content-Type": "application/json"
    };
}

function jsonResponse(data, status, headers) {
    return new Response(JSON.stringify(data), { status, headers });
}

function base64UrlEncode(input) {
    const bytes = typeof input === "string"
        ? new TextEncoder().encode(input)
        : new Uint8Array(input);

    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function base64UrlDecode(str) {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/")
        + "===".slice((str.length + 3) % 4);

    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

function pemToArrayBuffer(pem) {
    const normalized = pem
        .replace(/\\n/g, "\n")
        .replace(/-----BEGIN PRIVATE KEY-----/g, "")
        .replace(/-----END PRIVATE KEY-----/g, "")
        .replace(/\s+/g, "");

    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes.buffer;
}

async function getGoogleAccessToken(env) {
    const nowSec = Math.floor(Date.now() / 1000);

    if (TOKEN_CACHE.token && TOKEN_CACHE.expiresAt - 60 > nowSec) {
        return TOKEN_CACHE.token;
    }

    let serviceAccount;

    try {
        serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
    } catch {
        throw new Error("Firebase service account JSON secret is invalid");
    }

    const email = serviceAccount.client_email;
    const privateKeyPem = serviceAccount.private_key;

    if (!email || !privateKeyPem) {
        throw new Error("Firebase service account JSON is missing required fields");
    }

    if (serviceAccount.project_id !== env.FIREBASE_PROJECT_ID) {
        throw new Error("Service account project ID mismatch");
    }

    const header = base64UrlEncode(JSON.stringify({
        alg: "RS256",
        typ: "JWT"
    }));

    const claims = base64UrlEncode(JSON.stringify({
        iss: email,
        scope: [
            "https://www.googleapis.com/auth/firebase.messaging",
            "https://www.googleapis.com/auth/firebase.database",
            "https://www.googleapis.com/auth/userinfo.email"
        ].join(" "),
        aud: "https://oauth2.googleapis.com/token",
        exp: nowSec + 3600,
        iat: nowSec
    }));

    const signingInput = `${header}.${claims}`;

    const privateKey = await crypto.subtle.importKey(
        "pkcs8",
        pemToArrayBuffer(privateKeyPem),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        privateKey,
        new TextEncoder().encode(signingInput)
    );

    const assertion = `${signingInput}.${base64UrlEncode(signature)}`;

    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(assertion)}`
    });

    if (!response.ok) {
        throw new Error(`OAuth token exchange failed (${response.status})`);
    }

    const result = await response.json();

    TOKEN_CACHE.token = result.access_token;
    TOKEN_CACHE.expiresAt = nowSec + Number(result.expires_in || 3600);

    return TOKEN_CACHE.token;
}

async function getFirebaseJwks() {
    const now = Date.now();

    if (JWK_CACHE.keys && JWK_CACHE.expiresAt > now) {
        return JWK_CACHE.keys;
    }

    const response = await fetch(
        "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
    );

    if (!response.ok) {
        throw new Error("Unable to fetch Firebase public keys");
    }

    const result = await response.json();

    JWK_CACHE.keys = result.keys || [];
    JWK_CACHE.expiresAt = now + 3600 * 1000;

    return JWK_CACHE.keys;
}

async function verifyFirebaseIdToken(idToken, projectId) {
    const parts = String(idToken || "").split(".");

    if (parts.length !== 3) {
        throw new Error("Invalid Bearer token format");
    }

    const [rawHeader, rawPayload, rawSignature] = parts;

    const header = JSON.parse(
        new TextDecoder().decode(base64UrlDecode(rawHeader))
    );

    const payload = JSON.parse(
        new TextDecoder().decode(base64UrlDecode(rawPayload))
    );

    const nowSec = Math.floor(Date.now() / 1000);

    if (header.alg !== "RS256") {
        throw new Error("Unsupported token algorithm");
    }

    if (payload.aud !== projectId) {
        throw new Error("Token audience mismatch");
    }

    if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
        throw new Error("Token issuer mismatch");
    }

    if (
        !payload.sub ||
        payload.sub.length > 128 ||
        !payload.exp ||
        payload.exp <= nowSec ||
        !payload.iat ||
        payload.iat > nowSec + 300
    ) {
        throw new Error("Token expired or invalid");
    }

    const jwks = await getFirebaseJwks();
    const jwk = jwks.find((key) => key.kid === header.kid);

    if (!jwk) {
        throw new Error("Signing key not found");
    }

    const publicKey = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
    );

    const verified = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        base64UrlDecode(rawSignature),
        new TextEncoder().encode(`${rawHeader}.${rawPayload}`)
    );

    if (!verified) {
        throw new Error("Invalid Firebase token signature");
    }

    return payload;
}

async function rtdbGet(env, accessToken, path) {
    const url = `${env.FIREBASE_DATABASE_URL.replace(/\/$/, "")}/${path}.json?access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Firebase read failed (${response.status})`);
    }

    return response.json();
}

async function rtdbPatch(env, accessToken, path, payload) {
    const url = `${env.FIREBASE_DATABASE_URL.replace(/\/$/, "")}/${path}.json?access_token=${encodeURIComponent(accessToken)}`;

    const response = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Firebase update failed (${response.status})`);
    }

    return true;
}

async function rtdbPost(env, accessToken, path, payload) {
    const url = `${env.FIREBASE_DATABASE_URL.replace(/\/$/, "")}/${path}.json?access_token=${encodeURIComponent(accessToken)}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Firebase write failed (${response.status})`);
    }

    return response.json();
}

function safeText(value, maxLength = 160) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function sanitizeMetadata(metadata = {}) {
    const clean = {};

    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return clean;
    }

    Object.entries(metadata).slice(0, 12).forEach(([key, value]) => {
        const safeKey = safeText(key, 48);

        if (/password|token|secret|credential|apikey|authorization/i.test(safeKey)) {
            return;
        }

        if (
            value === null ||
            value === undefined ||
            typeof value === "object"
        ) {
            return;
        }

        clean[safeKey] = typeof value === "boolean" || typeof value === "number"
            ? value
            : safeText(value, 240);
    });

    return clean;
}

function getClientHints(body) {
    const allowedDeviceTypes = new Set(["desktop", "mobile", "tablet", "unknown"]);

    return {
        deviceType: allowedDeviceTypes.has(body?.deviceType)
            ? body.deviceType
            : "unknown",
        browser: safeText(body?.browser || "Unknown", 40),
        operatingSystem: safeText(body?.operatingSystem || "Unknown", 40)
    };
}

function getStaffStatus(uid, staff, env) {
    const primaryOwner = uid === env.PRIMARY_OWNER_UID;
    const exists = Boolean(staff);
    const active = primaryOwner || (exists && staff.active !== false);

    return {
        exists,
        active,
        isOwner: primaryOwner || (active && staff?.role === "owner"),
        role: primaryOwner ? "owner" : (active ? safeText(staff?.role || "helper", 32) : "unauthorized")
    };
}

async function handleLoginEvent(body, decoded, env, accessToken) {
    const uid = decoded.sub;
    const staff = await rtdbGet(env, accessToken, `staff/${uid}`);
    const profile = await rtdbGet(env, accessToken, `users/${uid}/profile`);

    const staffStatus = getStaffStatus(uid, staff, env);
    const portal = body?.portal === "admin" ? "admin" : "customer";
    const action = body?.action === "logout" ? "logout" : "login";

    const method = ["password", "google", "password_signup"].includes(body?.method)
        ? body.method
        : "password";

    let result = "success";
    let reason = "";

    if (portal === "admin" && !staffStatus.active) {
        result = "failed";
        reason = staff ? "account_disabled" : "not_in_staff_directory";
    }

    if (portal === "customer" && action === "login") {
        result = "success";
    }

    if (portal === "customer" && action === "logout") {
        result = "success";
    }

    if (result === "failed" && action === "logout") {
        throw new Error("Invalid login event");
    }

    const clientHints = getClientHints(body);

    const record = {
        uid,
        name: safeText(profile?.name || profile?.displayName || decoded.name || "", 80),
        email: safeText(decoded.email || "", 120).toLowerCase(),
        role: portal === "admin" ? staffStatus.role : "customer",
        method,
        action,
        result,
        reason,
        deviceType: clientHints.deviceType,
        browser: clientHints.browser,
        operatingSystem: clientHints.operatingSystem,
        sessionId: safeText(body?.sessionId || "", 96),
        deviceId: safeText(body?.deviceId || "", 80),
        timestamp: Date.now()
    };

    if (
        action === "logout" &&
        Number.isFinite(Number(body?.sessionDurationSec)) &&
        Number(body.sessionDurationSec) >= 0
    ) {
        record.sessionDurationSec = Math.min(
            Math.round(Number(body.sessionDurationSec)),
            2592000
        );
    }

    await rtdbPost(env, accessToken, "loginHistory", record);

    return {
        ok: true,
        result,
        reason
    };
}

async function handleSecurityEvent(body, decoded, env, accessToken) {
    const uid = decoded.sub;
    const eventType = safeText(body?.eventType || "", 64);

    if (!SECURITY_EVENTS.has(eventType)) {
        return { error: "Security event type is not allowed", status: 400 };
    }

    const staff = await rtdbGet(env, accessToken, `staff/${uid}`);
    const staffStatus = getStaffStatus(uid, staff, env);

    if (eventType === "unauthorized_admin_access") {
        if (staffStatus.active) {
            return {
                error: "This event is only valid for unauthorized admin access",
                status: 403
            };
        }
    } else if (!staffStatus.active) {
        return {
            error: "Active staff authorization required",
            status: 403
        };
    }

    const clientHints = getClientHints(body);

    let reason = "";
    if (eventType === "unauthorized_admin_access") {
        reason = staff ? "account_disabled" : "not_in_staff_directory";
    }

    const details = sanitizeMetadata(body?.details || {});
    if (reason) details.serverReason = reason;

    const record = {
        eventType,
        severity: SECURITY_SEVERITY[eventType] || "info",
        actorUid: uid,
        actorEmail: safeText(decoded.email || "", 120).toLowerCase(),
        actorRole: staffStatus.role,
        target: safeText(body?.target || "", 160),
        deviceType: clientHints.deviceType,
        browser: clientHints.browser,
        operatingSystem: clientHints.operatingSystem,
        details,
        timestamp: Date.now()
    };

    await rtdbPost(env, accessToken, "securityLogs", record);

    return { ok: true };
}

async function sendFcmV1Detailed(env, accessToken, token, { title, body, clickAction }) {
    const url = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: {
                    token,
                    notification: { title, body },
                    webpush: {
                        fcm_options: { link: clickAction || "/" }
                    },
                    data: {
                        title,
                        body,
                        clickAction: clickAction || "/"
                    }
                }
            })
        });

        if (response.ok) {
            return { ok: true, status: "sent_to_provider", error: "" };
        }

        const errorJson = await response.json().catch(() => null);
        const safeMessage = String(
            errorJson?.error?.message || `HTTP ${response.status}`
        ).slice(0, 140);

        return { ok: false, status: "failed", error: safeMessage };
    } catch (error) {
        return {
            ok: false,
            status: "failed",
            error: String(error?.message || "Network error").slice(0, 140)
        };
    }
}

async function dispatchToTargets(env, accessToken, targets, { title, body, clickAction }) {
    const seenTokens = new Set();
    const deliveryResults = [];
    let sentToProvider = 0;
    let failed = 0;

    for (const target of targets) {
        if (!target?.fcmToken || seenTokens.has(target.fcmToken)) continue;

        seenTokens.add(target.fcmToken);

        const result = await sendFcmV1Detailed(
            env,
            accessToken,
            target.fcmToken,
            { title, body, clickAction }
        );

        if (result.ok) sentToProvider += 1;
        else failed += 1;

        deliveryResults.push({
            deviceId: safeText(target.deviceId || "", 80),
            deviceName: safeText(target.deviceName || "Device", 80),
            staffName: safeText(target.staffName || target.uid || "", 80),
            status: result.status,
            error: result.error
        });
    }

    return {
        targeted: deliveryResults.length,
        sentToProvider,
        failed,
        deliveryResults
    };
}

function collectApprovedAdminTargets(
    devicesMap = {},
    staffMap = {},
    rbacRoles = {},
    primaryOwnerUid = "",
    {
        targetType = "all",
        requestedIds = [],
        preferenceKey = "staffAnnouncements",
        requireStaffOrderPerm = false
    } = {}
) {
    const list = [];

    Object.values(devicesMap || {}).forEach((device) => {
        if (
            !device ||
            device.approvalStatus !== "approved" ||
            device.blocked === true ||
            device.pushStatus !== "enabled" ||
            !device.fcmToken
        ) {
            return;
        }

        if (targetType === "selected" && !requestedIds.includes(device.deviceId)) {
            return;
        }

        if (preferenceKey && device.preferences?.[preferenceKey] === false) {
            return;
        }

        const staffRecord = staffMap?.[device.uid];
        const isDeviceOwner =
            device.uid === primaryOwnerUid ||
            staffRecord?.role === "owner" ||
            device.role === "owner";

        if (!isDeviceOwner && staffRecord && staffRecord.active === false) {
            return;
        }

        if (requireStaffOrderPerm && !isDeviceOwner) {
            const roleName = staffRecord?.role || device.role || "helper";
            const customPerm = staffRecord?.customPermissions?.viewOrders;
            const rolePerm = rbacRoles?.[roleName]?.viewOrders;

            const canViewOrders = typeof customPerm === "boolean"
                ? customPerm
                : (
                    typeof rolePerm === "boolean"
                        ? rolePerm
                        : ["owner", "admin", "moderator", "officer", "helper"].includes(roleName)
                );

            if (!canViewOrders) return;
        }

        list.push(device);
    });

    return list;
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get("Origin") || "";
        const headers = corsHeaders(env, origin);

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers });
        }

        if (request.method !== "POST") {
            return jsonResponse({ error: "Method not allowed" }, 405, headers);
        }

        if (
            env.ALLOWED_ORIGIN &&
            env.ALLOWED_ORIGIN !== "*" &&
            origin &&
            origin !== env.ALLOWED_ORIGIN
        ) {
            return jsonResponse({ error: "Origin not allowed" }, 403, headers);
        }

        try {
            const body = await request.json();
            const type = body?.type;

            // PUBLIC NEW-ORDER PUSH
            if (type === "new_order_alert") {
                const orderId = safeText(body?.orderId || "", 128);
                const trackingToken = safeText(body?.trackingToken || "", 64);

                if (!orderId || trackingToken.length !== 48) {
                    return jsonResponse({
                        error: "Valid orderId and trackingToken required"
                    }, 400, headers);
                }

                const accessToken = await getGoogleAccessToken(env);
                const order = await rtdbGet(env, accessToken, `orders/${orderId}`);

                if (
                    !order ||
                    order.id !== orderId ||
                    order.customerTrackingToken !== trackingToken
                ) {
                    return jsonResponse({ error: "Order verification failed" }, 403, headers);
                }

                if (order.pushAlertDispatched === true) {
                    return jsonResponse({
                        ok: true,
                        duplicate: true,
                        targeted: 0,
                        sentToProvider: 0,
                        failed: 0,
                        deliveryResults: []
                    }, 200, headers);
                }

                if (Date.now() - Number(order.createdAt || 0) > 15 * 60 * 1000) {
                    return jsonResponse({ error: "Order alert window expired" }, 400, headers);
                }

                await rtdbPatch(env, accessToken, `orders/${orderId}`, {
                    pushAlertDispatched: true
                });

                const [devicesMap, staffMap, rbacRoles] = await Promise.all([
                    rtdbGet(env, accessToken, "adminDevices"),
                    rtdbGet(env, accessToken, "staff"),
                    rtdbGet(env, accessToken, "rbac/roles")
                ]);

                const targets = collectApprovedAdminTargets(
                    devicesMap,
                    staffMap,
                    rbacRoles,
                    env.PRIMARY_OWNER_UID,
                    {
                        targetType: "all",
                        preferenceKey: "newOrders",
                        requireStaffOrderPerm: true
                    }
                );

                const title = `New Website Order #${orderId.slice(-8).toUpperCase()}`;
                const messageBody = `${order.customerName || "Customer"} (${order.orderType || "Pickup"}) • ${String(order.summary || "Order request").slice(0, 180)}`;

                const summary = await dispatchToTargets(
                    env,
                    accessToken,
                    targets,
                    {
                        title,
                        body: messageBody,
                        clickAction: "/admin/admin.html#orders"
                    }
                );

                const overallStatus = summary.targeted === 0
                    ? "created"
                    : (summary.sentToProvider > 0 ? "sent_to_provider" : "failed");

                await rtdbPost(env, accessToken, "notificationHistory/admin", {
                    channel: "admin",
                    title,
                    message: messageBody,
                    type: "new_order",
                    targetAudience: `Approved Admin & Owner Devices (${summary.targeted})`,
                    status: overallStatus,
                    actorUid: order.customerUid || "guest",
                    targetedCount: summary.targeted,
                    sentCount: summary.sentToProvider,
                    failedCount: summary.failed,
                    deliveryResults: summary.deliveryResults,
                    createdAt: Date.now()
                });

                return jsonResponse({ ok: true, ...summary }, 200, headers);
            }

            // ALL OTHER ROUTES REQUIRE A VERIFIED FIREBASE ID TOKEN
            const authHeader = request.headers.get("Authorization") || "";
            const idToken = authHeader.startsWith("Bearer ")
                ? authHeader.slice(7).trim()
                : "";

            if (!idToken) {
                return jsonResponse({
                    error: "Authorization token required"
                }, 401, headers);
            }

            let decoded;

            try {
                decoded = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
            } catch {
                return jsonResponse({
                    error: "Invalid or expired Firebase ID token"
                }, 401, headers);
            }

            const callerUid = decoded.sub;
            const accessToken = await getGoogleAccessToken(env);

            // LOGIN HISTORY ROUTE — CUSTOMER AND STAFF
            if (type === "login_event") {
                const result = await handleLoginEvent(body, decoded, env, accessToken);
                return jsonResponse(result, 200, headers);
            }

            // SECURITY LOG ROUTE — AUTHENTICATED STAFF ONLY,
            // EXCEPT VERIFIED UNAUTHORIZED ADMIN ACCESS EVENTS
            if (type === "security_event") {
                const result = await handleSecurityEvent(body, decoded, env, accessToken);

                if (result.status) {
                    return jsonResponse({ error: result.error }, result.status, headers);
                }

                return jsonResponse(result, 200, headers);
            }

            // EXISTING ADMIN NOTIFICATION AUTHORIZATION
            const staff = await rtdbGet(env, accessToken, `staff/${callerUid}`);
            const staffStatus = getStaffStatus(callerUid, staff, env);

            if (!staffStatus.active) {
                return jsonResponse({
                    error: "Staff authorization required"
                }, 403, headers);
            }

            const isOwner = staffStatus.isOwner;
            const title = safeText(body?.title || "Siranchowk Khaja Ghar", 120);
            const messageBody = safeText(body?.body || "", 320);

            if (!messageBody) {
                return jsonResponse({
                    error: "Notification body is required"
                }, 400, headers);
            }

            const roleName = staffStatus.role;
            const rolePerms = (!isOwner && roleName)
                ? await rtdbGet(env, accessToken, `rbac/roles/${roleName}`)
                : null;

            const hasPerm = (permissionKey) => {
                if (isOwner) return true;

                if (typeof staff?.customPermissions?.[permissionKey] === "boolean") {
                    return staff.customPermissions[permissionKey];
                }

                if (typeof rolePerms?.[permissionKey] === "boolean") {
                    return rolePerms[permissionKey];
                }

                return roleName === "admin";
            };

            if (type === "admin_alert") {
                if (!hasPerm("sendNotifications") && !hasPerm("manageInventory")) {
                    return jsonResponse({
                        error: "Owner or notification permission required"
                    }, 403, headers);
                }

                const [devicesMap, staffMap, rbacRoles] = await Promise.all([
                    rtdbGet(env, accessToken, "adminDevices"),
                    rtdbGet(env, accessToken, "staff"),
                    rtdbGet(env, accessToken, "rbac/roles")
                ]);

                const requestedIds = Array.isArray(body?.targetDeviceIds)
                    ? body.targetDeviceIds
                    : [];

                const preferenceKey = safeText(body?.category || "staffAnnouncements", 48);

                const targets = collectApprovedAdminTargets(
                    devicesMap,
                    staffMap,
                    rbacRoles,
                    env.PRIMARY_OWNER_UID,
                    {
                        targetType: body?.targetType === "selected" ? "selected" : "all",
                        requestedIds,
                        preferenceKey
                    }
                );

                const summary = await dispatchToTargets(
                    env,
                    accessToken,
                    targets,
                    {
                        title,
                        body: messageBody,
                        clickAction: body?.clickAction || "/admin/admin.html#orders"
                    }
                );

                return jsonResponse({
                    ok: true,
                    ...summary,
                    delivered: summary.sentToProvider
                }, 200, headers);
            }

            if (type === "customer_order_update") {
                if (!hasPerm("updateOrders") && !hasPerm("sendNotifications")) {
                    return jsonResponse({
                        error: "Order update permission required"
                    }, 403, headers);
                }

                const customerUid = safeText(body?.customerUid || "", 128);

                if (!customerUid) {
                    return jsonResponse({
                        error: "customerUid is required"
                    }, 400, headers);
                }

                const customerDevices = (
                    await rtdbGet(env, accessToken, `users/${customerUid}/devices`)
                ) || {};

                const targets = Object.values(customerDevices)
                    .filter((device) =>
                        device &&
                        device.enabled !== false &&
                        device.orderAlerts !== false &&
                        device.fcmToken
                    )
                    .map((device) => ({ ...device, staffName: customerUid }));

                const summary = await dispatchToTargets(
                    env,
                    accessToken,
                    targets,
                    {
                        title,
                        body: messageBody,
                        clickAction: "/account.html#orders"
                    }
                );

                return jsonResponse({
                    ok: true,
                    ...summary,
                    delivered: summary.sentToProvider
                }, 200, headers);
            }

            if (type === "customer_campaign") {
                if (!hasPerm("sendCustomerCampaigns")) {
                    return jsonResponse({
                        error: "Owner or campaign permission required"
                    }, 403, headers);
                }

                const audience = safeText(body?.audience || "opted_in", 40);

                const [users, orders] = await Promise.all([
                    rtdbGet(env, accessToken, "users"),
                    audience === "repeat_buyers"
                        ? rtdbGet(env, accessToken, "orders")
                        : Promise.resolve(null)
                ]);

                const orderCounts = {};

                if (orders) {
                    Object.values(orders).forEach((order) => {
                        if (order?.customerUid && order.status !== "cancelled") {
                            orderCounts[order.customerUid] =
                                (orderCounts[order.customerUid] || 0) + 1;
                        }
                    });
                }

                const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
                const targets = [];

                Object.entries(users || {}).forEach(([uid, user]) => {
                    const lastActivity = Number(
                        user?.profile?.lastActiveAt ||
                        user?.profile?.lastLoginAt ||
                        user?.profile?.createdAt ||
                        0
                    );

                    if (audience === "active_30d" && lastActivity < thirtyDaysAgo) {
                        return;
                    }

                    if (audience === "repeat_buyers" && (orderCounts[uid] || 0) < 2) {
                        return;
                    }

                    Object.values(user?.devices || {}).forEach((device) => {
                        if (
                            device &&
                            device.enabled !== false &&
                            device.offersOptIn === true &&
                            device.fcmToken
                        ) {
                            targets.push({
                                ...device,
                                staffName: user?.profile?.name || uid
                            });
                        }
                    });
                });

                const summary = await dispatchToTargets(
                    env,
                    accessToken,
                    targets,
                    {
                        title,
                        body: messageBody,
                        clickAction: "/account.html#offers"
                    }
                );

                return jsonResponse({
                    ok: true,
                    ...summary,
                    delivered: summary.sentToProvider
                }, 200, headers);
            }

            return jsonResponse({
                error: "Unsupported request type"
            }, 400, headers);

        } catch (error) {
            // Do not expose service-account or internal error details to clients.
            return jsonResponse({
                error: "Worker execution error"
            }, 500, headers);
        }
    }
};
