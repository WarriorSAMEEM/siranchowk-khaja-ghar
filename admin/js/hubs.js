// ============================================================================
// SIRANCHOWK KHAJA GHAR — CONSOLIDATED ADMIN WORKSPACE HUBS
// Combines related modules into clean tabbed hubs without duplicating nav links
// while preserving all role permissions and deep-link URL hashes.
// ============================================================================

import { hasPermission } from "./auth.js";
import { Utils } from "./utils.js";
import { AnalyticsModule } from "./analytics.js";
import { VisitorAnalyticsModule } from "./visitor-analytics.js";
import { OrderAnalyticsModule } from "./order-analytics.js";
import { CustomerEngagementModule } from "./customer-engagement.js";
import { ReportsExportsModule } from "./reports-exports.js";
import { MenuModule } from "./menu.js";
import { CategoriesModule } from "./categories.js";
import { CustomersModule } from "./customers.js";
import { UserActivityModule } from "./user-activity.js";
import { NotificationsModule } from "./notifications.js";
import { CustomerAnnouncementsModule } from "./customer-announcements.js";
import { SecurityLogsModule } from "./security-logs.js";
import { AuditLogsModule } from "./audit-logs.js";
import { LoginHistoryModule } from "./login-history.js";
import { ActivityLogsModule } from "./activity-logs.js";

function createTabbedHub({ title, subtitle, tabs, defaultHash, onBreadcrumbSubtab }) {
    return {
        async render(container, requestedSubtab = null, options = {}) {
            const allowedTabs = tabs.filter((t) => {
                if (typeof t.check === "function") return t.check();
                if (t.anyPerm) return t.anyPerm.some((p) => hasPermission(p));
                if (t.perm) return hasPermission(t.perm);
                return true;
            });

            if (!allowedTabs.length) {
                container.innerHTML = `<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">Your role does not permit viewing ${Utils.escapeHTML(title)}.</p></section>`;
                return;
            }

            let activeTab = allowedTabs.find((t) => t.key === requestedSubtab) || allowedTabs[0];
            const breadcrumbCallback = typeof options?.onBreadcrumbSubtab === "function"
                ? options.onBreadcrumbSubtab
                : onBreadcrumbSubtab;

            const renderShell = async () => {
                if (typeof breadcrumbCallback === "function") {
                    breadcrumbCallback(activeTab.label, activeTab);
                }

                const existingPanel = container.querySelector("#skg-hub-panel");
                if (existingPanel) {
                    if (typeof existingPanel._skgViewUnsubscribe === "function") {
                        existingPanel._skgViewUnsubscribe();
                        existingPanel._skgViewUnsubscribe = null;
                    }
                    if (typeof existingPanel._skgDashboardUnsubscribe === "function") {
                        existingPanel._skgDashboardUnsubscribe();
                        existingPanel._skgDashboardUnsubscribe = null;
                    }
                    if (typeof existingPanel._skgOrderUnsubscribe === "function") {
                        existingPanel._skgOrderUnsubscribe();
                        existingPanel._skgOrderUnsubscribe = null;
                    }
                }

                container.innerHTML = `
                  <div class="skg-hub-shell">
                    <div class="skg-hub-header">
                      <div>
                        <h2 class="skg-hub-title">${Utils.escapeHTML(title)}</h2>
                        <p class="skg-hub-subtitle">${Utils.escapeHTML(subtitle)}</p>
                      </div>
                      <nav class="skg-hub-tabs" role="tablist" aria-label="${Utils.escapeHTML(title)} sections">
                        ${allowedTabs.map((t) => `
                          <button
                            type="button"
                            role="tab"
                            aria-selected="${t.key === activeTab.key ? "true" : "false"}"
                            class="skg-tab ${t.key === activeTab.key ? "active" : ""}"
                            data-hub-tab="${Utils.escapeHTML(t.key)}"
                          >${Utils.escapeHTML(t.label)}</button>
                        `).join("")}
                      </nav>
                    </div>
                    <div id="skg-hub-panel" class="skg-hub-panel">
                      <div class="skg-admin-loading" role="status">Loading ${Utils.escapeHTML(activeTab.label)}…</div>
                    </div>
                  </div>
                `;

                const panel = container.querySelector("#skg-hub-panel");
                container.querySelectorAll("[data-hub-tab]").forEach((btn) => {
                    btn.addEventListener("click", async () => {
                        const next = allowedTabs.find((t) => t.key === btn.dataset.hubTab);
                        if (!next || next.key === activeTab.key) return;
                        activeTab = next;
                        const nextHash = `#${next.hash || defaultHash}`;
                        if (window.location.hash !== nextHash) {
                            history.replaceState(null, "", nextHash);
                        }
                        await renderShell();
                    });
                });

                try {
                    await activeTab.module.render(panel);
                } catch (err) {
                    console.error(`Failed rendering subtab ${activeTab.key}:`, err);
                    panel.innerHTML = `
                      <section class="card">
                        <h3 class="card-title">Unable to load ${Utils.escapeHTML(activeTab.label)}</h3>
                        <p class="card-subtitle">${Utils.escapeHTML(err?.message || "Please try refreshing.")}</p>
                      </section>
                    `;
                }
            };

            container._skgViewUnsubscribe = () => {
                const panel = container.querySelector("#skg-hub-panel");
                if (!panel) return;
                if (typeof panel._skgViewUnsubscribe === "function") {
                    panel._skgViewUnsubscribe();
                    panel._skgViewUnsubscribe = null;
                }
                if (typeof panel._skgDashboardUnsubscribe === "function") {
                    panel._skgDashboardUnsubscribe();
                    panel._skgDashboardUnsubscribe = null;
                }
                if (typeof panel._skgOrderUnsubscribe === "function") {
                    panel._skgOrderUnsubscribe();
                    panel._skgOrderUnsubscribe = null;
                }
            };

            await renderShell();
        }
    };
}

export const AnalyticsHubModule = createTabbedHub({
    title: "Analytics & Reports",
    subtitle: "Website traffic, visitor journeys, order revenue, customer retention, and CSV/print exports.",
    defaultHash: "website-analytics",
    tabs: [
        { key: "website-analytics", hash: "website-analytics", label: "Website Traffic", perm: "viewAnalytics", module: AnalyticsModule },
        { key: "visitor-analytics", hash: "visitor-analytics", label: "Visitor Sessions", perm: "viewVisitorAnalytics", module: VisitorAnalyticsModule },
        { key: "order-analytics", hash: "order-analytics", label: "Orders & Revenue", perm: "viewOrderAnalytics", module: OrderAnalyticsModule },
        { key: "customer-engagement", hash: "customer-engagement", label: "Customer Engagement", perm: "viewCustomerEngagement", module: CustomerEngagementModule },
        { key: "reports-exports", hash: "reports-exports", label: "Reports & Exports", perm: "exportReports", module: ReportsExportsModule }
    ]
});

export const CatalogHubModule = createTabbedHub({
    title: "Menu, Pricing & Categories",
    subtitle: "Single-source menu pricing (blocking UNSET items online) and storefront dish categories.",
    defaultHash: "products",
    tabs: [
        { key: "products", hash: "products", label: "Menu & Pricing Catalog", perm: "manageProducts", module: MenuModule },
        { key: "categories", hash: "categories", label: "Dish Categories", perm: "manageProducts", module: CategoriesModule }
    ]
});

export const CustomersHubModule = createTabbedHub({
    title: "Customer Management & Activity",
    subtitle: "Customer accounts, registered push devices, order spend, and chronological account activity.",
    defaultHash: "customers",
    tabs: [
        { key: "customers", hash: "customers", label: "Customer Directory", perm: "viewCustomers", module: CustomersModule },
        { key: "user-activity", hash: "user-activity", label: "Customer Activity Timeline", perm: "viewUserActivity", module: UserActivityModule }
    ]
});

export const NotificationsHubModule = createTabbedHub({
    title: "Notifications & Customer Announcements",
    subtitle: "Internal staff device alerts, 5-channel notification history, order templates, and customer campaigns.",
    defaultHash: "notifications",
    tabs: [
        { key: "notifications", hash: "notifications", label: "Notification Center & History", perm: null, module: NotificationsModule },
        { key: "customer-announcements", hash: "customer-announcements", label: "Customer Announcements", perm: "sendCustomerCampaigns", module: CustomerAnnouncementsModule }
    ]
});

export const LogsHubModule = createTabbedHub({
    title: "Security & Activity Logs",
    subtitle: "Immutable admin audit trail, security alerts, login history, and 10-category operational logs.",
    defaultHash: "security-logs",
    tabs: [
        { key: "security-logs", hash: "security-logs", label: "Security Alerts", perm: "viewSecurityLogs", module: SecurityLogsModule },
        { key: "audit-logs", hash: "audit-logs", label: "Admin Audit Logs", perm: "viewAuditLogs", module: AuditLogsModule },
        { key: "login-history", hash: "login-history", label: "Login History", perm: "viewLoginHistory", module: LoginHistoryModule },
        {
            key: "activity-logs",
            hash: "activity-logs",
            label: "10-Category Logs",
            anyPerm: ["viewLoginHistory", "viewAnalytics", "viewAuditLogs", "viewSecurityLogs", "sendNotifications", "sendCustomerCampaigns"],
            module: ActivityLogsModule
        }
    ]
});
