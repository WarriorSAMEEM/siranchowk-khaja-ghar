
import { db, ref, onValue, update } from "../../js/firebase.js";

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
    pending: "New",
    accepted: "Accepted",
    preparing: "Preparing",
    ready: "Ready",
    dispatched: "Out for delivery",
    delivered: "Completed",
    cancelled: "Cancelled"
};

let cachedOrders = {};
let monitorStarted = false;
let monitorUnsubscribe = null;
let initialSnapshot = true;

const orderSubscribers = new Set();

const ADMIN_ORDER_ICONS = {
    pending: "🕒",
    accepted: "✓",
    preparing: "🍳",
    ready: "✓",
    dispatched: "🛵",
    delivered: "✓",
    cancelled: "✕"
};

const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);

function notifyAdmin(title, body) {
    const toast = document.createElement("div");
    toast.className = "skg-admin-toast";
    toast.setAttribute("role", "status");

    toast.innerHTML = `
        <strong>${escapeHTML(title)}</strong>
        <span>${escapeHTML(body)}</span>
    `;

    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 6500);

    if (
        "Notification" in window &&
        Notification.permission === "granted"
    ) {
        try {
            new Notification(title, {
                body,
                icon: "/assets/icons/favicon.svg"
            });
        } catch (error) {
            console.warn("Browser notification failed:", error);
        }
    }
}

function addAdminOrderStyles() {
    if (document.getElementById("skg-admin-order-styles")) return;

    const style = document.createElement("style");
    style.id = "skg-admin-order-styles";

    style.textContent = `
        .skg-admin-order-toolbar {
            display:flex;
            flex-wrap:wrap;
            gap:10px;
            align-items:center;
            margin:16px 0;
        }

        .skg-admin-order-toolbar input,
        .skg-admin-order-toolbar select {
            min-height:42px;
            padding:9px 12px;
            border:1px solid var(--border-color,#dce5e3);
            border-radius:10px;
            background:#fff;
            color:#173c38;
            font:inherit;
        }

        .skg-admin-order-toolbar input {
            flex:1 1 220px;
        }

        .skg-live-dot {
            display:inline-block;
            width:8px;
            height:8px;
            border-radius:50%;
            background:#16a36d;
            margin-right:7px;
        }

        .skg-order-list {
            display:grid;
            gap:12px;
            margin-top:12px;
        }

        .skg-order-card {
            padding:17px;
            border:1px solid #e2ebe8;
            border-radius:16px;
            background:#fff;
            box-shadow:0 3px 12px #153c3710;
        }

        .skg-order-card-head {
            display:flex;
            justify-content:space-between;
            align-items:flex-start;
            gap:12px;
        }

        .skg-order-ref {
            font-size:12px;
            color:#6a817d;
            font-weight:700;
        }

        .skg-order-name {
            margin:4px 0;
            font-size:17px;
            font-weight:800;
            color:#183b37;
        }

        .skg-order-meta {
            display:flex;
            flex-wrap:wrap;
            gap:8px 14px;
            color:#6b807c;
            font-size:12px;
        }

        .skg-order-items {
            margin:14px 0;
            padding:12px 14px;
            border-radius:11px;
            background:#f6faf9;
            color:#294d47;
            font-size:14px;
            line-height:1.6;
        }

        .skg-order-items ul {
            margin:0;
            padding-left:18px;
        }

        .skg-order-details {
            display:grid;
            grid-template-columns:repeat(2,minmax(0,1fr));
            gap:10px;
            margin:10px 0;
            color:#49635e;
            font-size:13px;
        }

        .skg-order-details strong {
            display:block;
            margin-bottom:3px;
            color:#274640;
        }

        .skg-order-actions {
            display:flex;
            flex-wrap:wrap;
            align-items:center;
            gap:8px;
            margin-top:13px;
            padding-top:13px;
            border-top:1px solid #edf1ef;
        }

        .skg-order-actions select {
            min-height:38px;
            min-width:145px;
            padding:7px 10px;
            border:1px solid #d5e1de;
            border-radius:9px;
            background:#fff;
            color:#173c38;
        }

        .skg-order-actions button,
        .skg-order-actions a {
            display:inline-flex;
            align-items:center;
            justify-content:center;
            min-height:38px;
            padding:8px 12px;
            border:0;
            border-radius:9px;
            background:#087f78;
            color:#fff;
            font-size:13px;
            font-weight:800;
            text-decoration:none;
            cursor:pointer;
        }

        .skg-order-actions a {
            background:#e9f7ef;
            color:#176b3b;
        }

        .skg-order-actions button:disabled {
            opacity:.6;
            cursor:wait;
        }

        .skg-status {
            display:inline-flex;
            padding:5px 10px;
            border-radius:999px;
            background:#fff5dd;
            color:#8a5a09;
            font-size:11px;
            font-weight:900;
            text-transform:uppercase;
        }

        .skg-status.accepted,
        .skg-status.preparing {
            background:#eaf2ff;
            color:#285c9a;
        }

        .skg-status.ready,
        .skg-status.delivered {
            background:#e8f7ef;
            color:#176b3b;
        }

        .skg-status.cancelled {
            background:#fff0ef;
            color:#a43b34;
        }

        .skg-order-empty,
        .skg-order-error {
            padding:28px;
            border:1px dashed #d6e3df;
            border-radius:14px;
            text-align:center;
            color:#6b817c;
            background:#fbfdfc;
        }

        .skg-admin-toast {
            position:fixed;
            z-index:99999;
            right:22px;
            top:22px;
            display:grid;
            gap:4px;
            width:min(360px,calc(100vw - 32px));
            padding:15px 17px;
            border:1px solid #b8ddd2;
            border-radius:14px;
            background:#f2fbf7;
            color:#1d5144;
            box-shadow:0 14px 42px #102f2d28;
            animation:skgToastIn .25s ease;
        }

        .skg-admin-toast span {
            font-size:13px;
            line-height:1.45;
        }

        @keyframes skgToastIn {
            from { opacity:0; transform:translateY(-8px); }
            to { opacity:1; transform:translateY(0); }
        }

        @media(max-width:600px) {
            .skg-order-details {
                grid-template-columns:1fr;
            }

            .skg-order-card-head {
                flex-direction:column;
            }

            .skg-order-actions select {
                flex:1;
            }
        }

        @media(prefers-reduced-motion:reduce) {
            .skg-admin-toast { animation:none; }
        }
    `;

    document.head.appendChild(style);
}

function formatDate(timestamp) {
    if (!Number.isFinite(Number(timestamp))) {
        return "Time not available";
    }

    return new Intl.DateTimeFormat("en-NP", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kathmandu"
    }).format(new Date(Number(timestamp)));
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
                        notifyAdmin(
                            "New website order",
                            `${order.customerName || "Customer"} • ${order.summary || id}`
                        );
                    } else if (previous.status !== order.status) {
                        notifyAdmin(
                            "Order status updated",
                            `${order.customerName || "Customer"} • ${STATUS_LABELS[order.status] || order.status}`
                        );
                    }
                });
            }

            cachedOrders = nextOrders;
            initialSnapshot = false;

            const pendingCount = Object.values(cachedOrders)
                .filter((order) => order?.status === "pending")
                .length;

            const badge = document.getElementById("pending-orders-count");

            if (badge) {
                badge.textContent = String(pendingCount);
                badge.classList.toggle("hidden", pendingCount === 0);
            }

            orderSubscribers.forEach((callback) => {
                callback(cachedOrders, null);
            });
        },

        (error) => {
            console.error("Admin live order monitor failed:", error);

            monitorStarted = false;
            monitorUnsubscribe = null;

            orderSubscribers.forEach((callback) => {
                callback(cachedOrders, error);
            });

            notifyAdmin(
                "Order connection problem",
                "Live orders could not be loaded. Check Firebase rules and connection."
            );
        }
    );

    return monitorUnsubscribe;
}

async function enableBrowserNotifications(button) {
    if (!("Notification" in window)) {
        alert(
            "This browser does not support desktop notifications. In-panel notifications will still work."
        );
        return;
    }

    try {
        const permission = await Notification.requestPermission();

        if (permission === "granted") {
            button.textContent = "✓ Browser alerts enabled";
            button.disabled = true;

            notifyAdmin(
                "Notifications enabled",
                "New orders and status changes will appear here."
            );
        } else {
            button.textContent = "Notifications blocked";

            alert(
                "Browser notifications were not allowed. In-panel alerts will continue while the admin panel is open."
            );
        }
    } catch (error) {
        console.error("Notification permission error:", error);
        alert("Could not enable browser notifications.");
    }
}

function renderOrderCard(id, order) {
    const safeId = escapeHTML(id);

    const items = Array.isArray(order.items)
        ? order.items
        : Object.values(order.items || {});

    const itemList = items.map((item) => `
        <li>
            ${escapeHTML(item.quantity)} × ${escapeHTML(item.name)}
        </li>
    `).join("");

    const status = STATUSES.includes(order.status)
        ? order.status
        : "pending";

    const phoneDigits = String(order.customerPhone || "")
        .replace(/\D/g, "");

    const whatsappPhone = phoneDigits.length === 10
        ? `977${phoneDigits}`
        : phoneDigits;

    const whatsappMessage = encodeURIComponent(
        `Namaste ${order.customerName || ""}, this is Siranchowk Khaja Ghar regarding your website order ${id}.`
    );

    const options = STATUSES.map((value) => `
        <option value="${value}" ${status === value ? "selected" : ""}>
            ${STATUS_LABELS[value]}
        </option>
    `).join("");

    return `
        <article class="skg-order-card" data-order-card="${safeId}">
            <div class="skg-order-card-head">
                <div>
                    <div class="skg-order-ref">
                        ORDER #${escapeHTML(id.slice(-8).toUpperCase())}
                    </div>

                    <h3 class="skg-order-name">
                        ${escapeHTML(order.customerName || "Customer")}
                    </h3>

                    <div class="skg-order-meta">
                        <span>${escapeHTML(formatDate(order.createdAt))}</span>
                        <span>${escapeHTML(order.orderType || "Order")}</span>
                    </div>
                </div>

                <span class="skg-status ${escapeHTML(status)}">
                    ${escapeHTML(STATUS_LABELS[status])}
                </span>
            </div>

            <div class="skg-order-items">
                <strong>Items</strong>
                <ul>
                    ${itemList || "<li>Item details unavailable</li>"}
                </ul>
            </div>

            <div class="skg-order-details">
                <div>
                    <strong>Customer phone</strong>
                    ${escapeHTML(order.customerPhone || "Not provided")}
                </div>

                <div>
                    <strong>Delivery address</strong>
                    ${escapeHTML(order.deliveryAddress || "Not applicable")}
                </div>

                <div>
                    <strong>Special instructions</strong>
                    ${escapeHTML(order.notes || "None")}
                </div>

                <div>
                    <strong>Price</strong>
                    Confirm with customer — no online price is configured
                </div>
            </div>

            <div class="skg-order-actions">
                <label class="sr-only" for="status-${safeId}">
                    Order status
                </label>

                <select
                    id="status-${safeId}"
                    data-status-select="${safeId}"
                >
                    ${options}
                </select>

                <button type="button" data-save-order="${safeId}">
                    Save status
                </button>

                ${phoneDigits ? `
                    <a href="tel:${escapeHTML(phoneDigits)}">
                        Call customer
                    </a>
                ` : ""}

                ${whatsappPhone ? `
                    <a
                        href="https://wa.me/${escapeHTML(whatsappPhone)}?text=${whatsappMessage}"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        WhatsApp customer
                    </a>
                ` : ""}
            </div>
        </article>
    `;
}

const OrdersModule = {
    async render(container) {
        addAdminOrderStyles();

        container.innerHTML = `
            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Customer orders</h2>
                        <p class="card-subtitle">
                            Live website orders. WhatsApp conversations remain in WhatsApp.
                        </p>
                    </div>

                    <button
                        type="button"
                        class="btn btn-primary"
                        id="skg-enable-admin-notifications"
                    >
                        🔔 Enable browser alerts
                    </button>
                </div>

                <div class="skg-live-status" id="skg-orders-connection">
                    <span class="skg-live-dot"></span>
                    Connecting to live orders…
                </div>

                <div class="skg-admin-order-toolbar">
                    <input
                        type="search"
                        id="skg-order-search"
                        placeholder="Search customer, phone or order ID"
                        aria-label="Search orders"
                    >

                    <select id="skg-order-filter" aria-label="Filter orders">
                        <option value="all">All orders</option>

                        ${STATUSES.map((status) => `
                            <option value="${status}">
                                ${STATUS_LABELS[status]}
                            </option>
                        `).join("")}
                    </select>
                </div>

                <div class="skg-order-list" id="skg-order-list">
                    <div class="skg-order-empty">Loading orders…</div>
                </div>
            </section>

            <p class="form-hint" style="margin-top:12px">
                Website order requests are not confirmed until the restaurant accepts them.
                Final prices and delivery availability must be confirmed with the customer.
            </p>
        `;

        const button = container.querySelector(
            "#skg-enable-admin-notifications"
        );

        button.addEventListener("click", () => {
            enableBrowserNotifications(button);
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
                (a, b) =>
                    Number(b[1].createdAt || 0) -
                    Number(a[1].createdAt || 0)
            );

            const filtered = entries.filter(([id, order]) => {
                const matchesStatus =
                    statusFilter === "all" ||
                    order.status === statusFilter;

                const haystack = [
                    id,
                    order.customerName,
                    order.customerPhone,
                    order.summary
                ].join(" ").toLowerCase();

                return matchesStatus && haystack.includes(query);
            });

            if (!filtered.length) {
                list.innerHTML = `
                    <div class="skg-order-empty">
                        No orders match this view yet.
                    </div>
                `;
                return;
            }

            list.innerHTML = filtered
                .map(([id, order]) => renderOrderCard(id, order))
                .join("");

            list.querySelectorAll("[data-save-order]").forEach(
                (saveButton) => {
                    saveButton.addEventListener("click", async () => {
                        const id = saveButton.dataset.saveOrder;
                        const order = latest[id];

                        const select = list.querySelector(
                            `[data-status-select="${CSS.escape(id)}"]`
                        );

                        const nextStatus = select?.value;

                        if (!order || !STATUSES.includes(nextStatus)) {
                            return;
                        }

                        if (nextStatus === order.status) {
                            notifyAdmin(
                                "No change",
                                "This order already has that status."
                            );
                            return;
                        }

                        saveButton.disabled = true;
                        saveButton.textContent = "Saving…";

                        const now = Date.now();

                        const message =
                            `Your order is now ${STATUS_LABELS[nextStatus] || nextStatus}.`;

                        try {
                            // Update the specific order path, not the database root.
                            await update(
                                ref(db, `orders/${id}`),
                                {
                                    status: nextStatus,
                                    updatedAt: now
                                }
                            );

                            saveButton.textContent = "Saved";

                            notifyAdmin(
                                "Order updated",
                                `${order.customerName || "Customer"} • ${STATUS_LABELS[nextStatus]}`
                            );

                            // Tracking is updated separately.
                            if (order.customerTrackingToken) {
                                try {
                                    await update(
                                        ref(
                                            db,
                                            `orderTracking/${order.customerTrackingToken}`
                                        ),
                                        {
                                            status: nextStatus,
                                            updatedAt: now,
                                            customerMessage: message
                                        }
                                    );
                                } catch (trackingError) {
                                    console.error(
                                        "Order saved, but tracking update failed:",
                                        trackingError
                                    );

                                    notifyAdmin(
                                        "Tracking update warning",
                                        "Order status was saved, but customer tracking could not be updated."
                                    );
                                }
                            }
                        } catch (error) {
                            console.error("Order status update failed:", error);

                            alert(
                                `Could not update this order: ${error.message}`
                            );

                            saveButton.disabled = false;
                            saveButton.textContent = "Save status";
                        }
                    });
                }
            );
        };

        search.addEventListener("input", draw);
        filter.addEventListener("change", draw);

        if (container._skgOrderUnsubscribe) {
            container._skgOrderUnsubscribe();
        }

        container._skgOrderUnsubscribe = subscribeToOrders(
            (orders, error) => {
                latest = orders || {};

                if (error) {
                    connection.textContent =
                        `Unable to load orders: ${error.message}`;

                    list.innerHTML = `
                        <div class="skg-order-error">
                            Could not connect to Firebase. Check the database rules and internet connection.
                        </div>
                    `;

                    return;
                }

                connection.innerHTML = `
                    <span class="skg-live-dot"></span>
                    Live connection • ${Object.keys(latest).length} order(s)
                `;

                draw();
            }
        );
    }
};

export {
    OrdersModule,
    startOrderMonitor,
    subscribeToOrders
};
