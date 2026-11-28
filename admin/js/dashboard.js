// ============================================================================
// SIRANCHOWK KHAJA GHAR — BUSINESS OVERVIEW / DASHBOARD MODULE
// ============================================================================

import { db, ref, get } from "../../js/firebase.js";
import { subscribeToOrders } from "./orders.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { getStockHealth } from "../../js/inventory-sync.js";
import { mergeMenuWithDefaults, isItemPriceValid } from "../../js/menu-catalog.js";
import { Utils } from "./utils.js";
import { nptStartOfDayMs } from "./analytics-utils.js";
import { formatDuration } from "./analytics-utils.js";

const DashboardModule = {
    async render(container) {
        const session = getAdminSession();
        const roleLabel = session?.roleLabel || "Staff";
        const displayName = session?.staff?.name || session?.user?.email?.split("@")[0] || "Team";
        const isPendingDevice = session?.device?.approvalStatus === "pending" && session?.role !== "owner";

        container.innerHTML = `
          ${isPendingDevice ? `
            <div class="skg-alert-banner warning">
              <div>
                <strong>Device Pending Owner Approval</strong>
                <p>This device (${Utils.escapeHTML(session.device.deviceName)}) is registered and awaiting Owner approval for full trusted-device alerts.</p>
              </div>
            </div>
          ` : ""}
          <div id="skg-owner-pending-banner"></div>
          <div id="skg-low-stock-banner"></div>
          <div id="skg-moderation-pending-banner"></div>
          <section class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Business Overview — Welcome, ${Utils.escapeHTML(displayName)}</h2>
                <p class="card-subtitle">Siranchowk Khaja Ghar executive &amp; operational summary — Signed in as ${Utils.escapeHTML(roleLabel)}.</p>
              </div>
              <span class="badge badge-success">${Utils.escapeHTML(roleLabel)} Session Active</span>
            </div>
            <div class="metrics-grid" id="skg-dashboard-metrics">
              <div class="metric-card"><div class="metric-info"><span class="metric-label">Total Orders</span><span class="metric-value">—</span><span class="metric-subtext">All website orders</span></div><div class="metric-icon-box">🧾</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">Pending Review</span><span class="metric-value">—</span><span class="metric-subtext">Awaiting confirmation</span></div><div class="metric-icon-box">🔔</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">In Kitchen</span><span class="metric-value">—</span><span class="metric-subtext">Accepted or preparing</span></div><div class="metric-icon-box">🍳</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">Verified Order Revenue</span><span class="metric-value" id="skg-metric-revenue">—</span><span class="metric-subtext" id="skg-metric-revenue-sub">Non-cancelled billed total</span></div><div class="metric-icon-box">NPR</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">Menu Products</span><span class="metric-value" id="skg-metric-products">—</span><span class="metric-subtext" id="skg-metric-products-sub">Managed dishes</span></div><div class="metric-icon-box">🍽</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">Registered Customers</span><span class="metric-value" id="skg-metric-customers">—</span><span class="metric-subtext">Customer accounts</span></div><div class="metric-icon-box">👥</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">Active Coupons</span><span class="metric-value" id="skg-metric-offers">—</span><span class="metric-subtext">Published offers</span></div><div class="metric-icon-box">🏷</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">Low / Out-of-Stock</span><span class="metric-value" id="skg-metric-low-stock">—</span><span class="metric-subtext">Items needing restock</span></div><div class="metric-icon-box">📦</div></div>
              ${hasPermission("manageCreators") || hasPermission("moderateContent") ? `<div class="metric-card"><div class="metric-info"><span class="metric-label">Community &amp; Moderation</span><span class="metric-value" id="skg-metric-community">—</span><span class="metric-subtext" id="skg-metric-community-sub">Pending reviews &amp; reports</span></div><div class="metric-icon-box">✍</div></div>` : ""}
              ${hasPermission("viewAnalytics") ? `<div class="metric-card"><div class="metric-info"><span class="metric-label">Visitors Today</span><span class="metric-value" id="skg-metric-visitors-today">—</span><span class="metric-subtext" id="skg-metric-visitors-sub">Sessions today</span></div><div class="metric-icon-box">🌐</div></div>` : ""}
              ${hasPermission("viewVisitorAnalytics") ? `<div class="metric-card"><div class="metric-info"><span class="metric-label">Active Visitors (5m)</span><span class="metric-value" id="skg-metric-active-now">—</span><span class="metric-subtext" id="skg-metric-avg-dur">Estimated dwell</span></div><div class="metric-icon-box">🟢</div></div>` : ""}
              ${hasPermission("viewSecurityLogs") ? `<div class="metric-card"><div class="metric-info"><span class="metric-label">Security Alerts (24h)</span><span class="metric-value" id="skg-metric-sec-alerts">—</span><span class="metric-subtext">High/warning events</span></div><div class="metric-icon-box">🚨</div></div>` : ""}
              ${hasPermission("manageDevices") ? `<div class="metric-card"><div class="metric-info"><span class="metric-label">Approved Devices</span><span class="metric-value" id="skg-metric-devices">—</span><span class="metric-subtext">Trusted admin sessions</span></div><div class="metric-icon-box">🛡</div></div>` : ""}
            </div>
            <div class="skg-dashboard-bottom">
              <div>
                <h3>Daily Operations &amp; Revenue Desk</h3>
                <p>Priced menu items compute itemized NPR bills automatically on checkout and in printable receipts. Any dish with an Unset price (such as Roti before pricing is published) remains blocked from online checkout until an admin saves a valid NPR rate.</p>
              </div>
              <div class="skg-quick-actions">
                <a href="#orders" class="btn btn-primary">Open Orders →</a>
                ${hasPermission("manageProducts") ? '<a href="#products" class="btn btn-secondary">Menu &amp; Pricing</a>' : ""}
                ${hasPermission("viewAnalytics") ? '<a href="#website-analytics" class="btn btn-secondary">Analytics Hub</a>' : ""}
                ${hasPermission("exportReports") ? '<a href="#reports-exports" class="btn btn-secondary">Exports</a>' : ""}
              </div>
            </div>
          </section>
          <div class="skg-overview-split">
            <section class="card">
              <div class="card-header">
                <div>
                  <h2 class="card-title">Recent Website Orders</h2>
                  <p class="card-subtitle">Latest incoming customer requests &amp; verified bills</p>
                </div>
                <a href="#orders" class="btn btn-sm btn-secondary">View All</a>
              </div>
              <div id="skg-recent-orders" class="skg-recent-orders"><p class="form-hint">Loading recent orders…</p></div>
            </section>
            <section class="card">
              <div class="card-header">
                <div>
                  <h2 class="card-title">Recent Security &amp; Staff Activity</h2>
                  <p class="card-subtitle">Latest audit entries</p>
                </div>
                ${hasPermission("viewAuditLogs") ? '<a href="#audit-logs" class="btn btn-sm btn-secondary">Full Logs</a>' : ""}
              </div>
              <div id="skg-recent-audit" class="skg-recent-orders"><p class="form-hint">Loading activity…</p></div>
            </section>
          </div>`;

        const metrics = container.querySelector("#skg-dashboard-metrics");
        const recent = container.querySelector("#skg-recent-orders");
        const auditBox = container.querySelector("#skg-recent-audit");
        const pendingBanner = container.querySelector("#skg-owner-pending-banner");
        const lowStockBanner = container.querySelector("#skg-low-stock-banner");
        const modBanner = container.querySelector("#skg-moderation-pending-banner");

        (async () => {
            try {
                const canSeeInventory = hasPermission("viewInventory") || hasPermission("manageInventory") || hasPermission("manageProducts");
                const canSeeCommunity = hasPermission("manageCreators") || hasPermission("moderateContent");
                const todayMs = nptStartOfDayMs();
                const dayAgoMs = Date.now() - 24 * 60 * 60 * 1000;

                const [
                    menuVal,
                    customerCount,
                    offerCount,
                    devices,
                    inventoryItems,
                    sessionsList,
                    securityList,
                    creatorAppsVal,
                    reportsVal,
                    publishedVal
                ] = await Promise.all([
                    get(ref(db, "menu_items")).then((s) => (s.exists() ? s.val() : {})).catch(() => ({})),
                    hasPermission("viewCustomers")
                        ? get(ref(db, "users")).then((s) => (s.exists() ? Object.keys(s.val()).length : 0)).catch(() => "—")
                        : Promise.resolve("Restricted"),
                    get(ref(db, "offers")).then((s) => (s.exists() ? Object.values(s.val()).filter((o) => o?.active !== false).length : 0)).catch(() => 0),
                    hasPermission("manageDevices")
                        ? get(ref(db, "adminDevices")).then((s) => (s.exists() ? Object.values(s.val()) : [])).catch(() => [])
                        : Promise.resolve(null),
                    canSeeInventory
                        ? get(ref(db, "inventory/items")).then((s) => (s.exists() ? Object.values(s.val() || {}) : [])).catch(() => [])
                        : Promise.resolve(null),
                    (hasPermission("viewAnalytics") || hasPermission("viewVisitorAnalytics"))
                        ? get(ref(db, "visitorSessions")).then((s) => (s.exists() ? Object.values(s.val() || {}) : [])).catch(() => [])
                        : Promise.resolve(null),
                    hasPermission("viewSecurityLogs")
                        ? get(ref(db, "securityLogs")).then((s) => (s.exists() ? Object.values(s.val() || {}) : [])).catch(() => [])
                        : Promise.resolve(null),
                    canSeeCommunity && hasPermission("manageCreators")
                        ? get(ref(db, "creatorApplications")).then((s) => (s.exists() ? Object.values(s.val() || {}) : [])).catch(() => [])
                        : Promise.resolve([]),
                    canSeeCommunity && hasPermission("moderateContent")
                        ? get(ref(db, "contentReports")).then((s) => (s.exists() ? Object.values(s.val() || {}) : [])).catch(() => [])
                        : Promise.resolve([]),
                    canSeeCommunity
                        ? get(ref(db, "publishedArticles")).then((s) => (s.exists() ? Object.keys(s.val() || {}).length : 0)).catch(() => 0)
                        : Promise.resolve(0)
                ]);

                const mergedMenu = mergeMenuWithDefaults(menuVal, {});
                const unsetCount = mergedMenu.filter((item) => !isItemPriceValid(item.price)).length;

                const prodEl = container.querySelector("#skg-metric-products");
                const prodSubEl = container.querySelector("#skg-metric-products-sub");
                const custEl = container.querySelector("#skg-metric-customers");
                const offerEl = container.querySelector("#skg-metric-offers");
                const devEl = container.querySelector("#skg-metric-devices");
                const lowStockEl = container.querySelector("#skg-metric-low-stock");
                const commEl = container.querySelector("#skg-metric-community");
                const commSubEl = container.querySelector("#skg-metric-community-sub");

                if (prodEl) prodEl.textContent = String(mergedMenu.length);
                if (prodSubEl) {
                    prodSubEl.textContent = unsetCount > 0
                        ? `${unsetCount} item price UNSET (blocked online)`
                        : "All items priced";
                }
                if (custEl) custEl.textContent = String(customerCount);
                if (offerEl) offerEl.textContent = String(offerCount);

                if (canSeeCommunity && commEl) {
                    const pendingApps = creatorAppsVal.filter((a) => ["pending", "under_review", "more_info_required"].includes(a?.status)).length;
                    const openReports = reportsVal.filter((r) => (r?.status || "open") === "open").length;
                    commEl.textContent = String(pendingApps + openReports);
                    if (commSubEl) {
                        commSubEl.textContent = `${pendingApps} creator app(s) · ${openReports} open report(s) · ${publishedVal} live post(s)`;
                    }
                    if (modBanner && (pendingApps > 0 || openReports > 0)) {
                        modBanner.innerHTML = `
                          <div class="skg-alert-banner info">
                            <div>
                              <strong>Community Attention Needed</strong>
                              <p>${pendingApps} creator application(s) awaiting review and ${openReports} open content moderation report(s).</p>
                            </div>
                            <div class="skg-quick-actions">
                              ${pendingApps > 0 && hasPermission("manageCreators") ? '<a href="#creators" class="btn btn-sm btn-primary">Review Creators</a>' : ""}
                              ${openReports > 0 && hasPermission("moderateContent") ? '<a href="#moderation" class="btn btn-sm btn-secondary">Moderation Queue</a>' : ""}
                            </div>
                          </div>`;
                    }
                }

                if (Array.isArray(sessionsList)) {
                    const now = Date.now();
                    const todaySessions = sessionsList.filter((s) => Number(s.startTime || 0) >= todayMs);
                    const activeNow = sessionsList.filter((s) => !s.endTime && (now - Number(s.lastActivityAt || 0)) <= 5 * 60 * 1000);
                    const avgSec = todaySessions.length
                        ? Math.round(todaySessions.reduce((sum, s) => sum + Number(s.estimatedDurationSec || 0), 0) / todaySessions.length)
                        : 0;
                    const visEl = container.querySelector("#skg-metric-visitors-today");
                    const visSub = container.querySelector("#skg-metric-visitors-sub");
                    const actEl = container.querySelector("#skg-metric-active-now");
                    const durEl = container.querySelector("#skg-metric-avg-dur");
                    if (visEl) visEl.textContent = String(todaySessions.length);
                    if (visSub) visSub.textContent = `${sessionsList.length} total stored sessions`;
                    if (actEl) actEl.textContent = String(activeNow.length);
                    if (durEl) durEl.textContent = `Avg today: ${formatDuration(avgSec)}`;
                }

                if (Array.isArray(securityList)) {
                    const secRecent = securityList.filter((e) => Number(e.timestamp || 0) >= dayAgoMs && ["warning", "high", "critical"].includes(e.severity));
                    const secEl = container.querySelector("#skg-metric-sec-alerts");
                    if (secEl) secEl.textContent = String(secRecent.length);
                }

                if (Array.isArray(devices)) {
                    const approvedCount = devices.filter((d) => d?.approvalStatus === "approved" && !d?.blocked).length;
                    const pendingDevices = devices.filter((d) => d?.approvalStatus === "pending" && !d?.blocked);
                    if (devEl) devEl.textContent = String(approvedCount);

                    if (pendingBanner && pendingDevices.length > 0) {
                        pendingBanner.innerHTML = `
                          <div class="skg-alert-banner info">
                            <div>
                              <strong>${pendingDevices.length} Admin Device${pendingDevices.length > 1 ? "s" : ""} Awaiting Approval</strong>
                              <p>Review newly signed-in devices in Trusted Devices to approve or reject access.</p>
                            </div>
                            <a href="#devices" class="btn btn-sm btn-primary">Review Devices</a>
                          </div>`;
                    }
                } else if (devEl) {
                    devEl.textContent = "Owner Only";
                }

                if (Array.isArray(inventoryItems)) {
                    const lowItems = inventoryItems.filter((it) => it && getStockHealth(it).code !== "ok");
                    if (lowStockEl) lowStockEl.textContent = String(lowItems.length);

                    if (lowStockBanner && lowItems.length > 0) {
                        const outCount = lowItems.filter((it) => getStockHealth(it).code === "out").length;
                        const namesPreview = lowItems.slice(0, 3).map((it) => Utils.escapeHTML(it.name)).join(", ");
                        lowStockBanner.innerHTML = `
                          <div class="skg-alert-banner warning">
                            <div>
                              <strong>${lowItems.length} Inventory Item${lowItems.length > 1 ? "s" : ""} Low or Out of Stock${outCount > 0 ? ` (${outCount} at 0)` : ""}</strong>
                              <p>${namesPreview}${lowItems.length > 3 ? ` + ${lowItems.length - 3} more` : ""}. Review stock levels and restock soon.</p>
                            </div>
                            <a href="#inventory" class="btn btn-sm btn-primary">Open Inventory</a>
                          </div>`;
                    }
                } else if (lowStockEl) {
                    lowStockEl.textContent = "Restricted";
                }

                if (auditBox) {
                    if (hasPermission("viewAuditLogs")) {
                        const auditSnap = await get(ref(db, "auditLogs")).catch(() => null);
                        const entries = auditSnap && auditSnap.exists()
                            ? Object.values(auditSnap.val()).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).slice(0, 5)
                            : [];
                        if (!entries.length) {
                            auditBox.innerHTML = '<div class="skg-recent-empty">No audit events recorded yet.</div>';
                        } else {
                            auditBox.innerHTML = entries.map((ev) => `
                              <div class="skg-recent-row">
                                <div>
                                  <strong>${Utils.escapeHTML(String(ev.action || "event").replaceAll("_", " "))}</strong>
                                  <span>${Utils.escapeHTML(ev.actorEmail || ev.actorUid || "system")} (${Utils.escapeHTML(ev.actorRole || "system")})</span>
                                </div>
                                <div>
                                  <small>${Utils.escapeHTML(Utils.formatDate(ev.timestamp))}</small>
                                </div>
                              </div>`).join("");
                        }
                    } else {
                        auditBox.innerHTML = '<div class="skg-recent-empty">Audit logs are restricted to Owner and Admin roles.</div>';
                    }
                }
            } catch (err) {
                console.warn("Secondary dashboard metrics skipped:", err);
            }
        })();

        const renderOrders = (orders, error) => {
            if (error) {
                recent.innerHTML = `<p class="skg-dashboard-error">Unable to load live orders: ${Utils.escapeHTML(error.message || "Connection error")}</p>`;
                return;
            }
            const list = Object.entries(orders || {}).sort((a, b) =>
                Number(b[1].createdAt || 0) - Number(a[1].createdAt || 0)
            );
            const count = (statuses) => list.filter(([, order]) => statuses.includes(order.status)).length;
            const values = [
                list.length,
                count(["pending"]),
                count(["accepted", "preparing", "ready", "dispatched"])
            ];
            metrics.querySelectorAll(".metric-value").forEach((node, index) => {
                if (index < 3) node.textContent = String(values[index]);
            });

            let grossRevenue = 0;
            let totalDiscounts = 0;
            let pricedCount = 0;
            list.forEach(([, order]) => {
                if (!order || order.status === "cancelled") return;
                const amt = Number(order.totalAmount || order.amount || 0);
                const disc = Number(order.discountAmount || 0);
                if (Number.isFinite(amt) && amt > 0) {
                    grossRevenue += amt;
                    pricedCount += 1;
                }
                if (Number.isFinite(disc) && disc > 0) totalDiscounts += disc;
            });

            const revEl = container.querySelector("#skg-metric-revenue");
            const revSubEl = container.querySelector("#skg-metric-revenue-sub");
            if (revEl) revEl.textContent = `Rs. ${grossRevenue.toLocaleString()}`;
            if (revSubEl) {
                revSubEl.textContent = pricedCount
                    ? `${pricedCount} priced order(s)${totalDiscounts > 0 ? ` · Rs. ${totalDiscounts.toLocaleString()} discounts` : ""}`
                    : "Awaiting priced orders";
            }

            if (!list.length) {
                recent.innerHTML = '<div class="skg-recent-empty">No website orders yet. New requests will appear here live.</div>';
                return;
            }

            recent.innerHTML = list.slice(0, 5).map(([id, order]) => {
                const amt = Number(order.totalAmount || order.amount || 0);
                return `
                  <div class="skg-recent-row">
                    <div>
                      <strong>${Utils.escapeHTML(order.customerName || "Customer")}</strong>
                      <span>${Utils.escapeHTML(order.summary || id)}</span>
                    </div>
                    <div>
                      <b>${Utils.escapeHTML(String(order.status || "pending").replaceAll("_", " "))}${amt > 0 ? ` · Rs. ${amt.toLocaleString()}` : ""}</b>
                      <small>${Utils.escapeHTML(Utils.formatDate(order.createdAt))}</small>
                    </div>
                  </div>`;
            }).join("");
        };

        if (container._skgDashboardUnsubscribe) container._skgDashboardUnsubscribe();
        container._skgDashboardUnsubscribe = subscribeToOrders(renderOrders);
    }
};

export { DashboardModule };
