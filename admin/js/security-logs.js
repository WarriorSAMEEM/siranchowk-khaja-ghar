// ============================================================================
// SIRANCHOWK KHAJA GHAR — SECURITY LOGS MODULE
// ============================================================================

import { db, ref, get, query, limitToLast } from "../../js/firebase.js";
import { hasPermission } from "./auth.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";
import {
    getDateRangeFromPreset,
    paginateList,
    renderPaginationBar,
    renderDateFilterBar
} from "./analytics-utils.js";

function severityBadgeClass(sev) {
    if (sev === "critical" || sev === "high") return "badge-danger";
    if (sev === "warning") return "badge-warning";
    return "badge-info";
}

export const SecurityLogsModule = {
    async render(container) {
        if (!hasPermission("viewSecurityLogs")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Owner Authority Required</h2><p class="card-subtitle">Security Logs are restricted to the Business Owner or explicitly authorized roles.</p></section>';
            return;
        }

        container.innerHTML = '<div class="skg-admin-loading">Loading immutable security logs…</div>';

        const snap = await get(query(ref(db, "securityLogs"), limitToLast(500))).catch(() => null);
        const logs = snap && snap.exists()
            ? Object.values(snap.val() || {}).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
            : [];

        const eventTypes = [...new Set(logs.map((l) => l.eventType).filter(Boolean))].sort();

        const state = {
            preset: "30d",
            customStart: "",
            customEnd: "",
            severityFilter: "all",
            typeFilter: "all",
            search: "",
            page: 1
        };

        const draw = () => {
            const range = getDateRangeFromPreset(state.preset, state.customStart, state.customEnd);
            const q = state.search.trim().toLowerCase();

            const filtered = logs.filter((ev) => {
                const ts = Number(ev.timestamp || 0);
                if (ts < range.startMs || ts > range.endMs) return false;
                if (state.severityFilter !== "all" && ev.severity !== state.severityFilter) return false;
                if (state.typeFilter !== "all" && ev.eventType !== state.typeFilter) return false;
                if (q) {
                    const hay = `${ev.eventType} ${ev.actorEmail} ${ev.actorUid} ${ev.target} ${JSON.stringify(ev.details || {})}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });

            const pager = paginateList(filtered, state.page, 25);
            state.page = pager.page;

            const highCount = filtered.filter((e) => e.severity === "high" || e.severity === "critical").length;
            const failedAuthCount = filtered.filter((e) => String(e.eventType || "").includes("failed_") || e.eventType === "repeated_failed_logins").length;
            const accessDeniedCount = filtered.filter((e) => e.eventType === "unauthorized_admin_access" || e.eventType === "permission_denied").length;
            const deviceOrRbacCount = filtered.filter((e) => String(e.eventType || "").startsWith("device_") || String(e.eventType || "").startsWith("rbac_") || String(e.eventType || "").startsWith("staff_")).length;

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">Security Logs (${filtered.length})</h2>
                      <p class="card-subtitle">Failed authentications, repeated login alerts, unauthorized access attempts, RBAC changes, and device approvals/blocks (${Utils.escapeHTML(range.label)}).</p>
                    </div>
                    <button type="button" class="btn btn-secondary" id="skg-sec-refresh">↻ Refresh</button>
                  </div>

                  ${renderDateFilterBar(state, true)}

                  <div class="metrics-grid" style="margin-bottom:16px;">
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">High / Critical Alerts</span><span class="metric-value">${highCount}</span><span class="metric-subtext">Requires Owner review</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Failed Auth Events</span><span class="metric-value">${failedAuthCount}</span><span class="metric-subtext">Customer &amp; staff failures</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Access / Permission Denials</span><span class="metric-value">${accessDeniedCount}</span><span class="metric-subtext">Blocked route or panel attempts</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Device / RBAC / Staff Changes</span><span class="metric-value">${deviceOrRbacCount}</span><span class="metric-subtext">Trust &amp; role governance</span></div></div>
                  </div>

                  <div class="skg-admin-order-toolbar">
                    <input type="search" id="skg-sec-search" placeholder="Search event type, actor email, target, or details" value="${Utils.escapeHTML(state.search)}">
                    <select id="skg-sec-severity">
                      <option value="all" ${state.severityFilter === "all" ? "selected" : ""}>All Severities</option>
                      <option value="critical" ${state.severityFilter === "critical" ? "selected" : ""}>Critical</option>
                      <option value="high" ${state.severityFilter === "high" ? "selected" : ""}>High</option>
                      <option value="warning" ${state.severityFilter === "warning" ? "selected" : ""}>Warning</option>
                      <option value="info" ${state.severityFilter === "info" ? "selected" : ""}>Info</option>
                    </select>
                    <select id="skg-sec-type">
                      <option value="all" ${state.typeFilter === "all" ? "selected" : ""}>All Event Types</option>
                      ${eventTypes.map((t) => `<option value="${Utils.escapeHTML(t)}" ${state.typeFilter === t ? "selected" : ""}>${Utils.escapeHTML(t)}</option>`).join("")}
                    </select>
                  </div>

                  ${pager.items.length === 0 ? `
                    <div class="empty-state">
                      <div class="empty-state-icon">🛡️</div>
                      <h3 class="empty-state-title">No security events match this filter</h3>
                      <p class="empty-state-desc">Authentication failures, unauthorized access attempts, and device/RBAC security events appear here automatically.</p>
                    </div>
                  ` : `
                    <div class="table-responsive">
                      <table class="data-table">
                        <thead>
                          <tr>
                            <th>Timestamp (NPT)</th>
                            <th>Severity</th>
                            <th>Event Type</th>
                            <th>Actor</th>
                            <th>Target</th>
                            <th>Inspect</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${pager.items.map((ev) => `
                            <tr>
                              <td style="white-space:nowrap;">${Utils.escapeHTML(Utils.formatDate(ev.timestamp))}</td>
                              <td><span class="badge ${severityBadgeClass(ev.severity)}">${Utils.escapeHTML(ev.severity || "info")}</span></td>
                              <td><code>${Utils.escapeHTML(ev.eventType || "security_event")}</code></td>
                              <td>
                                <div>${Utils.escapeHTML(ev.actorEmail || ev.actorUid || "unauthenticated")}</div>
                                <span class="badge badge-info">${Utils.escapeHTML(ev.actorRole || "system")}</span>
                              </td>
                              <td><code>${Utils.escapeHTML(ev.target || "—")}</code></td>
                              <td><button type="button" class="btn btn-sm btn-secondary" data-view-sec="${Utils.escapeHTML(ev.id || "")}">Inspect</button></td>
                            </tr>
                          `).join("")}
                        </tbody>
                      </table>
                    </div>
                    ${renderPaginationBar(pager, "security-logs")}
                  `}
                </section>
              </div>
            `;

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
            container.querySelector("#skg-sec-search")?.addEventListener("input", (e) => {
                state.search = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-sec-severity")?.addEventListener("change", (e) => {
                state.severityFilter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-sec-type")?.addEventListener("change", (e) => {
                state.typeFilter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-sec-refresh")?.addEventListener("click", () => this.render(container));
            container.querySelectorAll("[data-page-nav]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    if (btn.dataset.pageNav === "prev" && state.page > 1) state.page -= 1;
                    if (btn.dataset.pageNav === "next" && state.page < pager.totalPages) state.page += 1;
                    draw();
                });
            });
            container.querySelectorAll("[data-view-sec]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const ev = filtered.find((item) => item.id === btn.dataset.viewSec);
                    if (!ev) return;
                    const detailsEntries = ev.details && typeof ev.details === "object" ? Object.entries(ev.details) : [];
                    const body = `
                      <div class="skg-customer-modal-meta">
                        <p><strong>Security Event ID:</strong> <code>${Utils.escapeHTML(ev.id || "N/A")}</code></p>
                        <p><strong>Event Type:</strong> <code>${Utils.escapeHTML(ev.eventType)}</code></p>
                        <p><strong>Severity:</strong> <span class="badge ${severityBadgeClass(ev.severity)}">${Utils.escapeHTML(ev.severity || "info")}</span></p>
                        <p><strong>Actor:</strong> ${Utils.escapeHTML(ev.actorEmail || "N/A")} (${Utils.escapeHTML(ev.actorRole || "system")})</p>
                        <p><strong>Actor UID:</strong> <code>${Utils.escapeHTML(ev.actorUid || "unauthenticated")}</code></p>
                        <p><strong>Target:</strong> <code>${Utils.escapeHTML(ev.target || "—")}</code></p>
                        <p><strong>Environment:</strong> ${Utils.escapeHTML(`${ev.deviceType || "unknown"} · ${ev.browser || "Unknown"} · ${ev.operatingSystem || "Unknown"}`)}</p>
                        <p><strong>Timestamp (NPT):</strong> ${Utils.escapeHTML(Utils.formatDate(ev.timestamp))}</p>
                      </div>
                      <h4 style="margin:14px 0 8px;">Event Details</h4>
                      ${detailsEntries.length === 0 ? '<p class="form-hint">No extra details recorded.</p>' : `
                        <div class="skg-modal-orders">
                          ${detailsEntries.map(([k, v]) => `
                            <div class="skg-modal-order-row">
                              <div><strong>${Utils.escapeHTML(k)}</strong></div>
                              <div><code>${Utils.escapeHTML(v)}</code></div>
                            </div>
                          `).join("")}
                        </div>
                      `}
                    `;
                    UIModule.openModal("Security Event Inspection", body, '<button type="button" class="btn btn-primary" id="sec-modal-close">Close</button>');
                    document.getElementById("sec-modal-close")?.addEventListener("click", () => UIModule.closeModal());
                });
            });
        };

        draw();
    }
};
