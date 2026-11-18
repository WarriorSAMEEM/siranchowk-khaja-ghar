// ============================================================================
// SIRANCHOWK KHAJA GHAR — ADMIN ACTIVITY LOGS MODULE (IMMUTABLE AUDIT TRAIL)
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

export const AuditLogsModule = {
    async render(container) {
        if (!hasPermission("viewAuditLogs")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">Only Owner and authorized Admin roles can inspect Admin Activity Logs.</p></section>';
            return;
        }

        container.innerHTML = '<div class="skg-admin-loading">Loading immutable admin activity logs…</div>';

        const snap = await get(query(ref(db, "auditLogs"), limitToLast(500))).catch(() => null);
        const logs = snap && snap.exists()
            ? Object.values(snap.val() || {}).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
            : [];

        const roles = [...new Set(logs.map((l) => l.actorRole).filter(Boolean))];
        const actions = [...new Set(logs.map((l) => l.action).filter(Boolean))].sort();

        const state = {
            preset: "30d",
            customStart: "",
            customEnd: "",
            searchQuery: "",
            roleFilter: "all",
            actionFilter: "all",
            statusFilter: "all",
            page: 1
        };

        const draw = () => {
            const range = getDateRangeFromPreset(state.preset, state.customStart, state.customEnd);
            const q = state.searchQuery.trim().toLowerCase();

            const filtered = logs.filter((entry) => {
                const ts = Number(entry.timestamp || 0);
                if (ts < range.startMs || ts > range.endMs) return false;
                if (state.roleFilter !== "all" && entry.actorRole !== state.roleFilter) return false;
                if (state.actionFilter !== "all" && entry.action !== state.actionFilter) return false;
                const st = entry.status || "success";
                if (state.statusFilter !== "all" && st !== state.statusFilter) return false;
                if (q) {
                    const metaText = entry.metadata ? JSON.stringify(entry.metadata) : "";
                    const hay = `${entry.action} ${entry.actorName || ""} ${entry.actorEmail} ${entry.actorUid} ${entry.target} ${metaText}`.toLowerCase();
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
                      <h2 class="card-title">Admin Activity Logs (${filtered.length})</h2>
                      <p class="card-subtitle">Append-only audit trail for order updates, menu edits, inventory changes, staff provisioning, and settings (${Utils.escapeHTML(range.label)}).</p>
                    </div>
                    <button type="button" class="btn btn-secondary" id="skg-audit-refresh">↻ Refresh</button>
                  </div>

                  ${renderDateFilterBar(state, true)}

                  <div class="skg-admin-order-toolbar">
                    <input type="search" id="skg-audit-search" placeholder="Search actor, action, target ID, or metadata" value="${Utils.escapeHTML(state.searchQuery)}">
                    <select id="skg-audit-role">
                      <option value="all" ${state.roleFilter === "all" ? "selected" : ""}>All Actor Roles</option>
                      ${roles.map((r) => `<option value="${Utils.escapeHTML(r)}" ${state.roleFilter === r ? "selected" : ""}>${Utils.escapeHTML(r)}</option>`).join("")}
                    </select>
                    <select id="skg-audit-action">
                      <option value="all" ${state.actionFilter === "all" ? "selected" : ""}>All Actions</option>
                      ${actions.map((a) => `<option value="${Utils.escapeHTML(a)}" ${state.actionFilter === a ? "selected" : ""}>${Utils.escapeHTML(a)}</option>`).join("")}
                    </select>
                    <select id="skg-audit-status">
                      <option value="all" ${state.statusFilter === "all" ? "selected" : ""}>All Statuses</option>
                      <option value="success" ${state.statusFilter === "success" ? "selected" : ""}>Success</option>
                      <option value="failed" ${state.statusFilter === "failed" ? "selected" : ""}>Failed</option>
                    </select>
                  </div>

                  ${pager.items.length === 0 ? `
                    <div class="empty-state">
                      <div class="empty-state-icon">📜</div>
                      <h3 class="empty-state-title">No matching audit entries</h3>
                      <p class="empty-state-desc">Operational actions and administrative changes appear here automatically.</p>
                    </div>
                  ` : `
                    <div class="table-responsive">
                      <table class="data-table">
                        <thead>
                          <tr>
                            <th>Timestamp (NPT)</th>
                            <th>Action</th>
                            <th>Actor</th>
                            <th>Target</th>
                            <th>Status</th>
                            <th>Inspect</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${pager.items.map((ev) => {
                              const st = ev.status || "success";
                              return `
                                <tr>
                                  <td style="white-space:nowrap;">${Utils.escapeHTML(Utils.formatDate(ev.timestamp))}</td>
                                  <td><code>${Utils.escapeHTML(ev.action || "event")}</code></td>
                                  <td>
                                    <strong>${Utils.escapeHTML(ev.actorName || ev.actorEmail || ev.actorUid || "system")}</strong>
                                    <div class="form-hint">${Utils.escapeHTML(ev.actorEmail || "")}</div>
                                    <span class="badge badge-info">${Utils.escapeHTML(ev.actorRole || "system")}</span>
                                  </td>
                                  <td><code>${Utils.escapeHTML(ev.target || "—")}</code></td>
                                  <td><span class="badge ${st === "failed" ? "badge-danger" : "badge-success"}">${Utils.escapeHTML(st)}</span></td>
                                  <td>
                                    <button type="button" class="btn btn-sm btn-secondary" data-view-audit="${Utils.escapeHTML(ev.id || "")}">Details</button>
                                  </td>
                                </tr>
                              `;
                          }).join("")}
                        </tbody>
                      </table>
                    </div>
                    ${renderPaginationBar(pager, "audit-logs")}
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
            container.querySelector("#skg-audit-search")?.addEventListener("input", (e) => {
                state.searchQuery = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-audit-role")?.addEventListener("change", (e) => {
                state.roleFilter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-audit-action")?.addEventListener("change", (e) => {
                state.actionFilter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-audit-status")?.addEventListener("change", (e) => {
                state.statusFilter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-audit-refresh")?.addEventListener("click", () => this.render(container));
            container.querySelectorAll("[data-page-nav]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    if (btn.dataset.pageNav === "prev" && state.page > 1) state.page -= 1;
                    if (btn.dataset.pageNav === "next" && state.page < pager.totalPages) state.page += 1;
                    draw();
                });
            });
            container.querySelectorAll("[data-view-audit]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const ev = filtered.find((item) => item.id === btn.dataset.viewAudit);
                    if (!ev) return;
                    const metaEntries = ev.metadata && typeof ev.metadata === "object" ? Object.entries(ev.metadata) : [];
                    const body = `
                      <div class="skg-customer-modal-meta">
                        <p><strong>Log ID:</strong> <code>${Utils.escapeHTML(ev.id || "N/A")}</code></p>
                        <p><strong>Action:</strong> <code>${Utils.escapeHTML(ev.action || "event")}</code></p>
                        <p><strong>Status:</strong> ${Utils.escapeHTML(ev.status || "success")}</p>
                        <p><strong>Actor:</strong> ${Utils.escapeHTML(ev.actorName || ev.actorEmail || "system")} (${Utils.escapeHTML(ev.actorRole || "system")})</p>
                        <p><strong>Actor UID:</strong> <code>${Utils.escapeHTML(ev.actorUid || "system")}</code></p>
                        <p><strong>Target:</strong> <code>${Utils.escapeHTML(ev.target || "—")}</code></p>
                        <p><strong>Timestamp (NPT):</strong> ${Utils.escapeHTML(Utils.formatDate(ev.timestamp))}</p>
                      </div>
                      <h4 style="margin:14px 0 8px;">Metadata Details</h4>
                      ${metaEntries.length === 0 ? '<p class="form-hint">No metadata attached to this event.</p>' : `
                        <div class="skg-modal-orders">
                          ${metaEntries.map(([k, v]) => `
                            <div class="skg-modal-order-row">
                              <div><strong>${Utils.escapeHTML(k)}</strong></div>
                              <div><code>${Utils.escapeHTML(v)}</code></div>
                            </div>
                          `).join("")}
                        </div>
                      `}
                    `;
                    UIModule.openModal("Admin Activity Log Details", body, '<button type="button" class="btn btn-primary" id="audit-modal-close">Close</button>');
                    document.getElementById("audit-modal-close")?.addEventListener("click", () => UIModule.closeModal());
                });
            });
        };

        draw();
    }
};
