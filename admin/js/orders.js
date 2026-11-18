// ============================================================================
// SIRANCHOWK KHAJA GHAR — ADMIN ORDERS MODULE (RBAC + CUSTOMER SYNC + PUSH)
// ============================================================================

import { db, ref, get, set, onValue, update } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { getAllowedOrderStatusesForRole } from "../../js/rbac.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { logCustomerActivity, recordNotificationHistory } from "../../js/activity-logger.js";
import {
    getPublicPushConfig,
    getOrderNotificationTemplates,
    renderOrderTemplate,
    registerAdminDevicePush,
    dispatchWorkerPush
} from "../../js/notifications-client.js";
import { deductInventoryForOrder, restoreInventoryForOrder } from "../../js/inventory-sync.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

const STATUSES = [
    "pending",
    "accepted",
    "preparing",
    "ready",
    "dispatched",
    "delivered",
    "cancelled"
];

const STATUS_LABELS = {
    pending: "Received",
    accepted: "Confirmed / Accepted",
    preparing: "Preparing",
    ready: "Ready",
    dispatched: "Dispatched / Out for delivery",
    delivered: "Delivered",
    cancelled: "Cancelled"
};

let cachedOrders = {};
let monitorStarted = false;
let monitorUnsubscribe = null;
let initialSnapshot = true;

const orderSubscribers = new Set();

function notifyAdmin(title, body) {
    UIModule.showToast(`${title}: ${body}`, "info");
    if ("Notification" in window && Notification.permission === "granted") {
        try {
            new Notification(title, { body, icon: "/assets/icons/favicon.svg" });
        } catch {
            // Ignore browser notification errors in restricted contexts
        }
    }
}

function addAdminOrderStyles() {
    if (document.getElementById("skg-admin-order-styles")) return;
    const style = document.createElement("style");
    style.id = "skg-admin-order-styles";
    style.textContent = `
        .skg-admin-order-toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:16px 0; }
        .skg-admin-order-toolbar input, .skg-admin-order-toolbar select { min-height:42px; padding:9px 12px; border:1px solid var(--border-color,#dce5e3); border-radius:10px; background:#fff; color:#173c38; font:inherit; }
        .skg-admin-order-toolbar input { flex:1 1 220px; }
        .skg-live-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#16a36d; margin-right:7px; }
        .skg-order-list { display:grid; gap:12px; margin-top:12px; }
        .skg-order-card { padding:17px; border:1px solid #e2ebe8; border-radius:16px; background:#fff; box-shadow:0 3px 12px #153c3710; }
        .skg-order-card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
        .skg-order-ref { font-size:12px; color:#6a817d; font-weight:700; }
        .skg-order-name { margin:4px 0; font-size:17px; font-weight:800; color:#183b37; }
        .skg-order-meta { display:flex; flex-wrap:wrap; gap:8px 14px; color:#6b807c; font-size:12px; }
        .skg-order-items { margin:14px 0; padding:12px 14px; border-radius:11px; background:#f6faf9; color:#294d47; font-size:14px; line-height:1.6; }
        .skg-order-items ul { margin:0; padding-left:18px; }
        .skg-order-details { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:10px 0; color:#49635e; font-size:13px; }
        .skg-order-details strong { display:block; margin-bottom:3px; color:#274640; }
        .skg-order-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:13px; padding-top:13px; border-top:1px solid #edf1ef; }
        .skg-order-actions select { min-height:38px; min-width:155px; padding:7px 10px; border:1px solid #d5e1de; border-radius:9px; background:#fff; color:#173c38; }
        .skg-order-actions button, .skg-order-actions a { display:inline-flex; align-items:center; justify-content:center; min-height:38px; padding:8px 12px; border:0; border-radius:9px; background:#087f78; color:#fff; font-size:13px; font-weight:800; text-decoration:none; cursor:pointer; }
        .skg-order-actions button.skg-btn-warn { background:#b45309; }
        .skg-order-actions button.skg-btn-muted { background:#334155; }
        .skg-order-actions a { background:#e9f7ef; color:#176b3b; }
        .skg-order-actions button:disabled { opacity:.6; cursor:not-allowed; }
        .skg-status { display:inline-flex; padding:5px 10px; border-radius:6px; background:#fff5dd; color:#8a5a09; font-size:11px; font-weight:900; text-transform:uppercase; }
        .skg-status.accepted, .skg-status.preparing { background:#eaf2ff; color:#285c9a; }
        .skg-status.ready, .skg-status.delivered, .skg-status.dispatched { background:#e8f7ef; color:#176b3b; }
        .skg-status.cancelled { background:#fff0ef; color:#a43b34; }
        .skg-order-empty, .skg-order-error { padding:28px; border:1px dashed #d6e3df; border-radius:14px; text-align:center; color:#6b817c; background:#fbfdfc; }
        @media(max-width:600px) {
            .skg-order-details { grid-template-columns:1fr; }
            .skg-order-card-head { flex-direction:column; }
            .skg-order-actions select { flex:1; }
        }
    `;
    document.head.appendChild(style);
}

function subscribeToOrders(callback) {
    orderSubscribers.add(callback);
    callback(cachedOrders, null);
    return () => orderSubscribers.delete(callback);
}

function startOrderMonitor() {
    if (monitorStarted) return monitorUnsubscribe;
    monitorStarted = true;
    initialSnapshot = true;

    monitorUnsubscribe = onValue(
        ref(db, "orders"),
        (snapshot) => {
            const nextOrders = snapshot.val() || {};
            if (!initialSnapshot) {
                Object.entries(nextOrders).forEach(([id, order]) => {
                    const previous = cachedOrders[id];
                    if (!previous) {
                        notifyAdmin("New website order", `${order.customerName || "Customer"} · ${order.summary || id}`);
                    } else if (previous.status !== order.status) {
                        notifyAdmin("Order status updated", `${order.customerName || "Customer"} · ${STATUS_LABELS[order.status] || order.status}`);
                    }
                });
            }

            cachedOrders = nextOrders;
            initialSnapshot = false;

            const pendingCount = Object.values(cachedOrders).filter((order) => order?.status === "pending").length;
            const badge = document.getElementById("pending-orders-count");
            if (badge) {
                badge.textContent = String(pendingCount);
                badge.classList.toggle("hidden", pendingCount === 0);
            }

            orderSubscribers.forEach((callback) => callback(cachedOrders, null));
        },
        (error) => {
            console.error("Admin live order monitor failed:", error);
            monitorStarted = false;
            monitorUnsubscribe = null;
            orderSubscribers.forEach((callback) => callback(cachedOrders, error));
        }
    );

    return monitorUnsubscribe;
}

async function sendOrderCustomerNotification({
    orderId,
    order,
    statusKey,
    title,
    message,
    idempotentKey,
    session,
    skipPushIfAlreadyNotified = true
}) {
    const now = Date.now();
    const actorUid = session?.user?.uid || "system";

    // Strict idempotency check for status lifecycle transitions
    if (skipPushIfAlreadyNotified && order?.notifiedStatuses?.[statusKey]) {
        return { skipped: true, status: "already_notified" };
    }

    let custOptedIn = true;
    if (order?.customerUid) {
        try {
            const prefSnap = await get(ref(db, `users/${order.customerUid}/profile/notificationPreferences`));
            if (prefSnap.exists()) {
                const prefs = prefSnap.val() || {};
                if (prefs.orderAlerts === false) custOptedIn = false;
            }
        } catch {
            // Keep default true if unreadable
        }

        const notifId = idempotentKey || `ord_${orderId}_${statusKey}`;
        await set(ref(db, `users/${order.customerUid}/notifications/${notifId}`), {
            id: notifId,
            orderId,
            status: statusKey,
            title,
            body: message,
            createdAt: now,
            read: false
        }).catch(() => {});
    }

    let notifStatus = "created";
    let pushTargeted = 0;
    let pushSent = 0;
    let pushFailed = 0;
    let deliveryResults = [];
    let failureDetails = "";

    if (order?.customerUid && custOptedIn) {
        try {
            const { workerUrl } = await getPublicPushConfig();
            const authToken = session?.user ? await session.user.getIdToken() : "";
            if (workerUrl && authToken) {
                const res = await dispatchWorkerPush({
                    workerUrl,
                    authToken,
                    payload: {
                        type: "customer_order_update",
                        customerUid: order.customerUid,
                        orderId,
                        status: statusKey,
                        title,
                        body: message
                    }
                });
                pushTargeted = res.targeted;
                pushSent = res.sentToProvider;
                pushFailed = res.failed;
                deliveryResults = res.deliveryResults || [];
                if (pushSent > 0) notifStatus = "sent_to_provider";
                else if (pushTargeted > 0 && pushFailed === pushTargeted) notifStatus = "failed";
                else notifStatus = "created";
            }
        } catch (pushErr) {
            failureDetails = String(pushErr?.message || "Push worker skipped").slice(0, 180);
            notifStatus = "failed";
        }
    } else if (order?.customerUid && !custOptedIn) {
        failureDetails = "Customer disabled push alerts; in-app inbox entry saved.";
    }

    await recordNotificationHistory("orders", {
        id: idempotentKey || `ord_${orderId}_${statusKey}`,
        title,
        message,
        type: `order_${statusKey}`,
        targetAudience: order?.customerUid ? `customer:${order.customerUid}` : `guest_tracking:${orderId}`,
        status: notifStatus,
        actorUid,
        failureDetails,
        targetedCount: pushTargeted,
        sentCount: pushSent,
        failedCount: pushFailed,
        deliveryResults
    });

    if (skipPushIfAlreadyNotified) {
        await update(ref(db, `orders/${orderId}/notifiedStatuses`), {
            [statusKey]: now
        }).catch(() => {});
    }

    return { skipped: false, status: notifStatus, targeted: pushTargeted, sentToProvider: pushSent, failed: pushFailed };
}

function renderOrderCard(id, order, canUpdate, allowedStatuses) {
    const safeId = Utils.escapeHTML(id);
    const items = Array.isArray(order.items) ? order.items : Object.values(order.items || {});
    const itemList = items.map((item) => `<li>${Utils.escapeHTML(item.quantity)} × ${Utils.escapeHTML(item.name)}</li>`).join("");
    const status = STATUSES.includes(order.status) ? order.status : "pending";
    const phoneDigits = String(order.customerPhone || "").replace(/\D/g, "");
    const whatsappPhone = phoneDigits.length === 10 ? `977${phoneDigits}` : phoneDigits;
    const whatsappMessage = encodeURIComponent(
        `Namaste ${order.customerName || ""}, this is Siranchowk Khaja Ghar regarding your website order ${id}.`
    );

    const selectable = allowedStatuses.includes(status) ? allowedStatuses : [status, ...allowedStatuses];
    const uniqueStatuses = [...new Set(selectable)];
    const options = uniqueStatuses.map((value) => `
        <option value="${value}" ${status === value ? "selected" : ""}>${STATUS_LABELS[value] || value}</option>
    `).join("");

    const isTerminal = status === "delivered" || status === "cancelled";

    return `
        <article class="skg-order-card" data-order-card="${safeId}">
            <div class="skg-order-card-head">
                <div>
                    <div class="skg-order-ref">
                        ORDER #${Utils.escapeHTML(id.slice(-8).toUpperCase())}
                        ${order.customerUid ? ' · <span class="badge badge-info">Registered Customer</span>' : ""}
                        ${order.couponCode ? ` · <span class="badge badge-success">Coupon: ${Utils.escapeHTML(order.couponCode)}</span>` : ""}
                        ${order.inventoryDeducted === true ? ' · <span class="badge badge-success">Stock Deducted</span>' : (order.inventoryRestoredAt ? ' · <span class="badge badge-warning">Stock Restored</span>' : "")}
                    </div>
                    <h3 class="skg-order-name">${Utils.escapeHTML(order.customerName || "Customer")}</h3>
                    <div class="skg-order-meta">
                        <span>${Utils.escapeHTML(Utils.formatDate(order.createdAt))}</span>
                        <span>${Utils.escapeHTML(order.orderType || "Order")}</span>
                    </div>
                </div>
                <span class="skg-status ${Utils.escapeHTML(status)}">${Utils.escapeHTML(STATUS_LABELS[status] || status)}</span>
            </div>

            <div class="skg-order-items">
                <strong>Items</strong>
                <ul>${itemList || "<li>Item details unavailable</li>"}</ul>
            </div>

            <div class="skg-order-details">
                <div><strong>Customer Phone</strong>${Utils.escapeHTML(order.customerPhone || "Not provided")}</div>
                <div><strong>Delivery Address</strong>${Utils.escapeHTML(order.deliveryAddress || "Pickup / Not specified")}</div>
                <div><strong>Special Instructions</strong>${Utils.escapeHTML(order.notes || "None")}</div>
                <div><strong>Pricing Note</strong>Confirm total directly with customer before kitchen dispatch</div>
            </div>

            <div class="skg-order-actions">
                ${canUpdate ? `
                  <label class="sr-only" for="status-${safeId}">Order status</label>
                  <select id="status-${safeId}" data-status-select="${safeId}">${options}</select>
                  <button type="button" data-save-order="${safeId}">Save status</button>
                  ${!isTerminal ? `<button type="button" class="skg-btn-warn" data-delay-order="${safeId}">Delay Alert</button>` : ""}
                  <button type="button" class="skg-btn-muted" data-payment-order="${safeId}">Payment / Refund</button>
                ` : '<span class="form-hint">Read-only order access for your role</span>'}

                ${phoneDigits ? `<a href="tel:${Utils.escapeHTML(phoneDigits)}">Call customer</a>` : ""}
                ${whatsappPhone ? `<a href="https://wa.me/${Utils.escapeHTML(whatsappPhone)}?text=${whatsappMessage}" target="_blank" rel="noopener noreferrer">WhatsApp customer</a>` : ""}
            </div>
        </article>
    `;
}

const OrdersModule = {
    async render(container) {
        addAdminOrderStyles();
        const session = getAdminSession();
        const canUpdate = hasPermission("updateOrders");
        const canCancel = hasPermission("cancelOrders");
        const allowedStatuses = getAllowedOrderStatusesForRole(session?.role, session?.permissions);

        container.innerHTML = `
            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Customer Orders</h2>
                        <p class="card-subtitle">Live website orders synced with customer tracking, idempotent templates &amp; account history.</p>
                    </div>
                    <button type="button" class="btn btn-primary" id="skg-enable-admin-notifications">
                        🔔 Enable Device Alerts
                    </button>
                </div>

                <div class="skg-live-status" id="skg-orders-connection">
                    <span class="skg-live-dot"></span> Connecting to live orders…
                </div>

                <div class="skg-admin-order-toolbar">
                    <input type="search" id="skg-order-search" placeholder="Search customer name, phone, or order ID" aria-label="Search orders">
                    <select id="skg-order-filter" aria-label="Filter orders">
                        <option value="all">All orders</option>
                        ${STATUSES.map((status) => `<option value="${status}">${STATUS_LABELS[status]}</option>`).join("")}
                    </select>
                </div>

                <div class="skg-order-list" id="skg-order-list">
                    <div class="skg-order-empty">Loading orders…</div>
                </div>
            </section>
            <p class="form-hint" style="margin-top:12px">
                Orders remain unconfirmed requests until staff accept them after checking item availability and pricing. Delivery alerts never trigger until explicitly marked Delivered.
            </p>
        `;

        const notifBtn = container.querySelector("#skg-enable-admin-notifications");
        if (session?.device?.pushStatus === "enabled" && "Notification" in window && Notification.permission === "granted") {
            notifBtn.textContent = "✓ Device Alerts Active";
        }
        notifBtn?.addEventListener("click", async () => {
            try {
                if (!session?.device?.deviceId) {
                    UIModule.showToast("Device ID unavailable. Reload the admin panel.", "error");
                    return;
                }
                if (session.device.approvalStatus !== "approved") {
                    UIModule.showToast("This device is pending Owner approval before push alerts can be enabled.", "error");
                    return;
                }
                notifBtn.disabled = true;
                await registerAdminDevicePush(session.device.deviceId, true);
                session.device.pushStatus = "enabled";
                notifBtn.textContent = "✓ Device Alerts Active";
                UIModule.showToast("This device is now registered for approved admin alerts.", "success");
            } catch (error) {
                UIModule.showToast(error?.message || "Could not enable browser alerts.", "error");
            } finally {
                notifBtn.disabled = false;
            }
        });

        const list = container.querySelector("#skg-order-list");
        const search = container.querySelector("#skg-order-search");
        const filter = container.querySelector("#skg-order-filter");
        const connection = container.querySelector("#skg-orders-connection");

        let latest = cachedOrders;

        const draw = () => {
            const query = search.value.trim().toLowerCase();
            const statusFilter = filter.value;

            const entries = Object.entries(latest).sort(
                (a, b) => Number(b[1].createdAt || 0) - Number(a[1].createdAt || 0)
            );

            const filtered = entries.filter(([id, order]) => {
                const matchesStatus = statusFilter === "all" || order.status === statusFilter;
                const haystack = [id, order.customerName, order.customerPhone, order.summary].join(" ").toLowerCase();
                return matchesStatus && haystack.includes(query);
            });

            if (!filtered.length) {
                list.innerHTML = '<div class="skg-order-empty">No orders match this filter yet.</div>';
                return;
            }

            list.innerHTML = filtered
                .map(([id, order]) => renderOrderCard(id, order, canUpdate, allowedStatuses))
                .join("");

            list.querySelectorAll("[data-save-order]").forEach((saveButton) => {
                saveButton.addEventListener("click", async () => {
                    const id = saveButton.dataset.saveOrder;
                    const order = latest[id];
                    const select = list.querySelector(`[data-status-select="${CSS.escape(id)}"]`);
                    const nextStatus = select?.value;

                    if (!order || !STATUSES.includes(nextStatus)) return;
                    if (!allowedStatuses.includes(nextStatus)) {
                        UIModule.showToast("Your role does not allow setting that status.", "error");
                        return;
                    }
                    if (nextStatus === "cancelled" && !canCancel) {
                        UIModule.showToast("Your role does not have permission to cancel orders.", "error");
                        return;
                    }
                    if (nextStatus === order.status) {
                        UIModule.showToast("Order already has this status.", "info");
                        return;
                    }

                    if (nextStatus === "cancelled") {
                        const confirmed = await UIModule.confirm({
                            title: "Cancel Customer Order?",
                            message: `Cancel order #${id.slice(-8).toUpperCase()} for ${order.customerName || "Customer"}? This will immediately notify their tracking page.`,
                            confirmText: "Yes, Cancel Order",
                            cancelText: "Keep Order",
                            dangerous: true
                        });
                        if (!confirmed) {
                            if (select) select.value = order.status || "pending";
                            return;
                        }
                    }

                    saveButton.disabled = true;
                    saveButton.textContent = "Saving…";

                    const now = Date.now();
                    const templates = await getOrderNotificationTemplates();
                    const message = renderOrderTemplate(templates, nextStatus, id);

                    try {
                        await update(ref(db, `orders/${id}`), {
                            status: nextStatus,
                            updatedAt: now,
                            updatedByUid: session?.user?.uid || "",
                            updatedByRole: session?.role || ""
                        });

                        if (order.customerTrackingToken) {
                            await update(ref(db, `orderTracking/${order.customerTrackingToken}`), {
                                status: nextStatus,
                                updatedAt: now,
                                customerMessage: message
                            }).catch((err) => console.warn("Tracking token update warning:", err));
                        }

                        if (order.customerUid) {
                            await update(ref(db, `users/${order.customerUid}/orders/${id}`), {
                                status: nextStatus,
                                updatedAt: now,
                                customerMessage: message
                            }).catch((err) => console.warn("Customer order mirror warning:", err));
                        }

                        await sendOrderCustomerNotification({
                            orderId: id,
                            order,
                            statusKey: nextStatus,
                            title: `Order #${id.slice(-8).toUpperCase()} — ${STATUS_LABELS[nextStatus] || nextStatus}`,
                            message,
                            idempotentKey: `ord_${id}_${nextStatus}`,
                            session,
                            skipPushIfAlreadyNotified: true
                        });

                        // Notify approved Admin devices about cancellations or important updates via Worker
                        try {
                            const { workerUrl } = await getPublicPushConfig();
                            const authToken = session?.user ? await session.user.getIdToken() : "";
                            if (workerUrl && authToken && (nextStatus === "cancelled" || nextStatus === "delivered")) {
                                const alertCategory = nextStatus === "cancelled" ? "orderCancellations" : "orderUpdates";
                                const adminTitle = nextStatus === "cancelled"
                                    ? `Order #${id.slice(-8).toUpperCase()} Cancelled`
                                    : `Order #${id.slice(-8).toUpperCase()} Delivered`;
                                const adminBody = `${order.customerName || "Customer"} · Marked ${STATUS_LABELS[nextStatus]} by ${session?.staff?.name || session?.role}`;
                                const res = await dispatchWorkerPush({
                                    workerUrl,
                                    authToken,
                                    payload: {
                                        type: "admin_alert",
                                        category: alertCategory,
                                        title: adminTitle,
                                        body: adminBody,
                                        targetType: "all"
                                    }
                                });
                                await recordNotificationHistory("admin", {
                                    title: adminTitle,
                                    message: adminBody,
                                    type: alertCategory,
                                    targetAudience: "all_approved_admin_devices",
                                    status: res.sentToProvider > 0 ? "sent_to_provider" : "created",
                                    actorUid: session?.user?.uid || "system",
                                    targetedCount: res.targeted,
                                    sentCount: res.sentToProvider,
                                    failedCount: res.failed,
                                    deliveryResults: res.deliveryResults
                                });
                            }
                        } catch {
                            // Do not fail order status update if optional admin push worker is unavailable
                        }

                        const CONFIRM_STATUSES = ["accepted", "preparing", "ready", "dispatched", "delivered"];
                        let stockSummaryToast = "";
                        try {
                            if (CONFIRM_STATUSES.includes(nextStatus) && order.inventoryDeducted !== true) {
                                const res = await deductInventoryForOrder(id, order, session);
                                if (res.deductedCount > 0) {
                                    const parts = [`${res.deductedCount} stock item(s) deducted`];
                                    if (res.alertsTriggered.length > 0) parts.push(`${res.alertsTriggered.length} low-stock alert(s)`);
                                    if (res.disabledDishes.length > 0) parts.push(`auto-paused: ${res.disabledDishes.map((d) => d.name).join(", ")}`);
                                    stockSummaryToast = parts.join(" · ");
                                }
                            } else if (nextStatus === "cancelled" && order.inventoryDeducted === true) {
                                const res = await restoreInventoryForOrder(id, order, session);
                                if (res.restoredCount > 0) {
                                    stockSummaryToast = `${res.restoredCount} linked stock item(s) restored.`;
                                }
                            }
                        } catch (invErr) {
                            console.warn("Inventory order sync warning:", invErr);
                        }

                        if (order.customerUid) {
                            await logCustomerActivity(order.customerUid, "order_status_changed", {
                                orderId: id,
                                previousStatus: order.status || "pending",
                                nextStatus
                            });
                        }

                        await logAuditEvent({
                            actorUid: session?.user?.uid || "",
                            actorName: session?.staff?.name || session?.user?.displayName || "",
                            actorEmail: session?.user?.email || "",
                            actorRole: session?.role || "staff",
                            action: "order_status_updated",
                            target: id,
                            metadata: { previousStatus: order.status || "pending", nextStatus }
                        });

                        UIModule.showToast(`Order #${id.slice(-8).toUpperCase()} updated to ${STATUS_LABELS[nextStatus]}.`, "success");
                        if (stockSummaryToast) {
                            UIModule.showToast(`Inventory: ${stockSummaryToast}`, "info");
                        }
                        saveButton.textContent = "Saved";
                    } catch (error) {
                        console.error("Order status update failed:", error);
                        UIModule.showToast(`Could not update order: ${error.message}`, "error");
                        saveButton.disabled = false;
                        saveButton.textContent = "Save status";
                    }
                });
            });

            // Delay Alert & Payment/Refund Update handlers (Modal-based, no window.prompt)
            list.querySelectorAll("[data-delay-order], [data-payment-order]").forEach((actionBtn) => {
                actionBtn.addEventListener("click", async () => {
                    const isDelay = Boolean(actionBtn.dataset.delayOrder);
                    const id = actionBtn.dataset.delayOrder || actionBtn.dataset.paymentOrder;
                    const order = latest[id];
                    if (!order) return;

                    const templates = await getOrderNotificationTemplates();
                    const statusKey = isDelay ? "delayed" : "payment_update";
                    const defaultMsg = renderOrderTemplate(templates, statusKey, id);

                    const modalBody = `
                      <form id="skg-order-custom-notif-form" class="skg-stack-form">
                        <p class="form-hint">Send a customized ${isDelay ? "order delay notice" : "payment or refund update"} for order <strong>#${Utils.escapeHTML(id.slice(-8).toUpperCase())}</strong> (${Utils.escapeHTML(order.customerName || "Customer")}).</p>
                        <div class="form-group">
                          <label class="form-label" for="skg-ord-msg-input">Message to Customer</label>
                          <textarea class="form-control" id="skg-ord-msg-input" required maxlength="240">${Utils.escapeHTML(defaultMsg)}</textarea>
                        </div>
                      </form>
                    `;
                    const modalFooter = `
                      <button type="button" class="btn btn-secondary" id="skg-ord-notif-cancel">Cancel</button>
                      <button type="button" class="btn btn-primary" id="skg-ord-notif-send">Send Customer Update</button>
                    `;
                    UIModule.openModal(isDelay ? "Send Order Delay Notice" : "Send Payment / Refund Update", modalBody, modalFooter);

                    document.getElementById("skg-ord-notif-cancel")?.addEventListener("click", () => UIModule.closeModal());
                    document.getElementById("skg-ord-notif-send")?.addEventListener("click", async () => {
                        const msg = document.getElementById("skg-ord-msg-input")?.value.trim();
                        if (!msg) return;
                        const now = Date.now();
                        try {
                            if (order.customerTrackingToken) {
                                await update(ref(db, `orderTracking/${order.customerTrackingToken}`), {
                                    customerMessage: msg,
                                    updatedAt: now
                                }).catch(() => {});
                            }
                            if (order.customerUid) {
                                await update(ref(db, `users/${order.customerUid}/orders/${id}`), {
                                    customerMessage: msg,
                                    updatedAt: now
                                }).catch(() => {});
                            }
                            await sendOrderCustomerNotification({
                                orderId: id,
                                order,
                                statusKey,
                                title: isDelay
                                    ? `Order #${id.slice(-8).toUpperCase()} Delay Notice`
                                    : `Order #${id.slice(-8).toUpperCase()} Payment / Refund Update`,
                                message: msg,
                                idempotentKey: `ord_${id}_${statusKey}_${now}`,
                                session,
                                skipPushIfAlreadyNotified: false
                            });
                            await logAuditEvent({
                                actorUid: session?.user?.uid || "",
                                actorName: session?.staff?.name || "",
                                actorEmail: session?.user?.email || "",
                                actorRole: session?.role || "staff",
                                action: isDelay ? "order_delay_notified" : "order_payment_notified",
                                target: id,
                                metadata: { message: msg.slice(0, 120) }
                            });
                            UIModule.closeModal();
                            UIModule.showToast("Customer order update dispatched.", "success");
                        } catch (err) {
                            UIModule.showToast(err?.message || "Failed to send update.", "error");
                        }
                    });
                });
            });
        };

        search.addEventListener("input", draw);
        filter.addEventListener("change", draw);

        if (container._skgOrderUnsubscribe) container._skgOrderUnsubscribe();
        container._skgOrderUnsubscribe = subscribeToOrders((orders, error) => {
            latest = orders || {};
            if (error) {
                connection.textContent = `Unable to load orders: ${error.message}`;
                list.innerHTML = '<div class="skg-order-error">Could not connect to Firebase Realtime Database. Check rules and permissions.</div>';
                return;
            }
            connection.innerHTML = `<span class="skg-live-dot"></span> Live connection · ${Object.keys(latest).length} order(s)`;
            draw();
        });
    }
};

export { OrdersModule, startOrderMonitor, subscribeToOrders };
