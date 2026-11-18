// ============================================================================
// SIRANCHOWK KHAJA GHAR — ROLE-BASED ACCESS CONTROL (RBAC)
// ============================================================================

export const PRIMARY_OWNER_UID = "47SB1i4UL5hlUVPqM1tQoKJFdaM2";

export const ROLE_IDS = Object.freeze(["owner", "admin", "moderator", "officer", "helper"]);

export const ROLE_METADATA = Object.freeze({
    owner: {
        id: "owner",
        label: "Owner",
        rank: 5,
        description: "Highest authority with full analytics, customer intelligence, security logs, RBAC, and operational control."
    },
    admin: {
        id: "admin",
        label: "Admin",
        rank: 4,
        description: "Advanced management over orders, products, inventory, customers, offers, and lower staff tiers."
    },
    moderator: {
        id: "moderator",
        label: "Moderator",
        rank: 3,
        description: "Customer service and operational supervision across orders, inventory visibility, products, and offers."
    },
    officer: {
        id: "officer",
        label: "Officer",
        rank: 2,
        description: "Order operations: confirm incoming orders, update preparation, mark ready, and manage delivery statuses."
    },
    helper: {
        id: "helper",
        label: "Helper",
        rank: 1,
        description: "Limited kitchen and counter preparation view for assigned or active order tasks."
    }
});

export const PERMISSION_CATALOG = Object.freeze([
    { key: "viewOrders", label: "View Orders", description: "Read incoming and historical customer orders." },
    { key: "updateOrders", label: "Update Orders", description: "Accept orders and advance preparation, ready, or delivery status." },
    { key: "cancelOrders", label: "Cancel Orders", description: "Cancel customer orders with confirmation." },
    { key: "manageProducts", label: "Manage Products", description: "Add, edit, toggle availability, and remove menu items and categories." },
    { key: "editPrices", label: "Edit Prices", description: "Modify menu item pricing and price labels." },
    { key: "viewInventory", label: "View Inventory & Stock", description: "Inspect ingredient stock levels, low-stock alerts, and restock logs." },
    { key: "manageInventory", label: "Manage Inventory & Restock", description: "Create stock items, log restocks/adjustments, and configure auto-availability." },
    { key: "viewCustomers", label: "View Customers", description: "Access Customer Management directory and customer order summaries." },
    { key: "viewCustomerContactDetails", label: "View Customer Contact PII", description: "View full customer email, phone number, address, and UID fields." },
    { key: "manageCoupons", label: "Manage Coupons", description: "Create, edit, activate, and remove coupons and offers." },
    { key: "viewAnalytics", label: "View Website Analytics", description: "Access Website Analytics traffic charts, pages, browsers, and comparisons." },
    { key: "viewVisitorAnalytics", label: "View Visitor Sessions", description: "Inspect anonymous Visitor Analytics session logs and dwell times." },
    { key: "viewCustomerEngagement", label: "View Customer Engagement", description: "Access DAU/WAU/MAU, activity tiers, repeat buyers, and retention metrics." },
    { key: "viewUserActivity", label: "View User Activity Timelines", description: "Inspect individual registered customer event timelines." },
    { key: "viewOrderAnalytics", label: "View Order Analytics", description: "Access order volume, completion rates, and sales revenue analytics." },
    { key: "viewLoginHistory", label: "View User Login History", description: "Inspect Customer and Staff login timestamps, devices, and failed attempts." },
    { key: "viewAuditLogs", label: "View Admin Activity Logs", description: "Inspect immutable operational and staff activity logs." },
    { key: "viewSecurityLogs", label: "View Security Logs", description: "Inspect failed auth, unauthorized access, device blocks, and RBAC changes." },
    { key: "exportReports", label: "Export Reports & CSVs", description: "Download CSV / printable reports and manage analytics retention." },
    { key: "sendNotifications", label: "Send Notifications", description: "Send custom admin announcements to approved devices." },
    { key: "sendCustomerCampaigns", label: "Send Customer Campaigns", description: "Send promotional announcements to opted-in customers." },
    { key: "manageStaff", label: "Manage Staff", description: "Create and manage staff accounts and assign permitted roles." },
    { key: "manageDevices", label: "Manage Devices", description: "Approve, reject, block, unblock, or revoke admin devices." },
    { key: "manageRoles", label: "Configure Roles & Permissions", description: "Customize role permissions and individual staff overrides." },
    { key: "manageSettings", label: "Manage Settings", description: "Update business settings and push notification configuration." }
]);

export const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
    owner: {
        viewOrders: true,
        updateOrders: true,
        cancelOrders: true,
        manageProducts: true,
        editPrices: true,
        viewInventory: true,
        manageInventory: true,
        viewCustomers: true,
        viewCustomerContactDetails: true,
        manageCoupons: true,
        viewAnalytics: true,
        viewVisitorAnalytics: true,
        viewCustomerEngagement: true,
        viewUserActivity: true,
        viewOrderAnalytics: true,
        viewLoginHistory: true,
        viewAuditLogs: true,
        viewSecurityLogs: true,
        exportReports: true,
        sendNotifications: true,
        sendCustomerCampaigns: true,
        manageStaff: true,
        manageDevices: true,
        manageRoles: true,
        manageSettings: true
    },
    admin: {
        viewOrders: true,
        updateOrders: true,
        cancelOrders: true,
        manageProducts: true,
        editPrices: true,
        viewInventory: true,
        manageInventory: true,
        viewCustomers: true,
        viewCustomerContactDetails: true,
        manageCoupons: true,
        viewAnalytics: true,
        viewVisitorAnalytics: false,
        viewCustomerEngagement: true,
        viewUserActivity: false,
        viewOrderAnalytics: true,
        viewLoginHistory: false,
        viewAuditLogs: true,
        viewSecurityLogs: false,
        exportReports: false,
        sendNotifications: false,
        sendCustomerCampaigns: false,
        manageStaff: true,
        manageDevices: false,
        manageRoles: false,
        manageSettings: false
    },
    moderator: {
        viewOrders: true,
        updateOrders: true,
        cancelOrders: false,
        manageProducts: false,
        editPrices: false,
        viewInventory: true,
        manageInventory: false,
        viewCustomers: true,
        viewCustomerContactDetails: false,
        manageCoupons: false,
        viewAnalytics: false,
        viewVisitorAnalytics: false,
        viewCustomerEngagement: false,
        viewUserActivity: false,
        viewOrderAnalytics: false,
        viewLoginHistory: false,
        viewAuditLogs: false,
        viewSecurityLogs: false,
        exportReports: false,
        sendNotifications: false,
        sendCustomerCampaigns: false,
        manageStaff: false,
        manageDevices: false,
        manageRoles: false,
        manageSettings: false
    },
    officer: {
        viewOrders: true,
        updateOrders: true,
        cancelOrders: false,
        manageProducts: false,
        editPrices: false,
        viewInventory: true,
        manageInventory: false,
        viewCustomers: false,
        viewCustomerContactDetails: false,
        manageCoupons: false,
        viewAnalytics: false,
        viewVisitorAnalytics: false,
        viewCustomerEngagement: false,
        viewUserActivity: false,
        viewOrderAnalytics: false,
        viewLoginHistory: false,
        viewAuditLogs: false,
        viewSecurityLogs: false,
        exportReports: false,
        sendNotifications: false,
        sendCustomerCampaigns: false,
        manageStaff: false,
        manageDevices: false,
        manageRoles: false,
        manageSettings: false
    },
    helper: {
        viewOrders: true,
        updateOrders: true,
        cancelOrders: false,
        manageProducts: false,
        editPrices: false,
        viewInventory: false,
        manageInventory: false,
        viewCustomers: false,
        viewCustomerContactDetails: false,
        manageCoupons: false,
        viewAnalytics: false,
        viewVisitorAnalytics: false,
        viewCustomerEngagement: false,
        viewUserActivity: false,
        viewOrderAnalytics: false,
        viewLoginHistory: false,
        viewAuditLogs: false,
        viewSecurityLogs: false,
        exportReports: false,
        sendNotifications: false,
        sendCustomerCampaigns: false,
        manageStaff: false,
        manageDevices: false,
        manageRoles: false,
        manageSettings: false
    }
});

export function normalizeRole(role) {
    const clean = String(role || "").toLowerCase().trim();
    return ROLE_IDS.includes(clean) ? clean : "helper";
}

export function isOwnerUid(uid, staffRecord = null) {
    if (!uid) return false;
    if (uid === PRIMARY_OWNER_UID) return true;
    return normalizeRole(staffRecord?.role) === "owner" && staffRecord?.active !== false;
}

export function resolveEffectivePermissions(role, roleMatrix = null, staffOverrides = null, uid = null) {
    const normalizedRole = uid === PRIMARY_OWNER_UID ? "owner" : normalizeRole(role);

    // Owner authority can never be reduced by any config.
    if (normalizedRole === "owner") {
        return { ...DEFAULT_ROLE_PERMISSIONS.owner };
    }

    const baseDefaults = DEFAULT_ROLE_PERMISSIONS[normalizedRole] || DEFAULT_ROLE_PERMISSIONS.helper;
    const configuredRole = roleMatrix && roleMatrix[normalizedRole] ? roleMatrix[normalizedRole] : {};
    const merged = { ...baseDefaults };

    for (const perm of PERMISSION_CATALOG) {
        if (typeof configuredRole[perm.key] === "boolean") {
            merged[perm.key] = configuredRole[perm.key];
        }
        if (staffOverrides && typeof staffOverrides[perm.key] === "boolean") {
            merged[perm.key] = staffOverrides[perm.key];
        }
    }

    return merged;
}

export function canManageTargetStaff(actorRole, targetRole, targetUid = "") {
    if (targetUid === PRIMARY_OWNER_UID || normalizeRole(targetRole) === "owner") {
        return false; // Nobody can demote, disable, or remove the Owner.
    }
    const actorRank = ROLE_METADATA[normalizeRole(actorRole)]?.rank || 0;
    const targetRank = ROLE_METADATA[normalizeRole(targetRole)]?.rank || 0;
    return actorRank > targetRank;
}

export function getAllowedAssignableRoles(actorRole) {
    const normalized = normalizeRole(actorRole);
    if (normalized === "owner") {
        return ["admin", "moderator", "officer", "helper"];
    }
    if (normalized === "admin") {
        return ["moderator", "officer", "helper"];
    }
    return [];
}

export function getAllowedOrderStatusesForRole(role, permissions = {}) {
    const normalized = normalizeRole(role);
    if (normalized === "owner" || normalized === "admin") {
        return ["pending", "accepted", "preparing", "ready", "dispatched", "delivered", "cancelled"];
    }
    if (normalized === "moderator") {
        return permissions.cancelOrders
            ? ["pending", "accepted", "preparing", "ready", "dispatched", "delivered", "cancelled"]
            : ["pending", "accepted", "preparing", "ready", "dispatched", "delivered"];
    }
    if (normalized === "officer") {
        return permissions.cancelOrders
            ? ["pending", "accepted", "preparing", "ready", "dispatched", "delivered", "cancelled"]
            : ["accepted", "preparing", "ready", "dispatched", "delivered"];
    }
    return ["preparing", "ready"];
}
