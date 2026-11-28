// ============================================================================
// SIRANCHOWK KHAJA GHAR — PUSH NOTIFICATION & PREFERENCE CLIENT
// ============================================================================
// Keeps customer and admin notifications strictly separated.
// Respects browser permission boundaries and never nags on first load.
// ============================================================================

import {
    db,
    ref,
    get,
    set,
    update,
    registerMessagingToken,
    listenForegroundMessages
} from "./firebase.js";
import { getPersistentDeviceId, detectDeviceMetadata } from "./device-manager.js";

const PROMPT_DISMISS_KEY = "skg_customer_notif_prompt_dismissed_v1";

export const DEFAULT_ORDER_NOTIFICATION_TEMPLATES = Object.freeze({
    pending: "Your order has been received successfully.",
    confirmed: "Your order has been confirmed. We are getting it ready.",
    accepted: "Your order has been confirmed. We are getting it ready.",
    preparing: "Your order is now being prepared.",
    ready: "Your order is ready.",
    dispatched: "Your order is on its way.",
    delivered: "Your order has been delivered. Thank you for choosing Siranchowk Khaja Ghar.",
    cancelled: "Your order has been cancelled. Please contact us if you need assistance.",
    delayed: "Your order #{orderShort} is slightly delayed. Thank you for your patience; we will update you shortly.",
    payment_update: "Your payment or refund status for order #{orderShort} has been updated."
});

export async function getOrderNotificationTemplates() {
    try {
        const snap = await get(ref(db, "settings/notificationTemplates"));
        if (snap.exists()) {
            return { ...DEFAULT_ORDER_NOTIFICATION_TEMPLATES, ...(snap.val() || {}) };
        }
    } catch {
        // Fallback to defaults
    }
    return { ...DEFAULT_ORDER_NOTIFICATION_TEMPLATES };
}

export function renderOrderTemplate(templates, statusKey, orderId = "", customNote = "") {
    const tplMap = templates || DEFAULT_ORDER_NOTIFICATION_TEMPLATES;
    const raw = String(tplMap[statusKey] || DEFAULT_ORDER_NOTIFICATION_TEMPLATES[statusKey] || `Your order status is now ${statusKey}.`);
    const orderShort = String(orderId || "").slice(-8).toUpperCase();
    const base = raw
        .replace(/\{orderId\}/g, String(orderId || ""))
        .replace(/\{orderShort\}/g, orderShort);
    return customNote ? `${base} ${customNote}`.trim() : base;
}

const DEFAULT_PUSH_WORKER_URL = "https://siranchowk-notifications.minecraftboot411-cloudflare.workers.dev";

export async function getPublicPushConfig() {
    const envVapid = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";
    const envWorker = import.meta.env.VITE_PUSH_WORKER_URL || "";

    try {
        const snap = await get(ref(db, "settings/pushPublic"));
        if (snap.exists()) {
            const val = snap.val() || {};
            return {
                vapidKey: val.vapidKey || envVapid || "",
                workerUrl: envWorker || val.workerUrl || DEFAULT_PUSH_WORKER_URL
            };
        }
    } catch {
        // Fallback to env config
    }

    return { vapidKey: envVapid, workerUrl: envWorker || DEFAULT_PUSH_WORKER_URL };
}

export async function ensureServiceWorkerRegistration() {
    if (!("serviceWorker" in navigator)) return null;
    try {
        return await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    } catch (error) {
        console.warn("Messaging service worker registration skipped:", error);
        return null;
    }
}

export async function registerCustomerDeviceNotifications(user, prefs = { orderAlerts: true, offersOptIn: false }) {
    if (!user?.uid) {
        throw new Error("Please sign in to save notification preferences.");
    }
    if (!("Notification" in window)) {
        throw new Error("This browser does not support notifications.");
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
        await update(ref(db, `users/${user.uid}/profile/notificationPreferences`), {
            orderAlerts: false,
            offersOptIn: false,
            browserPermission: permission,
            updatedAt: Date.now()
        }).catch((err) => console.warn("Could not save denied permission preference:", err));
        return { granted: false, permission, token: null };
    }

    const deviceId = await getPersistentDeviceId();
    const meta = detectDeviceMetadata();
    const { vapidKey } = await getPublicPushConfig();
    const swReg = await ensureServiceWorkerRegistration();
    const fcmToken = vapidKey ? await registerMessagingToken(vapidKey, swReg) : "";

    await set(ref(db, `users/${user.uid}/devices/${deviceId}`), {
        deviceId,
        uid: user.uid,
        deviceName: meta.deviceName,
        browser: meta.browser,
        os: meta.os,
        fcmToken: fcmToken || "",
        orderAlerts: Boolean(prefs.orderAlerts),
        offersOptIn: Boolean(prefs.offersOptIn),
        enabled: true,
        updatedAt: Date.now()
    });

    await update(ref(db, `users/${user.uid}/profile/notificationPreferences`), {
        orderAlerts: Boolean(prefs.orderAlerts),
        offersOptIn: Boolean(prefs.offersOptIn),
        browserPermission: "granted",
        updatedAt: Date.now()
    });

    return { granted: true, permission: "granted", token: fcmToken || null, deviceId };
}

export async function refreshCustomerFcmTokenIfGranted(user, prefs = null) {
    if (!user?.uid || !("Notification" in window) || Notification.permission !== "granted") return null;
    try {
        const deviceId = await getPersistentDeviceId();
        const { vapidKey } = await getPublicPushConfig();
        if (!vapidKey) return null;
        const swReg = await ensureServiceWorkerRegistration();
        const token = await registerMessagingToken(vapidKey, swReg);
        if (!token) return null;
        const meta = detectDeviceMetadata();
        await update(ref(db, `users/${user.uid}/devices/${deviceId}`), {
            deviceId,
            uid: user.uid,
            deviceName: meta.deviceName,
            browser: meta.browser,
            os: meta.os,
            fcmToken: token,
            enabled: true,
            ...(prefs ? { orderAlerts: Boolean(prefs.orderAlerts), offersOptIn: Boolean(prefs.offersOptIn) } : {}),
            updatedAt: Date.now()
        });
        return token;
    } catch {
        return null;
    }
}

export async function disableCustomerDeviceNotifications(user) {
    if (!user?.uid) return;
    const deviceId = await getPersistentDeviceId();
    await update(ref(db, `users/${user.uid}/devices/${deviceId}`), {
        deviceId,
        uid: user.uid,
        enabled: false,
        orderAlerts: false,
        offersOptIn: false,
        updatedAt: Date.now()
    }).catch(() => {});
    await update(ref(db, `users/${user.uid}/profile/notificationPreferences`), {
        orderAlerts: false,
        offersOptIn: false,
        updatedAt: Date.now()
    }).catch((err) => {
        console.warn("Notification preferences reset warning:", err);
        throw err;
    });
}

export async function registerAdminDevicePush(deviceId, enable = true) {
    if (!deviceId) return { enabled: false };
    if (!enable) {
        await update(ref(db, `adminDevices/${deviceId}`), {
            pushStatus: "disabled",
            fcmToken: ""
        });
        return { enabled: false };
    }

    if (!("Notification" in window)) {
        throw new Error("Browser notifications are not supported on this device.");
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
        await update(ref(db, `adminDevices/${deviceId}`), {
            pushStatus: "denied"
        });
        throw new Error("Browser notification permission was denied.");
    }

    const { vapidKey } = await getPublicPushConfig();
    const swReg = await ensureServiceWorkerRegistration();
    const fcmToken = vapidKey ? await registerMessagingToken(vapidKey, swReg) : "";

    await update(ref(db, `adminDevices/${deviceId}`), {
        pushStatus: "enabled",
        fcmToken: fcmToken || "",
        lastActiveAt: Date.now()
    });

    return { enabled: true, fcmToken: fcmToken || null };
}

export async function refreshAdminFcmTokenIfEnabled(deviceRecord) {
    if (!deviceRecord?.deviceId || deviceRecord.blocked || deviceRecord.approvalStatus !== "approved") return null;
    if (deviceRecord.pushStatus !== "enabled") return null;
    if (!("Notification" in window) || Notification.permission !== "granted") return null;
    try {
        const { vapidKey } = await getPublicPushConfig();
        if (!vapidKey) return null;
        const swReg = await ensureServiceWorkerRegistration();
        const token = await registerMessagingToken(vapidKey, swReg);
        if (token && token !== deviceRecord.fcmToken) {
            await update(ref(db, `adminDevices/${deviceRecord.deviceId}`), {
                fcmToken: token,
                lastActiveAt: Date.now()
            });
            return token;
        }
        return token || null;
    } catch {
        return null;
    }
}

export async function dispatchWorkerPush({ workerUrl, authToken, payload }) {
    if (!workerUrl) {
        return {
            sentViaWorker: false,
            targeted: 0,
            sentToProvider: 0,
            failed: 0,
            deliveryResults: [],
            reason: "Push Worker URL not configured; live Realtime Database notifications active."
        };
    }
    const response = await fetch(workerUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `Push worker responded with status ${response.status}`);
    }
    const data = await response.json().catch(() => ({}));
    return {
        sentViaWorker: true,
        targeted: Number(data.targeted || 0),
        sentToProvider: Number(data.sentToProvider ?? data.delivered ?? 0),
        failed: Number(data.failed || 0),
        deliveryResults: Array.isArray(data.deliveryResults) ? data.deliveryResults : [],
        data
    };
}

export function attachForegroundNotificationToast() {
    listenForegroundMessages((payload) => {
        const title = payload?.notification?.title || payload?.data?.title || "Siranchowk Khaja Ghar";
        const body = payload?.notification?.body || payload?.data?.body || "";
        if ("Notification" in window && Notification.permission === "granted") {
            try {
                new Notification(title, { body, icon: "/assets/icons/favicon.svg" });
            } catch {}
        }
    }).catch(() => {});
}

// Polite customer notification invitation (never shown repeatedly or forced on load)
export function maybeShowCustomerNotificationInvite(user) {
    if (!user?.uid) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted" || Notification.permission === "denied") return;

    try {
        if (localStorage.getItem(PROMPT_DISMISS_KEY) === "1") return;
    } catch {
        return;
    }

    if (document.getElementById("skg-notif-invite")) return;

    window.setTimeout(() => {
        if (document.getElementById("skg-notif-invite")) return;
        const bar = document.createElement("aside");
        bar.id = "skg-notif-invite";
        bar.className = "skg-notif-invite";
        bar.setAttribute("role", "region");
        bar.setAttribute("aria-label", "Order notification invitation");
        bar.innerHTML = `
            <div class="skg-notif-invite-body">
                <strong>Stay updated on your orders</strong>
                <p>Get live alerts when your order status changes or new offers are available for your account.</p>
            </div>
            <div class="skg-notif-invite-actions">
                <button type="button" class="skg-notif-enable" id="skg-invite-enable">Enable Notifications</button>
                <button type="button" class="skg-notif-later" id="skg-invite-later">Not Now</button>
            </div>
        `;
        document.body.appendChild(bar);

        bar.querySelector("#skg-invite-later")?.addEventListener("click", () => {
            try { localStorage.setItem(PROMPT_DISMISS_KEY, "1"); } catch {}
            bar.remove();
        });

        bar.querySelector("#skg-invite-enable")?.addEventListener("click", async () => {
            try {
                await registerCustomerDeviceNotifications(user, { orderAlerts: true, offersOptIn: true });
                try { localStorage.setItem(PROMPT_DISMISS_KEY, "1"); } catch {}
                bar.remove();
            } catch (error) {
                console.warn("Notification setup skipped:", error);
                try { localStorage.setItem(PROMPT_DISMISS_KEY, "1"); } catch {}
                bar.remove();
            }
        });
    }, 10500);
}
