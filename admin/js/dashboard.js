import { subscribeToOrders } from "./orders.js";

const DashboardModule = {
    async render(container) {
        container.innerHTML = `
          <section class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Good to see you</h2>
                <p class="card-subtitle">Your restaurant order desk at a glance.</p>
              </div>
              <span class="badge badge-success">Admin session active</span>
            </div>
            <div class="metrics-grid" id="skg-dashboard-metrics">
              <div class="metric-card"><div class="metric-info"><span class="metric-label">Total orders</span><span class="metric-value">—</span><span class="metric-subtext">All website orders</span></div><div class="metric-icon-box">🧾</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">New requests</span><span class="metric-value">—</span><span class="metric-subtext">Waiting for review</span></div><div class="metric-icon-box">🔔</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">In progress</span><span class="metric-value">—</span><span class="metric-subtext">Accepted or preparing</span></div><div class="metric-icon-box">🍳</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">Ready / completed</span><span class="metric-value">—</span><span class="metric-subtext">Ready, dispatched or delivered</span></div><div class="metric-icon-box">✓</div></div>
            </div>
            <div class="skg-dashboard-bottom">
              <div>
                <h3>Order desk</h3>
                <p>Website requests appear here in real time while this admin panel is open. Review each request, contact the customer and update its status.</p>
              </div>
              <a href="#orders" class="btn btn-primary" id="skg-open-orders">Open orders →</a>
            </div>
          </section>
          <section class="card" style="margin-top:18px">
            <div class="card-header"><div><h2 class="card-title">Recent website orders</h2><p class="card-subtitle">Latest customer requests</p></div></div>
            <div id="skg-recent-orders" class="skg-recent-orders"><p class="form-hint">Loading recent orders…</p></div>
          </section>
          <p class="form-hint" style="margin-top:14px">Reminder: a website order is a request, not a confirmed booking. Accept it only after checking availability and confirming the price with the customer.</p>`;

        const metrics = container.querySelector("#skg-dashboard-metrics");
        const recent = container.querySelector("#skg-recent-orders");

        const render = (orders, error) => {
            if (error) {
                recent.innerHTML = `<p class="skg-dashboard-error">Unable to load live orders: ${String(error.message || "Connection error")}</p>`;
                return;
            }
            const list = Object.entries(orders || {}).sort((a, b) =>
                Number(b[1].createdAt || 0) - Number(a[1].createdAt || 0)
            );
            const count = (statuses) => list.filter(([, order]) => statuses.includes(order.status)).length;
            const values = [
                list.length,
                count(["pending"]),
                count(["accepted", "preparing"]),
                count(["ready", "dispatched", "delivered"])
            ];
            metrics.querySelectorAll(".metric-value").forEach((node, index) => {
                node.textContent = String(values[index]);
            });

            if (!list.length) {
                recent.innerHTML = '<div class="skg-recent-empty">No website orders yet. New requests will appear here.</div>';
                return;
            }

            recent.innerHTML = list.slice(0, 5).map(([id, order]) => `
              <div class="skg-recent-row">
                <div><strong>${escapeHTML(order.customerName || "Customer")}</strong><span>${escapeHTML(order.summary || "Order details unavailable")}</span></div>
                <div><b>${escapeHTML(String(order.status || "pending").replaceAll("_", " "))}</b><small>${escapeHTML(formatTime(order.createdAt))}</small></div>
              </div>`).join("");
        };

        const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[char]));
        const formatTime = (value) => {
            if (!Number.isFinite(Number(value))) return "";
            return new Intl.DateTimeFormat("en-NP", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Kathmandu"
            }).format(new Date(Number(value)));
        };

        if (container._skgDashboardUnsubscribe) container._skgDashboardUnsubscribe();
        container._skgDashboardUnsubscribe = subscribeToOrders(render);
    }
};

export { DashboardModule };
