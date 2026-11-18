// ============================================================================
// SIRANCHOWK KHAJA GHAR — PERSISTENT DEVICE IDENTITY & ADMIN SESSION GUARD
// ============================================================================

import {
    db,
    auth,
    ref,
    get,
    set,
    update,
    onValue,
    signOut
} from "./firebase.js";
import { logAuditEvent } from "./audit-logger.js";
import { logSecurityEvent } from "./activity-logger.js";

const DEVICE_ID_STORAGE_KEY = "skg_persistent_device_id_v1";
const SESSION_VERSION_KEY = "skg_admin_device_session_version_v1";

function createSecureDeviceId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return "dev_" + crypto.randomUUID().replace(/-/g, "");
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return "dev_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function openDeviceDB() {
    return new Promise((resolve) => {
        if (!("indexedDB" in window)) {
            resolve(null);
            return;
        }
        try {
            const req = indexedDB.open("skg_device_store", 1);
            req.onupgradeneeded = () => {
                const database = req.result;
                if (!database.objectStoreNames.contains("meta")) {
                    database.createObjectStore("meta");
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function readIndexedDbDeviceId() {
    const database = await openDeviceDB();
    if (!database) return null;
    return new Promise((resolve) => {
        try {
            const tx = database.transaction("meta", "readonly");
            const store = tx.objectStore("meta");
            const getReq = store.get("deviceId");
            getReq.onsuccess = () => resolve(getReq.result || null);
            getReq.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function writeIndexedDbDeviceId(deviceId) {
    const database = await openDeviceDB();
    if (!database) return;
    try {
        const tx = database.transaction("meta", "readwrite");
        tx.objectStore("meta").put(deviceId, "deviceId");
    } catch {
        // Ignore IndexedDB quota/privacy errors
    }
}

export async function getPersistentDeviceId() {
    let deviceId = null;
    try {
        deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    } catch {
        deviceId = null;
    }

    if (!deviceId) {
        deviceId = await readIndexedDbDeviceId();
    }

    if (!deviceId || !/^[a-zA-Z0-9_-]{12,64}$/.test(deviceId)) {
        deviceId = createSecureDeviceId();
    }

    try {
        localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    } catch {
        // Ignore storage restrictions
    }
    await writeIndexedDbDeviceId(deviceId);

    return deviceId;
}

export function detectDeviceMetadata() {
    const ua = navigator.userAgent || "";
    const width = window.innerWidth || 1024;

    let deviceType = "Desktop";
    if (/Mobile|Android|iPhone|iPod/i.test(ua) || width <= 767) {
        deviceType = "Mobile";
    } else if (/iPad|Tablet/i.test(ua) || (width > 767 && width <= 1024)) {
        deviceType = "Tablet";
    }

    let browser = "Browser";
    if (ua.includes("Edg/")) browser = "Microsoft Edge";
    else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera";
    else if (ua.includes("Chrome/") && !ua.includes("Edg/")) browser = "Google Chrome";
    else if (ua.includes("Firefox/")) browser = "Mozilla Firefox";
    else if (ua.includes("Safari/") && !ua.includes("Chrome/")) browser = "Safari";

    let os = "Unknown OS";
    if (ua.includes("Windows NT")) os = "Windows";
    else if (ua.includes("Android")) os = "Android";
    else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
    else if (ua.includes("Mac OS X")) os = "macOS";
    else if (ua.includes("Linux")) os = "Linux";

    const deviceName = `${browser} on ${os} (${deviceType})`;
    return { deviceType, browser, os, deviceName, userAgent: ua.slice(0, 200) };
}

export const DEFAULT_ADMIN_DEVICE_PREFERENCES = Object.freeze({
    newOrders: true,
    orderCancellations: true,
    orderUpdates: true,
    securityAlerts: true,
    staffAnnouncements: true
});

export async function registerOrVerifyAdminDevice(user, staffProfile) {
    const deviceId = await getPersistentDeviceId();
    const meta = detectDeviceMetadata();
    const deviceRef = ref(db, `adminDevices/${deviceId}`);
    const now = Date.now();
    const isOwner = staffProfile?.role === "owner";

    const snapshot = await get(deviceRef);
    const existing = snapshot.exists() ? snapshot.val() : null;

    if (existing?.blocked === true) {
        await logAuditEvent({
            actorUid: user.uid,
            actorName: staffProfile?.name || user.displayName || "",
            actorEmail: user.email || "",
            actorRole: staffProfile?.role || "unknown",
            action: "blocked_device_login_attempt",
            target: deviceId,
            status: "failed",
            metadata: { deviceName: meta.deviceName }
        });
        await logSecurityEvent({
            eventType: "blocked_device_login_attempt",
            severity: "high",
            actorUid: user.uid,
            actorEmail: user.email || "",
            actorRole: staffProfile?.role || "unknown",
            target: deviceId,
            details: { deviceName: meta.deviceName }
        });
        throw new Error("This device has been blocked by the Owner. Access is denied.");
    }

    if (existing?.approvalStatus === "rejected" && !isOwner) {
        await logAuditEvent({
            actorUid: user.uid,
            actorName: staffProfile?.name || user.displayName || "",
            actorEmail: user.email || "",
            actorRole: staffProfile?.role || "unknown",
            action: "rejected_device_login_attempt",
            target: deviceId,
            status: "failed",
            metadata: { deviceName: meta.deviceName }
        });
        await logSecurityEvent({
            eventType: "rejected_device_login_attempt",
            severity: "warning",
            actorUid: user.uid,
            actorEmail: user.email || "",
            actorRole: staffProfile?.role || "unknown",
            target: deviceId,
            details: { deviceName: meta.deviceName }
        });
        throw new Error("This device registration was rejected by the Owner.");
    }

    // Bootstrap rule: If Owner signs in and NO approved Owner device exists yet,
    // auto-approve the very first Owner device so the Owner is never locked out.
    // Any subsequent 2nd/3rd Owner device or Admin device starts as "pending"
    // until the Owner explicitly approves it in Device Management.
    let initialApprovalStatus = existing?.approvalStatus;
    if (!initialApprovalStatus) {
        if (isOwner) {
            let hasExistingApprovedOwnerDevice = false;
            try {
                const allDevSnap = await get(ref(db, "adminDevices"));
                if (allDevSnap.exists()) {
                    const allDevs = Object.values(allDevSnap.val() || {});
                    hasExistingApprovedOwnerDevice = allDevs.some(
                        (d) => d && d.role === "owner" && d.approvalStatus === "approved" && !d.blocked
                    );
                }
            } catch {
                // Non-owner staff cannot list all adminDevices; Owner can.
                hasExistingApprovedOwnerDevice = false;
            }
            initialApprovalStatus = hasExistingApprovedOwnerDevice ? "pending" : "approved";
        } else {
            initialApprovalStatus = "pending";
        }
    }

    const sessionVersion = Number(existing?.sessionVersion || 1);
    try {
        sessionStorage.setItem(SESSION_VERSION_KEY, String(sessionVersion));
    } catch {
        // Ignore sessionStorage failures
    }

    const mergedPreferences = {
        ...DEFAULT_ADMIN_DEVICE_PREFERENCES,
        ...(existing?.preferences || {})
    };

    const record = {
        deviceId,
        deviceName: existing?.deviceName || meta.deviceName,
        uid: user.uid,
        staffName: staffProfile?.name || user.displayName || (user.email ? user.email.split("@")[0] : "Staff"),
        staffEmail: user.email || "",
        role: staffProfile?.role || "helper",
        deviceType: meta.deviceType,
        browser: meta.browser,
        os: meta.os,
        firstLoginAt: existing?.firstLoginAt || now,
        lastActiveAt: now,
        lastSessionEndedAt: existing?.lastSessionEndedAt || null,
        pushStatus: existing?.pushStatus || "disabled",
        fcmToken: existing?.fcmToken || "",
        preferences: mergedPreferences,
        approvalStatus: initialApprovalStatus,
        blocked: false,
        sessionVersion
    };

    if (!existing) {
        await set(deviceRef, record);
        await logAuditEvent({
            actorUid: user.uid,
            actorName: record.staffName,
            actorEmail: user.email || "",
            actorRole: record.role,
            action: "device_registered",
            target: deviceId,
            status: "success",
            metadata: { approvalStatus: record.approvalStatus, deviceName: record.deviceName }
        });
        await logSecurityEvent({
            eventType: "device_registered",
            severity: record.approvalStatus === "pending" ? "warning" : "info",
            actorUid: user.uid,
            actorEmail: user.email || "",
            actorRole: record.role,
            target: deviceId,
            details: { approvalStatus: record.approvalStatus, deviceName: record.deviceName }
        });
    } else {
        await update(deviceRef, {
            uid: record.uid,
            staffName: record.staffName,
            staffEmail: record.staffEmail,
            role: record.role,
            deviceType: record.deviceType,
            browser: record.browser,
            os: record.os,
            preferences: mergedPreferences,
            lastActiveAt: now
        });
    }

    return record;
}

export async function markDeviceSessionEnded(deviceId) {
    if (!deviceId) return;
    try {
        await update(ref(db, `adminDevices/${deviceId}`), {
            lastSessionEndedAt: Date.now()
        });
    } catch {
        // Ignore if user already signed out
    }
}

export function watchAdminDeviceSession(deviceId, onInvalidated) {
    if (!deviceId) return () => {};
    let expectedVersion = null;
    try {
        const stored = sessionStorage.getItem(SESSION_VERSION_KEY);
        if (stored) expectedVersion = Number(stored);
    } catch {
        expectedVersion = null;
    }

    const deviceRef = ref(db, `adminDevices/${deviceId}`);
    return onValue(deviceRef, async (snapshot) => {
        if (!snapshot.exists()) {
            // Device was removed by Owner
            try {
                await signOut(auth);
            } catch {}
            onInvalidated("This device registration was removed by the Owner.");
            return;
        }
        const data = snapshot.val();
        if (expectedVersion === null) {
            expectedVersion = Number(data.sessionVersion || 1);
            try {
                sessionStorage.setItem(SESSION_VERSION_KEY, String(expectedVersion));
            } catch {}
        }

        if (data.blocked === true) {
            try {
                await update(deviceRef, { lastSessionEndedAt: Date.now() });
                await signOut(auth);
            } catch {}
            onInvalidated("This device has been blocked by an administrator.");
            return;
        }

        if (Number(data.sessionVersion || 1) !== expectedVersion) {
            try {
                await signOut(auth);
            } catch {}
            onInvalidated("Your session was revoked from another device. Please sign in again.");
            return;
        }
    });
}
