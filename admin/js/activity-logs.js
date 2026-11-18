// ============================================================================
// SIRANCHOWK KHAJA GHAR — DEDICATED 10-CATEGORY ACTIVITY LOGS SYSTEM
// ============================================================================
// Strictly separated log categories (never mixed):
//  1. Admin Login Logs       6. Product & Inventory Activity Logs
//  2. Customer Login Logs    7. Device Activity Logs
//  3. Website Visitor Logs   8. Notification Logs
//  4. Admin Activity Logs    9. Security Logs
//  5. Order Activity Logs   10. Staff & Permission Change Logs
// ============================================================================

import { db, ref, get, query, limitToLast } from "../../js/firebase.js";
import { hasPermission, getAdminSession } from "./auth.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";
import {
    getDateRangeFromPreset,
    maskEmail,
    downloadCSV,
    paginateList,
    renderPaginationBar,
    renderDateFilterBar
} from "./analytics-utils.js";

const LOG_CATEGORIES = [
    { key: "admin_login", label: "1. Admin Login Logs", perm: "viewLoginHistory", desc: "Staff & Owner sign-ins, sign-outs, and failed admin login attempts." },
    { key: "customer_login", label: "2. Customer Login Logs", perm: "viewLoginHistory", desc: "Customer authentication events, sign-outs, and session durations." },
    { key: "visitor_logs", label: "3. Website Visitor Logs", perm: "viewAnalytics", desc: "Anonymous first-party visitor sessions and page browsing events." },
    { key: "admin_activity", label: "4. Admin Activity Logs", perm: "viewAuditLogs", desc: "General administrative operations, settings, coupons, and reports." },
    { key: "order_activity", label: "5. Order Activity Logs", perm: "viewAuditLogs", desc: "Order lifecycle status transitions, delay notices, and payment/refund alerts." },
    { key: "product_activity", label: "6. Product Activity Logs", perm: "viewAuditLogs", desc: "Menu item additions, edits, pricing changes, category & inventory adjustments." },
    { key: "device_activity", label: "7. Device Activity Logs", perm: "viewSecurityLogs", desc: "Admin device registrations, approvals, rejections, blocks, and session revocations." },
    { key: "notification_logs", label: "8. Notification Logs", perm: null, anyPerm: ["sendNotifications", "sendCustomerCampaigns", "viewAuditLogs"], desc: "Dispatched admin, order, security, and customer campaign notifications." },
    { key: "security_logs", label: "9. Security Logs", perm: "viewSecurityLogs", desc: "Auth failures, permission denials, repeated failures, and security triggers." },
    { key: "staff_rbac", label: "10. Staff & Permission Logs", perm: "viewSecurityLogs", desc: "Staff provisioning, role assignments, and RBAC permission overrides." }
];

function evTs(ev) {
    if (Number.isFinite(Number(ev?.timestamp)) && Number(ev.timestamp) > 0) return Number(ev.timestamp);
    if (Number.isFinite(Number(ev?.numericTimestamp)) && Number(ev.numericTimestamp) > 0) return Number(ev.numericTimestamp);
    if (Number.isFinite(Number(ev?.createdAt)) && Number(ev.createdAt) > 0) return Number(ev.createdAt);
    const parsed = new Date(ev?.timestamp || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function isOrderAction(action = "") {
    return /^order_|^order$/i.test(action);
}
function isProductOrStockAction(action = "") {
    return /^(product_|menu_|category_|inventory_|stock_)/i.test(action);
}
function isDeviceAction(action = "") {
    return /^device_/i.test(action);
}
function isStaffOrRbacAction(action = "") {
    return /^(staff_|rbac_|role_)/i.test(action);
}

function normalizeLogRow({
    id = "",
    actorUid = "",
    actorName = "",
    role = "",
    action = "",
    target = "",
    timestamp = 0,
    deviceInfo = "",
    result = "success",
    metadata = {}
}) {
    return {
        id: String(id || `evt_${timestamp}`),
        actorUid: String(actorUid || "system"),
        actorName: String(actorName || "System"),
        role: String(role || "system"),
        action: String(action || "event"),
        target: String(target || "—"),
        timestamp: Number(timestamp || 0),
        deviceInfo: String(deviceInfo || "Unknown"),
        result: String(result || "success").toLowerCase() === "failed" ? "failed" : "success",
        metadata: metadata && typeof metadata === "object" ? metadata : {}
    };
}

export const ActivityLogsModule = {
    async render(container) {
        const session = getAdminSession();
        const canSeePII = hasPermission("viewCustomerContactDetails");
        const canExport = hasPermission("exportReports");

        const allowedCats = LOG_CATEGORIES.filter((c) => {
            if (c.anyPerm) return c.anyPerm.some((p) => hasPermission(p));
            if (c.perm) return hasPermission(c.perm);
            return true;
        });

        if (!allowedCats.length) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">You do not have permission to view system activity logs.</p></section>';
            return;
        }

        container.innerHTML = '<div class="skg-admin-loading">Loading categorized system activity logs…</div>';

        const [
            loginSnap,
            auditSnap,
            secSnap,
            eventsSnap,
            notifHistSnap
        ] = await Promise.all([
            hasPermission("viewLoginHistory") ? get(query(ref(db, "loginHistory"), limitToLast(400))).catch(() => null) : Promise.resolve(null),
            hasPermission("viewAuditLogs") ? get(query(ref(db, "auditLogs"), limitToLast(500))).catch(() => null) : Promise.resolve(null),
            hasPermission("viewSecurityLogs") ? get(query(ref(db, "securityLogs"), limitToLast(400))).catch(() => null) : Promise.resolve(null),
            hasPermission("viewAnalytics") ? get(query(ref(db, "analytics/events"), limitToLast(400))).catch(() => null) : Promise.resolve(null),
            (hasPermission("sendNotifications") || hasPermission("sendCustomerCampaigns") || hasPermission("viewAuditLogs"))
                ? get(ref(db, "notificationHistory")).catch(() => null)
                : Promise.resolve(null)
        ]);

        const loginRows = loginSnap && loginSnap.exists() ? Object.values(loginSnap.val() || {}) : [];
        const auditRows = auditSnap && auditSnap.exists() ? Object.values(auditSnap.val() || {}) : [];
        const secRows = secSnap && secSnap.exists() ? Object.values(secSnap.val() || {}) : [];
        const analyticsRows = eventsSnap && eventsSnap.exists() ? Object.values(eventsSnap.val() || {}) : [];
        const notifChannels = notifHistSnap && notifHistSnap.exists() ? (notifHistSnap.val() || {}) : {};

        const datasets = {
            admin_login: loginRows
                .filter((l) => l && String(l.role || "").toLowerCase() !== "customer")
                .map((l) => normalizeLogRow({
                    id: l.id,
                    actorUid: l.uid,
                    actorName: l.name || l.email || "Staff",
                    role: l.role || "staff",
                    action: `${l.action || "login"} (${l.method || "password"})`,
                    target: l.email || l.deviceId || "Admin Panel",
                    timestamp: evTs(l),
                    deviceInfo: `${l.deviceType || "unknown"} · ${l.browser || "Other"} · ${l.operatingSystem || "Other"}`,
                    result: l.result,
                    metadata: { reason: l.reason, sessionId: l.sessionId, deviceId: l.deviceId, sessionDurationSec: l.sessionDurationSec }
                })),

            customer_login: loginRows
                .filter((l) => l && String(l.role || "").toLowerCase() === "customer")
                .map((l) => normalizeLogRow({
                    id: l.id,
                    actorUid: canSeePII ? l.uid : "Restricted",
                    actorName: l.name || (canSeePII ? l.email : maskEmail(l.email)) || "Customer",
                    role: "customer",
                    action: `${l.action || "login"} (${l.method || "password"})`,
                    target: canSeePII ? (l.email || "Account") : maskEmail(l.email),
                    timestamp: evTs(l),
                    deviceInfo: `${l.deviceType || "unknown"} · ${l.browser || "Other"} · ${l.operatingSystem || "Other"}`,
                    result: l.result,
                    metadata: { reason: l.reason, sessionId: l.sessionId, sessionDurationSec: l.sessionDurationSec }
                })),

            visitor_logs: analyticsRows.map((e, idx) => normalizeLogRow({
                id: e.sessionId ? `${e.sessionId}_${idx}` : `vis_${idx}`,
                actorUid: e.visitorId || "visitor",
                actorName: e.isReturning ? "Returning Visitor" : "Visitor",
                role: "anonymous_guest",
                action: e.eventType || "page_view",
                target: e.page || "/",
                timestamp: evTs(e),
                deviceInfo: `${e.device || "unknown"} · ${e.browser || "Other"} · ${e.operatingSystem || "Other"}`,
                result: "success",
                metadata: { referrerHost: e.referrerHost || "Direct", sessionId: e.sessionId }
            })),

            admin_activity: auditRows
                .filter((a) => a && !isOrderAction(a.action) && !isProductOrStockAction(a.action) && !isDeviceAction(a.action) && !isStaffOrRbacAction(a.action))
                .map((a) => normalizeLogRow({
                    id: a.id,
                    actorUid: a.actorUid,
                    actorName: a.actorName || a.actorEmail || "Staff",
                    role: a.actorRole || "staff",
                    action: a.action,
                    target: a.target,
                    timestamp: evTs(a),
                    deviceInfo: `${a.deviceType || "unknown"} · ${a.browser || "Other"} · ${a.operatingSystem || "Other"}`,
                    result: a.status || "success",
                    metadata: a.metadata || {}
                })),

            order_activity: auditRows
                .filter((a) => a && isOrderAction(a.action))
                .map((a) => normalizeLogRow({
                    id: a.id,
                    actorUid: a.actorUid,
                    actorName: a.actorName || a.actorEmail || "Staff",
                    role: a.actorRole || "staff",
                    action: a.action,
                    target: a.target,
                    timestamp: evTs(a),
                    deviceInfo: `${a.deviceType || "unknown"} · ${a.browser || "Other"} · ${a.operatingSystem || "Other"}`,
                    result: a.status || "success",
                    metadata: a.metadata || {}
                })),

            product_activity: auditRows
                .filter((a) => a && isProductOrStockAction(a.action))
                .map((a) => normalizeLogRow({
                    id: a.id,
                    actorUid: a.actorUid,
                    actorName: a.actorName || a.actorEmail || "Staff",
                    role: a.actorRole || "staff",
                    action: a.action,
                    target: a.target,
                    timestamp: evTs(a),
                    deviceInfo: `${a.deviceType || "unknown"} · ${a.browser || "Other"} · ${a.operatingSystem || "Other"}`,
                    result: a.status || "success",
                    metadata: a.metadata || {}
                })),

            device_activity: [
                ...auditRows.filter((a) => a && isDeviceAction(a.action)).map((a) => normalizeLogRow({
                    id: a.id,
                    actorUid: a.actorUid,
                    actorName: a.actorName || a.actorEmail || "Owner",
                    role: a.actorRole || "owner",
                    action: a.action,
                    target: a.target,
                    timestamp: evTs(a),
                    deviceInfo: `${a.deviceType || "unknown"} · ${a.browser || "Other"} · ${a.operatingSystem || "Other"}`,
                    result: a.status || "success",
                    metadata: a.metadata || {}
                })),
                ...secRows.filter((s) => s && isDeviceAction(s.eventType)).map((s) => normalizeLogRow({
                    id: s.id,
                    actorUid: s.actorUid,
                    actorName: s.actorEmail || s.actorUid || "System",
                    role: s.actorRole || "owner",
                    action: s.eventType,
                    target: s.target,
                    timestamp: evTs(s),
                    deviceInfo: `${s.deviceType || "unknown"} · ${s.browser || "Other"} · ${s.operatingSystem || "Other"}`,
                    result: s.severity === "high" || s.severity === "critical" ? "failed" : "success",
                    metadata: s.details || {}
                }))
            ],

            notification_logs: Object.entries(notifChannels).flatMap(([ch, map]) =>
                Object.values(map || {}).map((n) => normalizeLogRow({
                    id: n.id,
                    actorUid: n.actorUid,
                    actorName: n.actorUid || "System",
                    role: ch,
                    action: `${ch}:${n.type || "notification"}`,
                    target: n.targetAudience || n.title,
                    timestamp: evTs(n),
                    deviceInfo: `${n.targetedCount || 0} targeted · ${n.sentCount || 0} sent`,
                    result: n.status === "failed" ? "failed" : "success",
                    metadata: { title: n.title, status: n.status, failureDetails: n.failureDetails }
                }))
            ),

            security_logs: secRows.map((s) => normalizeLogRow({
                id: s.id,
                actorUid: s.actorUid,
                actorName: s.actorEmail || s.actorUid || "Unauthenticated",
                role: s.actorRole || "system",
                action: `${s.eventType} [${s.severity || "info"}]`,
                target: s.target,
                timestamp: evTs(s),
                deviceInfo: `${s.deviceType || "unknown"} · ${s.browser || "Other"} · ${s.operatingSystem || "Other"}`,
                result: (String(s.eventType || "").includes("failed") || s.severity === "high" || s.severity === "critical") ? "failed" : "success",
                metadata: s.details || {}
            })),

            staff_rbac: [
                ...auditRows.filter((a) => a && isStaffOrRbacAction(a.action)).map((a) => normalizeLogRow({
                    id: a.id,
                    actorUid: a.actorUid,
                    actorName: a.actorName || a.actorEmail || "Owner",
                    role: a.actorRole || "owner",
                    action: a.action,
                    target: a.target,
                    timestamp: evTs(a),
                    deviceInfo: `${a.deviceType || "unknown"} · ${a.browser || "Other"} · ${a.operatingSystem || "Other"}`,
                    result: a.status || "success",
                    metadata: a.metadata || {}
                })),
                ...secRows.filter((s) => s && isStaffOrRbacAction(s.eventType)).map((s) => normalizeLogRow({
                    id: s.id,
                    actorUid: s.actorUid,
                    actorName: s.actorEmail || s.actorUid || "Owner",
                    role: s.actorRole || "owner",
                    action: s.eventType,
                    target: s.target,
                    timestamp: evTs(s),
                    deviceInfo: `${s.deviceType || "unknown"} · ${s.browser || "Other"} · ${s.operatingSystem || "Other"}`,
                    result: "success",
                    metadata: s.details || {}
                }))
            ]
        };

        Object.values(datasets).forEach((arr) => arr.sort((a, b) => b.timestamp - a.timestamp));

        const state = {
            category: allowedCats[0].key,
            preset: "30d",
            customStart: "",
            customEnd: "",
            search: "",
            resultFilter: "all",
            page: 1
        };

        const draw = () => {
            const catMeta = allowedCats.find((c) => c.key === state.category) || allowedCats[0];
            const range = getDateRangeFromPreset(state.preset, state.customStart, state.customEnd);
            const q = state.search.trim().toLowerCase();

            const rawRows = datasets[catMeta.key] || [];
            const filtered = rawRows.filter((row) => {
                if (row.timestamp < range.startMs || row.timestamp > range.endMs) return false;
                if (state.resultFilter !== "all" && row.result !== state.resultFilter) return false;
                if (q) {
                    const hay = `${row.id} ${row.actorUid} ${row.actorName} ${row.role} ${row.action} ${row.target} ${row.deviceInfo} ${JSON.stringify(row.metadata)}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });

            const pager = paginateList(filtered, state.page, 25);
            state.page = pager.page;

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">Activity Logs — ${Utils.escapeHTML(catMeta.label)} (${filtered.length})</h2>
                      <p class="card-subtitle">${Utils.escapeHTML(catMeta.desc)} (${Utils.escapeHTML(range.label)})</p>
                    </div>
                    <div class="skg-quick-actions">
                      ${canExport && filtered.length ? '<button type="button" class="btn btn-primary" id="skg-al-export">⬇ Export CSV</button>' : ""}
                      <button type="button" class="btn btn-secondary" id="skg-al-refresh">↻ Refresh</button>
                    </div>
                  </div>

                  <div class="skg-tabs" role="tablist" aria-label="Activity log categories">
                    ${allowedCats.map((cat) => `
                      <button type="button" class="skg-tab ${cat.key === catMeta.key ? "active" : ""}" data-log-cat="${Utils.escapeHTML(cat.key)}">
                        ${Utils.escapeHTML(cat.label)} (${(datasets[cat.key] || []).length})
                      </button>
                    `).join("")}
                  </div>

                  ${renderDateFilterBar(state, true)}

                  <div class="skg-admin-order-toolbar">
                    <input type="search" id="skg-al-search" placeholder="Search event ID, actor UID/name, action, target, or metadata" value="${Utils.escapeHTML(state.search)}">
                    <select id="skg-al-result">
                      <option value="all" ${state.resultFilter === "all" ? "selected" : ""}>All Results</option>
                      <option value="success" ${state.resultFilter === "success" ? "selected" : ""}>Success Only</option>
                      <option value="failed" ${state.resultFilter === "failed" ? "selected" : ""}>Failed Only</option>
                    </select>
                  </div>

                  ${pager.items.length === 0 ? `
                    <div class="empty-state">
                      <div class="empty-state-icon">📑</div>
                      <h3 class="empty-state-title">No logs in ${Utils.escapeHTML(catMeta.label)}</h3>
                      <p class="empty-state-desc">No matching records were recorded in the selected date window (${Utils.escapeHTML(range.label)}).</p>
                    </div>
                  ` : `
                    <div class="table-responsive">
                      <table class="data-table">
                        <thead>
                          <tr>
                            <th>Timestamp (NPT)</th>
                            <th>Event ID</th>
                            <th>Actor</th>
                            <th>Role</th>
                            <th>Action</th>
                            <th>Target</th>
                            <th>Device Info</th>
                            <th>Result</th>
                            <th>Metadata</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${pager.items.map((row) => `
                            <tr>
                              <td style="white-space:nowrap;">${Utils.escapeHTML(Utils.formatDate(row.timestamp))}</td>
                              <td><code>${Utils.escapeHTML(row.id.slice(0, 14))}</code></td>
                              <td>
                                <strong>${Utils.escapeHTML(row.actorName)}</strong>
                                <div class="form-hint"><code>${Utils.escapeHTML(row.actorUid.slice(0, 14))}</code></div>
                              </td>
                              <td>${Utils.escapeHTML(row.role)}</td>
                              <td><code>${Utils.escapeHTML(row.action)}</code></td>
                              <td><code>${Utils.escapeHTML(row.target.slice(0, 40))}</code></td>
                              <td>${Utils.escapeHTML(row.deviceInfo)}</td>
                              <td><span class="badge ${row.result === "failed" ? "badge-danger" : "badge-success"}">${Utils.escapeHTML(row.result)}</span></td>
                              <td><button type="button" class="btn btn-sm btn-secondary" data-view-al="${Utils.escapeHTML(row.id)}">Inspect</button></td>
                            </tr>
                          `).join("")}
                        </tbody>
                      </table>
                    </div>
                    ${renderPaginationBar(pager, "activity-logs")}
                  `}
                </section>
              </div>
            `;

            container.querySelectorAll("[data-log-cat]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    state.category = btn.dataset.logCat;
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
            container.querySelector("#skg-al-search")?.addEventListener("input", (e) => {
                state.search = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-al-result")?.addEventListener("change", (e) => {
                state.resultFilter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-al-refresh")?.addEventListener("click", () => this.render(container));
            container.querySelectorAll("[data-page-nav]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    if (btn.dataset.pageNav === "prev" && state.page > 1) state.page -= 1;
                    if (btn.dataset.pageNav === "next" && state.page < pager.totalPages) state.page += 1;
                    draw();
                });
            });
            container.querySelector("#skg-al-export")?.addEventListener("click", async () => {
                const headers = ["Event ID", "Timestamp (NPT)", "Actor UID", "Actor Name", "Role", "Action", "Target", "Device Info", "Result", "Metadata"];
                const rows = filtered.map((r) => [
                    r.id,
                    Utils.formatDate(r.timestamp),
                    r.actorUid,
                    r.actorName,
                    r.role,
                    r.action,
                    r.target,
                    r.deviceInfo,
                    r.result,
                    JSON.stringify(r.metadata)
                ]);
                downloadCSV(`siranchowk_${catMeta.key}_${state.preset}.csv`, headers, rows);
                await logAuditEvent({
                    actorUid: session?.user?.uid,
                    actorEmail: session?.user?.email,
                    actorRole: session?.role,
                    action: "activity_logs_exported",
                    target: catMeta.key,
                    metadata: { rows: rows.length }
                });
                UIModule.showToast(`Exported ${rows.length} record(s) from ${catMeta.label}.`, "success");
            });

            container.querySelectorAll("[data-view-al]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const row = filtered.find((r) => r.id === btn.dataset.viewAl);
                    if (!row) return;
                    const metaEntries = Object.entries(row.metadata || {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
                    const body = `
                      <div class="skg-customer-modal-meta">
                        <p><strong>Event ID:</strong> <code>${Utils.escapeHTML(row.id)}</code></p>
                        <p><strong>Category:</strong> ${Utils.escapeHTML(catMeta.label)}</p>
                        <p><strong>Timestamp (NPT):</strong> ${Utils.escapeHTML(Utils.formatDate(row.timestamp))}</p>
                        <p><strong>Actor:</strong> ${Utils.escapeHTML(row.actorName)} (${Utils.escapeHTML(row.role)})</p>
                        <p><strong>Actor UID:</strong> <code>${Utils.escapeHTML(row.actorUid)}</code></p>
                        <p><strong>Action:</strong> <code>${Utils.escapeHTML(row.action)}</code></p>
                        <p><strong>Target:</strong> <code>${Utils.escapeHTML(row.target)}</code></p>
                        <p><strong>Device Info:</strong> ${Utils.escapeHTML(row.deviceInfo)}</p>
                        <p><strong>Result:</strong> ${Utils.escapeHTML(row.result)}</p>
                      </div>
                      <h4 style="margin:14px 0 8px;">Metadata</h4>
                      ${metaEntries.length === 0 ? '<p class="form-hint">No additional metadata recorded.</p>' : `
                        <div class="skg-modal-orders">
                          ${metaEntries.map(([k, v]) => `
                            <div class="skg-modal-order-row">
                              <div><strong>${Utils.escapeHTML(k)}</strong></div>
                              <div><code>${Utils.escapeHTML(typeof v === "object" ? JSON.stringify(v) : v)}</code></div>
                            </div>
                          `).join("")}
                        </div>
                      `}
                    `;
                    UIModule.openModal("Activity Event Details", body, '<button type="button" class="btn btn-primary" id="al-modal-close">Close</button>');
                    document.getElementById("al-modal-close")?.addEventListener("click", () => UIModule.closeModal());
                });
            });
        };

        draw();
    }
};
