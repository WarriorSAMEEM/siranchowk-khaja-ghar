// ============================================================================
// SIRANCHOWK KHAJA GHAR — IMMUTABLE AUDIT LOGGER
// ============================================================================

import { db, ref, push, set } from "./firebase.js";

function safeDeviceSummary() {
    if (typeof navigator === "undefined" || typeof window === "undefined") {
        return { deviceType: "server", browser: "Unknown", operatingSystem: "Unknown" };
    }
    const ua = navigator.userAgent || "";
    const width = window.innerWidth || 1024;
    let deviceType = "desktop";
    if (/Mobile|Android|iPhone|iPod/i.test(ua) || width <= 767) deviceType = "mobile";
    else if (/iPad|Tablet/i.test(ua) || (width > 767 && width <= 1024)) deviceType = "tablet";
    let browser = "Other";
    if (ua.includes("Edg/")) browser = "Edge";
    else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera";
    else if (ua.includes("Chrome/") && !ua.includes("Edg/")) browser = "Chrome";
    else if (ua.includes("Firefox/")) browser = "Firefox";
    else if (ua.includes("Safari/") && !ua.includes("Chrome/")) browser = "Safari";
    let operatingSystem = "Other";
    if (/Windows/i.test(ua)) operatingSystem = "Windows";
    else if (/Android/i.test(ua)) operatingSystem = "Android";
    else if (/iPhone|iPad|iPod/i.test(ua)) operatingSystem = "iOS";
    else if (/Mac/i.test(ua)) operatingSystem = "macOS";
    else if (/Linux/i.test(ua)) operatingSystem = "Linux";
    return { deviceType, browser, operatingSystem };
}

export async function logAuditEvent({
    actorUid = "system",
    actorName = "",
    actorEmail = "",
    actorRole = "system",
    action = "event",
    target = "",
    status = "success",
    metadata = {}
}) {
    try {
        const logRef = push(ref(db, "auditLogs"));
        const safeMetadata = {};
        if (metadata && typeof metadata === "object") {
            Object.entries(metadata).slice(0, 12).forEach(([k, v]) => {
                const key = String(k).slice(0, 40);
                if (/password|token|secret|credential|apikey/i.test(key)) return;
                if (v !== undefined && v !== null) {
                    safeMetadata[key] = String(v).slice(0, 240);
                }
            });
        }
        const env = safeDeviceSummary();

        await set(logRef, {
            id: logRef.key,
            actorUid: String(actorUid || "system").slice(0, 128),
            actorName: String(actorName || "").slice(0, 80),
            actorEmail: String(actorEmail || "").slice(0, 120),
            actorRole: String(actorRole || "system").slice(0, 32),
            action: String(action || "event").slice(0, 80),
            target: String(target || "").slice(0, 160),
            status: status === "failed" ? "failed" : "success",
            deviceType: env.deviceType,
            browser: env.browser,
            operatingSystem: env.operatingSystem,
            metadata: safeMetadata,
            timestamp: Date.now()
        });
    } catch (error) {
        // Audit log failure must not crash critical auth error reporting,
        // but we surface a warning in console for diagnostics.
        console.warn("Audit log write skipped:", error?.message || error);
    }
}
