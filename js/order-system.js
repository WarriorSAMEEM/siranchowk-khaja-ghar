
import {
    db,
    ref,
    push,
    set,
    onValue
} from "./firebase.js";

const BUSINESS = {
    name: "Siranchowk Khaja Ghar",
    phone: "9821233154",
    whatsapp: "9779821233154"
};

const CART_KEY = "skg_cart_v2";
const TRACKING_KEY = "skg_customer_tracking_v2";

const cart = new Map();

const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));

function loadCart() {
    try {
        const saved = JSON.parse(
            localStorage.getItem(CART_KEY) || "[]"
        );

        if (Array.isArray(saved)) {
            saved.forEach((item) => {
                if (
                    item &&
                    typeof item.name === "string" &&
                    Number.isInteger(item.quantity) &&
                    item.quantity > 0 &&
                    item.quantity <= 20
                ) {
                    cart.set(item.name, item.quantity);
                }
            });
        }
    } catch (error) {
        console.warn("Saved cart could not be restored.", error);
    }
}

function saveCart() {
    try {
        localStorage.setItem(
            CART_KEY,
            JSON.stringify(
                [...cart].map(([name, quantity]) => ({
                    name,
                    quantity
                }))
            )
        );
    } catch (error) {
        console.warn("Cart could not be saved on this device.", error);
    }
}

function createTrackingToken() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);

    return [...bytes]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function addStyles() {
    if (document.getElementById("skg-order-styles")) return;

    const style = document.createElement("style");

    style.id = "skg-order-styles";

    style.textContent = `
      .skg-add-cart{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:42px;padding:10px 15px;border:1px solid #087f78;border-radius:12px;background:#087f78;color:#fff;font-family:inherit;font-size:14px;font-weight:700;line-height:1.2;cursor:pointer;transition:transform .18s ease,background .18s ease}
      .skg-add-cart:hover{background:#066b65;transform:translateY(-1px)}
      .skg-add-cart:focus-visible,.skg-cart-fab:focus-visible,.skg-panel button:focus-visible{outline:3px solid #67d5c8;outline-offset:3px}
      .skg-cart-fab{position:fixed;z-index:1000;right:20px;bottom:20px;display:flex;align-items:center;gap:10px;padding:14px 19px;border:0;border-radius:999px;background:#123f3b;color:#fff;font-weight:800;box-shadow:0 12px 34px #102f2d35;cursor:pointer}
      .skg-cart-count{display:grid;place-items:center;min-width:23px;height:23px;padding:0 6px;border-radius:99px;background:#fff;color:#123f3b;font-size:12px}
      .skg-modal{position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;padding:16px;background:#102b2bcc;backdrop-filter:blur(5px)}
      .skg-modal.open{display:flex}
      .skg-panel{width:min(600px,100%);max-height:min(92vh,850px);overflow:auto;padding:clamp(20px,4vw,30px);border:1px solid #e3eeeb;border-radius:24px;background:#fff;color:#183b39;box-shadow:0 25px 90px #061d1b55}
      .skg-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
      .skg-panel h2{margin:0 0 5px;font-size:clamp(22px,4vw,28px);letter-spacing:-.03em}
      .skg-panel-subtitle{margin:0;color:#6b817e;font-size:13px;line-height:1.5}
      .skg-close{flex:0 0 auto;width:38px;height:38px;border:0;border-radius:50%;background:#eef5f3;color:#183b39;font-size:19px;cursor:pointer}
      .skg-cart-lines{margin:14px 0 18px}
      .skg-line{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid #e8efed}
      .skg-line-name{font-weight:700;overflow-wrap:anywhere}
      .skg-qty-controls{display:flex;align-items:center;gap:8px;white-space:nowrap}
      .skg-qty-controls button{width:30px;height:30px;border:1px solid #dbe7e4;border-radius:9px;background:#f7faf9;color:#21413e;font-weight:800;cursor:pointer}
      .skg-remove{border-color:#f0d8d5!important;background:#fff7f6!important;color:#a53e35!important}
      .skg-empty{padding:22px 10px;text-align:center;color:#71837f}
      .skg-field{display:grid;gap:6px;margin:13px 0}
      .skg-field label{font-size:13px;font-weight:800;color:#294a46}
      .skg-field input,.skg-field select,.skg-field textarea{width:100%;min-height:46px;box-sizing:border-box;padding:11px 13px;border:1px solid #d5e2df;border-radius:11px;background:#fff;color:#183b39;font:inherit}
      .skg-field textarea{min-height:82px;resize:vertical}
      .skg-field input:focus,.skg-field select:focus,.skg-field textarea:focus{outline:0;border-color:#159f91;box-shadow:0 0 0 3px #159f9120}
      .skg-order-notice{margin:15px 0;padding:13px 15px;border:1px solid #f0dfb7;border-radius:13px;background:#fffaf0;color:#76531c;font-size:13px;line-height:1.55}
      .skg-order-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:17px}
      .skg-order-actions button,.skg-order-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:11px 16px;border:0;border-radius:12px;font-family:inherit;font-size:14px;font-weight:800;text-decoration:none;cursor:pointer}
      .skg-submit{flex:1 1 190px;background:#087f78;color:#fff}
      .skg-whatsapp{flex:1 1 170px;background:#e8f7ef;color:#176b3b}
      .skg-call{flex:1 1 130px;background:#eef4f3;color:#21413e}
      .skg-submit:disabled{opacity:.6;cursor:wait}
      .skg-result{margin-top:16px;padding:15px;border:1px solid #b9e1d6;border-radius:14px;background:#f0faf6;color:#205a49;line-height:1.55}
      .skg-result strong{display:block;margin-bottom:4px}
      .skg-result-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:11px}
      .skg-result-actions button,.skg-result-actions a{padding:9px 12px;border:1px solid #cbded8;border-radius:10px;background:#fff;color:#205a49;font-weight:700;text-decoration:none;cursor:pointer}
      .skg-tracking{margin:14px 0;padding:12px 14px;border:1px solid #d9e9e5;border-radius:12px;background:#f6fbfa;color:#355c55;font-size:13px}
      @media(max-width:520px){.skg-cart-fab{right:14px;bottom:14px;padding:12px 15px}.skg-order-actions{display:grid}.skg-order-actions>*{width:100%}.skg-line{align-items:flex-start}}
      @media(prefers-reduced-motion:reduce){.skg-add-cart{transition:none}}
    `;

    document.head.appendChild(style);
}

function orderItems() {
    return [...cart].map(([name, quantity]) => ({
        name,
        quantity
    }));
}

function totalQuantity() {
    return [...cart.values()].reduce(
        (sum, quantity) => sum + quantity,
        0
    );
}

function mountUI() {
    addStyles();

    if (!document.getElementById("skg-cart-fab")) {
        const button = document.createElement("button");

        button.id = "skg-cart-fab";
        button.className = "skg-cart-fab";
        button.type = "button";
        button.setAttribute("aria-haspopup", "dialog");

        button.innerHTML = `
            🛒 Your cart
            <span class="skg-cart-count" id="skg-cart-count">0</span>
        `;

        button.addEventListener("click", openCart);

        document.body.appendChild(button);
    }

    if (!document.getElementById("skg-checkout-modal")) {
        const modal = document.createElement("div");

        modal.id = "skg-checkout-modal";
        modal.className = "skg-modal";

        modal.innerHTML = `
          <section class="skg-panel" role="dialog" aria-modal="true" aria-labelledby="skg-title">
            <div class="skg-panel-head">
              <div>
                <h2 id="skg-title">Your order</h2>
                <p class="skg-panel-subtitle">
                    Review your items and send your order to our team.
                </p>
              </div>
              <button class="skg-close" type="button" aria-label="Close order panel">×</button>
            </div>

            <div id="skg-cart-lines" class="skg-cart-lines" aria-live="polite"></div>

            <div class="skg-order-notice">
              <strong>Order confirmation notice</strong><br>
              Website orders are requests only. Our team may not see them immediately,
              and the order is not confirmed until we contact you.
              For urgent orders, message us on WhatsApp or call ${BUSINESS.phone}.
              Final prices and delivery availability are confirmed by our team.
            </div>

            <form id="skg-checkout-form" novalidate>
              <div class="skg-field">
                <label for="skg-name">Your name *</label>
                <input id="skg-name" name="customerName" maxlength="80"
                    required autocomplete="name" placeholder="Enter your full name">
              </div>

              <div class="skg-field">
                <label for="skg-phone">Phone number *</label>
                <input id="skg-phone" name="customerPhone" type="tel"
                    maxlength="16" required autocomplete="tel"
                    inputmode="tel" pattern="[0-9+() -]{7,16}"
                    placeholder="98XXXXXXXX">
              </div>

              <div class="skg-field">
                <label for="skg-method">Order method *</label>
                <select id="skg-method" name="orderType" required>
                    <option value="Pickup">Pickup / Takeaway</option>
                    <option value="Delivery">Local delivery (subject to confirmation)</option>
                    <option value="Dine-in">Dine-in</option>
                </select>
              </div>

              <div class="skg-field" id="skg-address-wrap" hidden>
                <label for="skg-address">Delivery address / nearby landmark *</label>
                <input id="skg-address" name="deliveryAddress"
                    maxlength="180" autocomplete="street-address"
                    placeholder="Your delivery location">
              </div>

              <div class="skg-field">
                <label for="skg-notes">
                    Special instructions
                    <span class="skg-panel-subtitle">(optional)</span>
                </label>
                <textarea id="skg-notes" name="notes" maxlength="400"
                    placeholder="Spice preference, instructions, etc."></textarea>
              </div>

              <div class="skg-order-actions">
                <button class="skg-submit" type="submit">
                    Send website order
                </button>

                <button class="skg-whatsapp" id="skg-whatsapp" type="button">
                    Continue on WhatsApp
                </button>

                <a class="skg-call" href="tel:${BUSINESS.phone}">
                    Call ${BUSINESS.phone}
                </a>
              </div>
            </form>

            <div id="skg-result" class="skg-result"
                role="status" aria-live="polite" hidden></div>
          </section>
        `;

        document.body.appendChild(modal);

        modal.querySelector(".skg-close")
            .addEventListener("click", closeCart);

        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeCart();
        });

        modal.querySelector("#skg-whatsapp")
            .addEventListener("click", sendWhatsApp);

        modal.querySelector("#skg-checkout-form")
            .addEventListener("submit", placeOrder);

        modal.querySelector("#skg-method")
            .addEventListener("change", updateDeliveryField);

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeCart();
        });
    }

    document.querySelectorAll(".dish-card").forEach((card) => {
        const footer = card.querySelector(".dish-footer");

        if (!footer || footer.querySelector(".skg-add-cart")) return;

        const name = card.querySelector("h3")?.textContent?.trim();

        if (!name) return;

        const button = document.createElement("button");

        button.type = "button";
        button.className = "skg-add-cart";
        button.textContent = "＋ Add to cart";
        button.setAttribute("aria-label", `Add ${name} to cart`);

        button.addEventListener("click", () => {
            const nextQuantity = (cart.get(name) || 0) + 1;

            if (nextQuantity > 20) {
                showCartMessage("Maximum 20 portions per menu item.");
                return;
            }

            cart.set(name, nextQuantity);

            saveCart();

            const submit = document.querySelector(
                "#skg-checkout-form [type='submit']"
            );

            if (submit) submit.textContent = "Send website order";

            refreshCart();

            button.textContent = "✓ Added";

            window.setTimeout(() => {
                button.textContent = "＋ Add to cart";
            }, 1000);
        });

        footer.appendChild(button);
    });

    refreshCart();
}

function showCartMessage(message) {
    const lines = document.getElementById("skg-cart-lines");

    if (lines) {
        const note = document.createElement("p");

        note.className = "skg-tracking";
        note.textContent = message;

        lines.prepend(note);
    }
}

function refreshCart() {
    const count = document.getElementById("skg-cart-count");

    if (count) {
        count.textContent = String(totalQuantity());
    }

    const lines = document.getElementById("skg-cart-lines");

    if (!lines) return;

    if (!cart.size) {
        lines.innerHTML = `
            <div class="skg-empty">
                Your cart is empty.<br>
                Add a few favourites from the menu to get started.
            </div>
        `;

        return;
    }

    lines.innerHTML = [...cart.entries()].map(([name, quantity]) => `
      <div class="skg-line">
        <span class="skg-line-name">${escapeHTML(name)}</span>

        <span class="skg-qty-controls">
          <button type="button"
              data-dec="${escapeHTML(name)}"
              aria-label="Decrease ${escapeHTML(name)}">−</button>

          <strong>${quantity}</strong>

          <button type="button"
              data-inc="${escapeHTML(name)}"
              aria-label="Increase ${escapeHTML(name)}">+</button>

          <button type="button"
              class="skg-remove"
              data-del="${escapeHTML(name)}"
              aria-label="Remove ${escapeHTML(name)}">×</button>
        </span>
      </div>
    `).join("");

    lines.querySelectorAll("[data-dec]").forEach((button) => {
        button.addEventListener("click", () => {
            const name = button.dataset.dec;
            const quantity = (cart.get(name) || 0) - 1;

            if (quantity <= 0) {
                cart.delete(name);
            } else {
                cart.set(name, quantity);
            }

            saveCart();
            refreshCart();
        });
    });

    lines.querySelectorAll("[data-inc]").forEach((button) => {
        button.addEventListener("click", () => {
            const name = button.dataset.inc;
            const quantity = (cart.get(name) || 0) + 1;

            if (quantity <= 20) {
                cart.set(name, quantity);
            } else {
                showCartMessage("Maximum 20 portions per menu item.");
            }

            saveCart();
            refreshCart();
        });
    });

    lines.querySelectorAll("[data-del]").forEach((button) => {
        button.addEventListener("click", () => {
            cart.delete(button.dataset.del);

            saveCart();
            refreshCart();
        });
    });
}

function updateDeliveryField() {
    const delivery =
        document.getElementById("skg-method")?.value === "Delivery";

    const wrap = document.getElementById("skg-address-wrap");
    const address = document.getElementById("skg-address");

    if (wrap) wrap.hidden = !delivery;
    if (address) address.required = delivery;
}

function openCart() {
    const modal = document.getElementById("skg-checkout-modal");

    if (!modal) return;

    modal.classList.add("open");

    refreshCart();

    modal.querySelector("#skg-name")?.focus();

    document.body.style.overflow = "hidden";
}

function closeCart() {
    const modal = document.getElementById("skg-checkout-modal");

    if (modal) {
        modal.classList.remove("open");
    }

    document.body.style.overflow = "";
}

function getFormValues() {
    const form = document.getElementById("skg-checkout-form");

    return {
        name: form.querySelector("#skg-name").value.trim(),
        phone: form.querySelector("#skg-phone").value.trim(),
        method: form.querySelector("#skg-method").value,
        address: form.querySelector("#skg-address").value.trim(),
        notes: form.querySelector("#skg-notes").value.trim()
    };
}

function validateOrder(values, requireContact = true) {
    if (!cart.size) {
        return "Your cart is empty. Please add at least one item.";
    }

    if (requireContact && values.name.length < 2) {
        return "Please enter your name.";
    }

    if (
        requireContact &&
        !/^[0-9+() -]{7,16}$/.test(values.phone)
    ) {
        return "Please enter a valid phone number.";
    }

    if (values.phone) {
        if (!/^[0-9+() -]{7,16}$/.test(values.phone)) {
            return "Please check your phone number.";
        }

        const digits = values.phone.replace(/\D/g, "");

        if (digits.length < 7 || digits.length > 15) {
            return "Please check your phone number.";
        }
    }

    if (
        values.method === "Delivery" &&
        values.address.length < 4
    ) {
        return "Please enter your delivery address or a nearby landmark.";
    }

    return "";
}

function makeWhatsAppMessage(values) {
    return [
        `Namaste ${BUSINESS.name}! I would like to place an order:`,
        "",
        ...orderItems().map(
            (item) => `${item.quantity} × ${item.name}`
        ),
        "",
        `Name: ${values.name || "Not provided"}`,
        `Phone: ${values.phone || "Not provided"}`,
        `Order type: ${values.method}`,
        `Address: ${values.address || "Not applicable"}`,
        `Instructions: ${values.notes || "None"}`,
        "",
        "Please confirm availability and final prices. Thank you."
    ].join("\n");
}

function sendWhatsApp() {
    const values = getFormValues();

    // WhatsApp orders must include the customer's name and phone number.
    const error = validateOrder(values, true);

    if (error) {
        alert(error);
        return;
    }

    const url =
        `https://wa.me/${BUSINESS.whatsapp}?text=` +
        encodeURIComponent(makeWhatsAppMessage(values));

    window.open(url, "_blank", "noopener,noreferrer");
}

async function placeOrder(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');

    const values = getFormValues();
    const error = validateOrder(values);

    if (error) {
        alert(error);
        return;
    }

    submit.disabled = true;
    submit.textContent = "Sending securely…";

    const orderRef = push(ref(db, "orders"));
    const orderId = orderRef.key;

    if (!orderId) {
        alert("Could not generate an order reference. Please try again.");

        submit.disabled = false;
        submit.textContent = "Send website order";

        return;
    }

    const trackingToken = createTrackingToken();
    const now = Date.now();
    const items = orderItems();

    const order = {
        id: orderId,
        customerName: values.name,
        customerPhone: values.phone,
        items,
        summary: items.map(
            (item) => `${item.quantity} × ${item.name}`
        ).join(", "),
        orderType: values.method,
        deliveryAddress: values.address,
        notes: values.notes,
        status: "pending",
        source: "website",
        currency: "NPR",
        priceStatus: "confirm_at_counter",
        customerTrackingToken: trackingToken,
        createdAt: now,
        updatedAt: now
    };

    const tracking = {
        orderId,
        status: "pending",
        updatedAt: now
    };

    let trackingSaved = false;

    try {
        // First: save the actual customer order.
        await set(orderRef, order);

        // Second: save the tracking record separately.
        try {
            await set(
                ref(db, `orderTracking/${trackingToken}`),
                tracking
            );

            trackingSaved = true;

        } catch (trackingError) {
            console.error(
                "Order was saved, but tracking could not be saved:",
                trackingError
            );
        }

        // Save tracking details locally only if Firebase saved them.
        if (trackingSaved) {
            try {
                localStorage.setItem(
                    TRACKING_KEY,
                    JSON.stringify({
                        id: orderId,
                        token: trackingToken
                    })
                );
            } catch (storageError) {
                console.warn(
                    "Tracking information could not be saved locally:",
                    storageError
                );
            }
        }

        // Save a customer-visible history copy on this browser.
        // This is a temporary pre-login profile; it is not cross-device account storage.
        try {
            const historyKey = "skg_customer_orders_v1";
            const history = JSON.parse(localStorage.getItem(historyKey) || "[]");
            history.unshift({
                id: orderId,
                token: trackingSaved ? trackingToken : null,
                customerName: values.name,
                customerPhone: values.phone,
                items,
                summary: order.summary,
                orderType: values.method,
                deliveryAddress: values.address,
                notes: values.notes,
                status: "pending",
                createdAt: now
            });
            localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 50)));
        } catch (historyError) {
            console.warn("Local customer order history could not be saved.", historyError);
        }

        // The order itself has been saved successfully.
        cart.clear();

        saveCart();
        refreshCart();

        const result = document.getElementById("skg-result");

        result.hidden = false;

        result.innerHTML = `
          <strong>Order request received</strong>

          Your reference is
          <b>${escapeHTML(orderId.slice(-8).toUpperCase())}</b>.

          This is not an acceptance confirmation.
          Our team will contact you to confirm availability,
          final prices and delivery.

          <div class="skg-result-actions">
            ${
                trackingSaved
                    ? `<button type="button"
                        id="skg-enable-customer-notifications">
                        Enable status alerts
                       </button>`
                    : ""
            }

            <a href="https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(
                `Namaste! I submitted website order ${orderId}. Please confirm it.`
            )}"
               target="_blank"
               rel="noopener noreferrer">
                Confirm on WhatsApp
            </a>

            <a href="tel:${BUSINESS.phone}">
                Call ${BUSINESS.phone}
            </a>
          </div>

          <div id="skg-customer-tracking" class="skg-tracking">
            ${
                trackingSaved
                    ? "Current status: Waiting for the restaurant to review your order."
                    : "Your order was received, but live tracking is temporarily unavailable. Please contact the restaurant to check its status."
            }
          </div>
        `;

        if (trackingSaved) {
            document
                .getElementById("skg-enable-customer-notifications")
                ?.addEventListener(
                    "click",
                    enableCustomerStatusAlerts
                );

            listenForCustomerUpdates(
                trackingToken,
                document.getElementById("skg-customer-tracking")
            );
        }

        form.reset();

        updateDeliveryField();

        submit.textContent = "Order sent";

    } catch (submissionError) {
        console.error(
            "Website order submission failed:",
            submissionError
        );

        alert(
            "We could not save your website order. " +
            "Please try WhatsApp or call the restaurant."
        );

    } finally {
        submit.disabled = false;

        if (submit.textContent === "Sending securely…") {
            submit.textContent = "Send website order";
        }
    }
}

let customerNotificationPermission = false;

async function enableCustomerStatusAlerts() {
    if (!("Notification" in window)) {
        alert(
            "This browser does not support notifications. " +
            "Keep this page open to see order status updates."
        );

        return;
    }

    try {
        const permission = await Notification.requestPermission();

        customerNotificationPermission = permission === "granted";

        const button = document.getElementById(
            "skg-enable-customer-notifications"
        );

        if (button) {
            button.textContent = customerNotificationPermission
                ? "Status alerts enabled"
                : "Alerts not enabled";
        }

        if (permission !== "granted") {
            alert(
                "Notifications were not allowed. " +
                "You can still track your order while this page is open."
            );
        }

    } catch (error) {
        console.error("Notification permission error:", error);

        alert("Could not enable notifications in this browser.");
    }
}

function listenForCustomerUpdates(token, element) {
    let firstSnapshot = true;
    let previousStatus = null;

    const labels = {
        pending: "Received — waiting for restaurant confirmation",
        accepted: "Accepted by the restaurant",
        preparing: "Being prepared",
        ready: "Ready for pickup",
        dispatched: "Out for delivery",
        delivered: "Delivered",
        cancelled: "Cancelled"
    };

    onValue(
        ref(db, `orderTracking/${token}`),

        (snapshot) => {
            if (!snapshot.exists()) return;

            const data = snapshot.val();

            const status = data.status || "pending";

            element.textContent =
                `Order ${data.orderId || ""}: ` +
                `${labels[status] || status}. ` +
                `${data.customerMessage || ""}`;

            if (
                !firstSnapshot &&
                previousStatus !== status &&
                customerNotificationPermission &&
                "Notification" in window
            ) {
                new Notification(
                    `${BUSINESS.name} — order update`,
                    {
                        body: labels[status] || status,
                        icon: "/assets/icons/favicon.svg"
                    }
                );
            }

            previousStatus = status;
            firstSnapshot = false;
        },

        (error) => {
            console.error(
                "Customer order tracking listener failed:",
                error
            );

            element.textContent =
                "Live tracking is temporarily unavailable. " +
                "Please contact the restaurant.";
        }
    );
}

function restoreTracking() {
    try {
        const data = JSON.parse(
            localStorage.getItem(TRACKING_KEY) || "null"
        );

        if (!data?.token || !data?.id) return;

        const main = document.querySelector("main");

        if (
            !main ||
            document.getElementById("skg-restored-tracking")
        ) {
            return;
        }

        const panel = document.createElement("div");

        panel.id = "skg-restored-tracking";
        panel.className = "skg-tracking";

        panel.innerHTML = `
            <strong>Recent order tracking</strong>
            <div id="skg-restored-tracking-status">
                Loading your latest order…
            </div>
        `;

        main.prepend(panel);

        listenForCustomerUpdates(
            data.token,
            panel.querySelector("#skg-restored-tracking-status")
        );

    } catch (error) {
        console.warn(
            "Saved order tracking could not be restored.",
            error
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadCart();

    // The cart is global: mount it on the homepage as well as the menu page.
    mountUI();

    const menuContainer = document.getElementById("menu-grid-container");
    if (menuContainer) {
        const observer = new MutationObserver(() => mountUI());
        observer.observe(menuContainer, { childList: true, subtree: true });
    }

    // Route customer-facing WhatsApp order CTAs through the shared cart/checkout.
    // Footer contact links are intentionally left as direct WhatsApp links.
    document.querySelectorAll('a[href*="wa.me"]').forEach((link) => {
        if (link.dataset.skgCartBound === "true") return;
        if (link.closest("footer")) return;
        if (!link.classList.contains("btn") && !link.classList.contains("btn-sm") &&
            !link.classList.contains("header-cta")) return;

        link.dataset.skgCartBound = "true";
        link.addEventListener("click", (event) => {
            event.preventDefault();
            const card = link.closest(".dish-card");
            const dishName = card?.querySelector("h3")?.textContent?.trim();
            if (dishName) {
                const quantity = cart.get(dishName) || 0;
                if (quantity < 20) cart.set(dishName, quantity + 1);
                saveCart();
                refreshCart();
            }
            openCart();
        });
    });

    restoreTracking();
});
