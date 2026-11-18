// ============================================================================
// SIRANCHOWK KHAJA GHAR — ADMIN SHELL CONTROLLER (ALL SECTIONS + RBAC + DEVICE)
// ============================================================================

import {
    checkAdminAuth,
    logoutAdmin,
    getAdminSession,
    hasPermission
} from "./auth.js";
import { db, ref, onValue } from "../../js/firebase.js";
import { DashboardModule } from "./dashboard.js";
import { OrdersModule, startOrderMonitor } from "./orders.js";
import { MenuModule } from "./menu.js";
import { CategoriesModule } from "./categories.js";
import { CustomersModule } from "./customers.js";
import { OffersModule } from "./offers.js";
import { AnalyticsModule } from "./analytics.js";
import { VisitorAnalyticsModule } from "./visitor-analytics.js";
import { LoginHistoryModule } from "./login-history.js";
import { UserActivityModule } from "./user-activity.js";
import { CustomerEngagementModule } from "./customer-engagement.js";
import { OrderAnalyticsModule } from "./order-analytics.js";
import { NotificationsModule } from "./notifications.js";
import { CustomerAnnouncementsModule } from "./customer-announcements.js";
import { ActivityLogsModule } from "./activity-logs.js";
import { DevicesModule } from "./devices.js";
import { StaffModule } from "./staff.js";
import { RolesModule } from "./roles.js";
import { AuditLogsModule } from "./audit-logs.js";
import { SecurityLogsModule } from "./security-logs.js";
import { ReportsExportsModule } from "./reports-exports.js";
import { SettingsModule } from "./settings.js";
import { InventoryModule } from "./inventory.js";
import { UIModule } from "./ui.js";
import {
    attachForegroundNotificationToast,
    refreshAdminFcmTokenIfEnabled
} from "../../js/notifications-client.js";
import { getStockHealth } from "../../js/inventory-sync.js";
import { logSecurityEvent } from "../../js/activity-logger.js";

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

    // Store Open indicator listener
    const statusIndicator = document.getElementById("business-status-indicator");
    onValue(ref(db, "settings/business/storeOpen"), (snap) => {
        if (!statusIndicator) return;
        const isOpen = snap.exists() ? snap.val() !== false : true;
        statusIndicator.innerHTML = `<span class="status-dot"></span> ${isOpen ? "Store Open" : "Store Paused"}`;
        statusIndicator.classList.toggle("is-paused", !isOpen);
    }, () => {});

    // Live pending order monitor
    startOrderMonitor();

    // Live pending devices count badge (for Owner / manageDevices)
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

    // Live low/out-of-stock count badge
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

    // Live in-panel admin notifications listener for approved & unblocked devices
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

    const viewRegistry = {
        overview: { module: DashboardModule, title: "Business Overview", perm: null },
        dashboard: { module: DashboardModule, title: "Business Overview", perm: null },
        orders: { module: OrdersModule, title: "Orders", perm: "viewOrders" },
        "website-analytics": { module: AnalyticsModule, title: "Website Analytics", perm: "viewAnalytics" },
        analytics: { module: AnalyticsModule, title: "Website Analytics", perm: "viewAnalytics" },
        "visitor-analytics": { module: VisitorAnalyticsModule, title: "Visitor Analytics", perm: "viewVisitorAnalytics" },
        "customer-engagement": { module: CustomerEngagementModule, title: "Customer Engagement", perm: "viewCustomerEngagement" },
        "order-analytics": { module: OrderAnalyticsModule, title: "Order Analytics", perm: "viewOrderAnalytics" },
        "reports-exports": { module: ReportsExportsModule, title: "Reports & Exports", perm: "exportReports" },
        customers: { module: CustomersModule, title: "Customer Management", perm: "viewCustomers" },
        "login-history": { module: LoginHistoryModule, title: "User Login History", perm: "viewLoginHistory" },
        "user-activity": { module: UserActivityModule, title: "User Activity", perm: "viewUserActivity" },
        products: { module: MenuModule, title: "Products & Menu", perm: "manageProducts" },
        inventory: { module: InventoryModule, title: "Inventory & Stock", perm: null, anyPerm: ["viewInventory", "manageInventory", "manageProducts"] },
        categories: { module: CategoriesModule, title: "Categories", perm: "manageProducts" },
        offers: { module: OffersModule, title: "Offers & Coupons", perm: "manageCoupons" },
        notifications: { module: NotificationsModule, title: "Notification Center & History", perm: null },
        "customer-announcements": { module: CustomerAnnouncementsModule, title: "Customer Announcements", perm: "sendCustomerCampaigns" },
        "activity-logs": {
            module: ActivityLogsModule,
            title: "Activity Logs (10 Categories)",
            perm: null,
            anyPerm: ["viewLoginHistory", "viewAnalytics", "viewAuditLogs", "viewSecurityLogs", "sendNotifications", "sendCustomerCampaigns"]
        },
        devices: { module: DevicesModule, title: "Devices", perm: "manageDevices" },
        staff: { module: StaffModule, title: "Staff", perm: "manageStaff" },
        roles: { module: RolesModule, title: "Roles & Permissions", perm: "manageRoles" },
        "audit-logs": { module: AuditLogsModule, title: "Admin Activity Logs", perm: "viewAuditLogs" },
        "security-logs": { module: SecurityLogsModule, title: "Security Logs", perm: "viewSecurityLogs" },
        settings: { module: SettingsModule, title: "Settings", perm: "manageSettings" }
    };

    function isViewAllowed(viewKey) {
        const entry = viewRegistry[viewKey];
        if (!entry) return false;
        if (entry.anyPerm) {
            return entry.anyPerm.some((p) => hasPermission(p));
        }
        if (!entry.perm) return true;
        return hasPermission(entry.perm);
    }

    const navItems = [...document.querySelectorAll(".nav-item[data-view]")];
    navItems.forEach((item) => {
        const key = item.dataset.view;
        const allowed = isViewAllowed(key);
        item.classList.toggle("hidden", !allowed);
    });

    // Hide empty nav section labels if all items under them are hidden
    document.querySelectorAll(".nav-section-label[data-section]").forEach((label) => {
        const group = label.dataset.section;
        const visibleSibling = document.querySelector(`.nav-item[data-group="${group}"]:not(.hidden)`);
        label.classList.toggle("hidden", !visibleSibling);
    });

    const main = document.getElementById("main-content");
    const titleEl = document.getElementById("page-title-heading");
    if (!main) return;

    // Show non-intrusive pending device banner if current device is awaiting Owner approval
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
              <p>This browser (<code>${session.device.deviceName || session.device.deviceId}</code>) is registered as <strong>pending</strong>. Push notifications and background admin alerts are disabled until approved by the Owner in Devices.</p>
            </div>
            <span class="badge badge-warning">Pending Approval</span>
        `;
        main.parentElement?.insertBefore(banner, main);
    }

    async function navigateTo(rawView) {
        const cleaned = (rawView || "overview").split("?")[0];
        const requested = cleaned === "dashboard" ? "overview" : (cleaned === "analytics" ? "website-analytics" : cleaned);
        let key = requested;

        if (viewRegistry[requested] && !isViewAllowed(requested)) {
            const active = getAdminSession();
            await logSecurityEvent({
                eventType: "permission_denied",
                severity: "warning",
                actorUid: active?.user?.uid || "unknown",
                actorEmail: active?.user?.email || "",
                actorRole: active?.role || "staff",
                target: requested,
                details: { attemptedSection: requested }
            });
            UIModule.showToast("Access restricted for your role.", "error");
            key = "overview";
        } else if (!viewRegistry[requested]) {
            key = "overview";
        }

        const target = viewRegistry[key];

        navItems.forEach((item) => {
            const active = item.dataset.view === key;
            item.classList.toggle("active", active);
            if (active) item.setAttribute("aria-current", "page");
            else item.removeAttribute("aria-current");
        });

        if (titleEl) titleEl.textContent = target.title;
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
            await target.module.render(main);
        } catch (error) {
            console.error(`Could not render admin view "${key}":`, error);
            main.innerHTML = `
              <section class="card">
                <h2 class="card-title">This section could not be loaded</h2>
                <p class="card-subtitle">${error?.message ? String(error.message) : "Check your connection and Firebase permissions, then try again."}</p>
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
