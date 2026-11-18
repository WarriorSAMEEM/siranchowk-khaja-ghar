// ============================================================================
// SIRANCHOWK KHAJA GHAR — VISITOR SESSION ANALYTICS MODULE
// ============================================================================

import { db, ref, get } from "../../js/firebase.js";
import { hasPermission } from "./auth.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";
import {
    getDateRangeFromPreset,
    formatDuration,
    paginateList,
    renderPaginationBar,
    renderDateFilterBar
} from "./analytics-utils.js";

export const VisitorAnalyticsModule = {
    async render(container) {
        if (!hasPermission("viewVisitorAnalytics")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Owner Authority Required</h2><p class="card-subtitle">Anonymous Visitor Session logs are restricted to the Owner or explicitly permitted roles.</p></section>';
            return;
        }

        container.innerHTML = '<div class="skg-admin-loading">Loading visitor sessions &amp; profiles…</div>';

        const [sessionsSnap, profilesSnap] = await Promise.all([
            get(ref(db, "visitorSessions")).catch(() => null),
            get(ref(db, "visitorProfiles")).catch(() => null)
        ]);

        const rawSessions = sessionsSnap && sessionsSnap.exists() ? Object.values(sessionsSnap.val() || {}) : [];
        const profilesMap = profilesSnap && profilesSnap.exists() ? (profilesSnap.val() || {}) : {};

        const sessions = rawSessions
            .map((s) => {
                const profile = profilesMap[s.visitorId] || {};
                const pages = s.pagesVisited ? Object.values(s.pagesVisited) : [];
                return {
                    ...s,
                    firstVisitAt: Number(profile.firstVisitAt || s.startTime || 0),
                    lastVisitAt: Number(profile.lastVisitAt || s.lastActivityAt || s.startTime || 0),
                    totalVisitsForVisitor: Number(profile.visitCount || 1),
                    pagesList: pages
                };
            })
            .sort((a, b) => Number(b.startTime || 0) - Number(a.startTime || 0));

        const state = {
            preset: "7d",
            customStart: "",
            customEnd: "",
            search: "",
            deviceFilter: "all",
            visitorType: "all",
            page: 1
        };

        const draw = () => {
            const range = getDateRangeFromPreset(state.preset, state.customStart, state.customEnd);
            const now = Date.now();
            const q = state.search.trim().toLowerCase();

            const filtered = sessions.filter((s) => {
                const ts = Number(s.startTime || 0);
                if (ts < range.startMs || ts > range.endMs) return false;
                if (state.deviceFilter !== "all" && String(s.device || "").toLowerCase() !== state.deviceFilter) return false;
                if (state.visitorType === "new" && s.isReturning) return false;
                if (state.visitorType === "returning" && !s.isReturning) return false;
                if (q) {
                    const hay = `${s.visitorId} ${s.sessionId} ${s.landingPage} ${s.browser} ${s.operatingSystem}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });

            const pager = paginateList(filtered, state.page, 20);
            state.page = pager.page;

            const activeNowCount = filtered.filter((s) => !s.endTime && (now - Number(s.lastActivityAt || 0)) <= 5 * 60 * 1000).length;
            const avgPages = filtered.length
                ? (filtered.reduce((sum, s) => sum + Number(s.pageCount || 1), 0) / filtered.length).toFixed(1)
                : "0";
            const avgDur = filtered.length
                ? Math.round(filtered.reduce((sum, s) => sum + Number(s.estimatedDurationSec || 0), 0) / filtered.length)
                : 0;

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">Visitor Analytics (${filtered.length} sessions)</h2>
                      <p class="card-subtitle">Anonymous first-party visitor sessions &amp; page journeys (${Utils.escapeHTML(range.label)}).</p>
                    </div>
                    <button type="button" class="btn btn-secondary" id="skg-vis-refresh">↻ Refresh</button>
                  </div>

                  <div class="skg-channel-note">
                    <strong>Privacy &amp; Estimation Notice:</strong> Visitor IDs are random first-party identifiers (zero fingerprinting, zero PII). Session duration is estimated from active tab visibility (60s heartbeat + unload events) and respects browser Do Not Track &amp; opt-out preferences.
                  </div>

                  ${renderDateFilterBar(state, true)}

                  <div class="skg-admin-order-toolbar">
                    <input type="search" id="skg-vis-search" placeholder="Search Visitor ID, Session ID, landing page, browser" value="${Utils.escapeHTML(state.search)}">
                    <select id="skg-vis-device">
                      <option value="all" ${state.deviceFilter === "all" ? "selected" : ""}>All Devices</option>
                      <option value="mobile" ${state.deviceFilter === "mobile" ? "selected" : ""}>Mobile</option>
                      <option value="desktop" ${state.deviceFilter === "desktop" ? "selected" : ""}>Desktop</option>
                      <option value="tablet" ${state.deviceFilter === "tablet" ? "selected" : ""}>Tablet</option>
                    </select>
                    <select id="skg-vis-type">
                      <option value="all" ${state.visitorType === "all" ? "selected" : ""}>New &amp; Returning</option>
                      <option value="new" ${state.visitorType === "new" ? "selected" : ""}>New Visitors Only</option>
                      <option value="returning" ${state.visitorType === "returning" ? "selected" : ""}>Returning Visitors Only</option>
                    </select>
                  </div>

                  <div class="metrics-grid" style="margin-bottom:16px;">
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Sessions in Range</span><span class="metric-value">${filtered.length}</span><span class="metric-subtext">30-min rolling window</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Active Now (5m)</span><span class="metric-value">${activeNowCount}</span><span class="metric-subtext">Current active tabs</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Avg Pages / Session</span><span class="metric-value">${avgPages}</span><span class="metric-subtext">Browse depth</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Avg Estimated Duration</span><span class="metric-value">${Utils.escapeHTML(formatDuration(avgDur))}</span><span class="metric-subtext">Visible active time</span></div></div>
                  </div>

                  ${pager.items.length === 0 ? `
                    <div class="empty-state">
                      <div class="empty-state-icon">🧭</div>
                      <h3 class="empty-state-title">No visitor sessions match this filter</h3>
                      <p class="empty-state-desc">Anonymous website sessions appear here once visitors browse public pages.</p>
                    </div>
                  ` : `
                    <div class="table-responsive">
                      <table class="data-table">
                        <thead>
                          <tr>
                            <th>Visitor ID</th>
                            <th>First Visit</th>
                            <th>Last Visit</th>
                            <th>Pages Viewed</th>
                            <th>Session Duration (Est.)</th>
                            <th>Device</th>
                            <th>Journey</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${pager.items.map((s) => {
                              const isLive = !s.endTime && (now - Number(s.lastActivityAt || 0)) <= 5 * 60 * 1000;
                              return `
                                <tr>
                                  <td>
                                    <code>${Utils.escapeHTML(s.visitorId || "N/A")}</code>
                                    <div>
                                      <span class="badge ${s.isReturning ? "badge-info" : "badge-success"}">${s.isReturning ? `Returning (${s.totalVisitsForVisitor}x)` : "New"}</span>
                                      ${isLive ? '<span class="badge badge-success">Active Now</span>' : ""}
                                    </div>
                                  </td>
                                  <td>${Utils.escapeHTML(Utils.formatDate(s.firstVisitAt))}</td>
                                  <td>${Utils.escapeHTML(Utils.formatDate(s.lastVisitAt))}</td>
                                  <td>
                                    <strong>${Number(s.pageCount || 1)}</strong>
                                    <div class="form-hint">${Utils.escapeHTML(s.landingPage || "/")} → ${Utils.escapeHTML(s.lastPage || "/")}</div>
                                  </td>
                                  <td>${Utils.escapeHTML(formatDuration(s.estimatedDurationSec || 0))}</td>
                                  <td>
                                    <strong>${Utils.escapeHTML(s.device || "unknown")}</strong>
                                    <div class="form-hint">${Utils.escapeHTML(s.browser || "Other")} · ${Utils.escapeHTML(s.operatingSystem || "Other")}</div>
                                  </td>
                                  <td>
                                    <button type="button" class="btn btn-sm btn-secondary" data-view-session="${Utils.escapeHTML(s.sessionId)}">Inspect</button>
                                  </td>
                                </tr>
                              `;
                          }).join("")}
                        </tbody>
                      </table>
                    </div>
                    ${renderPaginationBar(pager, "visitor-sessions")}
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
            container.querySelector("#skg-vis-search")?.addEventListener("input", (e) => {
                state.search = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-vis-device")?.addEventListener("change", (e) => {
                state.deviceFilter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-vis-type")?.addEventListener("change", (e) => {
                state.visitorType = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-vis-refresh")?.addEventListener("click", () => this.render(container));

            container.querySelectorAll("[data-page-nav]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    if (btn.dataset.pageNav === "prev" && state.page > 1) state.page -= 1;
                    if (btn.dataset.pageNav === "next" && state.page < pager.totalPages) state.page += 1;
                    draw();
                });
            });

            container.querySelectorAll("[data-view-session]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const s = filtered.find((item) => item.sessionId === btn.dataset.viewSession);
                    if (!s) return;
                    const pages = [...(s.pagesList || [])].sort((a, b) => Number(a.lastVisitedAt || 0) - Number(b.lastVisitedAt || 0));
                    const body = `
                      <div class="skg-customer-modal-meta">
                        <p><strong>Visitor ID:</strong> <code>${Utils.escapeHTML(s.visitorId)}</code></p>
                        <p><strong>Session ID:</strong> <code>${Utils.escapeHTML(s.sessionId)}</code></p>
                        <p><strong>Started:</strong> ${Utils.escapeHTML(Utils.formatDate(s.startTime))}</p>
                        <p><strong>Last Heartbeat:</strong> ${Utils.escapeHTML(Utils.formatDate(s.lastActivityAt))}</p>
                        <p><strong>Estimated Duration:</strong> ${Utils.escapeHTML(formatDuration(s.estimatedDurationSec || 0))}</p>
                        <p><strong>Device / Browser / OS:</strong> ${Utils.escapeHTML(`${s.device || "unknown"} · ${s.browser || "Other"} · ${s.operatingSystem || "Other"}`)}</p>
                        <p><strong>Referrer Source:</strong> ${Utils.escapeHTML(s.referrerHost || "Direct")}</p>
                      </div>
                      <h4 style="margin:14px 0 8px;">Pages Visited in Session (${pages.length})</h4>
                      ${pages.length === 0 ? '<p class="form-hint">No detailed page breakdown recorded for this session.</p>' : `
                        <div class="skg-modal-orders">
                          ${pages.map((p) => `
                            <div class="skg-modal-order-row">
                              <div>
                                <strong>${Utils.escapeHTML(p.path || "/")}</strong>
                                <span>Views: ${Number(p.views || 1)}</span>
                              </div>
                              <div>
                                <span class="badge badge-info">${Utils.escapeHTML(formatDuration(p.estimatedDurationSec || 0))} est.</span>
                                <small>${Utils.escapeHTML(Utils.formatDate(p.lastVisitedAt))}</small>
                              </div>
                            </div>
                          `).join("")}
                        </div>
                      `}
                    `;
                    UIModule.openModal("Visitor Session Journey", body, '<button type="button" class="btn btn-primary" id="vis-modal-close">Close</button>');
                    document.getElementById("vis-modal-close")?.addEventListener("click", () => UIModule.closeModal());
                });
            });
        };

        draw();
    }
};
