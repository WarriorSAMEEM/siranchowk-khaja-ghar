
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
    "device_registered",
    "creator_approved",
    "creator_under_review",
    "creator_more_info_required",
    "creator_rejected",
    "creator_suspended",
    "badge_granted",
    "badge_revoked",
    "content_moderated",
    "media_uploaded",
    "media_deleted"
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
    device_registered: "info",
    creator_approved: "info",
    creator_under_review: "info",
    creator_more_info_required: "info",
    creator_rejected: "info",
    creator_suspended: "high",
    badge_granted: "info",
    badge_revoked: "warning",
    content_moderated: "warning",
    media_uploaded: "info",
    media_deleted: "warning"
};

const DEFAULT_ALLOWED_ORIGINS = [
    "https://siranchowk-khaja-ghar.pages.dev",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://localhost:3000"
];
const MAX_BODY_BYTES = 32768;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const RATE_LIMIT_BUCKETS = new Map();

function getClientIp(request) {
    const cfIp = request.headers.get("CF-Connecting-IP") || "";
    if (cfIp.trim()) return cfIp.trim().slice(0, 64);
    const forwarded = request.headers.get("X-Forwarded-For") || "";
    const first = forwarded.split(",")[0]?.trim();
    return first ? first.slice(0, 64) : "unknown";
}

function checkRateLimit(bucketKey, maxRequests, windowMs = 60000) {
    const now = Date.now();
    if (RATE_LIMIT_BUCKETS.size > 1000) {
        for (const [key, timestamps] of RATE_LIMIT_BUCKETS.entries()) {
            const recent = timestamps.filter((ts) => now - ts < windowMs);
            if (recent.length === 0) RATE_LIMIT_BUCKETS.delete(key);
            else RATE_LIMIT_BUCKETS.set(key, recent);
        }
    }

    const existing = RATE_LIMIT_BUCKETS.get(bucketKey) || [];
    const active = existing.filter((ts) => now - ts < windowMs);
    if (active.length >= maxRequests) {
        const oldest = active[0] || now;
        const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
        RATE_LIMIT_BUCKETS.set(bucketKey, active);
        return { allowed: false, retryAfterSec };
    }

    active.push(now);
    RATE_LIMIT_BUCKETS.set(bucketKey, active);
    return { allowed: true, retryAfterSec: 0 };
}

function normalizeOrigin(origin) {
    return String(origin || "").trim().replace(/\/+$/, "");
}

function getAllowedOrigins(env) {
    const raw = [env?.ALLOWED_ORIGINS, env?.ALLOWED_ORIGIN]
        .filter((val) => typeof val === "string" && val.trim().length > 0)
        .join(",");

    const parsed = raw
        .split(",")
        .map(normalizeOrigin)
        .filter((origin) => origin && origin !== "*");

    return new Set(parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS);
}

function isOriginAllowed(env, origin) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    return getAllowedOrigins(env).has(normalized);
}

function corsHeaders(env, origin) {
    const headers = {
        "Vary": "Origin",
        "Content-Type": "application/json"
    };

    const normalized = normalizeOrigin(origin);
    if (normalized && isOriginAllowed(env, normalized)) {
        headers["Access-Control-Allow-Origin"] = normalized;
        headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
        headers["Access-Control-Max-Age"] = "86400";
    }

    return headers;
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
        throw new ConfigError("Service account secret is not valid JSON", ["FIREBASE_SERVICE_ACCOUNT_JSON"]);
    }

    const email = serviceAccount.client_email;
    const privateKeyPem = serviceAccount.private_key;

    if (!email || !privateKeyPem) {
        throw new ConfigError("Service account secret is missing client_email/private_key", ["FIREBASE_SERVICE_ACCOUNT_JSON"]);
    }

    if (serviceAccount.project_id !== env.FIREBASE_PROJECT_ID) {
        throw new ConfigError("Service account project_id does not match FIREBASE_PROJECT_ID", ["FIREBASE_SERVICE_ACCOUNT_JSON"]);
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

    let privateKey;
    try {
        privateKey = await crypto.subtle.importKey(
            "pkcs8",
            pemToArrayBuffer(privateKeyPem),
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["sign"]
        );
    } catch {
        throw new ConfigError("Service account private_key could not be parsed", ["FIREBASE_SERVICE_ACCOUNT_JSON"]);
    }

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
        // 400/401 here means Google rejected the credential (revoked key, wrong project, clock skew).
        if (response.status === 400 || response.status === 401) {
            throw new ConfigError(`Google rejected the service account credential (${response.status})`, ["FIREBASE_SERVICE_ACCOUNT_JSON"]);
        }
        throw new Error(`OAuth token exchange failed (${response.status})`);
    }

    const result = await response.json();

    TOKEN_CACHE.token = result.access_token;
    TOKEN_CACHE.expiresAt = nowSec + Number(result.expires_in || 3600);

    return TOKEN_CACHE.token;
}

async function getFirebaseJwks(forceRefresh = false) {
    const now = Date.now();

    if (!forceRefresh && JWK_CACHE.keys && JWK_CACHE.expiresAt > now) {
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
        typeof payload.sub !== "string" ||
        payload.sub.trim().length === 0 ||
        payload.sub.length > 128 ||
        !Number.isFinite(payload.exp) ||
        payload.exp <= nowSec ||
        !Number.isFinite(payload.iat) ||
        payload.iat > nowSec + 300
    ) {
        throw new Error("Token expired or invalid");
    }

    let jwks = await getFirebaseJwks(false);
    let jwk = jwks.find((key) => key.kid === header.kid && (!key.alg || key.alg === "RS256"));

    if (!jwk) {
        jwks = await getFirebaseJwks(true);
        jwk = jwks.find((key) => key.kid === header.kid && (!key.alg || key.alg === "RS256"));
    }

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

class ConfigError extends Error {
    constructor(message, missing = []) {
        super(message);
        this.name = "ConfigError";
        this.missing = missing;
    }
}

// Names only (never values) of the configuration this Worker needs.
const REQUIRED_VARS = ["FIREBASE_PROJECT_ID", "FIREBASE_DATABASE_URL", "PRIMARY_OWNER_UID"];
const REQUIRED_SECRETS = ["FIREBASE_SERVICE_ACCOUNT_JSON"];

function assertWorkerConfigured(env) {
    const missing = [...REQUIRED_VARS, ...REQUIRED_SECRETS].filter(
        (name) => typeof env?.[name] !== "string" || env[name].trim() === ""
    );
    if (missing.length > 0) {
        throw new ConfigError("Worker configuration incomplete", missing);
    }
}

// A single path segment from untrusted input must never be able to add "/", "..", "?" or "#".
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
function isSafeId(value, min = 1) {
    return typeof value === "string" && value.length >= min && SAFE_ID.test(value);
}

function rtdbUrl(env, path) {
    const base = String(env.FIREBASE_DATABASE_URL || "").replace(/\/$/, "");
    const encoded = String(path).split("/").map(encodeURIComponent).join("/");
    return `${base}/${encoded}.json`;
}

function rtdbHeaders(accessToken, extra = {}) {
    // OAuth2 token travels in the Authorization header so it never lands in URLs/logs.
    return { Authorization: `Bearer ${accessToken}`, ...extra };
}

async function rtdbGet(env, accessToken, path) {
    const response = await fetch(rtdbUrl(env, path), { headers: rtdbHeaders(accessToken) });

    if (!response.ok) {
        throw new Error(`Firebase read failed (${response.status})`);
    }

    return response.json();
}

async function rtdbPatch(env, accessToken, path, payload) {
    const response = await fetch(rtdbUrl(env, path), {
        method: "PATCH",
        headers: rtdbHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Firebase update failed (${response.status})`);
    }

    return true;
}

async function rtdbPost(env, accessToken, path, payload) {
    const response = await fetch(rtdbUrl(env, path), {
        method: "POST",
        headers: rtdbHeaders(accessToken, { "Content-Type": "application/json" }),
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

function safeClickAction(value, fallback = "/") {
    const candidate = safeText(value || "", 180);
    if (!candidate.startsWith("/") || candidate.startsWith("//")) {
        return fallback;
    }
    return candidate;
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

        if (!isPlausibleFcmToken(target.fcmToken)) {
            failed += 1;
            deliveryResults.push({
                deviceId: safeText(target.deviceId || "", 80),
                deviceName: safeText(target.deviceName || "Device", 80),
                staffName: safeText(target.staffName || target.uid || "", 80),
                status: "failed",
                error: "Invalid FCM token format"
            });
            continue;
        }

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

// Mirrors DEFAULT_ROLE_PERMISSIONS in js/rbac.js (the client) and the `!== false`
// fallbacks in database.rules.json. scripts/worker-hardening.test.js fails if these drift.
// Used only when neither staff.customPermissions nor rbac/roles/<role> define a key.
export const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
    owner: {
        viewOrders: true,
        updateOrders: true,
        cancelOrders: true,
        manageProducts: true,
        editPrices: true,
        viewInventory: true,
        manageInventory: true,
        viewCustomers: true,
        viewCustomerContactDetails: true,
        manageCoupons: true,
        viewAnalytics: true,
        viewVisitorAnalytics: true,
        viewCustomerEngagement: true,
        viewUserActivity: true,
        viewOrderAnalytics: true,
        viewLoginHistory: true,
        viewAuditLogs: true,
        viewSecurityLogs: true,
        exportReports: true,
        sendNotifications: true,
        sendCustomerCampaigns: true,
        manageStaff: true,
        manageDevices: true,
        manageRoles: true,
        manageSettings: true,
        manageCreators: true,
        manageBadges: true,
        moderateContent: true,
        manageSeo: true,
        viewContentAnalytics: true
    },
    admin: {
        viewOrders: true,
        updateOrders: true,
        cancelOrders: true,
        manageProducts: true,
        editPrices: true,
        viewInventory: true,
        manageInventory: true,
        viewCustomers: true,
        viewCustomerContactDetails: true,
        manageCoupons: true,
        viewAnalytics: true,
        viewVisitorAnalytics: false,
        viewCustomerEngagement: true,
        viewUserActivity: false,
        viewOrderAnalytics: true,
        viewLoginHistory: false,
        viewAuditLogs: true,
        viewSecurityLogs: false,
        exportReports: false,
        sendNotifications: false,
        sendCustomerCampaigns: false,
        manageStaff: true,
        manageDevices: false,
        manageRoles: false,
        manageSettings: false,
        manageCreators: true,
        manageBadges: true,
        moderateContent: true,
        manageSeo: true,
        viewContentAnalytics: true
    },
    moderator: {
        viewOrders: true,
        updateOrders: true,
        cancelOrders: false,
        manageProducts: false,
        editPrices: false,
        viewInventory: true,
        manageInventory: false,
        viewCustomers: true,
        viewCustomerContactDetails: false,
        manageCoupons: false,
        viewAnalytics: false,
        viewVisitorAnalytics: false,
        viewCustomerEngagement: false,
        viewUserActivity: false,
        viewOrderAnalytics: false,
        viewLoginHistory: false,
        viewAuditLogs: false,
        viewSecurityLogs: false,
        exportReports: false,
        sendNotifications: false,
        sendCustomerCampaigns: false,
        manageStaff: false,
        manageDevices: false,
        manageRoles: false,
        manageSettings: false,
        manageCreators: false,
        manageBadges: false,
        moderateContent: true,
        manageSeo: false,
        viewContentAnalytics: false
    },
    officer: {
        viewOrders: true,
        updateOrders: true,
        cancelOrders: false,
        manageProducts: false,
        editPrices: false,
        viewInventory: true,
        manageInventory: false,
        viewCustomers: false,
        viewCustomerContactDetails: false,
        manageCoupons: false,
        viewAnalytics: false,
        viewVisitorAnalytics: false,
        viewCustomerEngagement: false,
        viewUserActivity: false,
        viewOrderAnalytics: false,
        viewLoginHistory: false,
        viewAuditLogs: false,
        viewSecurityLogs: false,
        exportReports: false,
        sendNotifications: false,
        sendCustomerCampaigns: false,
        manageStaff: false,
        manageDevices: false,
        manageRoles: false,
        manageSettings: false,
        manageCreators: false,
        manageBadges: false,
        moderateContent: false,
        manageSeo: false,
        viewContentAnalytics: false
    },
    helper: {
        viewOrders: true,
        updateOrders: true,
        cancelOrders: false,
        manageProducts: false,
        editPrices: false,
        viewInventory: false,
        manageInventory: false,
        viewCustomers: false,
        viewCustomerContactDetails: false,
        manageCoupons: false,
        viewAnalytics: false,
        viewVisitorAnalytics: false,
        viewCustomerEngagement: false,
        viewUserActivity: false,
        viewOrderAnalytics: false,
        viewLoginHistory: false,
        viewAuditLogs: false,
        viewSecurityLogs: false,
        exportReports: false,
        sendNotifications: false,
        sendCustomerCampaigns: false,
        manageStaff: false,
        manageDevices: false,
        manageRoles: false,
        manageSettings: false,
        manageCreators: false,
        manageBadges: false,
        moderateContent: false,
        manageSeo: false,
        viewContentAnalytics: false
    }
});

async function rtdbPut(env, accessToken, path, payload) {
    const response = await fetch(rtdbUrl(env, path), {
        method: "PUT",
        headers: rtdbHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(`Firebase put failed (${response.status})`);
    }
    return response.json();
}

async function rtdbDelete(env, accessToken, path) {
    const response = await fetch(rtdbUrl(env, path), {
        method: "DELETE",
        headers: rtdbHeaders(accessToken)
    });
    if (!response.ok) {
        throw new Error(`Firebase delete failed (${response.status})`);
    }
    return true;
}

function classifyReferrerSource(rawReferrer = "") {
    const refStr = safeText(rawReferrer, 320).toLowerCase();
    if (!refStr) return { bucket: "direct", host: "Direct" };
    try {
        const parsed = new URL(refStr);
        const host = parsed.hostname.replace(/^www\./, "");
        if (host.includes("siranchowk-khaja-ghar.pages.dev") || host === "localhost" || host === "127.0.0.1") {
            return { bucket: "internal", host };
        }
        if (/^(google|bing|duckduckgo|search\.yahoo|yandex|ecosia|baidu)\./i.test(host) || host.includes("google.")) {
            return { bucket: "search_organic", host };
        }
        if (/(facebook|fb\.com|l\.facebook|instagram|t\.co|twitter|x\.com|linkedin|whatsapp|wa\.me|reddit|youtube|tiktok)/i.test(host)) {
            return { bucket: "social", host };
        }
        return { bucket: "external", host };
    } catch {
        return { bucket: "direct", host: "Direct" };
    }
}

function computeTrendingScoreServer(article, nowMs = Date.now()) {
    const views = Number(article?.viewsCount || 0);
    const likes = Number(article?.likesCount || 0);
    const comments = Number(article?.commentsCount || 0);
    const reposts = Number(article?.repostsCount || 0);
    const shares = Number(article?.sharesCount || 0);
    const publishedAt = Number(article?.publishedAt || article?.createdAt || nowMs);
    const ageHours = Math.max(1, (nowMs - publishedAt) / 3600000);
    const engagement = views * 0.25 + likes * 3 + comments * 5 + reposts * 4 + shares * 2;
    return Number((engagement / Math.pow(ageHours + 2, 1.25)).toFixed(4));
}

function todayKeyUtc() {
    return new Date().toISOString().slice(0, 10);
}

async function handlePlatformTrackEvent(body, env, accessToken, clientIp) {
    const eventType = safeText(body?.eventType || "", 32);
    if (!["view", "read_complete", "share"].includes(eventType)) {
        return { error: "Unsupported analytics eventType", status: 400 };
    }

    const articleId = safeText(body?.articleId || "", 128);
    if (!isSafeId(articleId, 2)) {
        return { error: "Valid articleId is required", status: 400 };
    }

    const sessionKey = safeText(body?.sessionKey || "anon", 80).replace(/[^A-Za-z0-9_-]/g, "") || "anon";
    const dedupLimit = eventType === "view"
        ? checkRateLimit(`view:${articleId}:${sessionKey}:${clientIp}`, 1, 30 * 60 * 1000)
        : checkRateLimit(`evt:${eventType}:${articleId}:${clientIp}`, 10, 60 * 1000);

    if (!dedupLimit.allowed) {
        return { ok: true, deduplicated: true };
    }

    const article = await rtdbGet(env, accessToken, `publishedArticles/${articleId}`);
    if (!article || article.status !== "published" || !isSafeId(article.authorUid || "", 2)) {
        return { ok: true, skipped: true };
    }

    const creatorUid = article.authorUid;
    const now = Date.now();
    const dayKey = todayKeyUtc();
    const { bucket, host } = classifyReferrerSource(body?.referrer || "");
    const safeHostKey = host.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 48) || "Direct";

    const [summary, daily, artStats, refStats] = await Promise.all([
        rtdbGet(env, accessToken, `creatorAnalytics/${creatorUid}/summary`),
        rtdbGet(env, accessToken, `creatorAnalytics/${creatorUid}/daily/${dayKey}`),
        rtdbGet(env, accessToken, `creatorAnalytics/${creatorUid}/articles/${articleId}`),
        rtdbGet(env, accessToken, `creatorAnalytics/${creatorUid}/referrers/${bucket}`)
    ]);

    const nextSummary = {
        totalViews: Number(summary?.totalViews || 0) + (eventType === "view" ? 1 : 0),
        readCompletes: Number(summary?.readCompletes || 0) + (eventType === "read_complete" ? 1 : 0),
        totalShares: Number(summary?.totalShares || 0) + (eventType === "share" ? 1 : 0),
        updatedAt: now
    };

    const nextDaily = {
        date: dayKey,
        views: Number(daily?.views || 0) + (eventType === "view" ? 1 : 0),
        readCompletes: Number(daily?.readCompletes || 0) + (eventType === "read_complete" ? 1 : 0),
        shares: Number(daily?.shares || 0) + (eventType === "share" ? 1 : 0)
    };

    const nextArtStats = {
        articleId,
        slug: safeText(article.slug || articleId, 120),
        title: safeText(article.title || "Article", 140),
        views: Number(artStats?.views || 0) + (eventType === "view" ? 1 : 0),
        readCompletes: Number(artStats?.readCompletes || 0) + (eventType === "read_complete" ? 1 : 0),
        shares: Number(artStats?.shares || 0) + (eventType === "share" ? 1 : 0),
        updatedAt: now
    };

    const nextRef = {
        bucket,
        count: Number(refStats?.count || 0) + 1,
        lastHost: safeHostKey,
        updatedAt: now
    };

    const nextViewsCount = Number(article.viewsCount || 0) + (eventType === "view" ? 1 : 0);
    const nextSharesCount = Number(article.sharesCount || 0) + (eventType === "share" ? 1 : 0);
    const nextTrending = computeTrendingScoreServer({
        ...article,
        viewsCount: nextViewsCount,
        sharesCount: nextSharesCount
    }, now);

    await Promise.all([
        rtdbPut(env, accessToken, `creatorAnalytics/${creatorUid}/summary`, nextSummary),
        rtdbPut(env, accessToken, `creatorAnalytics/${creatorUid}/daily/${dayKey}`, nextDaily),
        rtdbPut(env, accessToken, `creatorAnalytics/${creatorUid}/articles/${articleId}`, nextArtStats),
        rtdbPut(env, accessToken, `creatorAnalytics/${creatorUid}/referrers/${bucket}`, nextRef),
        rtdbPatch(env, accessToken, `publishedArticles/${articleId}`, {
            viewsCount: nextViewsCount,
            sharesCount: nextSharesCount,
            trendingScore: nextTrending
        })
    ]);

    return { ok: true, recorded: true, eventType };
}

async function handleSyncEmailBadge(decoded, env, accessToken) {
    const uid = decoded.sub;
    const isVerified = decoded.email_verified === true;
    const now = Date.now();
    const existingProfile = await rtdbGet(env, accessToken, `publicProfiles/${uid}`);
    if (!existingProfile) {
        return { ok: true, synced: false, emailVerified: isVerified };
    }
    await Promise.all([
        rtdbPatch(env, accessToken, `publicProfiles/${uid}/badges`, { emailVerified: isVerified }),
        rtdbPut(env, accessToken, `badgeRegistry/${uid}/emailVerified`, {
            badgeType: "emailVerified",
            active: isVerified,
            updatedAt: now,
            grantMode: "automatic_auth"
        })
    ]);
    return { ok: true, synced: true, emailVerified: isVerified };
}

export const CANONICAL_MENU_ITEMS_WORKER = Object.freeze([
    { id: "momo-chicken", name: "Chicken Momo", aliases: ["chicken-momo", "momo-chicken"], price: 130, available: true },
    { id: "momo-buff", name: "Buff Momo", aliases: ["buff-momo", "momo-buff"], price: 140, available: true },
    { id: "chowmein-veg", name: "Veg Chowmein", aliases: ["veg-chowmein", "chowmein-veg"], price: 100, available: true },
    { id: "chowmein-chicken", name: "Chicken Chowmein", aliases: ["chicken-chowmein", "chowmein-chicken"], price: 150, available: true },
    { id: "roti-plain", name: "Roti", aliases: ["roti", "roti-plain", "plain-roti"], price: null, available: true },
    { id: "roti-paratha", name: "Paratha", aliases: ["paratha", "fresh-paratha", "roti-paratha"], price: 30, available: true },
    { id: "tea-milk", name: "Milk Tea", aliases: ["milk-tea", "tea-milk", "chiya"], price: 25, available: true },
    { id: "tea-black", name: "Black Tea", aliases: ["black-tea", "tea-black"], price: 19, available: true },
    { id: "special-biryani", name: "Biryani", aliases: ["biryani", "special-biryani", "chicken-biryani"], price: 350, available: true },
    { id: "snack-chana", name: "Chana", aliases: ["chana", "snack-chana"], price: 30, available: true },
    { id: "snack-keema", name: "Keema", aliases: ["keema", "snack-keema"], price: 120, available: true },
    { id: "snack-sukuti", name: "Sukuti", aliases: ["sukuti", "snack-sukuti"], price: 120, available: true },
    { id: "snack-boiled-egg", name: "Boiled Egg", aliases: ["boiled-egg", "snack-boiled-egg", "egg"], price: 30, available: true },
    { id: "snack-fried-chicken", name: "Fried Chicken", aliases: ["fried-chicken", "snack-fried-chicken"], price: 200, available: true }
]);

function slugKeyWorker(v) {
    return String(v || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
}

function validPriceWorker(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n);
}

export function verifyOrderPricingServer({
    requestedItems = [],
    menuMap = {},
    stockMap = {},
    offersMap = {},
    usedCouponsMap = {},
    couponCode = "",
    storeOpen = true,
    nowMs = Date.now()
} = {}) {
    if (storeOpen === false) {
        return { ok: false, status: 409, error: "Website ordering is currently paused by the restaurant." };
    }
    if (!Array.isArray(requestedItems) || requestedItems.length === 0 || requestedItems.length > 40) {
        return { ok: false, status: 400, error: "At least one menu item is required." };
    }

    const aliasMap = new Map();
    CANONICAL_MENU_ITEMS_WORKER.forEach((base) => {
        aliasMap.set(base.id, base.id);
        aliasMap.set(slugKeyWorker(base.name), base.id);
        base.aliases.forEach((a) => aliasMap.set(slugKeyWorker(a), base.id));
    });

    const remoteByCanonical = new Map();
    const extraItems = [];
    Object.entries(menuMap || {}).forEach(([key, val]) => {
        if (!val || typeof val !== "object") return;
        const cid = aliasMap.get(slugKeyWorker(val.id)) || aliasMap.get(slugKeyWorker(key)) || aliasMap.get(slugKeyWorker(val.name));
        if (cid) {
            const cur = remoteByCanonical.get(cid);
            if (!cur || key === cid || Number(val.updatedAt || 0) >= Number(cur.updatedAt || 0)) {
                remoteByCanonical.set(cid, { key, ...val });
            }
        } else if (val.name) {
            extraItems.push({ key, ...val });
        }
    });

    const isStockOff = (id, name) => {
        const s1 = stockMap?.[slugKeyWorker(id)];
        const s2 = stockMap?.[slugKeyWorker(name)];
        return (s1 && s1.available === false) || (s2 && s2.available === false);
    };

    const resolvedCatalog = CANONICAL_MENU_ITEMS_WORKER.map((base) => {
        const remote = remoteByCanonical.get(base.id);
        let price = base.price;
        if (remote) {
            const parsed = validPriceWorker(remote.price);
            if (parsed !== null) {
                price = parsed;
            } else if (remote.priceUnset === true || remote.price === null || remote.price === 0 || remote.price === "") {
                const isPartial = !Object.prototype.hasOwnProperty.call(remote, "price") && !remote.name;
                price = isPartial ? base.price : null;
            }
        }
        const name = remote?.name ? String(remote.name).trim() : base.name;
        const available = (remote ? remote.available !== false : base.available) && !isStockOff(base.id, name);
        return { id: base.id, name, price, available };
    });

    extraItems.forEach((remote) => {
        const id = String(remote.id || remote.key);
        const name = String(remote.name || "").trim();
        resolvedCatalog.push({
            id,
            name,
            price: validPriceWorker(remote.price),
            available: remote.available !== false && !isStockOff(id, name)
        });
    });

    const billedItems = [];
    let subtotalAmount = 0;

    for (const reqItem of requestedItems) {
        const qty = Number(reqItem?.quantity || 0);
        if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
            return { ok: false, status: 400, error: `Invalid quantity for ${safeText(reqItem?.name || reqItem?.id || "item", 60)}.` };
        }
        const rawLookup = String(reqItem?.id || reqItem?.name || "").trim();
        const cid = aliasMap.get(slugKeyWorker(rawLookup));
        const match = resolvedCatalog.find((m) =>
            m.id === rawLookup ||
            (cid && m.id === cid) ||
            slugKeyWorker(m.name) === slugKeyWorker(rawLookup)
        );
        if (!match) {
            return { ok: false, status: 400, error: `Menu item "${safeText(rawLookup, 60)}" not found on menu.` };
        }
        if (!match.available) {
            return { ok: false, status: 400, error: `${match.name} is currently unavailable.` };
        }
        if (typeof match.price !== "number" || match.price <= 0) {
            return { ok: false, status: 400, error: `${match.name} does not have an online price set yet and cannot be ordered online.` };
        }
        const unitPrice = Math.round(match.price);
        const lineTotal = unitPrice * qty;
        subtotalAmount += lineTotal;
        billedItems.push({ id: match.id, name: match.name, quantity: qty, unitPrice, lineTotal });
    }

    let discountAmount = 0;
    let appliedOffer = null;
    const cleanCode = String(couponCode || "").trim().toUpperCase();
    if (cleanCode) {
        const found = Object.entries(offersMap || {})
            .map(([id, val]) => ({ id, ...(val || {}) }))
            .find((off) =>
                off &&
                off.active !== false &&
                String(off.code || "").trim().toUpperCase() === cleanCode &&
                (!off.expiresAt || Number(off.expiresAt) > nowMs)
            );
        if (!found) {
            return { ok: false, status: 400, error: "Coupon code is invalid or expired." };
        }
        if (usedCouponsMap?.[found.id]?.used) {
            return { ok: false, status: 400, error: "You have already used this coupon on your account." };
        }
        const minOrder = Math.max(0, Math.round(Number(found.minOrderNpr || found.minOrder || 0)));
        if (minOrder > 0 && subtotalAmount < minOrder) {
            return { ok: false, status: 400, error: `Minimum order of Rs. ${minOrder} is required for coupon ${cleanCode}.` };
        }
        const rawVal = Number(found.discountValue || 0);
        discountAmount = found.discountType === "percent"
            ? Math.round((subtotalAmount * Math.min(100, Math.max(0, rawVal))) / 100)
            : Math.round(Math.max(0, rawVal));
        discountAmount = Math.min(subtotalAmount, Math.max(0, discountAmount));
        appliedOffer = {
            id: found.id,
            code: cleanCode,
            title: safeText(found.title || cleanCode, 80)
        };
    }

    return {
        ok: true,
        bill: {
            items: billedItems,
            subtotalAmount,
            discountAmount,
            totalAmount: Math.max(0, subtotalAmount - discountAmount),
            currency: "NPR",
            priceStatus: "server_verified",
            coupon: appliedOffer
        }
    };
}

function extractGroundedMapsPlaces(response) {
    const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (!Array.isArray(chunks)) return [];
    const seen = new Set();
    const places = [];
    for (const chunk of chunks) {
        const maps = chunk?.maps;
        const uri = safeText(maps?.uri || "", 500);
        if (!uri || seen.has(uri)) continue;
        let parsed;
        try { parsed = new URL(uri); } catch { continue; }
        if (parsed.protocol !== "https:" || !["www.google.com", "google.com", "maps.google.com", "maps.app.goo.gl"].includes(parsed.hostname.toLowerCase())) continue;
        seen.add(uri);
        const snippets = Array.isArray(maps?.placeAnswerSources?.reviewSnippets)
            ? maps.placeAnswerSources.reviewSnippets
                .map((item) => safeText(item?.content || item?.text || "", 180))
                .filter(Boolean)
                .slice(0, 2)
            : [];
        places.push({
            title: safeText(maps?.title || "Google Maps Place", 140),
            uri,
            placeId: safeText(maps?.placeId || "", 128),
            snippets
        });
        if (places.length >= 8) break;
    }
    return places;
}

async function handleMapsGrounding(body, env, clientIp) {
    const apiKey = String(env?.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
        return { ok: false, status: 503, error: "Nearby place search is not configured yet.", code: "maps_grounding_not_configured" };
    }
    const query = safeText(body?.query || "", 500);
    if (!query) return { ok: false, status: 400, error: "Please enter a location question (1–500 characters)." };
    const latitudeRaw = Number(body?.lat);
    const longitudeRaw = Number(body?.lng);
    const latitude = Number.isFinite(latitudeRaw) && latitudeRaw >= -90 && latitudeRaw <= 90 ? latitudeRaw : 27.6087174620;
    const longitude = Number.isFinite(longitudeRaw) && longitudeRaw >= -180 && longitudeRaw <= 180 ? longitudeRaw : 84.5682702860;
    const model = safeText(env?.GEMINI_MAPS_MODEL || "gemini-2.5-flash", 80);
    const prompt = `Context: A visitor is checking places around Siranchowk Khaja Ghar (Khairahani-6, Parsa, Chitwan, Nepal — behind Chaudhary Medical, coordinates ${latitude.toFixed(6)}, ${longitude.toFixed(6)}).\nVisitor question: ${query}\nRespond helpfully with specific real nearby landmarks, transit stops, or amenities grounded via Google Maps. Do not invent places.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            tools: [{ googleMaps: {} }],
            toolConfig: { retrievalConfig: { latLng: { latitude, longitude } } }
        }),
        signal: AbortSignal.timeout(25000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 429) return { ok: false, status: 429, error: "Nearby place search has reached its current quota. Please try again later." };
        if (response.status === 401 || response.status === 403) return { ok: false, status: 503, error: "Nearby place search credentials need to be checked." };
        return { ok: false, status: 502, error: "Nearby place search is temporarily unavailable." };
    }
    const answer = (data?.candidates?.[0]?.content?.parts || [])
        .map((part) => typeof part?.text === "string" ? part.text : "")
        .filter(Boolean)
        .join("\n")
        .slice(0, 6000);
    return {
        ok: true,
        answer: answer || "No nearby summary was returned for this location question.",
        model,
        center: { lat: latitude, lng: longitude },
        places: extractGroundedMapsPlaces(data)
    };
}

export async function createTrustedOrder(body, decoded, env, accessToken, nowMs = Date.now()) {
    const uid = safeText(decoded?.sub || "", 128);
    const orderId = safeText(body?.orderId || "", 128);
    const trackingToken = safeText(body?.trackingToken || "", 64);
    const customerName = safeText(body?.customerName || "", 80);
    const customerPhone = safeText(body?.customerPhone || "", 16);
    const orderType = safeText(body?.orderType || "", 20);
    const deliveryAddress = safeText(body?.deliveryAddress || "", 180);
    const notes = safeText(body?.notes || "", 400);
    const expectedTotal = Number(body?.expectedTotal);
    const couponCode = safeText(body?.couponCode || "", 40).toUpperCase();

    if (!isSafeId(uid, 2)) return { ok: false, status: 401, error: "Authenticated customer account required." };
    if (!isSafeId(orderId, 8) || !/^[A-Za-z0-9]{48}$/.test(trackingToken)) {
        return { ok: false, status: 400, error: "Invalid order reference. Please try again." };
    }
    if (customerName.length < 2 || !/^[0-9+()\- ]{7,16}$/.test(customerPhone)) {
        return { ok: false, status: 400, error: "Please provide a valid name and phone number." };
    }
    const phoneDigits = customerPhone.replace(/\D/g, "");
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
        return { ok: false, status: 400, error: "Please provide a valid phone number." };
    }
    if (!["Pickup", "Delivery", "Dine-in"].includes(orderType)) {
        return { ok: false, status: 400, error: "Please select a valid order type." };
    }
    if (orderType === "Delivery" && deliveryAddress.length < 4) {
        return { ok: false, status: 400, error: "Please provide a delivery address or nearby landmark." };
    }
    if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0) {
        return { ok: false, status: 400, error: "A valid displayed total is required." };
    }

    const [menuMap, stockMap, offersMap, storeOpenVal, usedCouponsMap, existingOrder, existingTracking] = await Promise.all([
        rtdbGet(env, accessToken, "menu_items"),
        rtdbGet(env, accessToken, "inventory/stockAvailability"),
        couponCode ? rtdbGet(env, accessToken, "offers") : Promise.resolve({}),
        rtdbGet(env, accessToken, "settings/business/storeOpen"),
        couponCode ? rtdbGet(env, accessToken, `users/${uid}/coupons`) : Promise.resolve({}),
        rtdbGet(env, accessToken, `orders/${orderId}`),
        rtdbGet(env, accessToken, `orderTracking/${trackingToken}`)
    ]);

    if (existingOrder) {
        if (existingOrder.customerUid === uid && existingOrder.customerTrackingToken === trackingToken && existingOrder.priceStatus === "server_verified" && existingTracking?.orderId === orderId) {
            return {
                ok: true,
                idempotent: true,
                order: existingOrder,
                tracking: existingTracking,
                bill: {
                    items: Array.isArray(existingOrder.items) ? existingOrder.items : [],
                    subtotalAmount: Number(existingOrder.subtotalAmount || 0),
                    discountAmount: Number(existingOrder.discountAmount || 0),
                    totalAmount: Number(existingOrder.totalAmount || 0),
                    coupon: existingOrder.couponCode ? { code: existingOrder.couponCode, title: existingOrder.couponSummary || "" } : null
                },
                trackingSaved: true
            };
        }
        return { ok: false, status: 409, error: "This order reference is already linked to a different request." };
    }
    if (existingTracking) {
        return { ok: false, status: 409, error: "This tracking reference has already been used. Please retry checkout." };
    }

    const verified = verifyOrderPricingServer({
        requestedItems: body?.items || [],
        menuMap: menuMap || {},
        stockMap: stockMap || {},
        offersMap: offersMap || {},
        usedCouponsMap: usedCouponsMap || {},
        couponCode,
        storeOpen: storeOpenVal !== false,
        nowMs
    });
    if (!verified.ok) return verified;

    if (verified.bill.totalAmount > 5000000 || verified.bill.subtotalAmount > 5000000 || verified.bill.discountAmount > 5000000) {
        return { ok: false, status: 400, error: "This order exceeds the supported checkout total. Please contact the restaurant." };
    }

    if (verified.bill.totalAmount !== expectedTotal) {
        return {
            ok: false,
            status: 409,
            error: "The live menu or coupon price changed. Review the updated total and confirm again.",
            bill: verified.bill
        };
    }

    const items = verified.bill.items;
    const summary = items.map((item) => `${item.quantity} × ${item.name}`).join(", ").slice(0, 1000);
    const order = {
        id: orderId,
        customerUid: uid,
        ...(typeof decoded.email === "string" ? { customerEmail: safeText(decoded.email, 160) } : {}),
        customerName,
        customerPhone,
        items,
        summary,
        orderType,
        deliveryAddress,
        notes,
        status: "pending",
        source: "website",
        currency: "NPR",
        subtotalAmount: verified.bill.subtotalAmount,
        discountAmount: verified.bill.discountAmount,
        totalAmount: verified.bill.totalAmount,
        priceStatus: "server_verified",
        customerTrackingToken: trackingToken,
        createdAt: nowMs,
        updatedAt: nowMs
    };
    if (verified.bill.coupon) {
        order.couponCode = safeText(verified.bill.coupon.code || "", 40);
        order.couponSummary = safeText(verified.bill.coupon.title || "", 160);
    }

    const tracking = { orderId, status: "pending", updatedAt: nowMs };
    const updates = {
        [`orders/${orderId}`]: order,
        [`orderTracking/${trackingToken}`]: tracking,
        [`users/${uid}/orders/${orderId}`]: { ...order, trackingSaved: true }
    };

    if (verified.bill.coupon?.id) {
        const couponId = safeText(verified.bill.coupon.id, 128);
        if (!isSafeId(couponId, 1)) {
            return { ok: false, status: 400, error: "The selected coupon has an invalid identifier." };
        }
        updates[`users/${uid}/coupons/${couponId}`] = {
            id: couponId,
            code: verified.bill.coupon.code,
            title: verified.bill.coupon.title,
            summary: verified.bill.coupon.title,
            used: true,
            orderId,
            usedAt: nowMs
        };
    }

    // One root PATCH makes the order, tracking record, account mirror and coupon use a single RTDB write.
    await rtdbPatch(env, accessToken, "", updates);
    return { ok: true, order, tracking, bill: verified.bill, trackingSaved: true };
}

export function validateUploadedImageBytes(bytes, claimedMime = "") {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        return { ok: false, error: "Image file is empty." };
    }
    if (bytes.length > MAX_MEDIA_BYTES) {
        return { ok: false, error: "Image exceeds the 5 MB upload limit." };
    }
    // Check JPEG (FF D8 FF)
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return { ok: true, mimeType: "image/jpeg", ext: "jpg" };
    }
    // Check PNG (89 50 4E 47 0D 0A 1A 0A)
    if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    ) {
        return { ok: true, mimeType: "image/png", ext: "png" };
    }
    // Check WebP (RIFF....WEBP)
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
        return { ok: true, mimeType: "image/webp", ext: "webp" };
    }
    return { ok: false, error: `Unsupported or invalid image signature${claimedMime ? ` (${safeText(claimedMime, 32)})` : ""}. Only valid JPEG, PNG, and WebP images are permitted.` };
}

async function handleCreatorDecision(body, actorUid, actorRole, decoded, env, accessToken) {
    const targetUid = safeText(body?.targetUid || "", 128);
    const decision = safeText(body?.decision || "", 32);
    const reason = safeText(body?.reason || "", 320);

    if (!isSafeId(targetUid, 2)) {
        return { error: "Valid targetUid required", status: 400 };
    }
    const allowedDecisions = ["under_review", "more_info_required", "approved", "rejected", "suspended"];
    if (!allowedDecisions.includes(decision)) {
        return { error: `Decision must be one of: ${allowedDecisions.join(", ")}`, status: 400 };
    }
    if (["rejected", "more_info_required", "suspended"].includes(decision) && !reason) {
        return { error: "A clear reason or note is required for this status update.", status: 400 };
    }

    const now = Date.now();
    const [existingApp, existingProfile] = await Promise.all([
        rtdbGet(env, accessToken, `creatorApplications/${targetUid}`),
        rtdbGet(env, accessToken, `publicProfiles/${targetUid}`)
    ]);

    if (existingApp) {
        await rtdbPatch(env, accessToken, `creatorApplications/${targetUid}`, {
            status: decision,
            reviewedByUid: actorUid,
            reviewedByEmail: safeText(decoded.email || "", 120),
            reviewNote: reason,
            reviewedAt: now,
            updatedAt: now
        });
    }

    if (existingProfile) {
        await rtdbPatch(env, accessToken, `publicProfiles/${targetUid}`, {
            creatorStatus: decision,
            updatedAt: now
        });
    }

    const notifId = `notif_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const titleMap = {
        under_review: "Creator Application Under Review",
        more_info_required: "More Information Needed for Creator Application",
        approved: "Creator Publishing Approved",
        rejected: "Creator Application Update",
        suspended: "Creator Publishing Suspended"
    };
    const auditId = `aud_${now}_${Math.random().toString(36).slice(2, 8)}`;
    await Promise.all([
        rtdbPut(env, accessToken, `userSocialNotifications/${targetUid}/${notifId}`, {
            id: notifId,
            type: "creator_status",
            title: titleMap[decision],
            body: reason || `Your creator publishing status is now ${decision.replace(/_/g, " ")}.`,
            actorUid,
            read: false,
            createdAt: now
        }),
        rtdbPost(env, accessToken, "securityLogs", {
            eventType: `creator_${decision}`,
            severity: decision === "suspended" ? "high" : "info",
            actorUid,
            actorEmail: safeText(decoded.email || "", 120).toLowerCase(),
            actorRole,
            target: targetUid,
            details: { decision, reason },
            timestamp: now
        }),
        rtdbPut(env, accessToken, `auditLogs/${auditId}`, {
            id: auditId,
            action: `creator_${decision}`,
            actorUid,
            actorEmail: safeText(decoded.email || "", 120).toLowerCase(),
            actorRole,
            target: targetUid,
            metadata: { decision, reason },
            timestamp: now
        })
    ]);

    return { ok: true, targetUid, creatorStatus: decision };
}

async function handleManageBadge(body, actorUid, actorRole, decoded, env, accessToken) {
    const targetUid = safeText(body?.targetUid || "", 128);
    const badgeType = safeText(body?.badgeType || "", 32);
    const action = body?.action === "revoke" ? "revoke" : "grant";
    const note = safeText(body?.note || "", 240);
    const specialtyNote = safeText(body?.specialtyNote || "", 120);

    if (!isSafeId(targetUid, 2)) {
        return { error: "Valid targetUid required", status: 400 };
    }
    if (!["verifiedCreator", "officialOrg", "expertSpecialist"].includes(badgeType)) {
        return { error: "Admin badgeType must be verifiedCreator, officialOrg, or expertSpecialist", status: 400 };
    }

    const profile = await rtdbGet(env, accessToken, `publicProfiles/${targetUid}`);
    if (!profile) {
        return { error: "Public profile not found for target user", status: 404 };
    }

    const active = action === "grant";
    const now = Date.now();
    const logId = `blog_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const notifId = `notif_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const profilePatch = { updatedAt: now };
    if (badgeType === "expertSpecialist") {
        profilePatch.specialtyNote = active ? (specialtyNote || profile.specialtyNote || "Domain Specialist") : "";
    }

    const badgeLabels = {
        verifiedCreator: "Verified Creator",
        officialOrg: "Official Organization",
        expertSpecialist: "Domain Specialist"
    };

    await Promise.all([
        rtdbPatch(env, accessToken, `publicProfiles/${targetUid}`, profilePatch),
        rtdbPatch(env, accessToken, `publicProfiles/${targetUid}/badges`, { [badgeType]: active }),
        rtdbPut(env, accessToken, `badgeRegistry/${targetUid}/${badgeType}`, {
            badgeType,
            active,
            specialtyNote: badgeType === "expertSpecialist" ? (specialtyNote || "") : "",
            grantedByUid: actorUid,
            updatedAt: now
        }),
        rtdbPut(env, accessToken, `badgeAuditLogs/${logId}`, {
            id: logId,
            targetUid,
            targetUsername: safeText(profile.username || "", 40),
            badgeType,
            action,
            note: note || specialtyNote || "",
            actorUid,
            actorEmail: safeText(decoded.email || "", 120),
            timestamp: now
        }),
        rtdbPost(env, accessToken, "securityLogs", {
            eventType: active ? "badge_granted" : "badge_revoked",
            severity: active ? "info" : "warning",
            actorUid,
            actorEmail: safeText(decoded.email || "", 120).toLowerCase(),
            actorRole,
            target: `${targetUid}:${badgeType}`,
            details: { badgeType, action, note },
            timestamp: now
        }),
        rtdbPut(env, accessToken, `userSocialNotifications/${targetUid}/${notifId}`, {
            id: notifId,
            type: "badge_update",
            title: active ? `${badgeLabels[badgeType]} Badge Granted` : `${badgeLabels[badgeType]} Badge Revoked`,
            body: note || (active ? `Your profile now carries the ${badgeLabels[badgeType]} badge.` : `Your ${badgeLabels[badgeType]} badge was removed by administrators.`),
            actorUid,
            read: false,
            createdAt: now
        })
    ]);

    return { ok: true, targetUid, badgeType, active };
}

async function handleModerateContent(body, actorUid, actorRole, decoded, env, accessToken) {
    const action = safeText(body?.action || "", 40);
    const targetId = safeText(body?.targetId || "", 128);
    const parentId = safeText(body?.parentId || "", 128);
    const reportId = safeText(body?.reportId || "", 128);
    const reason = safeText(body?.reason || "Policy moderation action", 320);
    const now = Date.now();
    let affectedAuthorUid = "";
    let articleTitle = "";

    const movePublishedToModerated = async (modStatus) => {
        const article = await rtdbGet(env, accessToken, `publishedArticles/${targetId}`);
        if (!article) return null;
        affectedAuthorUid = article.authorUid || "";
        articleTitle = article.title || "Article";
        const payload = {
            ...article,
            status: modStatus,
            moderatedAt: now,
            moderatedByUid: actorUid,
            moderationReason: reason
        };
        if (modStatus === "removed") {
            payload.deletedAt = now;
            payload.recoverableUntil = now + 30 * 24 * 60 * 60 * 1000;
        }
        await rtdbPut(env, accessToken, `moderatedArticles/${targetId}`, payload);
        await rtdbDelete(env, accessToken, `publishedArticles/${targetId}`);
        return article;
    };

    if (["hide_article", "unpublish_article", "review_article", "reject_article", "soft_delete_article", "suspend_article"].includes(action) && isSafeId(targetId, 2)) {
        const statusMap = {
            hide_article: "hidden",
            unpublish_article: "draft",
            review_article: "under_review",
            reject_article: "rejected",
            soft_delete_article: "removed",
            suspend_article: "suspended"
        };
        const moved = await movePublishedToModerated(statusMap[action]);
        if (!moved) {
            const existingMod = await rtdbGet(env, accessToken, `moderatedArticles/${targetId}`);
            if (!existingMod) return { error: "Article not found", status: 404 };
            affectedAuthorUid = existingMod.authorUid || "";
            articleTitle = existingMod.title || "Article";
            await rtdbPatch(env, accessToken, `moderatedArticles/${targetId}`, {
                status: statusMap[action],
                moderatedAt: now,
                moderatedByUid: actorUid,
                moderationReason: reason,
                ...(statusMap[action] === "removed" ? { deletedAt: now, recoverableUntil: now + 30 * 86400000 } : {})
            });
        }
    } else if (action === "restore_article" && isSafeId(targetId, 2)) {
        const moderated = await rtdbGet(env, accessToken, `moderatedArticles/${targetId}`);
        if (!moderated) return { error: "Moderated article not found", status: 404 };
        affectedAuthorUid = moderated.authorUid || "";
        articleTitle = moderated.title || "Article";
        const restored = { ...moderated, status: "published", updatedAt: now };
        delete restored.moderatedAt;
        delete restored.moderatedByUid;
        delete restored.moderationReason;
        delete restored.deletedAt;
        delete restored.recoverableUntil;
        await rtdbPut(env, accessToken, `publishedArticles/${targetId}`, restored);
        await rtdbDelete(env, accessToken, `moderatedArticles/${targetId}`);
    } else if (action === "permanent_delete_article" && isSafeId(targetId, 2)) {
        const mod = await rtdbGet(env, accessToken, `moderatedArticles/${targetId}`);
        const pub = mod || (await rtdbGet(env, accessToken, `publishedArticles/${targetId}`));
        if (!pub) return { error: "Article not found", status: 404 };
        affectedAuthorUid = pub.authorUid || "";
        articleTitle = pub.title || "Article";
        const slugStr = typeof pub.slug === "string" ? pub.slug.trim() : "";
        const canDeleteSlug = Boolean(slugStr && !slugStr.includes("/") && !slugStr.includes(".."));
        await Promise.all([
            rtdbDelete(env, accessToken, `moderatedArticles/${targetId}`).catch(() => {}),
            rtdbDelete(env, accessToken, `publishedArticles/${targetId}`).catch(() => {}),
            ...(canDeleteSlug ? [rtdbDelete(env, accessToken, `articleSlugs/${slugStr}`).catch(() => {})] : [])
        ]);
    } else if (action === "edit_article" && isSafeId(targetId, 2)) {
        const pub = await rtdbGet(env, accessToken, `publishedArticles/${targetId}`);
        if (!pub) return { error: "Published article not found", status: 404 };
        affectedAuthorUid = pub.authorUid || "";
        articleTitle = safeText(body?.title || pub.title || "Article", 180);
        const nextSubtitle = safeText(body?.subtitle ?? body?.excerpt ?? pub.subtitle ?? pub.excerpt ?? "", 280);
        const patch = {
            title: articleTitle,
            subtitle: nextSubtitle,
            category: safeText(body?.category || pub.category || "community", 48),
            updatedAt: now,
            lastModeratedEditBy: actorUid
        };
        const rawMarkdown = typeof body?.contentMarkdown === "string"
            ? body.contentMarkdown
            : (typeof body?.bodyMarkdown === "string" ? body.bodyMarkdown : "");
        if (rawMarkdown.trim().length > 0) {
            patch.contentMarkdown = String(rawMarkdown).slice(0, 80000);
        }
        await rtdbPatch(env, accessToken, `publishedArticles/${targetId}`, patch);
    } else if (action === "delete_comment" && isSafeId(parentId, 2) && isSafeId(targetId, 2)) {
        const existingComment = await rtdbGet(env, accessToken, `articleComments/${parentId}/${targetId}`);
        await rtdbDelete(env, accessToken, `articleComments/${parentId}/${targetId}`);
        if (existingComment) {
            const pub = await rtdbGet(env, accessToken, `publishedArticles/${parentId}`);
            if (pub) {
                await rtdbPatch(env, accessToken, `publishedArticles/${parentId}`, {
                    commentsCount: Math.max(0, Number(pub.commentsCount || 0) - 1),
                    updatedAt: now
                }).catch(() => {});
            }
        }
    } else if (action === "delete_repost" && isSafeId(targetId, 2)) {
        const existingRepost = await rtdbGet(env, accessToken, `articleReposts/${targetId}`);
        await rtdbDelete(env, accessToken, `articleReposts/${targetId}`);
        if (existingRepost?.originalArticleId && isSafeId(existingRepost.originalArticleId, 2)) {
            const pub = await rtdbGet(env, accessToken, `publishedArticles/${existingRepost.originalArticleId}`);
            if (pub) {
                await rtdbPatch(env, accessToken, `publishedArticles/${existingRepost.originalArticleId}`, {
                    repostsCount: Math.max(0, Number(pub.repostsCount || 0) - 1),
                    updatedAt: now
                }).catch(() => {});
            }
        }
    } else if (action === "suspend_profile" && isSafeId(targetId, 2)) {
        affectedAuthorUid = targetId;
        await rtdbPatch(env, accessToken, `publicProfiles/${targetId}`, {
            creatorStatus: "suspended",
            updatedAt: now
        });
    } else if (action === "restore_profile" && isSafeId(targetId, 2)) {
        const existingProfile = await rtdbGet(env, accessToken, `publicProfiles/${targetId}`);
        if (!existingProfile || existingProfile.creatorStatus !== "suspended") {
            return {
                error: "Only suspended creator profiles can be restored by moderation; approving creators requires manageCreators permission.",
                status: 409
            };
        }
        affectedAuthorUid = targetId;
        await rtdbPatch(env, accessToken, `publicProfiles/${targetId}`, {
            creatorStatus: "approved",
            updatedAt: now
        });
    } else if (action !== "dismiss_report") {
        return { error: "Unsupported moderation action or invalid targetId", status: 400 };
    }

    if (reportId && isSafeId(reportId, 2)) {
        await rtdbPatch(env, accessToken, `contentReports/${reportId}`, {
            status: action === "dismiss_report" ? "dismissed" : "resolved",
            resolutionAction: action,
            resolutionNote: reason,
            resolvedByUid: actorUid,
            resolvedAt: now
        });
    }

    const auditId = `aud_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const tasks = [
        rtdbPost(env, accessToken, "securityLogs", {
            eventType: "content_moderated",
            severity: "warning",
            actorUid,
            actorEmail: safeText(decoded.email || "", 120).toLowerCase(),
            actorRole,
            target: `${action}:${targetId || reportId}`,
            details: { action, parentId, reportId, reason },
            timestamp: now
        }),
        rtdbPut(env, accessToken, `auditLogs/${auditId}`, {
            id: auditId,
            action: `moderation_${action}`,
            actorUid,
            actorEmail: safeText(decoded.email || "", 120).toLowerCase(),
            actorRole,
            target: targetId || reportId,
            metadata: { action, parentId, reportId, reason, title: articleTitle },
            timestamp: now
        })
    ];

    if (affectedAuthorUid && isSafeId(affectedAuthorUid, 2)) {
        const notifId = `mod_${now}_${Math.random().toString(36).slice(2, 8)}`;
        tasks.push(rtdbPut(env, accessToken, `userSocialNotifications/${affectedAuthorUid}/${notifId}`, {
            id: notifId,
            type: "moderation_notice",
            title: `Content Moderation Notice (${action.replace(/_/g, " ")})`,
            body: `${articleTitle ? `"${articleTitle}": ` : ""}${reason}`,
            actorUid,
            read: false,
            createdAt: now
        }));
    }

    await Promise.all(tasks);

    return { ok: true, action, targetId };
}

// FCM registration tokens are URL-safe strings (letters, digits, ':', '_', '-', '.').
// Rejecting anything else stops garbage/injected values from ever being sent to FCM.
const FCM_TOKEN_PATTERN = /^[A-Za-z0-9:_.-]{10,4096}$/;
export function isPlausibleFcmToken(token) {
    return typeof token === "string" && FCM_TOKEN_PATTERN.test(token);
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
        const isPrimaryOwner = Boolean(primaryOwnerUid && device.uid === primaryOwnerUid);
        if (!isPrimaryOwner && (!staffRecord || staffRecord.active === false)) {
            return;
        }

        const isDeviceOwner =
            isPrimaryOwner ||
            (staffRecord?.active !== false && staffRecord?.role === "owner");

        if (requireStaffOrderPerm && !isDeviceOwner) {
            const roleName = staffRecord?.role || "helper";
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

        if (origin && !isOriginAllowed(env, origin)) {
            return jsonResponse({ error: "Origin not allowed" }, 403, headers);
        }

        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
            if (!origin) {
                return jsonResponse({ error: "Origin not allowed" }, 403, headers);
            }
            return new Response(null, { status: 204, headers });
        }

        // PUBLIC R2 MEDIA SERVING ROUTE (GET /media/:key)
        if (request.method === "GET" && url.pathname.startsWith("/media/")) {
            let rawKey = "";
            try {
                rawKey = decodeURIComponent(url.pathname.slice("/media/".length));
            } catch {
                return jsonResponse({ error: "Invalid media key encoding" }, 400, headers);
            }
            if (!/^uploads\/[A-Za-z0-9_\/.-]{4,200}$/.test(rawKey) || rawKey.includes("..")) {
                return jsonResponse({ error: "Invalid media key" }, 400, headers);
            }
            if (!env?.MEDIA_BUCKET || typeof env.MEDIA_BUCKET.get !== "function") {
                return jsonResponse({ error: "Cloudflare R2 MEDIA_BUCKET is not bound on this Worker yet." }, 503, headers);
            }
            const obj = await env.MEDIA_BUCKET.get(rawKey);
            if (!obj) {
                return jsonResponse({ error: "Media object not found" }, 404, headers);
            }
            return new Response(obj.body, {
                status: 200,
                headers: {
                    ...headers,
                    "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
                    "Cache-Control": "public, max-age=31536000, immutable",
                    "X-Content-Type-Options": "nosniff"
                }
            });
        }

        if (request.method === "GET" && url.pathname === "/health") {
            return jsonResponse({
                ok: true,
                success: true,
                service: "Siranchowk Khaja Ghar Notifications",
                status: "Worker is running",
                projectId: env?.FIREBASE_PROJECT_ID || "",
                r2Configured: Boolean(env?.MEDIA_BUCKET && typeof env.MEDIA_BUCKET.get === "function")
            }, 200, headers);
        }

        if (request.method !== "POST") {
            return jsonResponse({ error: "Method not allowed" }, 405, headers);
        }

        if (url.pathname === "/media/upload") {
            if (!(request.headers.get("Content-Type") || "").includes("multipart/form-data")) {
                return jsonResponse({ error: "multipart/form-data Content-Type required for media upload" }, 400, headers);
            }
            const uploadContentLength = Number(request.headers.get("Content-Length") || 0);
            if (Number.isFinite(uploadContentLength) && uploadContentLength > MAX_MEDIA_BYTES + 65536) {
                return jsonResponse({ error: "Upload payload exceeds maximum 5 MB limit" }, 413, headers);
            }
            try {
                assertWorkerConfigured(env);
                const authHeader = request.headers.get("Authorization") || "";
                const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
                if (!idToken) {
                    return jsonResponse({ error: "Authorization token required" }, 401, headers);
                }
                const decoded = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID).catch(() => null);
                if (!decoded) {
                    return jsonResponse({ error: "Invalid or expired Firebase ID token" }, 401, headers);
                }
                const clientIp = getClientIp(request);
                const uploadLimit = checkRateLimit(`upload:${clientIp}:${decoded.sub}`, 15, 60000);
                if (!uploadLimit.allowed) {
                    return jsonResponse({ error: "Upload rate limit exceeded. Please wait a minute." }, 429, headers);
                }
                if (!env?.MEDIA_BUCKET || typeof env.MEDIA_BUCKET.put !== "function") {
                    return jsonResponse({ error: "Cloudflare R2 MEDIA_BUCKET is not configured yet. Follow CLOUDFLARE-SETUP-GUIDE.md to bind MEDIA_BUCKET.", code: "r2_not_configured" }, 503, headers);
                }

                const accessToken = await getGoogleAccessToken(env);
                const [staff, profile] = await Promise.all([
                    rtdbGet(env, accessToken, `staff/${decoded.sub}`),
                    rtdbGet(env, accessToken, `publicProfiles/${decoded.sub}`)
                ]);
                const staffStatus = getStaffStatus(decoded.sub, staff, env);
                const isApprovedCreator = profile?.creatorStatus === "approved";
                if (!staffStatus.active && !isApprovedCreator) {
                    return jsonResponse({ error: "Only approved creators or authorized staff may upload media." }, 403, headers);
                }

                const formData = await request.formData();
                const file = formData.get("file");
                const altText = safeText(formData.get("alt") || "", 180);
                if (!file || typeof file.arrayBuffer !== "function") {
                    return jsonResponse({ error: "Image file field ('file') is required." }, 400, headers);
                }
                if (typeof file.size === "number" && file.size > MAX_MEDIA_BYTES) {
                    return jsonResponse({ error: "Image must be 5 MB or smaller." }, 413, headers);
                }
                const bytes = new Uint8Array(await file.arrayBuffer());
                const check = validateUploadedImageBytes(bytes, file.type || "");
                if (!check.ok) {
                    return jsonResponse({ error: check.error }, 400, headers);
                }

                const now = Date.now();
                const mediaId = `med_${now}_${Math.random().toString(36).slice(2, 10)}`;
                const safeUid = decoded.sub.replace(/[^A-Za-z0-9_-]/g, "");
                const key = `uploads/${safeUid}/${mediaId}.${check.ext}`;

                await env.MEDIA_BUCKET.put(key, bytes, {
                    httpMetadata: {
                        contentType: check.mimeType,
                        cacheControl: "public, max-age=31536000, immutable"
                    },
                    customMetadata: {
                        uploaderUid: decoded.sub,
                        altText
                    }
                });

                const publicUrl = `${url.origin}/media/${key}`;
                await rtdbPut(env, accessToken, `mediaLibrary/${mediaId}`, {
                    id: mediaId,
                    key,
                    url: publicUrl,
                    mimeType: check.mimeType,
                    sizeBytes: bytes.length,
                    alt: altText,
                    uploaderUid: decoded.sub,
                    createdAt: now
                });

                return jsonResponse({ ok: true, id: mediaId, key, url: publicUrl, mimeType: check.mimeType, sizeBytes: bytes.length }, 200, headers);
            } catch (error) {
                if (error instanceof ConfigError) {
                    return jsonResponse({ error: "Upload service is not configured yet.", code: "worker_not_configured" }, 503, headers);
                }
                return jsonResponse({ error: "Media upload failed" }, 500, headers);
            }
        }

        const contentLength = Number(request.headers.get("Content-Length") || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
            return jsonResponse({ error: "Request payload too large" }, 413, headers);
        }

        let body;
        try {
            const rawBody = await request.text();
            if (rawBody.length > MAX_BODY_BYTES) {
                return jsonResponse({ error: "Request payload too large" }, 413, headers);
            }
            body = JSON.parse(rawBody || "{}");
            if (!body || typeof body !== "object" || Array.isArray(body)) {
                return jsonResponse({ error: "JSON object body required" }, 400, headers);
            }
        } catch {
            return jsonResponse({ error: "Invalid JSON request body" }, 400, headers);
        }

        try {
            assertWorkerConfigured(env);

            const type = body?.type;
            const clientIp = getClientIp(request);

            // PUBLIC GOOGLE MAPS GROUNDING — API key remains in the Worker secret.
            if (type === "maps_grounding") {
                const mapsLimit = checkRateLimit(`maps_grounding:ip:${clientIp}`, 8, 60000);
                if (!mapsLimit.allowed) {
                    return jsonResponse({ error: "Nearby place search rate limit reached. Please wait a minute." }, 429,
                        { ...headers, "Retry-After": String(mapsLimit.retryAfterSec || 60) });
                }
                const result = await handleMapsGrounding(body, env, clientIp);
                if (!result.ok) return jsonResponse(result, result.status || 400, headers);
                return jsonResponse(result, 200, headers);
            }

            // AUTHORITATIVE SERVER-SIDE ORDER PRICING & COUPON VERIFICATION
            if (type === "verify_order_pricing") {
                const verifyLimit = checkRateLimit(`verify_order:ip:${clientIp}`, 25, 60000);
                if (!verifyLimit.allowed) {
                    return jsonResponse(
                        { error: "Too many verification requests. Please wait shortly." },
                        429,
                        { ...headers, "Retry-After": String(verifyLimit.retryAfterSec || 60) }
                    );
                }
                const accessToken = await getGoogleAccessToken(env);
                let optionalUid = "";
                const optAuth = request.headers.get("Authorization") || "";
                if (optAuth.startsWith("Bearer ")) {
                    const tok = optAuth.slice(7).trim();
                    if (tok) {
                        const dec = await verifyFirebaseIdToken(tok, env.FIREBASE_PROJECT_ID).catch(() => null);
                        if (dec?.sub) optionalUid = dec.sub;
                    }
                }
                const [menuMap, stockMap, offersMap, storeOpenVal, usedCouponsMap] = await Promise.all([
                    rtdbGet(env, accessToken, "menu_items"),
                    rtdbGet(env, accessToken, "inventory/stockAvailability"),
                    body?.couponCode ? rtdbGet(env, accessToken, "offers") : Promise.resolve({}),
                    rtdbGet(env, accessToken, "settings/business/storeOpen"),
                    optionalUid && body?.couponCode ? rtdbGet(env, accessToken, `users/${optionalUid}/coupons`) : Promise.resolve({})
                ]);
                const result = verifyOrderPricingServer({
                    requestedItems: body?.items || [],
                    menuMap: menuMap || {},
                    stockMap: stockMap || {},
                    offersMap: offersMap || {},
                    usedCouponsMap: usedCouponsMap || {},
                    couponCode: body?.couponCode || "",
                    storeOpen: storeOpenVal !== false
                });
                if (!result.ok) {
                    return jsonResponse({ error: result.error }, result.status || 400, headers);
                }
                return jsonResponse({ ok: true, bill: result.bill }, 200, headers);
            }

            // PUBLIC NEW-ORDER PUSH
            if (type === "new_order_alert") {
                const orderId = safeText(body?.orderId || "", 128);
                const trackingToken = safeText(body?.trackingToken || "", 64);

                if (!isSafeId(orderId, 8) || !/^[A-Za-z0-9]{48}$/.test(trackingToken)) {
                    return jsonResponse({
                        error: "Valid orderId and trackingToken required"
                    }, 400, headers);
                }

                const ipLimit = checkRateLimit(`new_order:ip:${clientIp}`, 12, 60000);
                const orderLimit = checkRateLimit(`new_order:order:${orderId}`, 5, 60000);
                if (!ipLimit.allowed || !orderLimit.allowed) {
                    const retryAfter = Math.max(ipLimit.retryAfterSec, orderLimit.retryAfterSec, 1);
                    return jsonResponse(
                        { error: "Too many requests. Please try again shortly." },
                        429,
                        { ...headers, "Retry-After": String(retryAfter) }
                    );
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

            // PUBLIC ANONYMOUS / PRIVACY-RESPECTING CONTENT ANALYTICS ROUTE
            if (type === "platform_track_event") {
                const ipLimit = checkRateLimit(`track:ip:${clientIp}`, 60, 60000);
                if (!ipLimit.allowed) {
                    return jsonResponse(
                        { error: "Too many tracking events" },
                        429,
                        { ...headers, "Retry-After": String(ipLimit.retryAfterSec || 60) }
                    );
                }
                const accessToken = await getGoogleAccessToken(env);
                const result = await handlePlatformTrackEvent(body, env, accessToken, clientIp);
                if (result.status) {
                    return jsonResponse({ error: result.error }, result.status, headers);
                }
                return jsonResponse(result, 200, headers);
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
            const authRateLimit = checkRateLimit(`auth:${clientIp}:${callerUid}`, 60, 60000);
            if (!authRateLimit.allowed) {
                return jsonResponse(
                    { error: "Too many requests. Please try again shortly." },
                    429,
                    { ...headers, "Retry-After": String(authRateLimit.retryAfterSec || 60) }
                );
            }

            const accessToken = await getGoogleAccessToken(env);

            // AUTHENTICATED, SERVER-PRICED ORDER CREATION (FAIL CLOSED)
            if (type === "create_order") {
                const orderLimit = checkRateLimit(`create_order:${clientIp}:${callerUid}`, 8, 60000);
                if (!orderLimit.allowed) {
                    return jsonResponse(
                        { error: "Too many order attempts. Please wait and try again." },
                        429,
                        { ...headers, "Retry-After": String(orderLimit.retryAfterSec || 60) }
                    );
                }
                const result = await createTrustedOrder(body, decoded, env, accessToken);
                if (!result.ok) {
                    return jsonResponse(result, result.status || 400, headers);
                }
                return jsonResponse(result, result.idempotent ? 200 : 201, headers);
            }

            // SYNC EMAIL VERIFICATION BADGE FROM VERIFIED ID TOKEN
            if (type === "platform_sync_email_badge") {
                const result = await handleSyncEmailBadge(decoded, env, accessToken);
                return jsonResponse(result, 200, headers);
            }

            // MEDIA DELETE ROUTE (UPLOADER OWNER OR moderateContent STAFF / OWNER)
            if (type === "platform_delete_media") {
                const mediaId = safeText(body?.mediaId || "", 128);
                if (!isSafeId(mediaId, 2)) {
                    return jsonResponse({ error: "Valid mediaId required" }, 400, headers);
                }
                const mediaRec = await rtdbGet(env, accessToken, `mediaLibrary/${mediaId}`);
                if (!mediaRec) {
                    return jsonResponse({ error: "Media item not found" }, 404, headers);
                }
                let canDelete = mediaRec.uploaderUid === callerUid;
                if (!canDelete) {
                    const staffRec = await rtdbGet(env, accessToken, `staff/${callerUid}`);
                    const stStatus = getStaffStatus(callerUid, staffRec, env);
                    if (stStatus.active) {
                        if (stStatus.isOwner) {
                            canDelete = true;
                        } else if (typeof staffRec?.customPermissions?.moderateContent === "boolean") {
                            canDelete = staffRec.customPermissions.moderateContent;
                        } else {
                            const rolePerms = isSafeId(stStatus.role)
                                ? await rtdbGet(env, accessToken, `rbac/roles/${stStatus.role}`)
                                : null;
                            canDelete = typeof rolePerms?.moderateContent === "boolean"
                                ? rolePerms.moderateContent
                                : DEFAULT_ROLE_PERMISSIONS[stStatus.role]?.moderateContent === true;
                        }
                    }
                }
                if (!canDelete) {
                    return jsonResponse({ error: "Permission denied for media deletion" }, 403, headers);
                }
                if (env?.MEDIA_BUCKET && typeof env.MEDIA_BUCKET.delete === "function" && mediaRec.key) {
                    await env.MEDIA_BUCKET.delete(mediaRec.key).catch(() => {});
                }
                await rtdbDelete(env, accessToken, `mediaLibrary/${mediaId}`);
                return jsonResponse({ ok: true, deletedId: mediaId }, 200, headers);
            }

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
            const roleName = staffStatus.role;
            const rolePerms = (!isOwner && isSafeId(roleName))
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

                // Same defaults the dashboard (js/rbac.js) and the database rules apply.
                return DEFAULT_ROLE_PERMISSIONS[roleName]?.[permissionKey] === true;
            };

            if (type === "platform_creator_decision") {
                if (!hasPerm("manageCreators")) {
                    return jsonResponse({ error: "Creator management permission required" }, 403, headers);
                }
                const result = await handleCreatorDecision(body, callerUid, roleName, decoded, env, accessToken);
                if (result.status) return jsonResponse({ error: result.error }, result.status, headers);
                return jsonResponse(result, 200, headers);
            }

            if (type === "platform_manage_badge") {
                if (!hasPerm("manageBadges")) {
                    return jsonResponse({ error: "Badge management permission required" }, 403, headers);
                }
                const result = await handleManageBadge(body, callerUid, roleName, decoded, env, accessToken);
                if (result.status) return jsonResponse({ error: result.error }, result.status, headers);
                return jsonResponse(result, 200, headers);
            }

            if (type === "platform_moderate_content") {
                if (!hasPerm("moderateContent")) {
                    return jsonResponse({ error: "Content moderation permission required" }, 403, headers);
                }
                const result = await handleModerateContent(body, callerUid, roleName, decoded, env, accessToken);
                if (result.status) return jsonResponse({ error: result.error }, result.status, headers);
                return jsonResponse(result, 200, headers);
            }

            const title = safeText(body?.title || "Siranchowk Khaja Ghar", 120);
            const messageBody = safeText(body?.body || "", 320);

            if (!messageBody) {
                return jsonResponse({
                    error: "Notification body is required"
                }, 400, headers);
            }

            if (type === "admin_alert") {
                // Order staff deduct stock automatically, which raises the "low_stock" alert
                // (js/inventory-sync.js). Only that category is open to updateOrders staff.
                const isLowStockAlert = safeText(body?.category || "", 48) === "low_stock" && hasPerm("updateOrders");

                if (!hasPerm("sendNotifications") && !hasPerm("manageInventory") && !isLowStockAlert) {
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
                        clickAction: safeClickAction(body?.clickAction, "/admin/admin.html#orders")
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

                if (!isSafeId(customerUid)) {
                    return jsonResponse({
                        error: "A valid customerUid is required"
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
                const hasTargetUids = Array.isArray(body?.targetUids);
                const requestedUids = hasTargetUids
                    ? new Set(
                        body.targetUids
                            .slice(0, 500)
                            .map((uid) => safeText(uid, 128))
                            .filter(Boolean)
                    )
                    : null;

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
                    if (requestedUids !== null && !requestedUids.has(uid)) {
                        return;
                    }

                    const lastActivity = Number(
                        user?.profile?.lastActiveAt ||
                        user?.profile?.lastLoginAt ||
                        user?.profile?.createdAt ||
                        0
                    );

                    if (audience === "active_30d" && lastActivity < thirtyDaysAgo) {
                        return;
                    }

                    if (user?.profile?.notificationPreferences?.offersOptIn === false) {
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
            if (error instanceof ConfigError) {
                // Operators see WHICH setting is missing (names only, never values) in
                // `wrangler tail`; clients get a safe, specific message and a 503.
                console.error(`[worker-config] ${error.message}: ${error.missing.join(", ")}`);
                return jsonResponse({
                    error: "Notification service is not configured yet. Please contact the site owner.",
                    code: "worker_not_configured"
                }, 503, headers);
            }

            // Do not expose service-account or internal error details to clients.
            return jsonResponse({
                error: "Worker execution error"
            }, 500, headers);
        }
    }
};
