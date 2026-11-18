// ============================================================================
// SIRANCHOWK KHAJA GHAR — CUSTOMER ENGAGEMENT & ACTIVITY TIERS MODULE
// ============================================================================

import { db, ref, get } from "../../js/firebase.js";
import { hasPermission } from "./auth.js";
import { Utils } from "./utils.js";
import {
    loadAnalyticsSettings,
    classifyCustomerTier,
    maskEmail,
    renderHorizontalBreakdown,
    paginateList,
    renderPaginationBar
} from "./analytics-utils.js";

export const CustomerEngagementModule = {
    async render(container) {
        if (!hasPermission("viewCustomerEngagement")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">Customer Engagement requires the View Customer Engagement permission.</p></section>';
            return;
        }

        const canSeePII = hasPermission("viewCustomerContactDetails");
        const canSeeActivity = hasPermission("viewUserActivity");
        container.innerHTML = '<div class="skg-admin-loading">Computing DAU, WAU, MAU &amp; customer engagement tiers…</div>';

        const [usersSnap, ordersSnap, eventsSnap, cfg] = await Promise.all([
            get(ref(db, "users")).catch(() => null),
            get(ref(db, "orders")).catch(() => null),
            get(ref(db, "analytics/events")).catch(() => null),
            loadAnalyticsSettings()
        ]);

        const rawUsers = usersSnap && usersSnap.exists() ? (usersSnap.val() || {}) : {};
        const rawOrders = ordersSnap && ordersSnap.exists() ? (ordersSnap.val() || {}) : {};
        const rawEvents = eventsSnap && eventsSnap.exists() ? Object.values(eventsSnap.val() || {}) : [];
        const allOrders = Object.entries(rawOrders).map(([id, o]) => ({ id, ...(o || {}) }));

        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const dauCutoff = now - dayMs;
        const wauCutoff = now - 7 * dayMs;
        const mauCutoff = now - 30 * dayMs;

        const productViewCounts = {};
        rawEvents.filter((e) => e?.eventType === "product_view" && e.productName).forEach((e) => {
            productViewCounts[e.productName] = (productViewCounts[e.productName] || 0) + 1;
        });

        const orderedDishCounts = {};
        allOrders.filter((o) => o.status !== "cancelled").forEach((o) => {
            const items = Array.isArray(o.items) ? o.items : Object.values(o.items || {});
            items.forEach((it) => {
                if (!it?.name) return;
                orderedDishCounts[it.name] = (orderedDishCounts[it.name] || 0) + Number(it.quantity || 1);
            });
        });

        let dau = 0;
        let wau = 0;
        let mau = 0;
        let newRegs30d = 0;
        let returningCustomers30d = 0;

        const customers = Object.entries(rawUsers).map(([uid, rec]) => {
            const profile = rec?.profile || {};
            const userOrders = rec?.orders
                ? Object.entries(rec.orders).map(([id, o]) => ({ id, ...(o || {}) }))
                : allOrders.filter((o) => o.customerUid === uid);
            const activities = rec?.activity ? Object.values(rec.activity) : [];

            const lastActive = Number(profile.lastActiveAt || profile.lastLoginAt || profile.createdAt || 0);
            const createdAt = Number(profile.createdAt || 0);

            if (lastActive >= dauCutoff) dau += 1;
            if (lastActive >= wauCutoff) wau += 1;
            if (lastActive >= mauCutoff) {
                mau += 1;
                if (createdAt && createdAt < mauCutoff) returningCustomers30d += 1;
            }
            if (createdAt >= mauCutoff) newRegs30d += 1;

            const orders30 = userOrders.filter((o) => Number(o.createdAt || 0) >= mauCutoff).length;
            const logins30 = activities.filter((a) => a.type === "login" && Number(a.timestamp || 0) >= mauCutoff).length
                || (Number(profile.lastLoginAt || 0) >= mauCutoff ? Math.min(Number(profile.loginCount || 1), 1) : 0);

            const tier = classifyCustomerTier({
                ordersLast30Days: orders30,
                loginsLast30Days: logins30,
                lastActiveAt: lastActive,
                createdAt
            }, cfg, now);

            return {
                uid,
                name: profile.name || "Customer",
                email: profile.email || "",
                createdAt,
                lastActiveAt: lastActive,
                loginCount: Number(profile.loginCount || 0),
                totalOrders: userOrders.length,
                orders30,
                logins30,
                tier
            };
        });

        const totalOrdersLinked = customers.reduce((s, c) => s + c.totalOrders, 0);
        const avgOrdersPerCustomer = customers.length ? (totalOrdersLinked / customers.length).toFixed(2) : "0";
        const repeatBuyers = customers.filter((c) => c.totalOrders >= 2).sort((a, b) => b.totalOrders - a.totalOrders);
        const neverOrdered = customers.filter((c) => c.totalOrders === 0);
        const dormantList = customers.filter((c) => c.tier.key === "inactive");

        const tierCounts = {
            "Highly Active": customers.filter((c) => c.tier.key === "highly_active").length,
            "Active": customers.filter((c) => c.tier.key === "active").length,
            "Occasionally Active": customers.filter((c) => c.tier.key === "occasional").length,
            "Inactive": customers.filter((c) => c.tier.key === "inactive").length
        };

        const state = {
            tierFilter: "all",
            segmentFilter: "all",
            search: "",
            page: 1
        };

        const draw = () => {
            const q = state.search.trim().toLowerCase();
            const filtered = customers.filter((c) => {
                if (state.tierFilter !== "all" && c.tier.key !== state.tierFilter) return false;
                if (state.segmentFilter === "repeat" && c.totalOrders < 2) return false;
                if (state.segmentFilter === "never_ordered" && c.totalOrders !== 0) return false;
                if (state.segmentFilter === "dormant" && c.tier.key !== "inactive") return false;
                if (q) {
                    const hay = canSeePII ? `${c.name} ${c.email}` : c.name;
                    if (!hay.toLowerCase().includes(q)) return false;
                }
                return true;
            }).sort((a, b) => Number(b.lastActiveAt || 0) - Number(a.lastActiveAt || 0));

            const pager = paginateList(filtered, state.page, 15);
            state.page = pager.page;

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">Customer Engagement &amp; Retention</h2>
                      <p class="card-subtitle">Active customer frequency, engagement tiers (thresholds configurable in Settings), and product interest.</p>
                    </div>
                    <button type="button" class="btn btn-secondary" id="skg-ce-refresh">↻ Refresh</button>
                  </div>

                  <div class="metrics-grid">
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">DAU (24h)</span><span class="metric-value">${dau}</span><span class="metric-subtext">Daily active customers</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">WAU (7d)</span><span class="metric-value">${wau}</span><span class="metric-subtext">Weekly active customers</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">MAU (30d)</span><span class="metric-value">${mau}</span><span class="metric-subtext">Monthly active customers</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Returning vs New (30d)</span><span class="metric-value">${returningCustomers30d} / ${newRegs30d}</span><span class="metric-subtext">Retained vs new signups</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Avg Orders / Customer</span><span class="metric-value">${avgOrdersPerCustomer}</span><span class="metric-subtext">${repeatBuyers.length} repeat buyers (2+ orders)</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Registered Never Ordered</span><span class="metric-value">${neverOrdered.length}</span><span class="metric-subtext">${dormantList.length} inactive (${cfg.dormantDays}d+)</span></div></div>
                  </div>
                </section>

                <div class="analytics-grid">
                  <section class="card">
                    <div class="card-header"><div><h3 class="card-title">Customer Activity Tiers</h3><p class="card-subtitle">Based on ${cfg.highlyActiveMinOrders}+ orders (Highly Active), ${cfg.activeMinOrders}+ orders or 3+ logins (Active), and ${cfg.dormantDays}d inactivity window.</p></div></div>
                    ${renderHorizontalBreakdown(tierCounts, "No registered customers yet.")}
                  </section>
                  <section class="card">
                    <div class="card-header"><div><h3 class="card-title">Most Viewed Dishes</h3><p class="card-subtitle">Dish card clicks &amp; inspections</p></div></div>
                    ${renderHorizontalBreakdown(productViewCounts, "No dish view events recorded yet.")}
                  </section>
                  <section class="card">
                    <div class="card-header"><div><h3 class="card-title">Most Ordered Dishes</h3><p class="card-subtitle">Total units across non-cancelled orders</p></div></div>
                    ${renderHorizontalBreakdown(orderedDishCounts, "No ordered dishes recorded yet.")}
                  </section>
                </div>

                <section class="card">
                  <div class="card-header">
                    <div>
                      <h3 class="card-title">Customer Engagement Directory (${filtered.length})</h3>
                      <p class="card-subtitle">Filter customers by engagement tier, repeat purchase behavior, or inactivity.</p>
                    </div>
                  </div>
                  <div class="skg-admin-order-toolbar">
                    <input type="search" id="skg-ce-search" placeholder="Search customer" value="${Utils.escapeHTML(state.search)}">
                    <select id="skg-ce-tier">
                      <option value="all" ${state.tierFilter === "all" ? "selected" : ""}>All Activity Tiers</option>
                      <option value="highly_active" ${state.tierFilter === "highly_active" ? "selected" : ""}>Highly Active</option>
                      <option value="active" ${state.tierFilter === "active" ? "selected" : ""}>Active</option>
                      <option value="occasional" ${state.tierFilter === "occasional" ? "selected" : ""}>Occasionally Active</option>
                      <option value="inactive" ${state.tierFilter === "inactive" ? "selected" : ""}>Inactive</option>
                    </select>
                    <select id="skg-ce-segment">
                      <option value="all" ${state.segmentFilter === "all" ? "selected" : ""}>All Segments</option>
                      <option value="repeat" ${state.segmentFilter === "repeat" ? "selected" : ""}>Repeat Buyers (2+ orders)</option>
                      <option value="never_ordered" ${state.segmentFilter === "never_ordered" ? "selected" : ""}>Registered Never Ordered</option>
                      <option value="dormant" ${state.segmentFilter === "dormant" ? "selected" : ""}>Dormant Customers</option>
                    </select>
                  </div>

                  ${pager.items.length === 0 ? `
                    <div class="empty-state">
                      <div class="empty-state-icon">📈</div>
                      <h3 class="empty-state-title">No customers in this segment</h3>
                      <p class="empty-state-desc">Adjust your tier or segment filter to explore other accounts.</p>
                    </div>
                  ` : `
                    <div class="table-responsive">
                      <table class="data-table">
                        <thead>
                          <tr>
                            <th>Customer</th>
                            <th>Activity Tier</th>
                            <th>Orders (30d / All)</th>
                            <th>Logins (30d / All)</th>
                            <th>Last Active</th>
                            ${canSeeActivity ? "<th>Timeline</th>" : ""}
                          </tr>
                        </thead>
                        <tbody>
                          ${pager.items.map((c) => `
                            <tr>
                              <td>
                                <strong>${Utils.escapeHTML(c.name)}</strong>
                                <div class="form-hint">${Utils.escapeHTML(canSeePII ? (c.email || "No email") : maskEmail(c.email))}</div>
                              </td>
                              <td><span class="badge ${c.tier.badgeClass}">${Utils.escapeHTML(c.tier.label)}</span></td>
                              <td><strong>${c.orders30}</strong> (30d) / ${c.totalOrders} total</td>
                              <td><strong>${c.logins30}</strong> (30d) / ${c.loginCount} total</td>
                              <td>${Utils.escapeHTML(c.lastActiveAt ? Utils.formatDate(c.lastActiveAt) : "Not recorded")}</td>
                              ${canSeeActivity ? `<td><button type="button" class="btn btn-sm btn-secondary" data-ce-timeline="${Utils.escapeHTML(c.uid)}">View Activity</button></td>` : ""}
                            </tr>
                          `).join("")}
                        </tbody>
                      </table>
                    </div>
                    ${renderPaginationBar(pager, "customer-engagement")}
                  `}
                </section>
              </div>
            `;

            container.querySelector("#skg-ce-search")?.addEventListener("input", (e) => {
                state.search = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-ce-tier")?.addEventListener("change", (e) => {
                state.tierFilter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-ce-segment")?.addEventListener("change", (e) => {
                state.segmentFilter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-ce-refresh")?.addEventListener("click", () => this.render(container));
            container.querySelectorAll("[data-page-nav]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    if (btn.dataset.pageNav === "prev" && state.page > 1) state.page -= 1;
                    if (btn.dataset.pageNav === "next" && state.page < pager.totalPages) state.page += 1;
                    draw();
                });
            });
            container.querySelectorAll("[data-ce-timeline]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    window.__SKG_SELECTED_ACTIVITY_UID = btn.dataset.ceTimeline;
                    window.location.hash = "#user-activity";
                });
            });
        };

        draw();
    }
};
