// ============================================================================
// SIRANCHOWK KHAJA GHAR — ORDER ANALYTICS MODULE
// ============================================================================

import { db, ref, get } from "../../js/firebase.js";
import { hasPermission, getAdminSession } from "./auth.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";
import {
    getDateRangeFromPreset,
    formatPeriodComparison,
    dayKeyFromMs,
    monthKeyFromMs,
    enumerateDayKeys,
    maskPhone,
    downloadCSV,
    renderBarChartSVG,
    renderHorizontalBreakdown,
    renderDateFilterBar
} from "./analytics-utils.js";

function extractOrderSalesAmount(order, menuPriceMap = new Map()) {
    if (!order || order.status === "cancelled") return 0;
    const explicit = Number(order.totalAmount || order.amount || 0);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const items = Array.isArray(order.items) ? order.items : Object.values(order.items || {});
    return items.reduce((sum, item) => {
        if (!item?.name) return sum;
        const qty = Number(item.quantity || 1);
        const p = Number(item.price || menuPriceMap.get(String(item.name).toLowerCase()) || 0);
        return sum + (Number.isFinite(p) && p > 0 ? p * qty : 0);
    }, 0);
}

export const OrderAnalyticsModule = {
    async render(container) {
        if (!hasPermission("viewOrderAnalytics")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">Order Analytics requires the View Order Analytics permission.</p></section>';
            return;
        }

        const canSeePII = hasPermission("viewCustomerContactDetails");
        const canExport = hasPermission("exportReports");
        const session = getAdminSession();
        container.innerHTML = '<div class="skg-admin-loading">Loading order analytics &amp; sales breakdown…</div>';

        const [ordersSnap, menuSnap] = await Promise.all([
            get(ref(db, "orders")).catch(() => null),
            get(ref(db, "menu_items")).catch(() => null)
        ]);

        const orders = ordersSnap && ordersSnap.exists()
            ? Object.entries(ordersSnap.val() || {}).map(([id, o]) => ({ id, ...(o || {}) }))
            : [];
        const menuPriceMap = new Map();
        const menuCategoryMap = new Map();
        if (menuSnap && menuSnap.exists()) {
            Object.values(menuSnap.val() || {}).forEach((item) => {
                if (item?.name) {
                    const key = String(item.name).toLowerCase();
                    if (Number(item.price) > 0) menuPriceMap.set(key, Number(item.price));
                    if (item.category) menuCategoryMap.set(key, String(item.category));
                }
            });
        }

        const state = {
            preset: "30d",
            customStart: "",
            customEnd: "",
            statusFilter: "all",
            typeFilter: "all",
            productQuery: ""
        };

        const draw = () => {
            const range = getDateRangeFromPreset(state.preset, state.customStart, state.customEnd);
            const todayRange = getDateRangeFromPreset("today");
            const pq = state.productQuery.trim().toLowerCase();

            const matchesFilters = (o) => {
                if (state.statusFilter !== "all" && (o.status || "pending") !== state.statusFilter) return false;
                if (state.typeFilter !== "all" && String(o.orderType || "").toLowerCase() !== state.typeFilter) return false;
                if (pq) {
                    const summary = `${o.summary || ""} ${(o.customerName || "")}`.toLowerCase();
                    if (!summary.includes(pq)) return false;
                }
                return true;
            };

            const todayOrdersCount = orders.filter((o) => {
                const ts = Number(o.createdAt || 0);
                return ts >= todayRange.startMs && ts <= todayRange.endMs && matchesFilters(o);
            }).length;

            const currOrders = orders.filter((o) => {
                const ts = Number(o.createdAt || 0);
                return ts >= range.startMs && ts <= range.endMs && matchesFilters(o);
            });
            const prevOrders = orders.filter((o) => {
                const ts = Number(o.createdAt || 0);
                return ts >= range.prevStartMs && ts <= range.prevEndMs && matchesFilters(o);
            });

            const statusCounts = { pending: 0, accepted: 0, preparing: 0, ready: 0, dispatched: 0, delivered: 0, cancelled: 0 };
            const typeCounts = {};
            const dishCounts = {};
            const categoryCounts = {};
            const hourCounts = Array.from({ length: 24 }, (_, h) => ({
                hour: h,
                label: `${String(h).padStart(2, "0")}:00`,
                value: 0
            }));
            const customerOrderCounts = new Map();
            let grossSalesRevenue = 0;
            let pricedOrdersCount = 0;

            currOrders.forEach((o) => {
                const st = o.status || "pending";
                statusCounts[st] = (statusCounts[st] || 0) + 1;
                const tp = o.orderType || "Pickup";
                typeCounts[tp] = (typeCounts[tp] || 0) + 1;

                const d = new Date(Number(o.createdAt || 0));
                if (!Number.isNaN(d.getTime())) {
                    const nptHour = Number(d.toLocaleString("en-US", { timeZone: "Asia/Kathmandu", hour: "2-digit", hour12: false })) % 24;
                    if (hourCounts[nptHour]) hourCounts[nptHour].value += 1;
                }

                const sales = extractOrderSalesAmount(o, menuPriceMap);
                if (sales > 0) {
                    grossSalesRevenue += sales;
                    pricedOrdersCount += 1;
                }

                if (st !== "cancelled") {
                    const items = Array.isArray(o.items) ? o.items : Object.values(o.items || {});
                    items.forEach((it) => {
                        if (!it?.name) return;
                        const qty = Number(it.quantity || 1);
                        dishCounts[it.name] = (dishCounts[it.name] || 0) + qty;
                        const cat = it.category || menuCategoryMap.get(String(it.name).toLowerCase()) || "Uncategorized";
                        categoryCounts[cat] = (categoryCounts[cat] || 0) + qty;
                    });
                }

                const custKey = o.customerUid || o.customerPhone || o.customerName;
                if (custKey) {
                    const existing = customerOrderCounts.get(custKey) || {
                        name: o.customerName || "Customer",
                        phone: o.customerPhone || "",
                        uid: o.customerUid || "",
                        count: 0,
                        spend: 0
                    };
                    existing.count += 1;
                    existing.spend += sales;
                    customerOrderCounts.set(custKey, existing);
                }
            });

            const total = currOrders.length;
            const completed = statusCounts.delivered;
            const cancelled = statusCounts.cancelled;
            const pendingAndActive = total - completed - cancelled;
            const completionRate = total ? Math.round((completed / total) * 100) : 0;
            const cancellationRate = total ? Math.round((cancelled / total) * 100) : 0;
            const avgOrderValue = pricedOrdersCount ? Math.round(grossSalesRevenue / pricedOrdersCount) : null;

            const cmpOrders = formatPeriodComparison(total, prevOrders.length);
            const uniqueBuyersCount = customerOrderCounts.size;
            const repeatCustomers = [...customerOrderCounts.values()]
                .filter((c) => c.count >= 2)
                .sort((a, b) => b.count - a.count);
            const repeatRatePct = uniqueBuyersCount ? Math.round((repeatCustomers.length / uniqueBuyersCount) * 100) : 0;
            const peakHourEntry = [...hourCounts].sort((a, b) => b.value - a.value)[0];

            // Daily bars
            const dayKeys = enumerateDayKeys(range.startMs, range.endMs);
            const dailyMap = {};
            dayKeys.forEach((k) => { dailyMap[k] = 0; });
            currOrders.forEach((o) => {
                const k = dayKeyFromMs(o.createdAt);
                if (dailyMap[k] !== undefined) dailyMap[k] += 1;
            });
            const dailyBars = dayKeys.map((k) => ({ label: k.slice(5), value: dailyMap[k] }));

            // Monthly bars across all matching orders
            const monthlyMap = {};
            orders.filter(matchesFilters).forEach((o) => {
                const mk = monthKeyFromMs(o.createdAt);
                if (mk !== "unknown") monthlyMap[mk] = (monthlyMap[mk] || 0) + 1;
            });
            const monthlyBars = Object.entries(monthlyMap)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .slice(-12)
                .map(([label, value]) => ({ label, value }));

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">Order Analytics (${Utils.escapeHTML(range.label)})</h2>
                      <p class="card-subtitle">Order lifecycle volume, peak ordering hours (NPT), categories, completion rates, and gross sales revenue.</p>
                    </div>
                    <div class="skg-quick-actions">
                      ${canExport && currOrders.length ? '<button type="button" class="btn btn-primary" id="skg-oa-export">⬇ Export CSV</button>' : ""}
                      <button type="button" class="btn btn-secondary" id="skg-oa-refresh">↻ Refresh</button>
                    </div>
                  </div>

                  ${renderDateFilterBar(state, true)}

                  <div class="skg-admin-order-toolbar">
                    <input type="search" id="skg-oa-search" placeholder="Filter by dish name or customer" value="${Utils.escapeHTML(state.productQuery)}">
                    <select id="skg-oa-status">
                      <option value="all" ${state.statusFilter === "all" ? "selected" : ""}>All Statuses</option>
                      ${Object.keys(statusCounts).map((s) => `<option value="${s}" ${state.statusFilter === s ? "selected" : ""}>${Utils.escapeHTML(s)}</option>`).join("")}
                    </select>
                    <select id="skg-oa-type">
                      <option value="all" ${state.typeFilter === "all" ? "selected" : ""}>All Order Methods</option>
                      <option value="pickup" ${state.typeFilter === "pickup" ? "selected" : ""}>Pickup</option>
                      <option value="delivery" ${state.typeFilter === "delivery" ? "selected" : ""}>Delivery</option>
                      <option value="dine-in" ${state.typeFilter === "dine-in" ? "selected" : ""}>Dine-in</option>
                    </select>
                  </div>
                </section>

                ${orders.length === 0 ? `
                  <section class="card">
                    <div class="empty-state">
                      <div class="empty-state-icon">🧾</div>
                      <h3 class="empty-state-title">No Website Orders Recorded Yet</h3>
                      <p class="empty-state-desc">Order analytics and sales summaries appear automatically once customers submit orders.</p>
                    </div>
                  </section>
                ` : `
                  <div class="metrics-grid">
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Total Orders (${Utils.escapeHTML(range.label)})</span><span class="metric-value">${total}</span><span class="metric-subtext ${cmpOrders.cssClass}">${Utils.escapeHTML(cmpOrders.text)}</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Today's Orders</span><span class="metric-value">${todayOrdersCount}</span><span class="metric-subtext">Orders placed today</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Delivered / Completed</span><span class="metric-value">${completed}</span><span class="metric-subtext">Completion rate: ${completionRate}%</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Active Pipeline</span><span class="metric-value">${pendingAndActive}</span><span class="metric-subtext">Confirmed: ${statusCounts.accepted} · Prep: ${statusCounts.preparing} · Ready: ${statusCounts.ready}</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Cancelled</span><span class="metric-value">${cancelled}</span><span class="metric-subtext">Cancellation rate: ${cancellationRate}%</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Total Sales Revenue</span><span class="metric-value">${grossSalesRevenue > 0 ? `Rs. ${grossSalesRevenue.toLocaleString()}` : "Rs. 0"}</span><span class="metric-subtext">Gross sales only (not net profit); ${pricedOrdersCount} priced</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Average Order Value</span><span class="metric-value">${avgOrderValue ? `Rs. ${avgOrderValue.toLocaleString()}` : "N/A"}</span><span class="metric-subtext">Across priced orders</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Repeat Customer Rate</span><span class="metric-value">${repeatRatePct}%</span><span class="metric-subtext">${repeatCustomers.length} repeat / ${uniqueBuyersCount} buyer(s)</span></div></div>
                  </div>

                  <div class="skg-overview-split">
                    <section class="card">
                      <div class="card-header"><div><h3 class="card-title">Orders by Day</h3><p class="card-subtitle">Daily order requests in selected range</p></div></div>
                      ${renderBarChartSVG(dailyBars, "Daily orders chart")}
                    </section>
                    <section class="card">
                      <div class="card-header"><div><h3 class="card-title">Peak Ordering Hours (NPT)</h3><p class="card-subtitle">${peakHourEntry?.value ? `Peak hour: ${peakHourEntry.label} (${peakHourEntry.value} order(s))` : "Hourly distribution across the day"}</p></div></div>
                      ${renderBarChartSVG(hourCounts.slice(6, 23), "Peak ordering hours chart")}
                    </section>
                  </div>

                  <section class="card">
                    <div class="card-header"><div><h3 class="card-title">Orders by Month</h3><p class="card-subtitle">Historical monthly order trend</p></div></div>
                    ${renderBarChartSVG(monthlyBars, "Monthly orders chart")}
                  </section>

                  <div class="analytics-grid">
                    <section class="card">
                      <div class="card-header"><div><h3 class="card-title">Order Status Breakdown</h3><p class="card-subtitle">By lifecycle stage</p></div></div>
                      ${renderHorizontalBreakdown(statusCounts, "No orders in this filter.")}
                    </section>
                    <section class="card">
                      <div class="card-header"><div><h3 class="card-title">Most Ordered Categories</h3><p class="card-subtitle">Grouped by menu category</p></div></div>
                      ${renderHorizontalBreakdown(categoryCounts, "No categorized items in this range.")}
                    </section>
                    <section class="card">
                      <div class="card-header"><div><h3 class="card-title">Top Ordered Dishes</h3><p class="card-subtitle">Non-cancelled item quantities</p></div></div>
                      ${renderHorizontalBreakdown(dishCounts, "No ordered dishes in this range.")}
                    </section>
                    <section class="card">
                      <div class="card-header"><div><h3 class="card-title">Order Method Breakdown</h3><p class="card-subtitle">Pickup vs Delivery vs Dine-in</p></div></div>
                      ${renderHorizontalBreakdown(typeCounts, "No orders in this filter.")}
                    </section>
                  </div>

                  <section class="card">
                    <div class="card-header">
                      <div>
                        <h3 class="card-title">Repeat Order Customers (${repeatCustomers.length})</h3>
                        <p class="card-subtitle">Customers with 2+ orders in the selected period</p>
                      </div>
                    </div>
                    ${repeatCustomers.length === 0 ? '<p class="form-hint">No repeat order customers found in this date range.</p>' : `
                      <div class="table-responsive">
                        <table class="data-table">
                          <thead><tr><th>Customer</th><th>Phone</th><th>Orders</th><th>Gross Sales</th></tr></thead>
                          <tbody>
                            ${repeatCustomers.slice(0, 20).map((rc) => `
                              <tr>
                                <td><strong>${Utils.escapeHTML(rc.name)}</strong></td>
                                <td>${Utils.escapeHTML(canSeePII ? (rc.phone || "Not provided") : maskPhone(rc.phone))}</td>
                                <td><span class="badge badge-success">${rc.count} orders</span></td>
                                <td>${rc.spend > 0 ? `Rs. ${rc.spend.toLocaleString()}` : "Counter priced"}</td>
                              </tr>
                            `).join("")}
                          </tbody>
                        </table>
                      </div>
                    `}
                  </section>
                `}
              </div>
            `;

            container.querySelectorAll("[data-date-preset]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    state.preset = btn.dataset.datePreset;
                    draw();
                });
            });
            container.querySelector("#skg-apply-custom-dates")?.addEventListener("click", () => {
                state.customStart = container.querySelector("#skg-custom-start")?.value || "";
                state.customEnd = container.querySelector("#skg-custom-end")?.value || "";
                draw();
            });
            container.querySelector("#skg-oa-search")?.addEventListener("input", (e) => {
                state.productQuery = e.target.value;
                draw();
            });
            container.querySelector("#skg-oa-status")?.addEventListener("change", (e) => {
                state.statusFilter = e.target.value;
                draw();
            });
            container.querySelector("#skg-oa-type")?.addEventListener("change", (e) => {
                state.typeFilter = e.target.value;
                draw();
            });
            container.querySelector("#skg-oa-refresh")?.addEventListener("click", () => this.render(container));
            container.querySelector("#skg-oa-export")?.addEventListener("click", async () => {
                const headers = ["Order ID", "Date (NPT)", "Customer", "Phone", "Type", "Status", "Sales (NPR)", "Summary"];
                const rows = currOrders.map((o) => [
                    o.id,
                    Utils.formatDate(o.createdAt),
                    o.customerName || "Customer",
                    canSeePII ? (o.customerPhone || "Not provided") : maskPhone(o.customerPhone),
                    o.orderType || "Pickup",
                    o.status || "pending",
                    extractOrderSalesAmount(o, menuPriceMap),
                    o.summary || ""
                ]);
                downloadCSV(`siranchowk_order_analytics_${state.preset}.csv`, headers, rows);
                await logAuditEvent({
                    actorUid: session?.user?.uid,
                    actorEmail: session?.user?.email,
                    actorRole: session?.role,
                    action: "order_analytics_exported",
                    target: state.preset,
                    metadata: { rows: rows.length }
                });
                UIModule.showToast("Order analytics CSV exported.", "success");
            });
        };

        draw();
    }
};
