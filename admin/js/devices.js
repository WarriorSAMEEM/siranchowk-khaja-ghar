// ============================================================================
// SIRANCHOWK KHAJA GHAR — ADMIN DEVICE MANAGEMENT & SESSION CONTROL
// ============================================================================

import { db, ref, onValue, update, remove } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { DEFAULT_ADMIN_DEVICE_PREFERENCES } from "../../js/device-manager.js";
import { registerAdminDevicePush } from "../../js/notifications-client.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { logSecurityEvent } from "../../js/activity-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

const PREF_LABELS = [
    ["newOrders", "New Orders"],
    ["orderCancellations", "Order Cancellations"],
    ["orderUpdates", "Important Order Updates"],
    ["securityAlerts", "Security Alerts"],
    ["staffAnnouncements", "Staff Announcements"]
];

export const DevicesModule = {
    async render(container) {
        const session = getAdminSession();
        const canManage = hasPermission("manageDevices");
        const currentDeviceId = session?.device?.deviceId || "";

        if (!canManage) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Owner Authority Required</h2><p class="card-subtitle">Device approval, blocking, and session revocation are restricted to the Business Owner.</p></section>';
            return;
        }

        container.innerHTML = '<div class="skg-admin-loading">Loading registered admin devices…</div>';

        const unsubscribe = onValue(
            ref(db, "adminDevices"),
            (snapshot) => {
                const devices = snapshot.exists()
                    ? Object.values(snapshot.val() || {}).sort((a, b) => Number(b.lastActiveAt || 0) - Number(a.lastActiveAt || 0))
                    : [];

                const pendingCount = devices.filter((d) => d.approvalStatus === "pending" && !d.blocked).length;
                const approvedPushCount = devices.filter((d) => d.approvalStatus === "approved" && !d.blocked && d.pushStatus === "enabled" && d.fcmToken).length;
                const badgeEl = document.getElementById("pending-devices-count");
                if (badgeEl) {
                    badgeEl.textContent = String(pendingCount);
                    badgeEl.classList.toggle("hidden", pendingCount === 0);
                }

                container.innerHTML = `
                  <section class="card">
                    <div class="card-header">
                      <div>
                        <h2 class="card-title">Multi-Device Admin &amp; Notification Governance (${devices.length})</h2>
                        <p class="card-subtitle">First Owner device bootstraps approved. Any 2nd/3rd Owner or Admin device starts Pending until Owner approves it. Pending/blocked devices never receive notifications.</p>
                      </div>
                      <span class="badge ${approvedPushCount > 0 ? "badge-success" : "badge-warning"}">
                        ${approvedPushCount} Push-Ready Device(s)
                      </span>
                    </div>

                    ${pendingCount > 0 ? `
                      <div class="skg-channel-note">
                        <strong>${pendingCount} Device(s) Awaiting Approval:</strong> Unapproved devices are strictly blocked from receiving admin or order push notifications until you click <em>Approve Device</em> below.
                      </div>
                    ` : ""}

                    ${devices.length === 0 ? `
                      <div class="empty-state">
                        <div class="empty-state-icon">🛡️</div>
                        <h3 class="empty-state-title">No admin devices registered yet</h3>
                        <p class="empty-state-desc">Devices appear automatically upon staff sign-in.</p>
                      </div>
                    ` : `
                      <div class="skg-device-grid">
                        ${devices.map((dev) => {
                            const isCurrent = dev.deviceId === currentDeviceId;
                            const prefs = { ...DEFAULT_ADMIN_DEVICE_PREFERENCES, ...(dev.preferences || {}) };
                            const statusBadge = dev.blocked
                                ? '<span class="badge badge-danger">Blocked</span>'
                                : dev.approvalStatus === "approved"
                                    ? '<span class="badge badge-success">Approved</span>'
                                    : dev.approvalStatus === "rejected"
                                        ? '<span class="badge badge-danger">Rejected</span>'
                                        : '<span class="badge badge-warning">Pending Approval</span>';

                            return `
                              <article class="skg-device-card ${isCurrent ? "is-current" : ""}">
                                <div class="skg-device-card-head">
                                  <div>
                                    <h3>
                                      ${Utils.escapeHTML(dev.deviceName || "Unknown Device")}
                                      ${isCurrent ? '<span class="badge badge-info">This Device</span>' : ""}
                                    </h3>
                                    <p class="form-hint">
                                      Staff: <strong>${Utils.escapeHTML(dev.staffName || "Staff")}</strong> (${Utils.escapeHTML(dev.role || "staff")}) · ${Utils.escapeHTML(dev.staffEmail || "")}
                                    </p>
                                  </div>
                                  ${statusBadge}
                                </div>

                                <div class="skg-device-meta">
                                  <div><span>Device ID</span><code>${Utils.escapeHTML(dev.deviceId)}</code></div>
                                  <div><span>Browser / OS</span><strong>${Utils.escapeHTML(dev.browser || "Browser")} · ${Utils.escapeHTML(dev.os || "OS")}</strong></div>
                                  <div><span>Push Status</span><strong>${Utils.escapeHTML(dev.pushStatus || "disabled")} ${dev.fcmToken ? "(Token saved)" : "(No token)"}</strong></div>
                                  <div><span>First Login</span><strong>${Utils.escapeHTML(Utils.formatDate(dev.firstLoginAt))}</strong></div>
                                  <div><span>Last Active</span><strong>${Utils.escapeHTML(Utils.formatDate(dev.lastActiveAt))}</strong></div>
                                  <div><span>Session Revoke #</span><strong>v${Utils.escapeHTML(dev.sessionVersion || 1)}</strong></div>
                                </div>

                                ${dev.approvalStatus === "approved" && !dev.blocked ? `
                                  <div style="margin:10px 0 14px;padding:10px 12px;border-radius:10px;background:var(--surface-muted);border:1px solid var(--border-color-subtle);">
                                    <div class="form-hint" style="margin-bottom:8px;font-weight:700;color:var(--text-primary);">Notification Alert Categories for This Device</div>
                                    <div style="display:flex;flex-wrap:wrap;gap:10px 18px;">
                                      ${PREF_LABELS.map(([prefKey, prefLabel]) => `
                                        <label class="skg-checkbox-inline">
                                          <input type="checkbox" data-dev-pref="${Utils.escapeHTML(dev.deviceId)}" data-pref-key="${prefKey}" ${prefs[prefKey] !== false ? "checked" : ""}>
                                          <span>${Utils.escapeHTML(prefLabel)}</span>
                                        </label>
                                      `).join("")}
                                    </div>
                                  </div>
                                ` : `
                                  <p class="form-hint" style="margin:6px 0 12px;">
                                    Notifications are locked on this device while its status is <strong>${dev.blocked ? "Blocked" : Utils.escapeHTML(dev.approvalStatus || "pending")}</strong>.
                                  </p>
                                `}

                                <div class="skg-device-actions">
                                  ${isCurrent && dev.approvalStatus === "approved" && !dev.blocked ? `
                                    <button type="button" class="btn btn-sm btn-primary" data-push-toggle="${Utils.escapeHTML(dev.deviceId)}" data-next-push="${dev.pushStatus === "enabled" ? "false" : "true"}">
                                      ${dev.pushStatus === "enabled" ? "🔕 Disable Push on This Device" : "🔔 Enable Push on This Device"}
                                    </button>
                                  ` : ""}

                                  ${dev.approvalStatus !== "approved" && !dev.blocked ? `
                                    <button type="button" class="btn btn-sm btn-primary" data-approve-dev="${Utils.escapeHTML(dev.deviceId)}">✓ Approve Device</button>
                                  ` : ""}
                                  ${dev.approvalStatus === "pending" ? `
                                    <button type="button" class="btn btn-sm btn-secondary" data-reject-dev="${Utils.escapeHTML(dev.deviceId)}">Reject</button>
                                  ` : ""}

                                  ${!dev.blocked ? `
                                    <button type="button" class="btn btn-sm btn-secondary" data-revoke-dev="${Utils.escapeHTML(dev.deviceId)}">Kick / Revoke Session</button>
                                  ` : ""}

                                  ${!isCurrent ? `
                                    <button type="button" class="btn btn-sm ${dev.blocked ? "btn-secondary" : "btn-danger"}" data-block-dev="${Utils.escapeHTML(dev.deviceId)}" data-next-block="${dev.blocked ? "false" : "true"}">
                                      ${dev.blocked ? "Unblock Device" : "Block Device"}
                                    </button>
                                    <button type="button" class="btn btn-sm btn-danger" data-remove-dev="${Utils.escapeHTML(dev.deviceId)}">Remove</button>
                                  ` : '<span class="form-hint">Current Owner session protected</span>'}
                                </div>
                              </article>
                            `;
                        }).join("")}
                      </div>
                    `}
                  </section>
                `;

                container.querySelectorAll("[data-dev-pref]").forEach((checkbox) => {
                    checkbox.addEventListener("change", async () => {
                        const devId = checkbox.dataset.devPref;
                        const prefKey = checkbox.dataset.prefKey;
                        const val = checkbox.checked;
                        try {
                            await update(ref(db, `adminDevices/${devId}/preferences`), { [prefKey]: val });
                            if (session?.device?.deviceId === devId) {
                                session.device.preferences = { ...(session.device.preferences || {}), [prefKey]: val };
                            }
                            UIModule.showToast(`Updated ${prefKey} preference.`, "success");
                        } catch (err) {
                            checkbox.checked = !val;
                            UIModule.showToast(err?.message || "Could not save device preference.", "error");
                        }
                    });
                });

                container.querySelectorAll("[data-push-toggle]").forEach((btn) => {
                    btn.addEventListener("click", async () => {
                        const enable = btn.dataset.nextPush === "true";
                        try {
                            btn.disabled = true;
                            await registerAdminDevicePush(btn.dataset.pushToggle, enable);
                            if (session?.device) session.device.pushStatus = enable ? "enabled" : "disabled";
                            UIModule.showToast(enable ? "Push alerts enabled for this device." : "Push alerts disabled for this device.", "success");
                        } catch (err) {
                            UIModule.showToast(err?.message || "Failed to update push status.", "error");
                        } finally {
                            btn.disabled = false;
                        }
                    });
                });

                container.querySelectorAll("[data-approve-dev]").forEach((btn) => {
                    btn.addEventListener("click", async () => {
                        const id = btn.dataset.approveDev;
                        btn.disabled = true;
                        try {
                            await update(ref(db, `adminDevices/${id}`), { approvalStatus: "approved", blocked: false, approvedAt: Date.now() });
                            await logAuditEvent({
                                actorUid: session?.user?.uid,
                                actorName: session?.staff?.name,
                                actorEmail: session?.user?.email,
                                actorRole: session?.role,
                                action: "device_approved",
                                target: id
                            });
                            await logSecurityEvent({
                                eventType: "device_approved",
                                severity: "info",
                                actorUid: session?.user?.uid,
                                actorEmail: session?.user?.email,
                                actorRole: session?.role,
                                target: id
                            });
                            UIModule.showToast("Device approved. It can now receive admin & order alerts.", "success");
                        } catch (err) {
                            UIModule.showToast(err?.message || "Failed to approve device.", "error");
                            btn.disabled = false;
                        }
                    });
                });

                container.querySelectorAll("[data-reject-dev]").forEach((btn) => {
                    btn.addEventListener("click", async () => {
                        const id = btn.dataset.rejectDev;
                        const dev = devices.find((d) => d.deviceId === id);
                        const ok = await UIModule.confirm({
                            title: "Reject Admin Device?",
                            message: `Reject ${dev?.deviceName || id}? Any active session on that device will be revoked.`,
                            confirmText: "Reject Device",
                            dangerous: true
                        });
                        if (!ok) return;
                        btn.disabled = true;
                        try {
                            await update(ref(db, `adminDevices/${id}`), {
                                approvalStatus: "rejected",
                                sessionVersion: Number(dev?.sessionVersion || 1) + 1
                            });
                            await logAuditEvent({
                                actorUid: session?.user?.uid,
                                actorName: session?.staff?.name,
                                actorEmail: session?.user?.email,
                                actorRole: session?.role,
                                action: "device_rejected",
                                target: id
                            });
                            await logSecurityEvent({
                                eventType: "device_rejected",
                                severity: "warning",
                                actorUid: session?.user?.uid,
                                actorEmail: session?.user?.email,
                                actorRole: session?.role,
                                target: id,
                                details: { deviceName: dev?.deviceName || "" }
                            });
                            UIModule.showToast("Device rejected and signed out.", "info");
                        } catch (err) {
                            UIModule.showToast(err?.message || "Failed to reject device.", "error");
                            btn.disabled = false;
                        }
                    });
                });

                container.querySelectorAll("[data-revoke-dev]").forEach((btn) => {
                    btn.addEventListener("click", async () => {
                        const id = btn.dataset.revokeDev;
                        const dev = devices.find((d) => d.deviceId === id);
                        const ok = await UIModule.confirm({
                            title: "Revoke Active Session?",
                            message: `Force immediate sign-out on "${dev?.deviceName || id}"? They will have to sign in again.`,
                            confirmText: "Kick Session",
                            dangerous: true
                        });
                        if (!ok) return;
                        btn.disabled = true;
                        try {
                            await update(ref(db, `adminDevices/${id}`), {
                                sessionVersion: Number(dev?.sessionVersion || 1) + 1,
                                lastSessionEndedAt: Date.now()
                            });
                            await logAuditEvent({
                                actorUid: session?.user?.uid,
                                actorName: session?.staff?.name,
                                actorEmail: session?.user?.email,
                                actorRole: session?.role,
                                action: "device_session_revoked",
                                target: id
                            });
                            await logSecurityEvent({
                                eventType: "device_session_revoked",
                                severity: "warning",
                                actorUid: session?.user?.uid,
                                actorEmail: session?.user?.email,
                                actorRole: session?.role,
                                target: id,
                                details: { deviceName: dev?.deviceName || "" }
                            });
                            UIModule.showToast("Session revoked.", "success");
                        } catch (err) {
                            UIModule.showToast(err?.message || "Failed to revoke session.", "error");
                            btn.disabled = false;
                        }
                    });
                });

                container.querySelectorAll("[data-block-dev]").forEach((btn) => {
                    btn.addEventListener("click", async () => {
                        const id = btn.dataset.blockDev;
                        const nextBlocked = btn.dataset.nextBlock === "true";
                        const dev = devices.find((d) => d.deviceId === id);
                        if (nextBlocked) {
                            const ok = await UIModule.confirm({
                                title: "Block Device Permanently?",
                                message: `Block "${dev?.deviceName || id}"? It will be signed out immediately and prevented from logging in until unblocked.`,
                                confirmText: "Block Device",
                                dangerous: true
                            });
                            if (!ok) return;
                        }
                        btn.disabled = true;
                        try {
                            await update(ref(db, `adminDevices/${id}`), {
                                blocked: nextBlocked,
                                sessionVersion: Number(dev?.sessionVersion || 1) + 1
                            });
                            await logAuditEvent({
                                actorUid: session?.user?.uid,
                                actorName: session?.staff?.name,
                                actorEmail: session?.user?.email,
                                actorRole: session?.role,
                                action: nextBlocked ? "device_blocked" : "device_unblocked",
                                target: id
                            });
                            await logSecurityEvent({
                                eventType: nextBlocked ? "device_blocked" : "device_unblocked",
                                severity: nextBlocked ? "high" : "info",
                                actorUid: session?.user?.uid,
                                actorEmail: session?.user?.email,
                                actorRole: session?.role,
                                target: id,
                                details: { deviceName: dev?.deviceName || "" }
                            });
                            UIModule.showToast(nextBlocked ? "Device blocked." : "Device unblocked.", "success");
                        } catch (err) {
                            UIModule.showToast(err?.message || "Failed to update device block status.", "error");
                            btn.disabled = false;
                        }
                    });
                });

                container.querySelectorAll("[data-remove-dev]").forEach((btn) => {
                    btn.addEventListener("click", async () => {
                        const id = btn.dataset.removeDev;
                        const dev = devices.find((d) => d.deviceId === id);
                        const ok = await UIModule.confirm({
                            title: "Remove Device Record?",
                            message: `Delete device "${dev?.deviceName || id}" from registered devices? If currently open, that session will terminate immediately.`,
                            confirmText: "Remove Device",
                            dangerous: true
                        });
                        if (!ok) return;
                        btn.disabled = true;
                        try {
                            await remove(ref(db, `adminDevices/${id}`));
                            await logAuditEvent({
                                actorUid: session?.user?.uid,
                                actorName: session?.staff?.name,
                                actorEmail: session?.user?.email,
                                actorRole: session?.role,
                                action: "device_removed",
                                target: id
                            });
                            await logSecurityEvent({
                                eventType: "device_removed",
                                severity: "warning",
                                actorUid: session?.user?.uid,
                                actorEmail: session?.user?.email,
                                actorRole: session?.role,
                                target: id,
                                details: { deviceName: dev?.deviceName || "" }
                            });
                            UIModule.showToast("Device removed.", "success");
                        } catch (err) {
                            UIModule.showToast(err?.message || "Failed to remove device.", "error");
                            btn.disabled = false;
                        }
                    });
                });
            },
            (err) => {
                container.innerHTML = `<section class="card"><p class="skg-dashboard-error">Unable to load admin devices: ${Utils.escapeHTML(err.message)}</p></section>`;
            }
        );

        container._skgViewUnsubscribe = unsubscribe;
    }
};
