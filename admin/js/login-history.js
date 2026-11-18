// ============================================================================
// SIRANCHOWK KHAJA GHAR — USER LOGIN HISTORY MODULE
// ============================================================================

import { db, ref, get, query, limitToLast } from "../../js/firebase.js";
import { hasPermission } from "./auth.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";
import {
    getDateRangeFromPreset,
    maskEmail,
    paginateList,
    renderPaginationBar,
    renderDateFilterBar
} from "./analytics-utils.js";

export const LoginHistoryModule = {
    async render(container) {
        if (!hasPermission("viewLoginHistory")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Owner Authority Required</h2><p class="card-subtitle">User Login History is restricted to the Business Owner or explicitly authorized roles.</p></section>';
            return;
        }

        const canSeePII = hasPermission("viewCustomerContactDetails");
        container.innerHTML = '<div class="skg-admin-loading">Loading login history &amp; account activity metrics…</div>';

        const [loginSnap, usersSnap] = await Promise.all([
            get(query(ref(db, "loginHistory"), limitToLast(500))).catch(() => null),
            get(ref(db, "users")).catch(() => null)
        ]);

        const logs = loginSnap && loginSnap.exists()
            ? Object.values(loginSnap.val() || {}).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
            : [];
        const usersMap = usersSnap && usersSnap.exists() ? (usersSnap.val() || {}) : {};
        const profiles = Object.entries(usersMap).map(([uid, rec]) => ({ uid, ...(rec?.profile || {}) }));

        const now = Date.now();
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

        const recentlyRegisteredCount = profiles.filter((p) => Number(p.createdAt || 0) >= sevenDaysAgo).length;
        const inactiveAccountsCount = profiles.filter((p) => Number(p.lastActiveAt || p.lastLoginAt || p.createdAt || 0) < thirtyDaysAgo).length;
        const mostActiveCustomer = [...profiles].sort((a, b) => Number(b.loginCount || 0) - Number(a.loginCount || 0))[0] || null;

        const state = {
            preset: "30d",
            customStart: "",
            customEnd: "",
            search: "",
            roleFilter: "all",
            resultFilter: "all",
            page: 1
        };

        const draw = () => {
            const range = getDateRangeFromPreset(state.preset, state.customStart, state.customEnd);
            const q = state.search.trim().toLowerCase();

            const filtered = logs.filter((entry) => {
                const ts = Number(entry.timestamp || 0);
                if (ts < range.startMs || ts > range.endMs) return false;
                if (state.roleFilter !== "all" && String(entry.role || "").toLowerCase() !== state.roleFilter) return false;
                if (state.resultFilter !== "all" && entry.result !== state.resultFilter) return false;
                if (q) {
                    const hay = `${entry.name || ""} ${entry.email || ""} ${entry.uid || ""} ${entry.browser || ""} ${entry.deviceType || ""} ${entry.reason || ""}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });

            const pager = paginateList(filtered, state.page, 25);
            state.page = pager.page;

            const successCount = filtered.filter((l) => l.result === "success").length;
            const failedCount = filtered.filter((l) => l.result === "failed").length;

            // Count logins per user in selected period
            const userLoginCounts = {};
            filtered.filter((l) => l.result === "success" && l.uid !== "unauthenticated").forEach((l) => {
                const key = l.email || l.uid;
                userLoginCounts[key] = (userLoginCounts[key] || 0) + 1;
            });
            const topLoginsInRange = Object.entries(userLoginCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">User Login History (${filtered.length})</h2>
                      <p class="card-subtitle">Customer and staff sign-in attempts (${Utils.escapeHTML(range.label)}). Passwords, tokens, and secrets are never recorded.</p>
                    </div>
                    <button type="button" class="btn btn-secondary" id="skg-lh-refresh">↻ Refresh</button>
                  </div>

                  ${renderDateFilterBar(state, true)}

                  <div class="metrics-grid" style="margin-bottom:16px;">
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Successful Logins</span><span class="metric-value">${successCount}</span><span class="metric-subtext">In selected range</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Failed Attempts</span><span class="metric-value">${failedCount}</span><span class="metric-subtext">Flagged to Security Logs</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Recently Registered (7d)</span><span class="metric-value">${recentlyRegisteredCount}</span><span class="metric-subtext">New customer accounts</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Inactive Accounts (30d+)</span><span class="metric-value">${inactiveAccountsCount}</span><span class="metric-subtext">No recent login/activity</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Most Active Customer</span><span class="metric-value" style="font-size:1.1rem;">${mostActiveCustomer ? Utils.escapeHTML(mostActiveCustomer.name || "Customer") : "N/A"}</span><span class="metric-subtext">${mostActiveCustomer ? `${Number(mostActiveCustomer.loginCount || 0)} total logins` : "No customer logins yet"}</span></div></div>
                  </div>

                  ${topLoginsInRange.length ? `
                    <div class="skg-channel-note">
                      <strong>Most Frequent Logins (${Utils.escapeHTML(range.label)}):</strong>
                      ${topLoginsInRange.map(([u, cnt]) => `${Utils.escapeHTML(canSeePII ? u : maskEmail(u))} (${cnt})`).join(" • ")}
                    </div>
                  ` : ""}

                  <div class="skg-admin-order-toolbar">
                    <input type="search" id="skg-lh-search" placeholder="Search email, name, UID, browser, failure reason" value="${Utils.escapeHTML(state.search)}">
                    <select id="skg-lh-role">
                      <option value="all" ${state.roleFilter === "all" ? "selected" : ""}>All Roles</option>
                      <option value="customer" ${state.roleFilter === "customer" ? "selected" : ""}>Customer</option>
                      <option value="owner" ${state.roleFilter === "owner" ? "selected" : ""}>Owner</option>
                      <option value="admin" ${state.roleFilter === "admin" ? "selected" : ""}>Admin</option>
                      <option value="moderator" ${state.roleFilter === "moderator" ? "selected" : ""}>Moderator</option>
                      <option value="officer" ${state.roleFilter === "officer" ? "selected" : ""}>Officer</option>
                      <option value="helper" ${state.roleFilter === "helper" ? "selected" : ""}>Helper</option>
                      <option value="staff" ${state.roleFilter === "staff" ? "selected" : ""}>Unauthenticated Staff Attempt</option>
                    </select>
                    <select id="skg-lh-result">
                      <option value="all" ${state.resultFilter === "all" ? "selected" : ""}>Success &amp; Failed</option>
                      <option value="success" ${state.resultFilter === "success" ? "selected" : ""}>Success Only</option>
                      <option value="failed" ${state.resultFilter === "failed" ? "selected" : ""}>Failed Only</option>
                    </select>
                  </div>

                  ${pager.items.length === 0 ? `
                    <div class="empty-state">
                      <div class="empty-state-icon">🔑</div>
                      <h3 class="empty-state-title">No login records match this filter</h3>
                      <p class="empty-state-desc">Customer and staff sign-in attempts will appear here automatically.</p>
                    </div>
                  ` : `
                    <div class="table-responsive">
                      <table class="data-table">
                        <thead>
                          <tr>
                            <th>Timestamp (NPT)</th>
                            <th>User</th>
                            <th>Role</th>
                            <th>Method</th>
                            <th>Result</th>
                            <th>Device / Browser</th>
                            <th>Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${pager.items.map((ev) => {
                              const emailDisplay = ev.role === "customer" && !canSeePII ? maskEmail(ev.email) : (ev.email || "Not provided");
                              const actionLabel = ev.action === "logout" ? "Logout" : "Login";
                              const durSec = Number(ev.sessionDurationSec);
                              const durText = ev.action === "logout" && Number.isFinite(durSec) && durSec >= 0 ? ` · ${Math.floor(durSec / 60)}m ${durSec % 60}s` : "";
                              return `
                                <tr>
                                  <td style="white-space:nowrap;">${Utils.escapeHTML(Utils.formatDate(ev.timestamp))}</td>
                                  <td>
                                    <strong>${Utils.escapeHTML(ev.name || (ev.uid === "unauthenticated" ? "Unauthenticated" : "Account"))}</strong>
                                    <div class="form-hint">${Utils.escapeHTML(emailDisplay)}</div>
                                  </td>
                                  <td><span class="badge badge-info">${Utils.escapeHTML(ev.role || "customer")}</span></td>
                                  <td><code>${Utils.escapeHTML(ev.method || "password")}</code> <span class="form-hint">${actionLabel}${durText}</span></td>
                                  <td>
                                    <span class="badge ${ev.result === "failed" ? "badge-danger" : "badge-success"}">
                                      ${ev.result === "failed" ? "Failed" : actionLabel}
                                    </span>
                                    ${ev.reason ? `<div class="form-hint">${Utils.escapeHTML(ev.reason)}</div>` : ""}
                                  </td>
                                  <td>
                                    <div>${Utils.escapeHTML(ev.deviceType || "unknown")} · ${Utils.escapeHTML(ev.browser || "Other")}</div>
                                    <div class="form-hint">${Utils.escapeHTML(ev.operatingSystem || "Other")}</div>
                                  </td>
                                  <td>
                                    <button type="button" class="btn btn-sm btn-secondary" data-view-login="${Utils.escapeHTML(ev.id || "")}">Inspect</button>
                                  </td>
                                </tr>
                              `;
                          }).join("")}
                        </tbody>
                      </table>
                    </div>
                    ${renderPaginationBar(pager, "login-history")}
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
            container.querySelector("#skg-lh-search")?.addEventListener("input", (e) => {
                state.search = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-lh-role")?.addEventListener("change", (e) => {
                state.roleFilter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-lh-result")?.addEventListener("change", (e) => {
                state.resultFilter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-lh-refresh")?.addEventListener("click", () => this.render(container));
            container.querySelectorAll("[data-page-nav]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    if (btn.dataset.pageNav === "prev" && state.page > 1) state.page -= 1;
                    if (btn.dataset.pageNav === "next" && state.page < pager.totalPages) state.page += 1;
                    draw();
                });
            });
            container.querySelectorAll("[data-view-login]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const ev = filtered.find((item) => item.id === btn.dataset.viewLogin);
                    if (!ev) return;
                    const emailDisplay = ev.role === "customer" && !canSeePII ? maskEmail(ev.email) : (ev.email || "Not provided");
                    const durSec = Number(ev.sessionDurationSec);
                    const durLine = ev.action === "logout" && Number.isFinite(durSec) && durSec >= 0 ? `<p><strong>Session Duration:</strong> ${Math.floor(durSec / 60)}m ${durSec % 60}s</p>` : "";
                    const body = `
                      <div class="skg-customer-modal-meta">
                        <p><strong>Event ID:</strong> <code>${Utils.escapeHTML(ev.id || "N/A")}</code></p>
                        <p><strong>User UID:</strong> <code>${Utils.escapeHTML(ev.role === "customer" && !canSeePII ? "Restricted" : (ev.uid || "unauthenticated"))}</code></p>
                        <p><strong>Email:</strong> ${Utils.escapeHTML(emailDisplay)}</p>
                        <p><strong>Action / Role / Method:</strong> ${Utils.escapeHTML(ev.action || "login")} · ${Utils.escapeHTML(ev.role)} · ${Utils.escapeHTML(ev.method)}</p>
                        <p><strong>Result:</strong> ${Utils.escapeHTML(ev.result)}${ev.reason ? ` (${Utils.escapeHTML(ev.reason)})` : ""}</p>
                        ${durLine}
                        <p><strong>Environment:</strong> ${Utils.escapeHTML(`${ev.deviceType} · ${ev.browser} · ${ev.operatingSystem}`)}</p>
                        <p><strong>Session / Device ID:</strong> <code>${Utils.escapeHTML(ev.sessionId || "N/A")}</code> ${ev.deviceId ? `· <code>${Utils.escapeHTML(ev.deviceId)}</code>` : ""}</p>
                        <p><strong>Timestamp (NPT):</strong> ${Utils.escapeHTML(Utils.formatDate(ev.timestamp))}</p>
                      </div>
                    `;
                    UIModule.openModal("Login Attempt Details", body, '<button type="button" class="btn btn-primary" id="lh-modal-close">Close</button>');
                    document.getElementById("lh-modal-close")?.addEventListener("click", () => UIModule.closeModal());
                });
            });
        };

        draw();
    }
};
