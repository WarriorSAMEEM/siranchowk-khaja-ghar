// ============================================================================
// SIRANCHOWK KHAJA GHAR — ADMIN SHELL CONTROLLER (CONSOLIDATED 7-SECTION NAV)
// ============================================================================

import {
    checkAdminAuth,
    logoutAdmin,
    getAdminSession,
    hasPermission
} from "./auth.js";
import { db, ref, onValue, update } from "../../js/firebase.js";
import { DashboardModule } from "./dashboard.js";
import { OrdersModule, startOrderMonitor } from "./orders.js";
import { OffersModule } from "./offers.js";
import { DevicesModule } from "./devices.js";
import { StaffModule } from "./staff.js";
import { RolesModule } from "./roles.js";
import { SettingsModule } from "./settings.js";
import { InventoryModule } from "./inventory.js";
import { CreatorsModule } from "./creators.js";
import { ModerationModule } from "./moderation.js";
import { SeoManagerModule } from "./seo-manager.js";
import {
    AnalyticsHubModule,
    CatalogHubModule,
    CustomersHubModule,
    NotificationsHubModule,
    LogsHubModule
} from "./hubs.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";
import {
    attachForegroundNotificationToast,
    refreshAdminFcmTokenIfEnabled
} from "../../js/notifications-client.js";
import { getStockHealth } from "../../js/inventory-sync.js";
import { logSecurityEvent } from "../../js/activity-logger.js";
import { logAuditEvent } from "../../js/audit-logger.js";

const GROUP_LABELS = {
    overview: "Overview",
    restaurant: "Restaurant Management",
    customers: "Customer Management",
    content: "Content Management",
    creators: "Creator Management",
    notifications: "Notifications",
    security: "Security & Administration"
};

document.addEventListener("DOMContentLoaded", async () => {
    let session = null;

    try {
        session = await checkAdminAuth((revokedReason) => {
            const target = `./login.html?reason=${encodeURIComponent(revokedReason || "Session ended.")}`;
            window.location.replace(target);
        });
        if (!session || !session.user) return;
    } catch (error) {
        console.error("Admin authentication check failed:", error);
        const target = `./login.html?reason=${encodeURIComponent(error?.message || "Access denied.")}`;
        window.location.replace(target);
        return;
    }

    if (typeof window.revealAdminApplication === "function") {
        window.revealAdminApplication();
    }

    UIModule.init();
    attachForegroundNotificationToast();
    if (session.device) {
        refreshAdminFcmTokenIfEnabled(session.device).catch(() => {});
    }

    const displayNameElement = document.getElementById("user-display-name");
    const roleElement = document.getElementById("user-role-label");
    const avatarElement = document.getElementById("user-avatar-initials");
    const email = session.user.email || "Staff";
    const displayName = session.staff?.name || session.user.displayName || email.split("@")[0] || "Staff";

    if (displayNameElement) displayNameElement.textContent = displayName;
    if (roleElement) roleElement.textContent = session.roleLabel || "Staff";
    if (avatarElement) {
        avatarElement.textContent = displayName
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part.charAt(0).toUpperCase())
            .join("") || "SK";
    }

    // Store Open indicator listener + quick toggle for manageSettings role
    let currentStoreOpen = true;
    const statusIndicator = document.getElementById("business-status-indicator");
    onValue(ref(db, "settings/business/storeOpen"), (snap) => {
        if (!statusIndicator) return;
        currentStoreOpen = snap.exists() ? snap.val() !== false : true;
        statusIndicator.innerHTML = `<span class="status-dot"></span> ${currentStoreOpen ? "Store Open" : "Store Paused"}`;
        statusIndicator.classList.toggle("is-paused", !currentStoreOpen);
        statusIndicator.title = hasPermission("manageSettings")
            ? "Click to toggle Store Open / Store Paused"
            : "Current store online order availability";
    }, () => {});

    statusIndicator?.addEventListener("click", async () => {
        if (!hasPermission("manageSettings")) return;
        const nextOpen = !currentStoreOpen;
        const ok = await UIModule.confirm({
            title: nextOpen ? "Re-open Website Ordering?" : "Pause Website Ordering?",
            message: nextOpen
                ? "Customers will be able to place new online orders immediately."
                : "New customer online checkout will be paused until you re-open the store.",
            confirmText: nextOpen ? "Open Store" : "Pause Store",
            dangerous: !nextOpen
        });
        if (!ok) return;
        try {
            await update(ref(db, "settings/business"), { storeOpen: nextOpen, updatedAt: Date.now() });
            await logAuditEvent({
                actorUid: session?.user?.uid,
                actorName: session?.staff?.name,
                actorEmail: session?.user?.email,
                actorRole: session?.role,
                action: nextOpen ? "store_reopened" : "store_paused",
                target: "settings/business/storeOpen"
            });
            UIModule.showToast(nextOpen ? "Store is now Open for online orders." : "Store ordering is now Paused.", "info");
        } catch (err) {
            UIModule.showToast(err?.message || "Unable to update store status.", "error");
        }
    });

    // Live pending order monitor
    startOrderMonitor();

    // Live badges in sidebar
    if (hasPermission("manageDevices")) {
        onValue(ref(db, "adminDevices"), (snap) => {
            const devices = snap.exists() ? Object.values(snap.val() || {}) : [];
            const pendingCount = devices.filter((d) => d?.approvalStatus === "pending" && !d?.blocked).length;
            const badge = document.getElementById("pending-devices-count");
            if (badge) {
                badge.textContent = String(pendingCount);
                badge.classList.toggle("hidden", pendingCount === 0);
            }
        }, () => {});
    }

    if (hasPermission("viewInventory") || hasPermission("manageInventory") || hasPermission("manageProducts")) {
        onValue(ref(db, "inventory/items"), (snap) => {
            const invItems = snap.exists() ? Object.values(snap.val() || {}) : [];
            const lowCount = invItems.filter((item) => item && getStockHealth(item).code !== "ok").length;
            const badge = document.getElementById("low-stock-count");
            if (badge) {
                badge.textContent = String(lowCount);
                badge.classList.toggle("hidden", lowCount === 0);
            }
        }, () => {});
    }

    if (hasPermission("moderateContent")) {
        onValue(ref(db, "contentReports"), (snap) => {
            const reps = snap.exists() ? Object.values(snap.val() || {}) : [];
            const openCount = reps.filter((r) => (r?.status || "open") === "open").length;
            const badge = document.getElementById("open-reports-count");
            if (badge) {
                badge.textContent = String(openCount);
                badge.classList.toggle("hidden", openCount === 0);
            }
        }, () => {});
    }

    if (hasPermission("manageCreators")) {
        onValue(ref(db, "creatorApplications"), (snap) => {
            const apps = snap.exists() ? Object.values(snap.val() || {}) : [];
            const pendCount = apps.filter((a) => ["pending", "under_review", "more_info_required"].includes(a?.status)).length;
            const badge = document.getElementById("pending-creators-count");
            if (badge) {
                badge.textContent = String(pendCount);
                badge.classList.toggle("hidden", pendCount === 0);
            }
        }, () => {});
    }

    // Live in-panel admin notifications listener
    let initialNotifSnapshot = true;
    onValue(ref(db, "adminNotifications"), (snap) => {
        if (initialNotifSnapshot) {
            initialNotifSnapshot = false;
            return;
        }
        const activeSession = getAdminSession();
        const myDevice = activeSession?.device;
        if (!myDevice || myDevice.blocked || myDevice.approvalStatus !== "approved") return;

        const items = snap.exists() ? Object.values(snap.val() || {}) : [];
        items.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        const latest = items[0];
        if (!latest) return;

        const isRecipient = latest.targetType === "all" ||
            (Array.isArray(latest.targetDeviceIds) && latest.targetDeviceIds.includes(myDevice.deviceId));
        if (isRecipient && Number(latest.createdAt || 0) > Date.now() - 60000) {
            UIModule.showToast(`${latest.title}: ${latest.body}`, "info");
        }
    }, () => {});

    // Canonical views + backward-compatible deep-link route aliases
    const viewRegistry = {
        overview: { navKey: "overview", group: "overview", module: DashboardModule, title: "Business Overview", perm: null },
        dashboard: { navKey: "overview", group: "overview", module: DashboardModule, title: "Business Overview", perm: null },

        analytics: { navKey: "analytics", group: "overview", module: AnalyticsHubModule, title: "Analytics & Reports", anyPerm: ["viewAnalytics", "viewVisitorAnalytics", "viewOrderAnalytics", "viewCustomerEngagement", "exportReports"] },
        "website-analytics": { navKey: "analytics", group: "overview", module: AnalyticsHubModule, subtab: "website-analytics", title: "Website Analytics", perm: "viewAnalytics" },
        "visitor-analytics": { navKey: "analytics", group: "overview", module: AnalyticsHubModule, subtab: "visitor-analytics", title: "Visitor Analytics", perm: "viewVisitorAnalytics" },
        "order-analytics": { navKey: "analytics", group: "overview", module: AnalyticsHubModule, subtab: "order-analytics", title: "Order Analytics", perm: "viewOrderAnalytics" },
        "customer-engagement": { navKey: "analytics", group: "overview", module: AnalyticsHubModule, subtab: "customer-engagement", title: "Customer Engagement", perm: "viewCustomerEngagement" },
        "reports-exports": { navKey: "analytics", group: "overview", module: AnalyticsHubModule, subtab: "reports-exports", title: "Reports & Exports", perm: "exportReports" },

        orders: { navKey: "orders", group: "restaurant", module: OrdersModule, title: "Orders & Bills", perm: "viewOrders" },
        products: { navKey: "products", group: "restaurant", module: CatalogHubModule, subtab: "products", title: "Menu & Categories", perm: "manageProducts" },
        categories: { navKey: "products", group: "restaurant", module: CatalogHubModule, subtab: "categories", title: "Dish Categories", perm: "manageProducts" },
        inventory: { navKey: "inventory", group: "restaurant", module: InventoryModule, title: "Inventory & Stock", anyPerm: ["viewInventory", "manageInventory", "manageProducts"] },
        offers: { navKey: "offers", group: "restaurant", module: OffersModule, title: "Offers & Coupons", perm: "manageCoupons" },

        customers: { navKey: "customers", group: "customers", module: CustomersHubModule, subtab: "customers", title: "Customers & Activity", perm: "viewCustomers" },
        "user-activity": { navKey: "customers", group: "customers", module: CustomersHubModule, subtab: "user-activity", title: "Customer Activity Timeline", perm: "viewUserActivity" },

        moderation: { navKey: "moderation", group: "content", module: ModerationModule, title: "Moderation & Content", perm: "moderateContent" },
        "seo-manager": { navKey: "seo-manager", group: "content", module: SeoManagerModule, title: "SEO & Community Topics", anyPerm: ["manageSeo", "viewContentAnalytics"] },

        creators: { navKey: "creators", group: "creators", module: CreatorsModule, title: "Creators & Blue Tick", anyPerm: ["manageCreators", "manageBadges"] },

        notifications: { navKey: "notifications", group: "notifications", module: NotificationsHubModule, subtab: "notifications", title: "Alerts & Campaigns", perm: null },
        "customer-announcements": { navKey: "notifications", group: "notifications", module: NotificationsHubModule, subtab: "customer-announcements", title: "Customer Announcements", perm: "sendCustomerCampaigns" },

        staff: { navKey: "staff", group: "security", module: StaffModule, title: "Staff", perm: "manageStaff" },
        roles: { navKey: "roles", group: "security", module: RolesModule, title: "Roles & Permissions", perm: "manageRoles" },
        logs: { navKey: "logs", group: "security", module: LogsHubModule, title: "Security & Activity Logs", anyPerm: ["viewSecurityLogs", "viewAuditLogs", "viewLoginHistory", "viewAnalytics", "sendNotifications", "sendCustomerCampaigns"] },
        "security-logs": { navKey: "logs", group: "security", module: LogsHubModule, subtab: "security-logs", title: "Security Logs", perm: "viewSecurityLogs" },
        "audit-logs": { navKey: "logs", group: "security", module: LogsHubModule, subtab: "audit-logs", title: "Admin Audit Logs", perm: "viewAuditLogs" },
        "login-history": { navKey: "logs", group: "security", module: LogsHubModule, subtab: "login-history", title: "Login History", perm: "viewLoginHistory" },
        "activity-logs": { navKey: "logs", group: "security", module: LogsHubModule, subtab: "activity-logs", title: "Activity Logs (10 Categories)", anyPerm: ["viewLoginHistory", "viewAnalytics", "viewAuditLogs", "viewSecurityLogs", "sendNotifications", "sendCustomerCampaigns"] },
        devices: { navKey: "devices", group: "security", module: DevicesModule, title: "Trusted Devices", perm: "manageDevices" },
        settings: { navKey: "settings", group: "security", module: SettingsModule, title: "Settings", perm: "manageSettings" }
    };

    function isViewAllowed(viewKey) {
        const entry = viewRegistry[viewKey];
        if (!entry) return false;
        if (entry.anyPerm) return entry.anyPerm.some((p) => hasPermission(p));
        if (!entry.perm) return true;
        return hasPermission(entry.perm);
    }

    const navItems = [...document.querySelectorAll(".nav-item[data-view]")];
    navItems.forEach((item) => {
        const key = item.dataset.view;
        const allowed = isViewAllowed(key);
        item.classList.toggle("hidden", !allowed);
        item.dataset.allowed = allowed ? "1" : "0";
    });

    // Collapsible 7-section accordion setup
    const groupWraps = [...document.querySelectorAll(".nav-group[data-group-wrap]")];
    const refreshGroupVisibility = () => {
        groupWraps.forEach((wrap) => {
            const visibleItems = wrap.querySelectorAll(".nav-item:not(.hidden)").length;
            wrap.classList.toggle("hidden", visibleItems === 0);
        });
    };
    refreshGroupVisibility();

    document.querySelectorAll(".nav-group-toggle").forEach((toggle) => {
        toggle.addEventListener("click", () => {
            const wrap = toggle.closest(".nav-group");
            if (!wrap) return;
            const collapsed = wrap.classList.toggle("is-collapsed");
            toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        });
    });

    // Sidebar quick search
    const sidebarSearch = document.getElementById("skg-sidebar-search");
    sidebarSearch?.addEventListener("input", (e) => {
        const q = String(e.target.value || "").trim().toLowerCase();
        navItems.forEach((item) => {
            if (item.dataset.allowed !== "1") {
                item.classList.add("hidden");
                return;
            }
            const text = item.textContent.trim().toLowerCase();
            item.classList.toggle("hidden", Boolean(q && !text.includes(q)));
        });
        if (q) {
            groupWraps.forEach((wrap) => {
                wrap.classList.remove("is-collapsed");
                wrap.querySelector(".nav-group-toggle")?.setAttribute("aria-expanded", "true");
            });
        }
        refreshGroupVisibility();
    });

    const main = document.getElementById("main-content");
    const titleEl = document.getElementById("page-title-heading");
    const breadcrumbEl = document.getElementById("skg-admin-breadcrumb");
    if (!main) return;

    const existingPendingBanner = document.getElementById("skg-pending-device-banner");
    if (existingPendingBanner) existingPendingBanner.remove();
    if (session?.device && session.device.approvalStatus !== "approved" && !session.device.blocked) {
        const banner = document.createElement("div");
        banner.id = "skg-pending-device-banner";
        banner.className = "skg-alert-banner warning";
        banner.style.margin = "1rem 1.75rem 0";
        banner.innerHTML = `
            <div>
              <strong>Device Pending Owner Approval</strong>
              <p>This browser (<code>${Utils.escapeHTML(session.device.deviceName || session.device.deviceId)}</code>) is registered as <strong>pending</strong>. Push notifications and background admin alerts are disabled until approved by the Owner in Devices.</p>
            </div>
            <span class="badge badge-warning">Pending Approval</span>
        `;
        main.parentElement?.insertBefore(banner, main);
    }

    async function navigateTo(rawView) {
        const cleaned = (rawView || "overview").split("?")[0];
        let key = cleaned === "dashboard" ? "overview" : cleaned;

        if (viewRegistry[key] && !isViewAllowed(key)) {
            const active = getAdminSession();
            await logSecurityEvent({
                eventType: "permission_denied",
                severity: "warning",
                actorUid: active?.user?.uid || "unknown",
                actorEmail: active?.user?.email || "",
                actorRole: active?.role || "staff",
                target: key,
                details: { attemptedSection: key }
            });
            UIModule.showToast("Access restricted for your role.", "error");
            key = "overview";
        } else if (!viewRegistry[key]) {
            key = "overview";
        }

        const target = viewRegistry[key];
        const activeNavKey = target.navKey || key;

        navItems.forEach((item) => {
            const active = item.dataset.view === activeNavKey;
            item.classList.toggle("active", active);
            if (active) {
                item.setAttribute("aria-current", "page");
                const parentGroup = item.closest(".nav-group");
                if (parentGroup?.classList.contains("is-collapsed")) {
                    parentGroup.classList.remove("is-collapsed");
                    parentGroup.querySelector(".nav-group-toggle")?.setAttribute("aria-expanded", "true");
                }
            } else {
                item.removeAttribute("aria-current");
            }
        });

        if (titleEl) titleEl.textContent = target.title;
        if (breadcrumbEl) {
            const gLabel = GROUP_LABELS[target.group] || "Workspace";
            breadcrumbEl.textContent = gLabel === target.title ? gLabel : `${gLabel} › ${target.title}`;
        }
        UIModule.closeDrawer();

        if (typeof main._skgOrderUnsubscribe === "function") {
            main._skgOrderUnsubscribe();
            main._skgOrderUnsubscribe = null;
        }
        if (typeof main._skgDashboardUnsubscribe === "function") {
            main._skgDashboardUnsubscribe();
            main._skgDashboardUnsubscribe = null;
        }
        if (typeof main._skgViewUnsubscribe === "function") {
            main._skgViewUnsubscribe();
            main._skgViewUnsubscribe = null;
        }

        main.innerHTML = '<div class="skg-admin-loading" role="status">Loading…</div>';

        try {
            const gLabel = GROUP_LABELS[target.group] || "Workspace";
            await target.module.render(main, target.subtab || null, {
                onBreadcrumbSubtab: (subtabLabel) => {
                    if (!subtabLabel) return;
                    if (titleEl) titleEl.textContent = subtabLabel;
                    if (breadcrumbEl) {
                        breadcrumbEl.textContent = `${gLabel} › ${target.title} › ${subtabLabel}`;
                    }
                }
            });
        } catch (error) {
            console.error(`Could not render admin view "${key}":`, error);
            main.innerHTML = `
              <section class="card">
                <h2 class="card-title">This section could not be loaded</h2>
                <p class="card-subtitle">${Utils.escapeHTML(error?.message ? String(error.message) : "Check your connection and Firebase permissions, then try again.")}</p>
                <button type="button" class="btn btn-primary" id="skg-retry-view">Try again</button>
              </section>`;
            main.querySelector("#skg-retry-view")?.addEventListener("click", () => navigateTo(key));
        }
    }

    window.addEventListener("hashchange", () => {
        const requested = window.location.hash.replace("#", "").trim().toLowerCase();
        navigateTo(requested || "overview");
    });

    navItems.forEach((item) => {
        item.addEventListener("click", (event) => {
            event.preventDefault();
            const key = item.dataset.view;
            const hash = `#${key}`;
            if (window.location.hash !== hash) window.location.hash = hash;
            else navigateTo(key);
        });
    });

    document.getElementById("quick-refresh-btn")?.addEventListener("click", () => {
        const key = window.location.hash.replace("#", "").trim().toLowerCase() || "overview";
        navigateTo(key);
    });

    document.getElementById("logout-btn")?.addEventListener("click", async () => {
        const confirmed = await UIModule.confirm({
            title: "Sign Out of Admin Panel?",
            message: "End your active management session on this device?",
            confirmText: "Sign Out",
            cancelText: "Stay Signed In",
            dangerous: true
        });
        if (!confirmed) return;

        try {
            await logoutAdmin();
        } catch (error) {
            console.error("Admin logout failed:", error);
            UIModule.showToast("Unable to sign out. Please try again.", "error");
        }
    });

    const initialView = window.location.hash.replace("#", "").trim().toLowerCase() || "overview";
    await navigateTo(initialView);
});
