// ============================================================================
// SIRANCHOWK KHAJA GHAR — BACKGROUND PUSH NOTIFICATION SERVICE WORKER
// ============================================================================
// Handles background Web Push / FCM payloads safely across customer & admin scopes.
// No secrets are stored here.

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

function sanitizeSameOriginUrl(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl || "/"), self.location.origin);
        if (parsed.origin !== self.location.origin) return "/";
        return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
    } catch {
        return "/";
    }
}

self.addEventListener("push", (event) => {
    if (!event.data) return;

    let payload = {};
    try {
        payload = event.data.json();
    } catch {
        payload = { notification: { title: "Siranchowk Khaja Ghar", body: event.data.text() } };
    }

    const notif = payload.notification || {};
    const data = payload.data || {};
    const title = notif.title || data.title || "Siranchowk Khaja Ghar";
    const body = notif.body || data.body || "You have a new update.";
    const targetUrl = sanitizeSameOriginUrl(data.clickAction || data.url || "/");

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon: "/assets/images/favicon_io%20(2)/android-chrome-192x192.png",
            badge: "/assets/images/favicon_io%20(2)/favicon-32x32.png",
            data: { url: targetUrl }
        })
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const targetUrl = sanitizeSameOriginUrl(event.notification?.data?.url || "/");

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.startsWith(self.location.origin) && "focus" in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});
