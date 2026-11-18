// ============================================================================
// SIRANCHOWK KHAJA GHAR — CUSTOMER MANAGEMENT MODULE (REAL DATA + PII RBAC)
// ============================================================================

import { db, ref, get, query, limitToLast } from "../../js/firebase.js";
import { hasPermission } from "./auth.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";
import { formatDuration, maskEmail, maskPhone, paginateList, renderPaginationBar } from "./analytics-utils.js";

function computeOrderRevenue(order) {
    if (!order || order.status === "cancelled") return 0;
    const explicit = Number(order.totalAmount || order.amount || 0);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    if (Array.isArray(order.items)) {
        return order.items.reduce((sum, item) => {
            const p = Number(item?.price || 0);
            const q = Number(item?.quantity || 1);
            return sum + (Number.isFinite(p) && p > 0 ? p * q : 0);
        }, 0);
    }
    return 0;
}

export const CustomersModule = {
    async render(container) {
        if (!hasPermission("viewCustomers")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">Your role does not permit viewing customer account data.</p></section>';
            return;
        }

        const canSeePII = hasPermission("viewCustomerContactDetails");
        const canSeeActivity = hasPermission("viewUserActivity");
        const canSeeLogins = hasPermission("viewLoginHistory");

        container.innerHTML = '<div class="skg-admin-loading">Loading customer intelligence directory…</div>';

        const [usersSnap, ordersSnap, loginsSnap] = await Promise.all([
            get(ref(db, "users")).catch(() => null),
            get(ref(db, "orders")).catch(() => null),
            canSeeLogins ? get(query(ref(db, "loginHistory"), limitToLast(600))).catch(() => null) : Promise.resolve(null)
        ]);

        const rawUsers = usersSnap && usersSnap.exists() ? usersSnap.val() : {};
        const rawOrders = ordersSnap && ordersSnap.exists() ? ordersSnap.val() : {};
        const ordersList = Object.entries(rawOrders || {}).map(([id, o]) => ({ id, ...(o || {}) }));
        const loginRecords = loginsSnap && loginsSnap.exists() ? Object.values(loginsSnap.val() || {}) : [];

        const sessionDurationByUid = new Map();
        const lastLogoutByUid = new Map();
        loginRecords.forEach((ev) => {
            if (!ev?.uid || ev.uid === "unauthenticated") return;
            if (ev.action === "logout") {
                const prevTs = lastLogoutByUid.get(ev.uid) || 0;
                if (Number(ev.timestamp || 0) > prevTs) lastLogoutByUid.set(ev.uid, Number(ev.timestamp || 0));
                if (Number.isFinite(Number(ev.sessionDurationSec)) && Number(ev.sessionDurationSec) >= 0) {
                    const entry = sessionDurationByUid.get(ev.uid) || { totalSec: 0, count: 0 };
                    entry.totalSec += Number(ev.sessionDurationSec);
                    entry.count += 1;
                    sessionDurationByUid.set(ev.uid, entry);
                }
            }
        });

        const nowMs = Date.now();
        const thirtyDaysAgoMs = nowMs - 30 * 24 * 60 * 60 * 1000;

        const customers = Object.entries(rawUsers || {}).map(([uid, record]) => {
            const profile = record?.profile || {};
            const devicesMap = record?.devices || {};
            const devices = Object.values(devicesMap).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
            const userOrders = record?.orders
                ? Object.entries(record.orders).map(([id, o]) => ({ id, ...(o || {}) }))
                : ordersList.filter((o) => o.customerUid === uid);
            userOrders.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

            const completedOrders = userOrders.filter((o) => o.status === "delivered");
            const cancelledOrders = userOrders.filter((o) => o.status === "cancelled");
            const productFreq = {};
            let totalSpent = 0;
            let pricedOrderCount = 0;
            userOrders.forEach((o) => {
                const amt = computeOrderRevenue(o);
                if (amt > 0) {
                    totalSpent += amt;
                    pricedOrderCount += 1;
                }
                if (o.status !== "cancelled") {
                    const items = Array.isArray(o.items) ? o.items : Object.values(o.items || {});
                    items.forEach((it) => {
                        if (!it?.name) return;
                        productFreq[it.name] = (productFreq[it.name] || 0) + Number(it.quantity || 1);
                    });
                }
            });
            const frequentProducts = Object.entries(productFreq).sort((a, b) => b[1] - a[1]);
            const avgOrderValue = pricedOrderCount > 0 ? Math.round(totalSpent / pricedOrderCount) : null;

            const durAgg = sessionDurationByUid.get(uid);
            const avgAuthSessionSec = durAgg && durAgg.count > 0
                ? Math.round(durAgg.totalSec / durAgg.count)
                : (Number.isFinite(Number(profile.lastSessionDurationSec)) ? Number(profile.lastSessionDurationSec) : null);
            const lastLogoutAt = lastLogoutByUid.get(uid) || profile.lastLogoutAt || null;

            return {
                uid,
                name: profile.name || "Not provided",
                email: profile.email || "",
                phone: profile.phone || "",
                address: profile.address || "",
                authProvider: profile.authProvider || "password",
                accountStatus: profile.accountStatus || "active",
                createdAt: profile.createdAt || null,
                lastLoginAt: profile.lastLoginAt || null,
                lastLogoutAt,
                lastActiveAt: profile.lastActiveAt || profile.lastLoginAt || profile.createdAt || null,
                loginCount: Number(profile.loginCount || 0),
                avgAuthSessionSec,
                prefs: profile.notificationPreferences || {},
                devices,
                orders: userOrders,
                frequentProducts,
                completedCount: completedOrders.length,
                cancelledCount: cancelledOrders.length,
                lastOrderDate: userOrders[0]?.createdAt || null,
                totalSpent,
                avgOrderValue
            };
        });

        const state = {
            query: "",
            filter: "all",
            sort: "newest",
            page: 1
        };

        const draw = () => {
            const q = state.query.trim().toLowerCase();

            const filtered = customers.filter((c) => {
                const lastActive = Number(c.lastActiveAt || 0);
                if (state.filter === "new" && !(Number(c.createdAt || 0) >= thirtyDaysAgoMs && c.orders.length <= 1)) return false;
                if (state.filter === "returning" && !(c.orders.length >= 2 || c.loginCount >= 2)) return false;
                if (state.filter === "active" && !(lastActive >= thirtyDaysAgoMs)) return false;
                if (state.filter === "inactive" && !(lastActive < thirtyDaysAgoMs)) return false;
                if (state.filter === "with_orders" && c.orders.length === 0) return false;
                if (state.filter === "no_orders" && c.orders.length > 0) return false;
                if (state.filter === "opted_in" && !c.prefs?.offersOptIn) return false;
                if (q) {
                    const searchable = canSeePII
                        ? `${c.name} ${c.email} ${c.phone} ${c.uid} ${c.address}`
                        : `${c.name}`;
                    if (!searchable.toLowerCase().includes(q)) return false;
                }
                return true;
            });

            filtered.sort((a, b) => {
                if (state.sort === "orders") return b.orders.length - a.orders.length;
                if (state.sort === "spend") return b.totalSpent - a.totalSpent;
                if (state.sort === "logins") return b.loginCount - a.loginCount;
                if (state.sort === "active") return Number(b.lastActiveAt || 0) - Number(a.lastActiveAt || 0);
                return Number(b.createdAt || 0) - Number(a.createdAt || 0);
            });

            const pager = paginateList(filtered, state.page, 20);
            state.page = pager.page;

            const totalWithOrders = customers.filter((c) => c.orders.length > 0).length;
            const returningCount = customers.filter((c) => c.orders.length >= 2 || c.loginCount >= 2).length;
            const optedInCount = customers.filter((c) => c.prefs?.offersOptIn).length;
            const devicesTotal = customers.reduce((s, c) => s + c.devices.length, 0);

            container.innerHTML = `
              <section class="card">
                <div class="card-header">
                  <div>
                    <h2 class="card-title">Customer Management (${customers.length})</h2>
                    <p class="card-subtitle">
                      Registered customer profiles, registered devices, login sessions, order history, and frequently purchased dishes.
                      ${!canSeePII ? "<strong>Contact PII masked (requires View Customer Contact PII permission).</strong>" : ""}
                    </p>
                  </div>
                </div>

                <div class="metrics-grid" style="margin-bottom:16px;">
                  <div class="metric-card"><div class="metric-info"><span class="metric-label">Registered Customers</span><span class="metric-value">${customers.length}</span><span class="metric-subtext">Verified accounts</span></div></div>
                  <div class="metric-card"><div class="metric-info"><span class="metric-label">Customers With Orders</span><span class="metric-value">${totalWithOrders}</span><span class="metric-subtext">${returningCount} returning</span></div></div>
                  <div class="metric-card"><div class="metric-info"><span class="metric-label">Registered Devices</span><span class="metric-value">${devicesTotal}</span><span class="metric-subtext">Push-configured browsers</span></div></div>
                  <div class="metric-card"><div class="metric-info"><span class="metric-label">Offers Opt-In</span><span class="metric-value">${optedInCount}</span><span class="metric-subtext">Marketing subscribers</span></div></div>
                </div>

                <div class="skg-admin-order-toolbar">
                  <input type="search" id="skg-customer-search" placeholder="${canSeePII ? "Search name, email, phone, address, or UID" : "Search customer name"}" value="${Utils.escapeHTML(state.query)}">
                  <select id="skg-customer-filter">
                    <option value="all" ${state.filter === "all" ? "selected" : ""}>All Customers</option>
                    <option value="new" ${state.filter === "new" ? "selected" : ""}>New Customers (30d)</option>
                    <option value="returning" ${state.filter === "returning" ? "selected" : ""}>Returning Customers</option>
                    <option value="active" ${state.filter === "active" ? "selected" : ""}>Active Customers (30d)</option>
                    <option value="inactive" ${state.filter === "inactive" ? "selected" : ""}>Inactive Customers (30d+)</option>
                    <option value="with_orders" ${state.filter === "with_orders" ? "selected" : ""}>Has Placed Orders</option>
                    <option value="no_orders" ${state.filter === "no_orders" ? "selected" : ""}>Registered Never Ordered</option>
                    <option value="opted_in" ${state.filter === "opted_in" ? "selected" : ""}>Offers Opt-In</option>
                  </select>
                  <select id="skg-customer-sort">
                    <option value="newest" ${state.sort === "newest" ? "selected" : ""}>Sort: Newest Joined</option>
                    <option value="active" ${state.sort === "active" ? "selected" : ""}>Sort: Last Active</option>
                    <option value="orders" ${state.sort === "orders" ? "selected" : ""}>Sort: Most Orders</option>
                    <option value="spend" ${state.sort === "spend" ? "selected" : ""}>Sort: Highest Purchase Total</option>
                    <option value="logins" ${state.sort === "logins" ? "selected" : ""}>Sort: Most Logins</option>
                  </select>
                </div>

                ${pager.items.length === 0 ? `
                  <div class="empty-state">
                    <div class="empty-state-icon">👥</div>
                    <h3 class="empty-state-title">${customers.length ? "No matching customers" : "No registered customers yet"}</h3>
                    <p class="empty-state-desc">Customers appear here automatically once they create an account or sign in via Google on the customer website.</p>
                  </div>
                ` : `
                  <div class="table-responsive">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Customer</th>
                          <th>Contact &amp; Status</th>
                          <th>Sessions &amp; Activity</th>
                          <th>Orders (Done / Canc)</th>
                          <th>Purchase &amp; Last Order</th>
                          <th>Notifications &amp; Devices</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${pager.items.map((c) => {
                            const displayEmail = canSeePII ? (c.email || "Not provided") : maskEmail(c.email);
                            const displayPhone = canSeePII ? (c.phone || "Not provided") : maskPhone(c.phone);
                            return `
                              <tr>
                                <td>
                                  <strong>${Utils.escapeHTML(c.name)}</strong>
                                  <div class="form-hint">Joined: ${Utils.escapeHTML(c.createdAt ? Utils.formatShortDate(c.createdAt) : "Not provided")}</div>
                                  <div class="form-hint"><code>${Utils.escapeHTML(canSeePII ? c.uid : `${c.uid.slice(0, 6)}…`)}</code></div>
                                </td>
                                <td>
                                  <div>${Utils.escapeHTML(displayEmail)}</div>
                                  <div class="form-hint">${Utils.escapeHTML(displayPhone)}</div>
                                  <span class="badge ${c.accountStatus === "active" ? "badge-success" : "badge-danger"}">${Utils.escapeHTML(c.accountStatus)}</span>
                                </td>
                                <td>
                                  <div><strong>${c.loginCount}</strong> login(s)</div>
                                  <div class="form-hint">Last login: ${Utils.escapeHTML(c.lastLoginAt ? Utils.formatShortDate(c.lastLoginAt) : "Not recorded")}</div>
                                  <div class="form-hint">Last active: ${Utils.escapeHTML(c.lastActiveAt ? Utils.formatShortDate(c.lastActiveAt) : "Not recorded")}</div>
                                  ${c.avgAuthSessionSec !== null ? `<div class="form-hint">Avg auth duration: ${Utils.escapeHTML(formatDuration(c.avgAuthSessionSec))}</div>` : ""}
                                </td>
                                <td>
                                  <span class="badge badge-info">${c.orders.length} total</span>
                                  <div class="form-hint">${c.completedCount} completed · ${c.cancelledCount} cancelled</div>
                                </td>
                                <td>
                                  <div><strong>${c.totalSpent > 0 ? `Rs. ${c.totalSpent.toLocaleString()}` : "Counter priced"}</strong></div>
                                  <div class="form-hint">AOV: ${c.avgOrderValue ? `Rs. ${c.avgOrderValue.toLocaleString()}` : "Not available"}</div>
                                  <div class="form-hint">Last order: ${Utils.escapeHTML(c.lastOrderDate ? Utils.formatShortDate(c.lastOrderDate) : "Never")}</div>
                                </td>
                                <td>
                                  <span class="badge ${c.prefs?.offersOptIn ? "badge-success" : "badge-warning"}">${c.prefs?.offersOptIn ? "Offers Opt-In" : "Offers Off"}</span>
                                  <div class="form-hint">Order alerts: ${c.prefs?.orderAlerts === false ? "Off" : "On"}</div>
                                  <div class="form-hint">${c.devices.length} device(s) saved</div>
                                </td>
                                <td>
                                  <div class="skg-table-actions">
                                    <button type="button" class="btn btn-sm btn-secondary" data-view-customer="${Utils.escapeHTML(c.uid)}">Profile</button>
                                    ${canSeeActivity ? `<button type="button" class="btn btn-sm btn-primary" data-jump-activity="${Utils.escapeHTML(c.uid)}">Timeline</button>` : ""}
                                  </div>
                                </td>
                              </tr>
                            `;
                        }).join("")}
                      </tbody>
                    </table>
                  </div>
                  ${renderPaginationBar(pager, "customers")}
                `}
              </section>
            `;

            container.querySelector("#skg-customer-search")?.addEventListener("input", (e) => {
                state.query = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-customer-filter")?.addEventListener("change", (e) => {
                state.filter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-customer-sort")?.addEventListener("change", (e) => {
                state.sort = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelectorAll("[data-page-nav]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    if (btn.dataset.pageNav === "prev" && state.page > 1) state.page -= 1;
                    if (btn.dataset.pageNav === "next" && state.page < pager.totalPages) state.page += 1;
                    draw();
                });
            });

            container.querySelectorAll("[data-jump-activity]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    window.__SKG_SELECTED_ACTIVITY_UID = btn.dataset.jumpActivity;
                    window.location.hash = "#user-activity";
                });
            });

            container.querySelectorAll("[data-view-customer]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const customer = customers.find((c) => c.uid === btn.dataset.viewCustomer);
                    if (!customer) return;
                    const body = `
                      <div class="skg-customer-modal-meta">
                        <p><strong>Name:</strong> ${Utils.escapeHTML(customer.name)}</p>
                        <p><strong>Email:</strong> ${Utils.escapeHTML(canSeePII ? (customer.email || "Not provided") : maskEmail(customer.email))}</p>
                        <p><strong>Phone:</strong> ${Utils.escapeHTML(canSeePII ? (customer.phone || "Not provided") : maskPhone(customer.phone))}</p>
                        <p><strong>Saved Address:</strong> ${Utils.escapeHTML(canSeePII ? (customer.address || "Not provided") : "Restricted by RBAC")}</p>
                        <p><strong>Account UID:</strong> <code>${Utils.escapeHTML(canSeePII ? customer.uid : `${customer.uid.slice(0, 8)}…`)}</code></p>
                        <p><strong>Auth Provider / Status:</strong> ${Utils.escapeHTML(customer.authProvider)} · ${Utils.escapeHTML(customer.accountStatus)}</p>
                        <p><strong>Joined / Last Login / Last Logout:</strong> ${Utils.escapeHTML(customer.createdAt ? Utils.formatDate(customer.createdAt) : "Not provided")} | ${Utils.escapeHTML(customer.lastLoginAt ? Utils.formatDate(customer.lastLoginAt) : "Not recorded")} | ${Utils.escapeHTML(customer.lastLogoutAt ? Utils.formatDate(customer.lastLogoutAt) : "Not recorded")}</p>
                        <p><strong>Login Count / Avg Auth Session:</strong> ${customer.loginCount} · ${customer.avgAuthSessionSec !== null ? Utils.escapeHTML(formatDuration(customer.avgAuthSessionSec)) : "Not measured yet"}</p>
                        <p><strong>Purchase Total / AOV:</strong> ${customer.totalSpent > 0 ? `Rs. ${customer.totalSpent.toLocaleString()}` : "Counter priced"} · AOV: ${customer.avgOrderValue ? `Rs. ${customer.avgOrderValue.toLocaleString()}` : "N/A"}</p>
                      </div>

                      <h4 style="margin:14px 0 8px;">Registered Devices (${customer.devices.length})</h4>
                      ${customer.devices.length === 0 ? '<p class="form-hint">No registered push devices for this customer yet.</p>' : `
                        <div class="skg-modal-orders">
                          ${customer.devices.map((d) => `
                            <div class="skg-modal-order-row">
                              <div>
                                <strong>${Utils.escapeHTML(d.deviceName || "Browser Device")}</strong>
                                <span>${Utils.escapeHTML(d.browser || "Browser")} · ${Utils.escapeHTML(d.os || "OS")} · Updated: ${Utils.escapeHTML(d.updatedAt ? Utils.formatShortDate(d.updatedAt) : "Unknown")}</span>
                              </div>
                              <div>
                                <span class="badge ${d.enabled && d.fcmToken ? "badge-success" : "badge-warning"}">${d.enabled && d.fcmToken ? "Push Active" : "Token Inactive"}</span>
                                <small>Orders: ${d.orderAlerts === false ? "Off" : "On"} · Offers: ${d.offersOptIn ? "On" : "Off"}</small>
                              </div>
                            </div>
                          `).join("")}
                        </div>
                      `}

                      <h4 style="margin:14px 0 8px;">Frequently Purchased Dishes (${customer.frequentProducts.length})</h4>
                      ${customer.frequentProducts.length === 0 ? '<p class="form-hint">No non-cancelled item history yet.</p>' : `
                        <div class="skg-detail-pills" style="margin-bottom:10px;">
                          ${customer.frequentProducts.slice(0, 8).map(([dish, qty]) => `<span class="skg-detail-pill"><strong>${Utils.escapeHTML(dish)}:</strong> ${qty}×</span>`).join("")}
                        </div>
                      `}

                      <h4 style="margin:14px 0 8px;">Recent Purchases (${customer.orders.length})</h4>
                      ${customer.orders.length === 0 ? '<p class="form-hint">No orders linked to this customer account yet.</p>' : `
                        <div class="skg-modal-orders">
                          ${customer.orders.slice(0, 20).map((o) => `
                            <div class="skg-modal-order-row">
                              <div>
                                <strong>#${Utils.escapeHTML((o.id || "").slice(-8).toUpperCase())}</strong>
                                <span>${Utils.escapeHTML(o.summary || "Order")}</span>
                              </div>
                              <div>
                                <span class="badge badge-info">${Utils.escapeHTML(o.status || "pending")}</span>
                                <small>${Utils.escapeHTML(Utils.formatDate(o.createdAt))}</small>
                              </div>
                            </div>
                          `).join("")}
                        </div>
                      `}
                    `;
                    UIModule.openModal(`Customer Profile: ${customer.name}`, body, '<button type="button" class="btn btn-primary" id="cust-modal-close">Close</button>');
                    document.getElementById("cust-modal-close")?.addEventListener("click", () => UIModule.closeModal());
                });
            });
        };

        draw();
    }
};

if (typeof window !== "undefined") {
    window.CustomersModule = CustomersModule;
}