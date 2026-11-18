// ============================================================================
// SIRANCHOWK KHAJA GHAR — BUSINESS, PUSH & ANALYTICS SETTINGS
// ============================================================================

import { db, ref, get, update } from "../../js/firebase.js";
import { ADMIN_CONFIG } from "./config.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";
import { DEFAULT_ANALYTICS_SETTINGS } from "./analytics-utils.js";

export const SettingsModule = {
    async render(container) {
        const session = getAdminSession();
        const canEdit = hasPermission("manageSettings");

        container.innerHTML = '<div class="skg-admin-loading">Loading settings…</div>';

        const [bizSnap, pushSnap, analyticsSnap] = await Promise.all([
            get(ref(db, "settings/business")).catch(() => null),
            get(ref(db, "settings/pushPublic")).catch(() => null),
            get(ref(db, "settings/analytics")).catch(() => null)
        ]);

        const biz = {
            name: ADMIN_CONFIG.business.name,
            location: ADMIN_CONFIG.business.location,
            landmark: ADMIN_CONFIG.business.landmark,
            phone: ADMIN_CONFIG.business.phone,
            whatsapp: ADMIN_CONFIG.business.whatsapp,
            hours: ADMIN_CONFIG.business.hours,
            openingDate: ADMIN_CONFIG.business.openingDate,
            storeOpen: true,
            ...(bizSnap && bizSnap.exists() ? bizSnap.val() : {})
        };

        const pushCfg = {
            vapidKey: import.meta.env.VITE_VAPID_PUBLIC_KEY || "",
            workerUrl: import.meta.env.VITE_PUSH_WORKER_URL || "",
            ...(pushSnap && pushSnap.exists() ? pushSnap.val() : {})
        };

        const analyticsCfg = {
            ...DEFAULT_ANALYTICS_SETTINGS,
            ...(analyticsSnap && analyticsSnap.exists() ? analyticsSnap.val() : {})
        };

        container.innerHTML = `
          <div class="skg-overview-split">
            <section class="card">
              <div class="card-header">
                <div>
                  <h2 class="card-title">Business &amp; Operations Profile</h2>
                  <p class="card-subtitle">Verified restaurant identity and store status shown in operations.</p>
                </div>
              </div>

              <form id="skg-biz-settings-form">
                <div class="form-group">
                  <label class="form-label" for="set-biz-name">Business Name</label>
                  <input class="form-control" id="set-biz-name" type="text" value="${Utils.escapeHTML(biz.name)}" ${canEdit ? "" : "disabled"}>
                </div>
                <div class="form-group">
                  <label class="form-label" for="set-biz-loc">Address</label>
                  <input class="form-control" id="set-biz-loc" type="text" value="${Utils.escapeHTML(biz.location)}" ${canEdit ? "" : "disabled"}>
                </div>
                <div class="skg-modal-row">
                  <div class="form-group">
                    <label class="form-label" for="set-biz-landmark">Landmark</label>
                    <input class="form-control" id="set-biz-landmark" type="text" value="${Utils.escapeHTML(biz.landmark)}" ${canEdit ? "" : "disabled"}>
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="set-biz-hours">Opening Hours</label>
                    <input class="form-control" id="set-biz-hours" type="text" value="${Utils.escapeHTML(biz.hours)}" ${canEdit ? "" : "disabled"}>
                  </div>
                </div>
                <div class="skg-modal-row">
                  <div class="form-group">
                    <label class="form-label" for="set-biz-phone">Phone</label>
                    <input class="form-control" id="set-biz-phone" type="text" value="${Utils.escapeHTML(biz.phone)}" ${canEdit ? "" : "disabled"}>
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="set-biz-wa">WhatsApp Number (digits)</label>
                    <input class="form-control" id="set-biz-wa" type="text" value="${Utils.escapeHTML(biz.whatsapp)}" ${canEdit ? "" : "disabled"}>
                  </div>
                </div>
                <label class="skg-checkbox-inline" style="margin-bottom:16px;">
                  <input type="checkbox" id="set-store-open" ${biz.storeOpen !== false ? "checked" : ""} ${canEdit ? "" : "disabled"}>
                  <span>Accepting incoming website order requests</span>
                </label>
                ${canEdit ? '<button type="submit" class="btn btn-primary">Save Business Settings</button>' : '<p class="form-hint">Settings editing is restricted to Owner.</p>'}
              </form>
            </section>

            <section class="card">
              <div class="card-header">
                <div>
                  <h2 class="card-title">Web Push &amp; Worker Endpoints</h2>
                  <p class="card-subtitle">Public Web Push configuration only. Never enter Firebase private keys or service-account JSON here.</p>
                </div>
              </div>

              <form id="skg-push-settings-form">
                <div class="form-group">
                  <label class="form-label" for="set-vapid-key">Firebase Web Push Certificate (Public VAPID Key)</label>
                  <input class="form-control" id="set-vapid-key" type="text" value="${Utils.escapeHTML(pushCfg.vapidKey)}" placeholder="Paste public VAPID key from Firebase Console → Cloud Messaging" ${canEdit ? "" : "disabled"}>
                  <span class="form-hint">Required for background FCM Web Push tokens on customer and admin browsers.</span>
                </div>
                <div class="form-group">
                  <label class="form-label" for="set-worker-url">Cloudflare Push Worker URL</label>
                  <input class="form-control" id="set-worker-url" type="url" value="${Utils.escapeHTML(pushCfg.workerUrl)}" placeholder="https://siranchowk-push.your-subdomain.workers.dev" ${canEdit ? "" : "disabled"}>
                  <span class="form-hint">Free-tier Cloudflare Worker handles FCM HTTP v1 signing securely via Cloudflare Secrets.</span>
                </div>
                ${canEdit ? '<button type="submit" class="btn btn-primary">Save Push Configuration</button>' : ""}
              </form>
            </section>
          </div>

          <section class="card" style="margin-top:20px;">
            <div class="card-header">
              <div>
                <h2 class="card-title">Analytics Retention &amp; Customer Activity Tiers</h2>
                <p class="card-subtitle">Owner-configurable engagement thresholds and RTDB Spark-plan retention window.</p>
              </div>
            </div>
            <form id="skg-analytics-settings-form">
              <div class="skg-modal-row">
                <div class="form-group">
                  <label class="form-label" for="set-retention-days">Raw Session &amp; Event Retention Window (Days)</label>
                  <input class="form-control" id="set-retention-days" type="number" min="7" max="365" value="${Number(analyticsCfg.retentionDays)}" ${canEdit ? "" : "disabled"}>
                  <span class="form-hint">Used by Reports &amp; Exports cleanup tool to prune old anonymous visitor sessions/events and stay within Firebase Spark storage limits.</span>
                </div>
                <div class="form-group">
                  <label class="form-label" for="set-dormant-days">Inactive Customer Threshold (Days Without Activity)</label>
                  <input class="form-control" id="set-dormant-days" type="number" min="7" max="180" value="${Number(analyticsCfg.dormantDays)}" ${canEdit ? "" : "disabled"}>
                </div>
              </div>
              <div class="skg-modal-row">
                <div class="form-group">
                  <label class="form-label" for="set-highly-active-orders">"Highly Active" Minimum Orders (30d)</label>
                  <input class="form-control" id="set-highly-active-orders" type="number" min="2" max="50" value="${Number(analyticsCfg.highlyActiveMinOrders)}" ${canEdit ? "" : "disabled"}>
                </div>
                <div class="form-group">
                  <label class="form-label" for="set-active-orders">"Active" Minimum Logins or Orders (30d)</label>
                  <input class="form-control" id="set-active-orders" type="number" min="1" max="30" value="${Number(analyticsCfg.activeMinOrders)}" ${canEdit ? "" : "disabled"}>
                </div>
              </div>
              ${canEdit ? '<button type="submit" class="btn btn-primary">Save Analytics &amp; Tier Settings</button>' : ""}
            </form>
          </section>
        `;

        container.querySelector("#skg-biz-settings-form")?.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!canEdit) return;
            const btn = e.currentTarget.querySelector('[type="submit"]');
            if (btn) btn.disabled = true;
            try {
                const payload = {
                    name: container.querySelector("#set-biz-name")?.value.trim() || ADMIN_CONFIG.business.name,
                    location: container.querySelector("#set-biz-loc")?.value.trim() || ADMIN_CONFIG.business.location,
                    landmark: container.querySelector("#set-biz-landmark")?.value.trim() || ADMIN_CONFIG.business.landmark,
                    hours: container.querySelector("#set-biz-hours")?.value.trim() || ADMIN_CONFIG.business.hours,
                    phone: container.querySelector("#set-biz-phone")?.value.trim() || ADMIN_CONFIG.business.phone,
                    whatsapp: container.querySelector("#set-biz-wa")?.value.trim() || ADMIN_CONFIG.business.whatsapp,
                    storeOpen: container.querySelector("#set-store-open")?.checked ?? true,
                    updatedAt: Date.now()
                };
                await update(ref(db, "settings/business"), payload);
                await logAuditEvent({
                    actorUid: session?.user?.uid,
                    actorName: session?.staff?.name,
                    actorEmail: session?.user?.email,
                    actorRole: session?.role,
                    action: "business_settings_updated",
                    target: "settings/business",
                    metadata: { storeOpen: payload.storeOpen }
                });
                UIModule.showToast("Business settings updated.", "success");
            } catch (err) {
                UIModule.showToast(err?.message || "Failed to save business settings.", "error");
            } finally {
                if (btn) btn.disabled = false;
            }
        });

        container.querySelector("#skg-push-settings-form")?.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!canEdit) return;
            const btn = e.currentTarget.querySelector('[type="submit"]');
            if (btn) btn.disabled = true;
            try {
                const payload = {
                    vapidKey: container.querySelector("#set-vapid-key")?.value.trim() || "",
                    workerUrl: container.querySelector("#set-worker-url")?.value.trim() || "",
                    updatedAt: Date.now()
                };
                await update(ref(db, "settings/pushPublic"), payload);
                await logAuditEvent({
                    actorUid: session?.user?.uid,
                    actorName: session?.staff?.name,
                    actorEmail: session?.user?.email,
                    actorRole: session?.role,
                    action: "push_settings_updated",
                    target: "settings/pushPublic",
                    metadata: { hasVapid: Boolean(payload.vapidKey), hasWorkerUrl: Boolean(payload.workerUrl) }
                });
                UIModule.showToast("Public Web Push configuration saved.", "success");
            } catch (err) {
                UIModule.showToast(err?.message || "Failed to save push configuration.", "error");
            } finally {
                if (btn) btn.disabled = false;
            }
        });

        container.querySelector("#skg-analytics-settings-form")?.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!canEdit) return;
            const btn = e.currentTarget.querySelector('[type="submit"]');
            if (btn) btn.disabled = true;
            try {
                const payload = {
                    retentionDays: Math.max(7, Math.min(365, Number(container.querySelector("#set-retention-days")?.value || 90))),
                    dormantDays: Math.max(7, Math.min(180, Number(container.querySelector("#set-dormant-days")?.value || 30))),
                    highlyActiveMinOrders: Math.max(2, Number(container.querySelector("#set-highly-active-orders")?.value || 5)),
                    activeMinOrders: Math.max(1, Number(container.querySelector("#set-active-orders")?.value || 2)),
                    updatedAt: Date.now()
                };
                await update(ref(db, "settings/analytics"), payload);
                await logAuditEvent({
                    actorUid: session?.user?.uid,
                    actorName: session?.staff?.name,
                    actorEmail: session?.user?.email,
                    actorRole: session?.role,
                    action: "analytics_settings_updated",
                    target: "settings/analytics",
                    metadata: payload
                });
                UIModule.showToast("Analytics retention & engagement tier settings saved.", "success");
            } catch (err) {
                UIModule.showToast(err?.message || "Failed to save analytics settings.", "error");
            } finally {
                if (btn) btn.disabled = false;
            }
        });
    }
};

if (typeof window !== "undefined") {
    window.SettingsModule = SettingsModule;
}