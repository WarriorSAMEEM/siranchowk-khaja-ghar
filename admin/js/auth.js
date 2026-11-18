// ============================================================================
// SIRANCHOWK KHAJA GHAR — ADMIN AUTHENTICATION, RBAC & DEVICE SESSION GUARD
// ============================================================================

import {
    auth,
    db,
    ref,
    get,
    set,
    update,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserSessionPersistence
} from "../../js/firebase.js";
import {
    PRIMARY_OWNER_UID,
    ROLE_METADATA,
    normalizeRole,
    resolveEffectivePermissions
} from "../../js/rbac.js";
import {
    registerOrVerifyAdminDevice,
    markDeviceSessionEnded,
    watchAdminDeviceSession
} from "../../js/device-manager.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { recordLoginEvent, logSecurityEvent } from "../../js/activity-logger.js";

let currentUser = null;
let activeAdminSession = null;
let stopDeviceWatch = null;
const ADMIN_LOGIN_TS_KEY = "skg_admin_login_ts_v1";

function markAdminLoginStart() {
    try { sessionStorage.setItem(ADMIN_LOGIN_TS_KEY, String(Date.now())); } catch {}
}

function consumeAdminSessionDurationSec() {
    try {
        const started = Number(sessionStorage.getItem(ADMIN_LOGIN_TS_KEY) || 0);
        sessionStorage.removeItem(ADMIN_LOGIN_TS_KEY);
        if (started > 0 && Date.now() >= started) {
            return Math.round((Date.now() - started) / 1000);
        }
    } catch {}
    return null;
}

onAuthStateChanged(auth, (user) => {
    currentUser = user;
});

function waitForAuthState() {
    return new Promise((resolve) => {
        if (auth.currentUser) {
            currentUser = auth.currentUser;
            resolve(auth.currentUser);
            return;
        }
        let unsubscribe = null;
        unsubscribe = onAuthStateChanged(auth, (user) => {
            if (unsubscribe) unsubscribe();
            currentUser = user;
            resolve(user);
        });
    });
}

async function resolveStaffRecord(user) {
    if (!user?.uid) return null;

    const staffRef = ref(db, `staff/${user.uid}`);
    const snap = await get(staffRef);
    let record = snap.exists() ? snap.val() : null;

    // Guarantee primary Owner always retains Owner role and record integrity.
    if (user.uid === PRIMARY_OWNER_UID) {
        const now = Date.now();
        if (!record) {
            record = {
                uid: user.uid,
                name: user.displayName || "Business Owner",
                email: user.email || "",
                role: "owner",
                active: true,
                createdAt: now,
                updatedAt: now
            };
            await set(staffRef, record);
        } else if (record.role !== "owner" || record.active === false) {
            record = {
                ...record,
                uid: user.uid,
                role: "owner",
                active: true,
                email: user.email || record.email || "",
                updatedAt: now
            };
            await update(staffRef, {
                role: "owner",
                active: true,
                email: record.email,
                updatedAt: now
            });
        }
    }

    if (!record) return null;
    if (record.active === false) return { ...record, disabled: true };

    return {
        ...record,
        uid: user.uid,
        role: user.uid === PRIMARY_OWNER_UID ? "owner" : normalizeRole(record.role)
    };
}

async function loadRoleMatrix() {
    try {
        const snap = await get(ref(db, "rbac/roles"));
        return snap.exists() ? snap.val() : null;
    } catch {
        return null;
    }
}

export function getAdminSession() {
    return activeAdminSession;
}

export function hasPermission(permissionKey) {
    if (!activeAdminSession) return false;
    if (activeAdminSession.role === "owner" || activeAdminSession.user?.uid === PRIMARY_OWNER_UID) {
        return true;
    }
    return Boolean(activeAdminSession.permissions?.[permissionKey]);
}

export async function refreshAdminPermissions() {
    if (!activeAdminSession?.user) return null;
    const staff = await resolveStaffRecord(activeAdminSession.user);
    if (!staff || staff.disabled) return null;
    const roleMatrix = await loadRoleMatrix();
    const permissions = resolveEffectivePermissions(
        staff.role,
        roleMatrix,
        staff.customPermissions || null,
        activeAdminSession.user.uid
    );
    activeAdminSession = {
        ...activeAdminSession,
        staff,
        role: staff.role,
        roleLabel: ROLE_METADATA[staff.role]?.label || staff.role,
        permissions
    };
    return activeAdminSession;
}

export async function checkAdminAuth(onSessionRevoked = null) {
    const currentPath = window.location.pathname;
    const isLoginPage =
        currentPath.endsWith("/admin/login.html") ||
        currentPath.endsWith("/admin/login");
    const isAdminPage =
        currentPath.endsWith("/admin/admin.html") ||
        currentPath.endsWith("/admin/admin");

    const user = await waitForAuthState();

    if (!user) {
        if (isAdminPage) {
            window.location.replace("./login.html");
        }
        return false;
    }

    const staff = await resolveStaffRecord(user);
    if (!staff || staff.disabled) {
        await logAuditEvent({
            actorUid: user.uid,
            actorName: staff?.name || user.displayName || "",
            actorEmail: user.email || "",
            actorRole: staff?.role || "unauthorized",
            action: "admin_access_denied",
            target: user.uid,
            status: "failed",
            metadata: { reason: staff?.disabled ? "account_disabled" : "not_in_staff_directory" }
        });
        await logSecurityEvent({
            eventType: "unauthorized_admin_access",
            severity: "high",
            actorUid: user.uid,
            actorEmail: user.email || "",
            actorRole: staff?.role || "unauthorized",
            target: user.uid,
            details: { reason: staff?.disabled ? "account_disabled" : "not_in_staff_directory" }
        });
        await signOut(auth);
        if (isAdminPage) {
            window.location.replace("./login.html");
        }
        throw new Error(
            staff?.disabled
                ? "Your staff account has been disabled by an administrator."
                : "This account is not authorized to access the admin panel."
        );
    }

    const roleMatrix = await loadRoleMatrix();
    const permissions = resolveEffectivePermissions(
        staff.role,
        roleMatrix,
        staff.customPermissions || null,
        user.uid
    );

    let deviceRecord;
    try {
        deviceRecord = await registerOrVerifyAdminDevice(user, staff);
    } catch (deviceError) {
        await signOut(auth);
        if (isAdminPage) {
            window.location.replace("./login.html");
        }
        throw deviceError;
    }

    currentUser = user;
    activeAdminSession = {
        user,
        staff,
        role: staff.role,
        roleLabel: ROLE_METADATA[staff.role]?.label || staff.role,
        permissions,
        device: deviceRecord
    };

    if (isLoginPage) {
        window.location.replace("./admin.html");
        return activeAdminSession;
    }

    if (stopDeviceWatch) stopDeviceWatch();
    stopDeviceWatch = watchAdminDeviceSession(deviceRecord.deviceId, (reason) => {
        activeAdminSession = null;
        if (typeof onSessionRevoked === "function") {
            onSessionRevoked(reason);
        } else {
            window.location.replace("./login.html");
        }
    });

    return activeAdminSession;
}

export async function loginAdmin(email, password) {
    if (!email || !password) {
        throw new Error("Email and password are required.");
    }

    let authFailureLogged = false;
    try {
        await setPersistence(auth, browserSessionPersistence);
        const result = await signInWithEmailAndPassword(auth, email.trim(), password);
        const user = result.user;

        const staff = await resolveStaffRecord(user);
        if (!staff || staff.disabled) {
            const denyReason = staff?.disabled ? "account_disabled" : "not_in_staff_directory";
            await logAuditEvent({
                actorUid: user.uid,
                actorName: staff?.name || user.displayName || "",
                actorEmail: user.email || "",
                actorRole: staff?.role || "unauthorized",
                action: "admin_login_denied",
                target: user.uid,
                status: "failed",
                metadata: { reason: denyReason }
            });
            await recordLoginEvent({
                uid: user.uid,
                name: staff?.name || user.displayName || "",
                email: user.email || email.trim(),
                role: staff?.role || "unauthorized",
                method: "password",
                result: "failed",
                reason: denyReason
            });
            await logSecurityEvent({
                eventType: "unauthorized_admin_access",
                severity: "high",
                actorUid: user.uid,
                actorEmail: user.email || email.trim(),
                actorRole: staff?.role || "unauthorized",
                target: user.uid,
                details: { reason: denyReason }
            });
            authFailureLogged = true;
            await signOut(auth);
            throw new Error(
                staff?.disabled
                    ? "This staff account is currently disabled. Contact the Owner."
                    : "This account is not authorized for the Siranchowk Admin Panel."
            );
        }

        let deviceRecord;
        try {
            deviceRecord = await registerOrVerifyAdminDevice(user, staff);
        } catch (deviceErr) {
            await recordLoginEvent({
                uid: user.uid,
                name: staff.name || user.displayName || "",
                email: user.email || email.trim(),
                role: staff.role,
                method: "password",
                result: "failed",
                reason: deviceErr?.message || "device_blocked_or_rejected"
            });
            authFailureLogged = true;
            await signOut(auth).catch(() => {});
            throw deviceErr;
        }

        const roleMatrix = await loadRoleMatrix();
        const permissions = resolveEffectivePermissions(
            staff.role,
            roleMatrix,
            staff.customPermissions || null,
            user.uid
        );

        currentUser = user;
        activeAdminSession = {
            user,
            staff,
            role: staff.role,
            roleLabel: ROLE_METADATA[staff.role]?.label || staff.role,
            permissions,
            device: deviceRecord
        };
        markAdminLoginStart();

        await recordLoginEvent({
            uid: user.uid,
            name: staff.name || user.displayName || "",
            email: user.email || "",
            role: staff.role,
            method: "password",
            result: "success",
            deviceId: deviceRecord.deviceId
        });

        await logAuditEvent({
            actorUid: user.uid,
            actorName: staff.name || user.displayName || "",
            actorEmail: user.email || "",
            actorRole: staff.role,
            action: "admin_login",
            target: deviceRecord.deviceId,
            status: "success",
            metadata: { deviceName: deviceRecord.deviceName, approvalStatus: deviceRecord.approvalStatus }
        });

        return user;
    } catch (error) {
        let message = error?.message || "Login failed. Please check your email and password.";
        switch (error.code) {
            case "auth/invalid-credential":
                message = "Invalid email or password.";
                break;
            case "auth/invalid-email":
                message = "Please enter a valid email address.";
                break;
            case "auth/user-disabled":
                message = "This account has been disabled.";
                break;
            case "auth/too-many-requests":
                message = "Too many login attempts. Please try again later.";
                break;
            case "auth/network-request-failed":
                message = "Network error. Please check your internet connection.";
                break;
            case "auth/user-not-found":
                message = "No account found with this email.";
                break;
            case "auth/wrong-password":
                message = "Incorrect password.";
                break;
            case "auth/operation-not-allowed":
                message = "Email/password authentication is not enabled in Firebase.";
                break;
            default:
                break;
        }
        if (!authFailureLogged) {
            await recordLoginEvent({
                uid: "unauthenticated",
                email: String(email || "").trim(),
                role: "staff",
                method: "password",
                result: "failed",
                reason: error?.code || message
            });
        }
        throw new Error(message);
    }
}

export async function logoutAdmin() {
    const deviceId = activeAdminSession?.device?.deviceId;
    const actor = activeAdminSession;
    if (stopDeviceWatch) {
        stopDeviceWatch();
        stopDeviceWatch = null;
    }
    if (actor?.user?.uid) {
        const durationSec = consumeAdminSessionDurationSec();
        await recordLoginEvent({
            uid: actor.user.uid,
            name: actor.staff?.name || actor.user.displayName || "",
            email: actor.user.email || "",
            role: actor.role || "staff",
            method: "password",
            action: "logout",
            result: "success",
            deviceId: deviceId || "",
            sessionDurationSec: durationSec
        }).catch(() => {});
        await logAuditEvent({
            actorUid: actor.user.uid,
            actorName: actor.staff?.name || actor.user.displayName || "",
            actorEmail: actor.user.email || "",
            actorRole: actor.role || "staff",
            action: "admin_logout",
            target: deviceId || actor.user.uid,
            status: "success",
            metadata: durationSec !== null ? { sessionDurationSec: durationSec } : {}
        });
    }
    if (deviceId) {
        await markDeviceSessionEnded(deviceId);
    }
    await signOut(auth);
    currentUser = null;
    activeAdminSession = null;
    window.location.replace("./login.html");
}

export function getCurrentAdmin() {
    return auth.currentUser || currentUser || null;
}

export function listenToAuthState(callback) {
    return onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (typeof callback === "function") {
            callback(user);
        }
    });
}