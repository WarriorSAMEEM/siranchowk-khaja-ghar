import { db, ref, onValue } from "./firebase.js";

const HISTORY_KEY = "skg_customer_orders_v1";
const LEGACY_TRACKING_KEY = "skg_customer_tracking_v2";
const labels = {
  pending: "Received — awaiting confirmation",
  accepted: "Accepted",
  preparing: "Preparing your order",
  ready: "Ready for pickup",
  dispatched: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled"
};
const terminal = new Set(["delivered", "cancelled"]);
let history = [];
let notificationAllowed = false;
const listeners = new Map();

const safe = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function readHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    history = Array.isArray(data) ? data.filter(x => x && x.id) : [];
  } catch { history = []; }
  // Older version stored only the latest order's tracking token. Keep it visible if it is not already listed.
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_TRACKING_KEY) || "null");
    if (legacy?.id && !history.some(x => x.id === legacy.id)) {
      history.unshift({ id: legacy.id, token: legacy.token || null, customerName: "Previous customer", items: [], summary: "Order details from an earlier version are not stored on this device.", status: "pending", createdAt: Date.now(), legacy: true });
    }
  } catch {}
}
function saveHistory() { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0,50))); } catch {} }
function dateLabel(value) {
  const date = new Date(Number(value) || value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
}
function render() {
  const total = history.length;
  const active = history.filter(o => !terminal.has(o.status || "pending")).length;
  const completed = history.filter(o => o.status === "delivered").length;
  document.getElementById("account-total").textContent = total;
  document.getElementById("account-active").textContent = active;
  document.getElementById("account-completed").textContent = completed;
  const host = document.getElementById("account-orders");
  if (!total) {
    host.innerHTML = `<div class="account-card account-empty"><div style="font-size:38px">🧾</div><h3>No orders saved on this device yet</h3><p class="account-muted">Your new website orders will appear here after you place them.</p><a class="account-btn" href="menu.html">Explore the menu</a></div>`;
    return;
  }
  host.innerHTML = history.map(order => {
    const status = order.status || "pending";
    const items = Array.isArray(order.items) && order.items.length
      ? order.items.map(i => `${safe(i.quantity)} × ${safe(i.name)}`).join("<br>")
      : safe(order.summary || "Order items unavailable");
    const shortId = safe(String(order.id).slice(-8).toUpperCase());
    return `<article class="account-card"><div class="account-order-top"><div><h3>Order #${shortId}</h3><div class="account-muted">${dateLabel(order.createdAt)}</div></div><span class="account-status ${safe(status)}">${safe(labels[status] || status)}</span></div><div class="account-items">${items}</div><div class="account-order-bottom"><span class="account-muted">${safe(order.orderType || "Order")} · ${safe(order.customerName || "Customer")}</span><span class="account-muted">${order.legacy ? "Older tracking record" : safe(order.customerPhone || "")}</span></div>${order.customerTrackingToken || order.token ? "" : "<p class='account-muted'>Live status token is not available for this order.</p>"}</article>`;
  }).join("");
}
function watchOrders() {
  history.forEach(order => {
    const token = order.token || order.customerTrackingToken;
    if (!token || listeners.has(token)) return;
    let first = true;
    let previous = order.status || "pending";
    const unsubscribe = onValue(ref(db, `orderTracking/${token}`), snapshot => {
      if (!snapshot.exists()) return;
      const data = snapshot.val();
      const current = data.status || "pending";
      const target = history.find(x => x.id === order.id);
      if (target) {
        target.status = current;
        target.customerMessage = data.customerMessage || "";
        saveHistory();
        render();
      }
      if (!first && current !== previous && notificationAllowed && "Notification" in window) {
        new Notification("Siranchowk Khaja Ghar — Order update", { body: labels[current] || current, icon: "/assets/icons/favicon.svg" });
      }
      previous = current;
      first = false;
    }, error => console.warn("Could not refresh order status", error));
    listeners.set(token, unsubscribe);
  });
}
document.getElementById("enable-notifications")?.addEventListener("click", async () => {
  if (!("Notification" in window)) { alert("This browser does not support notifications."); return; }
  const permission = await Notification.requestPermission();
  notificationAllowed = permission === "granted";
  document.getElementById("enable-notifications").textContent = notificationAllowed ? "Notifications enabled" : "Permission not granted";
});
readHistory();
render();
watchOrders();
