// ============================================================================
// SIRANCHOWK KHAJA GHAR — SEPARATED PUSH & IN-APP NOTIFICATION CENTER
// ============================================================================

import { db, ref, get, push, set, update } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { DEFAULT_ADMIN_DEVICE_PREFERENCES } from "../../js/device-manager.js";
import {
    DEFAULT_ORDER_NOTIFICATION_TEMPLATES,
    getOrderNotificationTemplates,
    getPublicPushConfig,
    registerAdminDevicePush,
    dispatchWorkerPush
} from "../../js/notifications-client.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { recordNotificationHistory } from "../../js/activity-logger.js";
import {
    getDateRangeFromPreset,
    paginateList,
    renderPaginationBar,
    renderDateFilterBar
} from "./analytics-utils.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

const HISTORY_CHANNELS = [
    { key: "admin", label: "1. Admin Notifications", desc: "Internal alerts dispatched to approved Owner & Staff devices." },
    { key: "customer", label: "2. Customer Notifications", desc: "Account-level customer alerts & preference updates." },
    { key: "orders", label: "3. Order Notifications", desc: "Order received, confirmed, preparing, ready, dispatched, delivered, delay & refund updates." },
    { key: "security", label: "4. Security Notifications", desc: "Security alert notifications & device/authentication warnings." },
    { key: "campaigns", label: "5. Campaign History", desc: "Customer promotional & schedule announcements." }
];

const TEMPLATE_META = [
    ["pending", "Order Received (Pending)", "Sent when a customer places an order request."],
    ["accepted", "Order Confirmed / Accepted", "Sent when staff accept the order."],
    ["preparing", "Preparation Started / Preparing", "Sent when kitchen starts preparing."],
    ["ready", "Order Ready", "Sent when food is ready for pickup or rider."],
    ["dispatched", "Dispatched / Out for Delivery", "Sent when courier is on the way."],
    ["delivered", "Order Delivered", "Sent ONLY when explicitly marked Delivered."],
    ["cancelled", "Order Cancelled", "Sent when an order is cancelled."],
    ["delayed", "Important Order Delay", "Customizable delay notice ({orderShort} supported)."],
    ["payment_update", "Payment / Refund Update", "Payment or refund status update ({orderShort} supported)."]
];

const PREF_META = [
    ["newOrders", "New Website Orders", "Alert whenever a customer places a new order."],
    ["orderCancellations", "Order Cancellations", "Alert when an order is cancelled by staff."],
    ["orderUpdates", "Important Order Updates", "Alert when orders complete or require attention."],
    ["securityAlerts", "Security Alerts", "Critical security and device warnings."],
    ["staffAnnouncements", "Staff Announcements", "Internal broadcasts from Owner / Admin."]
];

function statusBadgeClass(status) {
    if (status === "delivered" || status === "sent_to_provider") return "badge-success";
    if (status === "failed") return "badge-danger";
    if (status === "queued") return "badge-warning";
    return "badge-info";
}

export const NotificationsModule = {
    async render(container) {
        const session = getAdminSession();
        const canAdminNotify = hasPermission("sendNotifications");
        const canCampaign = hasPermission("sendCustomerCampaigns");
        const canEditTemplates = hasPermission("manageSettings") || canAdminNotify || canCampaign;
        const myDevice = session?.device || null;

        container.innerHTML = '<div class="skg-admin-loading">Loading Notification Center &amp; 5-channel history…</div>';

        const [
            devSnap,
            adminNotifSnap,
            custAnnSnap,
            notifHistSnap,
            templates,
            pushConfig
        ] = await Promise.all([
            canAdminNotify ? get(ref(db, "adminDevices")).catch(() => null) : Promise.resolve(null),
            get(ref(db, "adminNotifications")).catch(() => null),
            get(ref(db, "announcements/customer")).catch(() => null),
            get(ref(db, "notificationHistory")).catch(() => null),
            getOrderNotificationTemplates(),
            getPublicPushConfig()
        ]);

        const approvedDevices = (devSnap && devSnap.exists() ? Object.values(devSnap.val() || {}) : [])
            .filter((d) => d?.approvalStatus === "approved" && !d?.blocked);

        const rawHistory = notifHistSnap && notifHistSnap.exists() ? (notifHistSnap.val() || {}) : {};
        const fallbackAdmin = adminNotifSnap && adminNotifSnap.exists() ? Object.values(adminNotifSnap.val() || {}) : [];
        const fallbackCampaigns = custAnnSnap && custAnnSnap.exists() ? Object.values(custAnnSnap.val() || {}) : [];

        const buildChannelList = (ch) => {
            const direct = Object.values(rawHistory[ch] || {});
            const seenIds = new Set();
            direct.forEach((x) => {
                if (x?.id) seenIds.add(x.id);
                if (x?.referenceId) seenIds.add(x.referenceId);
            });
            if (ch === "admin") {
                fallbackAdmin.forEach((a) => {
                    if (a && !seenIds.has(a.id)) {
                        direct.push({
                            id: a.id,
                            channel: "admin",
                            title: a.title,
                            message: a.body,
                            type: a.category || "staffAnnouncements",
                            targetAudience: a.targetType === "selected" ? `${(a.targetDeviceIds || []).length} device(s)` : "all_approved_admin_devices",
                            status: "created",
                            actorUid: a.senderUid || "admin",
                            createdAt: a.createdAt
                        });
                    }
                });
            } else if (ch === "campaigns") {
                fallbackCampaigns.forEach((c) => {
                    if (c && !seenIds.has(c.id)) {
                        direct.push({
                            id: c.id,
                            channel: "campaigns",
                            title: c.title,
                            message: c.body,
                            type: c.badge || "Announcement",
                            targetAudience: c.audience || "opted_in",
                            status: c.status || (c.active ? "created" : "queued"),
                            actorUid: c.senderUid || "admin",
                            targetedCount: c.targetedCount || 0,
                            sentCount: c.sentCount || 0,
                            failedCount: c.failedCount || 0,
                            failureDetails: c.failureDetails || "",
                            createdAt: c.createdAt
                        });
                    }
                });
            }
            return direct.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        };

        const channelData = {
            admin: buildChannelList("admin"),
            customer: buildChannelList("customer"),
            orders: buildChannelList("orders"),
            security: buildChannelList("security"),
            campaigns: buildChannelList("campaigns")
        };

        const visibleChannels = HISTORY_CHANNELS.filter((ch) => {
            if (session?.role === "owner" || canAdminNotify) return true;
            if (ch.key === "admin") return hasPermission("viewAuditLogs");
            if (ch.key === "customer") return canCampaign || hasPermission("viewCustomers");
            if (ch.key === "orders") return canCampaign || hasPermission("viewOrders");
            if (ch.key === "security") return hasPermission("viewSecurityLogs");
            if (ch.key === "campaigns") return canCampaign;
            return false;
        });

        const state = {
            mainTab: visibleChannels.length > 0 ? "history" : "my_prefs",
            historyChannel: visibleChannels[0]?.key || "admin",
            preset: "30d",
            customStart: "",
            customEnd: "",
            search: "",
            page: 1
        };

        const draw = () => {
            const activeChMeta = visibleChannels.find((c) => c.key === state.historyChannel) || visibleChannels[0] || HISTORY_CHANNELS[0];
            const range = getDateRangeFromPreset(state.preset, state.customStart, state.customEnd);
            const q = state.search.trim().toLowerCase();

            const rawChItems = visibleChannels.length ? (channelData[activeChMeta.key] || []) : [];
            const filteredHist = rawChItems.filter((item) => {
                const ts = Number(item.createdAt || 0);
                if (ts < range.startMs || ts > range.endMs) return false;
                if (q) {
                    const hay = `${item.title || ""} ${item.message || ""} ${item.type || ""} ${item.targetAudience || ""} ${item.actorUid || ""} ${item.status || ""}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });
            const pager = paginateList(filteredHist, state.page, 20);
            state.page = pager.page;

            const myPrefs = { ...DEFAULT_ADMIN_DEVICE_PREFERENCES, ...(myDevice?.preferences || {}) };

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">Notification Center &amp; History</h2>
                      <p class="card-subtitle">Separated 5-channel notification history, internal admin device alerts, per-device preferences, and customizable order templates.</p>
                    </div>
                    <span class="badge ${pushConfig.workerUrl ? "badge-success" : "badge-warning"}">
                      ${pushConfig.workerUrl ? "Worker Push Ready" : "RTDB Live Mode (Configure Worker in Settings)"}
                    </span>
                  </div>

                  <div class="skg-tabs" role="tablist">
                    ${visibleChannels.length > 0 ? `<button type="button" class="skg-tab ${state.mainTab === "history" ? "active" : ""}" data-main-tab="history">📋 Notification History (${visibleChannels.length} ${visibleChannels.length === 1 ? "View" : "Views"})</button>` : ""}
                    ${canAdminNotify ? `<button type="button" class="skg-tab ${state.mainTab === "send_admin" ? "active" : ""}" data-main-tab="send_admin">🛡️ Send Admin Alert</button>` : ""}
                    <button type="button" class="skg-tab ${state.mainTab === "my_prefs" ? "active" : ""}" data-main-tab="my_prefs">📱 My Device Preferences</button>
                    ${canEditTemplates ? `<button type="button" class="skg-tab ${state.mainTab === "templates" ? "active" : ""}" data-main-tab="templates">✉️ Order Templates</button>` : ""}
                  </div>

                  ${state.mainTab === "history" && visibleChannels.length > 0 ? `
                    <div class="skg-tabs" role="tablist" aria-label="Notification History Channels" style="border-bottom:0;margin-bottom:0.5rem;">
                      ${visibleChannels.map((ch) => `
                        <button type="button" class="btn btn-sm ${ch.key === activeChMeta.key ? "btn-primary" : "btn-secondary"}" data-hist-ch="${Utils.escapeHTML(ch.key)}">
                          ${Utils.escapeHTML(ch.label)} (${(channelData[ch.key] || []).length})
                        </button>
                      `).join("")}
                    </div>
                    <p class="form-hint" style="margin-bottom:10px;">${Utils.escapeHTML(activeChMeta.desc)} · Note: Push statuses reflect provider acceptance (<code>sent_to_provider</code>), never fabricated delivery confirmations.</p>

                    ${renderDateFilterBar(state, true)}

                    <div class="skg-admin-order-toolbar">
                      <input type="search" id="skg-nh-search" placeholder="Search title, message, type, audience, actor UID, or status" value="${Utils.escapeHTML(state.search)}">
                      <button type="button" class="btn btn-secondary" id="skg-nh-refresh">↻ Refresh</button>
                    </div>

                    ${pager.items.length === 0 ? `
                      <div class="empty-state">
                        <div class="empty-state-icon">🔔</div>
                        <h3 class="empty-state-title">No ${Utils.escapeHTML(activeChMeta.label)} in Range</h3>
                        <p class="empty-state-desc">Notifications dispatched in this category during ${Utils.escapeHTML(range.label)} appear here with per-device delivery results.</p>
                      </div>
                    ` : `
                      <div class="table-responsive">
                        <table class="data-table">
                          <thead>
                            <tr>
                              <th>Timestamp (NPT)</th>
                              <th>Title &amp; Message</th>
                              <th>Type</th>
                              <th>Audience</th>
                              <th>Status</th>
                              <th>Actor UID</th>
                              <th>Delivery</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${pager.items.map((item) => {
                                const st = item.status || "created";
                                return `
                                  <tr>
                                    <td style="white-space:nowrap;">${Utils.escapeHTML(Utils.formatDate(item.createdAt))}</td>
                                    <td>
                                      <strong>${Utils.escapeHTML(item.title || "Notification")}</strong>
                                      <div class="form-hint">${Utils.escapeHTML(item.message || "")}</div>
                                      ${item.failureDetails ? `<div class="form-hint" style="color:var(--color-danger);">${Utils.escapeHTML(item.failureDetails)}</div>` : ""}
                                    </td>
                                    <td><code>${Utils.escapeHTML(item.type || activeChMeta.key)}</code></td>
                                    <td>${Utils.escapeHTML(item.targetAudience || "—")}</td>
                                    <td><span class="badge ${statusBadgeClass(st)}">${Utils.escapeHTML(st)}</span></td>
                                    <td><code>${Utils.escapeHTML((item.actorUid || "system").slice(0, 14))}</code></td>
                                    <td>
                                      ${item.targetedCount ? `${item.sentCount || 0}/${item.targetedCount} sent` : "In-app / feed"}
                                      ${(Array.isArray(item.deliveryResults) && item.deliveryResults.length) ? `
                                        <div style="margin-top:4px;"><button type="button" class="btn btn-sm btn-secondary" data-view-delivery="${Utils.escapeHTML(item.id)}">Devices</button></div>
                                      ` : ""}
                                    </td>
                                  </tr>
                                `;
                            }).join("")}
                          </tbody>
                        </table>
                      </div>
                      ${renderPaginationBar(pager, "notif-history")}
                    `}
                  ` : ""}

                  ${state.mainTab === "send_admin" && canAdminNotify ? `
                    <div class="skg-notif-panel">
                      <div class="skg-channel-note">
                        <strong>Internal Admin Channel Only:</strong> Messages sent here go exclusively to approved, unblocked, push-enabled staff devices matching the chosen alert category. Pending or blocked devices never receive them.
                      </div>
                      <form id="skg-admin-notif-form" class="skg-stack-form">
                        <div class="skg-modal-row">
                          <div class="form-group">
                            <label class="form-label" for="admin-notif-title">Alert Title *</label>
                            <input class="form-control" id="admin-notif-title" type="text" required maxlength="80" placeholder="e.g., Evening Shift Prep Reminder">
                          </div>
                          <div class="form-group">
                            <label class="form-label" for="admin-notif-category">Alert Category</label>
                            <select class="form-control" id="admin-notif-category">
                              <option value="staffAnnouncements">Staff Announcement</option>
                              <option value="securityAlerts">Security Alert</option>
                              <option value="orderUpdates">Important Order Update</option>
                            </select>
                          </div>
                        </div>
                        <div class="form-group">
                          <label class="form-label" for="admin-notif-body">Message *</label>
                          <textarea class="form-control" id="admin-notif-body" required maxlength="280" placeholder="Write the internal alert for approved staff devices..."></textarea>
                        </div>
                        <div class="form-group">
                          <label class="form-label" for="admin-notif-target">Target Approved Devices</label>
                          <select class="form-control" id="admin-notif-target">
                            <option value="all">All Approved &amp; Unblocked Admin Devices (${approvedDevices.length})</option>
                            <option value="selected">Select Specific Approved Devices…</option>
                          </select>
                        </div>
                        <div id="admin-device-checklist" class="skg-device-checklist hidden">
                          ${approvedDevices.length === 0 ? '<p class="form-hint">No approved devices found yet.</p>' : approvedDevices.map((d) => `
                            <label class="skg-checkbox-inline">
                              <input type="checkbox" name="targetDevice" value="${Utils.escapeHTML(d.deviceId)}" checked>
                              <span>
                                <strong>${Utils.escapeHTML(d.staffName || d.uid)}</strong> (${Utils.escapeHTML(d.role)}) — ${Utils.escapeHTML(d.deviceName)}
                                · <em>Push: ${Utils.escapeHTML(d.pushStatus || "disabled")}</em>
                              </span>
                            </label>
                          `).join("")}
                        </div>
                        <div>
                          <button type="submit" class="btn btn-primary" id="send-admin-notif-btn">Send Admin Alert</button>
                        </div>
                      </form>
                    </div>
                  ` : ""}

                  ${state.mainTab === "my_prefs" ? `
                    <div class="skg-notif-panel">
                      <div class="skg-channel-note">
                        <strong>Current Device Status:</strong>
                        ${myDevice ? `${Utils.escapeHTML(myDevice.deviceName)} · Approval: <strong>${Utils.escapeHTML(myDevice.approvalStatus)}</strong> · Push: <strong>${Utils.escapeHTML(myDevice.pushStatus || "disabled")}</strong>` : "Device record unavailable."}
                      </div>
                      ${!myDevice || myDevice.approvalStatus !== "approved" || myDevice.blocked ? `
                        <p class="form-hint">This device is currently <strong>${Utils.escapeHTML(myDevice?.blocked ? "Blocked" : (myDevice?.approvalStatus || "pending"))}</strong>. The Owner must approve this device before push notifications or category preferences take effect.</p>
                      ` : `
                        <div style="margin-bottom:16px;">
                          <button type="button" class="btn btn-primary" id="skg-my-dev-push-btn" data-next-push="${myDevice.pushStatus === "enabled" ? "false" : "true"}">
                            ${myDevice.pushStatus === "enabled" ? "🔕 Disable Web Push on This Device" : "🔔 Enable Web Push on This Device"}
                          </button>
                        </div>
                        <form id="skg-my-dev-prefs-form" class="skg-stack-form">
                          ${PREF_META.map(([key, label, desc]) => `
                            <label class="skg-checkbox-inline" style="align-items:flex-start;padding:10px;border:1px solid var(--border-color);border-radius:10px;background:var(--surface-card);">
                              <input type="checkbox" name="myPref" value="${key}" ${myPrefs[key] !== false ? "checked" : ""} style="margin-top:3px;">
                              <span>
                                <strong>${Utils.escapeHTML(label)}</strong>
                                <div class="form-hint">${Utils.escapeHTML(desc)}</div>
                              </span>
                            </label>
                          `).join("")}
                          <div>
                            <button type="submit" class="btn btn-primary" id="skg-save-my-prefs-btn">Save Device Notification Preferences</button>
                          </div>
                        </form>
                      `}
                    </div>
                  ` : ""}

                  ${state.mainTab === "templates" && canEditTemplates ? `
                    <div class="skg-notif-panel">
                      <div class="skg-channel-note">
                        <strong>Order Status Notification Templates:</strong> Customize the messages sent automatically when order statuses advance or delay/payment updates are sent. Supported placeholders: <code>{orderShort}</code>, <code>{orderId}</code>.
                      </div>
                      <form id="skg-order-templates-form" class="skg-stack-form">
                        ${TEMPLATE_META.map(([key, label, desc]) => `
                          <div class="form-group">
                            <label class="form-label" for="tpl-${key}">${Utils.escapeHTML(label)}</label>
                            <input class="form-control" id="tpl-${key}" data-tpl-key="${key}" type="text" required maxlength="240" value="${Utils.escapeHTML(templates[key] || DEFAULT_ORDER_NOTIFICATION_TEMPLATES[key] || "")}">
                            <span class="form-hint">${Utils.escapeHTML(desc)}</span>
                          </div>
                        `).join("")}
                        <div class="skg-quick-actions">
                          <button type="submit" class="btn btn-primary" id="skg-save-tpl-btn">Save Notification Templates</button>
                          <button type="button" class="btn btn-secondary" id="skg-reset-tpl-btn">Reset to Defaults</button>
                        </div>
                      </form>
                    </div>
                  ` : ""}
                </section>
              </div>
            `;

            container.querySelectorAll("[data-main-tab]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    state.mainTab = btn.dataset.mainTab;
                    draw();
                });
            });
            container.querySelectorAll("[data-hist-ch]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    state.historyChannel = btn.dataset.histCh;
                    state.page = 1;
                    draw();
                });
            });
            container.querySelectorAll("[data-date-preset]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    state.preset = btn.dataset.datePreset;
                    state.page = 1;
                    draw();
                });
            });
            container.querySelector("#skg-apply-custom-dates")?.addEventListener("click", () => {
                state.customStart = container.querySelector("#skg-custom-start")?.value || "";
                state.customEnd = container.querySelector("#skg-custom-end")?.value || "";
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-nh-search")?.addEventListener("input", (e) => {
                state.search = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-nh-refresh")?.addEventListener("click", () => this.render(container));
            container.querySelectorAll("[data-page-nav]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    if (btn.dataset.pageNav === "prev" && state.page > 1) state.page -= 1;
                    if (btn.dataset.pageNav === "next" && state.page < pager.totalPages) state.page += 1;
                    draw();
                });
            });

            container.querySelectorAll("[data-view-delivery]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const item = filteredHist.find((x) => x.id === btn.dataset.viewDelivery);
                    if (!item) return;
                    const results = item.deliveryResults || [];
                    const body = `
                      <div class="skg-customer-modal-meta" style="margin-bottom:12px;">
                        <p><strong>Title:</strong> ${Utils.escapeHTML(item.title)}</p>
                        <p><strong>Status:</strong> <span class="badge ${statusBadgeClass(item.status)}">${Utils.escapeHTML(item.status)}</span></p>
                        <p><strong>Targeted / Provider Accepted / Failed:</strong> ${item.targetedCount || 0} / ${item.sentCount || 0} / ${item.failedCount || 0}</p>
                      </div>
                      <div class="skg-modal-orders">
                        ${results.map((r) => `
                          <div class="skg-modal-order-row">
                            <div>
                              <strong>${Utils.escapeHTML(r.deviceName || r.deviceId || "Device")}</strong>
                              <span>${Utils.escapeHTML(r.staffName || "")} ${r.error ? `· ${Utils.escapeHTML(r.error)}` : ""}</span>
                            </div>
                            <div>
                              <span class="badge ${statusBadgeClass(r.status)}">${Utils.escapeHTML(r.status)}</span>
                            </div>
                          </div>
                        `).join("")}
                      </div>
                    `;
                    UIModule.openModal("Per-Device Push Delivery Results", body, '<button type="button" class="btn btn-primary" id="deliv-modal-close">Close</button>');
                    document.getElementById("deliv-modal-close")?.addEventListener("click", () => UIModule.closeModal());
                });
            });

            const targetSelect = container.querySelector("#admin-notif-target");
            const checklist = container.querySelector("#admin-device-checklist");
            targetSelect?.addEventListener("change", () => {
                checklist?.classList.toggle("hidden", targetSelect.value !== "selected");
            });

            container.querySelector("#skg-admin-notif-form")?.addEventListener("submit", async (e) => {
                e.preventDefault();
                const title = container.querySelector("#admin-notif-title")?.value.trim();
                const body = container.querySelector("#admin-notif-body")?.value.trim();
                const category = container.querySelector("#admin-notif-category")?.value || "staffAnnouncements";
                const targetType = targetSelect?.value || "all";
                if (!title || !body) return;

                let targetDeviceIds = [];
                if (targetType === "selected") {
                    targetDeviceIds = [...container.querySelectorAll('input[name="targetDevice"]:checked')].map((i) => i.value);
                    if (!targetDeviceIds.length) {
                        UIModule.showToast("Select at least one approved device.", "error");
                        return;
                    }
                } else {
                    targetDeviceIds = approvedDevices.map((d) => d.deviceId);
                }

                const ok = await UIModule.confirm({
                    title: "Send Admin Alert?",
                    message: `Send "${title}" to ${targetType === "all" ? "all approved admin devices" : `${targetDeviceIds.length} selected device(s)`}?`,
                    confirmText: "Send Alert"
                });
                if (!ok) return;

                const sendBtn = container.querySelector("#send-admin-notif-btn");
                if (sendBtn) sendBtn.disabled = true;

                try {
                    const now = Date.now();
                    const notifRef = push(ref(db, "adminNotifications"));
                    const record = {
                        id: notifRef.key,
                        title,
                        body,
                        category,
                        targetType,
                        targetDeviceIds,
                        senderUid: session?.user?.uid || "",
                        senderEmail: session?.user?.email || "",
                        createdAt: now
                    };
                    await set(notifRef, record);

                    let histStatus = "created";
                    let targetedCount = 0;
                    let sentCount = 0;
                    let failedCount = 0;
                    let deliveryResults = [];
                    let failureDetails = "";
                    let pushNote = "Delivered to live admin panels.";

                    if (pushConfig.workerUrl && session?.user) {
                        try {
                            const authToken = await session.user.getIdToken();
                            const res = await dispatchWorkerPush({
                                workerUrl: pushConfig.workerUrl,
                                authToken,
                                payload: {
                                    type: "admin_alert",
                                    category,
                                    title,
                                    body,
                                    targetType,
                                    targetDeviceIds
                                }
                            });
                            targetedCount = res.targeted;
                            sentCount = res.sentToProvider;
                            failedCount = res.failed;
                            deliveryResults = res.deliveryResults || [];
                            histStatus = sentCount > 0 ? "sent_to_provider" : (targetedCount > 0 && failedCount === targetedCount ? "failed" : "created");
                            pushNote = `Dispatched (${sentCount}/${targetedCount} accepted by FCM).`;
                        } catch (workerErr) {
                            histStatus = "failed";
                            failureDetails = String(workerErr?.message || "Worker push failed").slice(0, 180);
                            pushNote = `Saved live alert (Worker note: ${failureDetails})`;
                        }
                    }

                    const histChannel = category === "securityAlerts" ? "security" : "admin";
                    await recordNotificationHistory(histChannel, {
                        id: notifRef.key,
                        title,
                        message: body,
                        type: category,
                        targetAudience: targetType === "selected" ? `${targetDeviceIds.length} selected device(s)` : "all_approved_admin_devices",
                        status: histStatus,
                        actorUid: session?.user?.uid || "system",
                        failureDetails,
                        targetedCount,
                        sentCount,
                        failedCount,
                        deliveryResults
                    });
                    channelData[histChannel].unshift({
                        id: notifRef.key,
                        channel: histChannel,
                        title,
                        message: body,
                        type: category,
                        targetAudience: targetType === "selected" ? `${targetDeviceIds.length} selected device(s)` : "all_approved_admin_devices",
                        status: histStatus,
                        actorUid: session?.user?.uid || "system",
                        failureDetails,
                        targetedCount,
                        sentCount,
                        failedCount,
                        deliveryResults,
                        createdAt: now
                    });

                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: "admin_notification_sent",
                        target: notifRef.key,
                        metadata: { title, category, targetType, count: targetDeviceIds.length }
                    });

                    UIModule.showToast(pushNote, "success");
                    state.mainTab = "history";
                    state.historyChannel = histChannel;
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not send admin alert.", "error");
                    if (sendBtn) sendBtn.disabled = false;
                }
            });

            container.querySelector("#skg-my-dev-push-btn")?.addEventListener("click", async (e) => {
                const btn = e.currentTarget;
                const enable = btn.dataset.nextPush === "true";
                try {
                    btn.disabled = true;
                    await registerAdminDevicePush(myDevice.deviceId, enable);
                    myDevice.pushStatus = enable ? "enabled" : "disabled";
                    UIModule.showToast(enable ? "Push notifications enabled on this device." : "Push notifications disabled on this device.", "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Failed to update push setting.", "error");
                    btn.disabled = false;
                }
            });

            container.querySelector("#skg-my-dev-prefs-form")?.addEventListener("submit", async (e) => {
                e.preventDefault();
                if (!myDevice?.deviceId) return;
                const nextPrefs = {};
                container.querySelectorAll('input[name="myPref"]').forEach((cb) => {
                    nextPrefs[cb.value] = cb.checked;
                });
                const btn = container.querySelector("#skg-save-my-prefs-btn");
                if (btn) btn.disabled = true;
                try {
                    await update(ref(db, `adminDevices/${myDevice.deviceId}/preferences`), nextPrefs);
                    myDevice.preferences = nextPrefs;
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: "device_preferences_updated",
                        target: myDevice.deviceId,
                        metadata: nextPrefs
                    });
                    UIModule.showToast("Notification preferences saved for this device.", "success");
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not save preferences.", "error");
                } finally {
                    if (btn) btn.disabled = false;
                }
            });

            container.querySelector("#skg-reset-tpl-btn")?.addEventListener("click", () => {
                TEMPLATE_META.forEach(([key]) => {
                    const input = container.querySelector(`#tpl-${key}`);
                    if (input) input.value = DEFAULT_ORDER_NOTIFICATION_TEMPLATES[key] || "";
                });
                UIModule.showToast("Default templates loaded into editor. Click Save to apply.", "info");
            });

            container.querySelector("#skg-order-templates-form")?.addEventListener("submit", async (e) => {
                e.preventDefault();
                const updatedTemplates = { ...DEFAULT_ORDER_NOTIFICATION_TEMPLATES };
                TEMPLATE_META.forEach(([key]) => {
                    const val = container.querySelector(`#tpl-${key}`)?.value.trim();
                    if (val) updatedTemplates[key] = val;
                });
                if (updatedTemplates.accepted) updatedTemplates.confirmed = updatedTemplates.accepted;

                const btn = container.querySelector("#skg-save-tpl-btn");
                if (btn) btn.disabled = true;
                try {
                    await set(ref(db, "settings/notificationTemplates"), updatedTemplates);
                    Object.assign(templates, updatedTemplates);
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: "notification_templates_updated",
                        target: "settings/notificationTemplates"
                    });
                    UIModule.showToast("Order notification templates saved.", "success");
                } catch (err) {
                    UIModule.showToast(err?.message || "Failed to save templates.", "error");
                } finally {
                    if (btn) btn.disabled = false;
                }
            });
        };

        draw();
    }
};
