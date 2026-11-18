// ============================================================================
// SIRANCHOWK KHAJA GHAR — CART, CHECKOUT, COUPONS & LIVE ORDER TRACKING
// ============================================================================

import {
    db,
    ref,
    get,
    push,
    set,
    onValue
} from "./firebase.js";
import { getCustomerState, onCustomerAuthChange } from "./customer-auth.js";
import { logCustomerActivity, recordNotificationHistory } from "./activity-logger.js";
import {
    getPublicPushConfig,
    getOrderNotificationTemplates,
    renderOrderTemplate,
    dispatchWorkerPush
} from "./notifications-client.js";

const BUSINESS = {
    name: "Siranchowk Khaja Ghar",
    phone: "9821233154",
    whatsapp: "9779821233154"
};

const CART_KEY = "skg_cart_v2";
const TRACKING_KEY = "skg_customer_tracking_v2";
const COUPON_KEY = "skg_applied_coupon_v1";

const cart = new Map();
let appliedCoupon = null;
let isSubmittingOrder = false;

const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));

function slugifyDishKey(name) {
    return String(name || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");
}

function isDishUnavailable(name) {
    const key = slugifyDishKey(name);
    if (!key) return false;
    return Boolean(window.__SKG_UNAVAILABLE_DISHES && window.__SKG_UNAVAILABLE_DISHES.has(key));
}

function syncAddCartButtonsAvailability() {
    document.querySelectorAll(".dish-card").forEach((card) => {
        const name = card.querySelector("h3")?.textContent?.trim();
        const button = card.querySelector(".skg-add-cart");
        if (!button || !name) return;
        const unavailable = card.classList.contains("dish-sold-out") || isDishUnavailable(name);
        button.disabled = unavailable;
        if (unavailable) {
            button.textContent = "Currently Unavailable";
            button.style.opacity = "0.55";
            button.style.cursor = "not-allowed";
        } else if (button.textContent === "Currently Unavailable") {
            button.textContent = "+ Add to cart";
            button.style.opacity = "";
            button.style.cursor = "";
        }
    });
}

function syncStorePausedUI() {
    const form = document.getElementById("skg-checkout-form");
    const submit = form?.querySelector('[type="submit"]');
    const notice = document.getElementById("skg-store-paused-notice");
    const isPaused = window.__SKG_STORE_OPEN === false;
    if (notice) notice.hidden = !isPaused;
    if (submit) {
        submit.disabled = isPaused;
        submit.textContent = isPaused ? "Website Ordering Paused" : "Send website order";
    }
}

function loadCart() {
    try {
        const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
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
        const savedCoupon = JSON.parse(localStorage.getItem(COUPON_KEY) || "null");
        if (savedCoupon && savedCoupon.code) {
            appliedCoupon = savedCoupon;
        }
    } catch (error) {
        console.warn("Saved cart could not be restored.", error);
    }
}

function saveCart() {
    try {
        localStorage.setItem(
            CART_KEY,
            JSON.stringify([...cart].map(([name, quantity]) => ({ name, quantity })))
        );
        if (appliedCoupon) {
            localStorage.setItem(COUPON_KEY, JSON.stringify(appliedCoupon));
        } else {
            localStorage.removeItem(COUPON_KEY);
        }
    } catch (error) {
        console.warn("Cart could not be saved on this device.", error);
    }
}

function createTrackingToken() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function addStyles() {
    if (document.getElementById("skg-order-styles")) return;

    const style = document.createElement("style");
    style.id = "skg-order-styles";
    style.textContent = `
      .skg-add-cart{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:42px;padding:10px 15px;border:1px solid #087f78;border-radius:12px;background:#087f78;color:#fff;font-family:inherit;font-size:14px;font-weight:700;line-height:1.2;cursor:pointer;transition:transform .18s ease,background .18s ease}
      .skg-add-cart:hover{background:#066b65;transform:translateY(-1px)}
      .skg-add-cart:focus-visible,.skg-cart-fab:focus-visible,.skg-panel button:focus-visible{outline:3px solid #67d5c8;outline-offset:3px}
      .skg-cart-fab{position:fixed;z-index:1000;right:20px;bottom:20px;display:flex;align-items:center;gap:10px;padding:13px 18px;border:0;border-radius:999px;background:#123f3b;color:#fff;font-weight:800;box-shadow:0 12px 34px #102f2d35;cursor:pointer}
      .skg-cart-count{display:grid;place-items:center;min-width:23px;height:23px;padding:0 6px;border-radius:99px;background:#fff;color:#123f3b;font-size:12px;font-variant-numeric:tabular-nums}
      .skg-modal{position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;padding:16px;background:#102b2bcc;backdrop-filter:blur(5px)}
      .skg-modal.open{display:flex}
      .skg-panel{width:min(620px,100%);max-height:min(92vh,880px);overflow:auto;padding:clamp(20px,4vw,30px);border:1px solid #e3eeeb;border-radius:20px;background:#fff;color:#183b39;box-shadow:0 25px 90px #061d1b55}
      .skg-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}
      .skg-panel h2{margin:0 0 5px;font-size:clamp(22px,4vw,28px);letter-spacing:-.03em}
      .skg-panel-subtitle{margin:0;color:#5d7370;font-size:13px;line-height:1.5}
      .skg-close{flex:0 0 auto;width:38px;height:38px;border:0;border-radius:50%;background:#eef5f3;color:#183b39;font-size:19px;cursor:pointer}
      .skg-cart-lines{margin:12px 0 16px}
      .skg-line{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #e8efed}
      .skg-line-name{font-weight:700;overflow-wrap:anywhere}
      .skg-qty-controls{display:flex;align-items:center;gap:8px;white-space:nowrap}
      .skg-qty-controls button{width:32px;height:32px;border:1px solid #dbe7e4;border-radius:9px;background:#f7faf9;color:#21413e;font-weight:800;cursor:pointer}
      .skg-remove{border-color:#f0d8d5!important;background:#fff7f6!important;color:#a53e35!important}
      .skg-empty{padding:22px 10px;text-align:center;color:#71837f}
      .skg-coupon-box{display:flex;gap:8px;align-items:center;margin:12px 0;padding:10px;border:1px solid #dce9e6;border-radius:12px;background:#f8fbfa}
      .skg-coupon-box input{flex:1;min-height:40px;padding:8px 11px;border:1px solid #d5e2df;border-radius:9px;background:#fff;color:#183b39;font:inherit;text-transform:uppercase}
      .skg-coupon-box button{min-height:40px;padding:8px 14px;border:0;border-radius:9px;background:#123f3b;color:#fff;font-weight:700;cursor:pointer;white-space:nowrap}
      .skg-coupon-applied{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;margin:10px 0;border:1px solid #b9e1d6;border-radius:10px;background:#f0faf6;color:#195947;font-size:13px}
      .skg-coupon-applied button{border:0;background:transparent;color:#9b2c2c;font-weight:700;cursor:pointer}
      .skg-field{display:grid;gap:6px;margin:13px 0}
      .skg-field label{font-size:13px;font-weight:800;color:#294a46}
      .skg-field input,.skg-field select,.skg-field textarea{width:100%;min-height:44px;box-sizing:border-box;padding:10px 12px;border:1px solid #d5e2df;border-radius:10px;background:#fff;color:#183b39;font:inherit}
      .skg-field textarea{min-height:78px;resize:vertical}
      .skg-field input:focus,.skg-field select:focus,.skg-field textarea:focus{outline:0;border-color:#087f78;box-shadow:0 0 0 3px #087f7822}
      .skg-form-error{margin:10px 0;padding:11px 13px;border:1px solid #f0c3be;border-radius:10px;background:#fff5f4;color:#9f2c22;font-size:13px;font-weight:600}
      .skg-order-notice{margin:14px 0;padding:12px 14px;border:1px solid #e6d7b9;border-radius:12px;background:#fffbf2;color:#6d4f1d;font-size:13px;line-height:1.55}
      .skg-order-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
      .skg-order-actions button,.skg-order-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 16px;border:0;border-radius:11px;font-family:inherit;font-size:14px;font-weight:800;text-decoration:none;cursor:pointer}
      .skg-submit{flex:1 1 190px;background:#087f78;color:#fff}
      .skg-whatsapp{flex:1 1 170px;background:#e8f7ef;color:#176b3b}
      .skg-call{flex:1 1 130px;background:#eef4f3;color:#21413e}
      .skg-submit:disabled{opacity:.6;cursor:wait}
      .skg-result{margin-top:16px;padding:15px;border:1px solid #b9e1d6;border-radius:14px;background:#f0faf6;color:#205a49;line-height:1.55}
      .skg-result strong{display:block;margin-bottom:4px}
      .skg-result-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:11px}
      .skg-result-actions button,.skg-result-actions a{padding:9px 12px;border:1px solid #cbded8;border-radius:10px;background:#fff;color:#205a49;font-weight:700;text-decoration:none;cursor:pointer}
      .skg-tracking{margin:14px 0;padding:12px 14px;border:1px solid #d9e9e5;border-radius:12px;background:#f6fbfa;color:#355c55;font-size:13px}
      @media(max-width:520px){.skg-cart-fab{right:14px;bottom:14px;padding:11px 15px}.skg-order-actions{display:grid}.skg-order-actions>*{width:100%}.skg-line{align-items:flex-start}}
      @media(prefers-reduced-motion:reduce){.skg-add-cart{transition:none}}
    `;
    document.head.appendChild(style);
}

function orderItems() {
    return [...cart].map(([name, quantity]) => ({ name, quantity }));
}

function totalQuantity() {
    return [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
}

function syncNavCount() {
    const qty = String(totalQuantity());
    const fabCount = document.getElementById("skg-cart-count");
    const navBadge = document.getElementById("nav-cart-badge");
    const navInline = document.getElementById("nav-cart-inline-count");
    if (fabCount) fabCount.textContent = qty;
    if (navBadge) navBadge.textContent = qty;
    if (navInline) navInline.textContent = qty;
}

function showFormError(message) {
    const el = document.getElementById("skg-form-error");
    if (!el) return;
    if (!message) {
        el.hidden = true;
        el.textContent = "";
    } else {
        el.hidden = false;
        el.textContent = message;
    }
}

async function applyCouponCode(rawCode) {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) {
        showFormError("Please enter a coupon code.");
        return false;
    }
    showFormError("");

    try {
        const snap = await get(ref(db, "offers"));
        if (!snap.exists()) {
            showFormError("No active coupons found right now.");
            return false;
        }
        const now = Date.now();
        const match = Object.entries(snap.val() || {})
            .map(([id, val]) => ({ id, ...val }))
            .find((off) =>
                off &&
                off.active !== false &&
                String(off.code || "").trim().toUpperCase() === code &&
                (!off.expiresAt || Number(off.expiresAt) > now)
            );

        if (!match) {
            showFormError(`Coupon "${code}" is invalid or expired.`);
            return false;
        }

        const { user } = getCustomerState();
        if (user?.uid) {
            const usedSnap = await get(ref(db, `users/${user.uid}/coupons/${match.id}`));
            if (usedSnap.exists() && usedSnap.val()?.used) {
                showFormError(`You have already used coupon "${code}".`);
                return false;
            }
        }

        const summary = match.discountType === "percent"
            ? `${match.discountValue}% off`
            : (match.discountValue ? `Rs. ${match.discountValue} off` : match.title);

        appliedCoupon = {
            id: match.id,
            code,
            title: match.title || code,
            summary
        };
        saveCart();
        renderCouponStatus();
        return true;
    } catch (error) {
        console.warn("Coupon validation error:", error);
        showFormError("Could not validate coupon right now.");
        return false;
    }
}

function renderCouponStatus() {
    const holder = document.getElementById("skg-coupon-status");
    const input = document.getElementById("skg-coupon-input");
    if (!holder) return;

    if (!appliedCoupon) {
        holder.innerHTML = "";
        return;
    }

    if (input) input.value = appliedCoupon.code;
    holder.innerHTML = `
      <div class="skg-coupon-applied">
        <span>Applied: <strong>${escapeHTML(appliedCoupon.code)}</strong> (${escapeHTML(appliedCoupon.summary)})</span>
        <button type="button" id="skg-remove-coupon">Remove</button>
      </div>
    `;
    holder.querySelector("#skg-remove-coupon")?.addEventListener("click", () => {
        appliedCoupon = null;
        if (input) input.value = "";
        saveCart();
        renderCouponStatus();
    });
}

function prefillAuthenticatedCustomer() {
    const { user, profile } = getCustomerState();
    const form = document.getElementById("skg-checkout-form");
    if (!form || !user) return;
    const nameInput = form.querySelector("#skg-name");
    const phoneInput = form.querySelector("#skg-phone");
    const addressInput = form.querySelector("#skg-address");
    if (nameInput && !nameInput.value && (profile?.name || user.displayName)) {
        nameInput.value = profile?.name || user.displayName;
    }
    if (phoneInput && !phoneInput.value && profile?.phone) {
        phoneInput.value = profile.phone;
    }
    if (addressInput && !addressInput.value && profile?.address) {
        addressInput.value = profile.address;
    }
}

function mountUI() {
    addStyles();

    if (!document.getElementById("skg-cart-fab")) {
        const button = document.createElement("button");
        button.id = "skg-cart-fab";
        button.className = "skg-cart-fab";
        button.type = "button";
        button.setAttribute("aria-haspopup", "dialog");
        button.innerHTML = `Cart <span class="skg-cart-count" id="skg-cart-count">0</span>`;
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
                <p class="skg-panel-subtitle">Review your items and send your order to our team.</p>
              </div>
              <button class="skg-close" type="button" aria-label="Close order panel">×</button>
            </div>

            <div id="skg-cart-lines" class="skg-cart-lines" aria-live="polite"></div>

            <div class="skg-coupon-box">
              <input id="skg-coupon-input" type="text" maxlength="24" placeholder="Promo / Coupon code (optional)" aria-label="Promo or coupon code">
              <button type="button" id="skg-apply-coupon-btn">Apply</button>
            </div>
            <div id="skg-coupon-status"></div>

            <div class="skg-order-notice">
              <strong>Order confirmation notice</strong><br>
              Website orders are requests only. Our team will contact you to confirm availability,
              final prices, coupon eligibility, and delivery. For urgent orders, message us on WhatsApp or call ${BUSINESS.phone}.
            </div>

            <div id="skg-store-paused-notice" class="skg-form-error" role="status" hidden>
              Website ordering is currently paused. Please call ${BUSINESS.phone} or message us on WhatsApp for inquiries.
            </div>
            <div id="skg-form-error" class="skg-form-error" role="alert" hidden></div>

            <form id="skg-checkout-form" novalidate>
              <div class="skg-field">
                <label for="skg-name">Your name *</label>
                <input id="skg-name" name="customerName" maxlength="80" required autocomplete="name" placeholder="Enter your full name">
              </div>

              <div class="skg-field">
                <label for="skg-phone">Phone number *</label>
                <input id="skg-phone" name="customerPhone" type="tel" maxlength="16" required autocomplete="tel" inputmode="tel" pattern="[0-9+\\(\\)\\- ]{7,16}" placeholder="98XXXXXXXX">
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
                <input id="skg-address" name="deliveryAddress" maxlength="180" autocomplete="street-address" placeholder="Your delivery location">
              </div>

              <div class="skg-field">
                <label for="skg-notes">Special instructions <span class="skg-panel-subtitle">(optional)</span></label>
                <textarea id="skg-notes" name="notes" maxlength="400" placeholder="Spice preference, instructions, etc."></textarea>
              </div>

              <div class="skg-order-actions">
                <button class="skg-submit" type="submit">Send website order</button>
                <button class="skg-whatsapp" id="skg-whatsapp" type="button">Continue on WhatsApp</button>
                <a class="skg-call" href="tel:${BUSINESS.phone}">Call ${BUSINESS.phone}</a>
              </div>
            </form>

            <div id="skg-result" class="skg-result" role="status" aria-live="polite" hidden></div>
          </section>
        `;

        document.body.appendChild(modal);

        modal.querySelector(".skg-close").addEventListener("click", closeCart);
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeCart();
        });
        modal.querySelector("#skg-whatsapp").addEventListener("click", sendWhatsApp);
        modal.querySelector("#skg-checkout-form").addEventListener("submit", placeOrder);
        modal.querySelector("#skg-method").addEventListener("change", updateDeliveryField);
        modal.querySelector("#skg-apply-coupon-btn").addEventListener("click", () => {
            const val = modal.querySelector("#skg-coupon-input")?.value || "";
            applyCouponCode(val);
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeCart();
        });
    }

    document.querySelectorAll(".dish-card").forEach((card) => {
        const footer = card.querySelector(".dish-footer");
        if (!footer || footer.querySelector(".skg-add-cart")) return;
        const name = card.querySelector("h3")?.textContent?.trim();
        if (!name) return;

        const unavailable = card.classList.contains("dish-sold-out") || isDishUnavailable(name);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "skg-add-cart";
        button.textContent = unavailable ? "Currently Unavailable" : "+ Add to cart";
        button.disabled = unavailable;
        if (unavailable) {
            button.style.opacity = "0.55";
            button.style.cursor = "not-allowed";
        }
        button.setAttribute("aria-label", `Add ${name} to cart`);

        button.addEventListener("click", () => {
            if (card.classList.contains("dish-sold-out") || isDishUnavailable(name)) {
                syncAddCartButtonsAvailability();
                return;
            }
            const nextQuantity = (cart.get(name) || 0) + 1;
            if (nextQuantity > 20) {
                showCartMessage("Maximum 20 portions per menu item.");
                return;
            }
            cart.set(name, nextQuantity);
            saveCart();
            const submit = document.querySelector("#skg-checkout-form [type='submit']");
            if (submit && window.__SKG_STORE_OPEN !== false) submit.textContent = "Send website order";
            refreshCart();

            window.AnalyticsTracker?.trackEvent?.("add_to_cart", { productName: name, quantity: nextQuantity });
            const { user } = getCustomerState();
            if (user?.uid) {
                logCustomerActivity(user.uid, "add_to_cart", { productName: name, quantity: nextQuantity });
            }

            button.textContent = "Added";
            window.setTimeout(() => {
                syncAddCartButtonsAvailability();
                if (!button.disabled) button.textContent = "+ Add to cart";
            }, 900);
        });

        footer.appendChild(button);
    });

    syncAddCartButtonsAvailability();
    syncStorePausedUI();
    refreshCart();
    renderCouponStatus();
    prefillAuthenticatedCustomer();
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
    syncNavCount();
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
          <button type="button" data-dec="${escapeHTML(name)}" aria-label="Decrease ${escapeHTML(name)}">−</button>
          <strong>${quantity}</strong>
          <button type="button" data-inc="${escapeHTML(name)}" aria-label="Increase ${escapeHTML(name)}">+</button>
          <button type="button" class="skg-remove" data-del="${escapeHTML(name)}" aria-label="Remove ${escapeHTML(name)}">×</button>
        </span>
      </div>
    `).join("");

    lines.querySelectorAll("[data-dec]").forEach((button) => {
        button.addEventListener("click", () => {
            const name = button.dataset.dec;
            const quantity = (cart.get(name) || 0) - 1;
            if (quantity <= 0) cart.delete(name);
            else cart.set(name, quantity);
            saveCart();
            refreshCart();
        });
    });

    lines.querySelectorAll("[data-inc]").forEach((button) => {
        button.addEventListener("click", () => {
            const name = button.dataset.inc;
            const quantity = (cart.get(name) || 0) + 1;
            if (quantity <= 20) cart.set(name, quantity);
            else showCartMessage("Maximum 20 portions per menu item.");
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
    const delivery = document.getElementById("skg-method")?.value === "Delivery";
    const wrap = document.getElementById("skg-address-wrap");
    const address = document.getElementById("skg-address");
    if (wrap) wrap.hidden = !delivery;
    if (address) address.required = delivery;
}

function openCart() {
    const modal = document.getElementById("skg-checkout-modal");
    if (!modal) return;
    modal.classList.add("open");
    showFormError("");
    refreshCart();
    renderCouponStatus();
    prefillAuthenticatedCustomer();
    syncStorePausedUI();
    modal.querySelector("#skg-name")?.focus();
    document.body.style.overflow = "hidden";
    if (cart.size > 0) {
        window.AnalyticsTracker?.trackEvent?.("checkout_started", { itemCount: totalQuantity() });
        const { user } = getCustomerState();
        if (user?.uid) {
            logCustomerActivity(user.uid, "checkout_started", { itemCount: totalQuantity() });
        }
    }
}

function closeCart() {
    const modal = document.getElementById("skg-checkout-modal");
    if (modal) modal.classList.remove("open");
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
    if (!cart.size) return "Your cart is empty. Please add at least one item.";
    if (requireContact && values.name.length < 2) return "Please enter your name.";
    if (requireContact && !/^[0-9+()\- ]{7,16}$/.test(values.phone)) {
        return "Please enter a valid phone number.";
    }
    if (values.phone) {
        if (!/^[0-9+()\- ]{7,16}$/.test(values.phone)) return "Please check your phone number.";
        const digits = values.phone.replace(/\D/g, "");
        if (digits.length < 7 || digits.length > 15) return "Please check your phone number.";
    }
    if (values.method === "Delivery" && values.address.length < 4) {
        return "Please enter your delivery address or a nearby landmark.";
    }
    return "";
}

function makeWhatsAppMessage(values) {
    const lines = [
        `Namaste ${BUSINESS.name}! I would like to place an order:`,
        "",
        ...orderItems().map((item) => `${item.quantity} × ${item.name}`),
        "",
        `Name: ${values.name || "Not provided"}`,
        `Phone: ${values.phone || "Not provided"}`,
        `Order type: ${values.method}`,
        `Address: ${values.address || "Not applicable"}`,
        `Instructions: ${values.notes || "None"}`
    ];
    if (appliedCoupon) {
        lines.push(`Coupon: ${appliedCoupon.code} (${appliedCoupon.summary})`);
    }
    lines.push("", "Please confirm availability and final prices. Thank you.");
    return lines.join("\n");
}

function sendWhatsApp() {
    showFormError("");
    const values = getFormValues();
    const error = validateOrder(values, true);
    if (error) {
        showFormError(error);
        return;
    }
    window.AnalyticsTracker?.trackEvent?.("whatsapp_click", {
        itemCount: totalQuantity(),
        orderType: values.method
    });
    const { user } = getCustomerState();
    if (user?.uid) {
        logCustomerActivity(user.uid, "whatsapp_order_clicked", { itemCount: totalQuantity(), orderType: values.method });
    }
    const url = `https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(makeWhatsAppMessage(values))}`;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
}

async function placeOrder(event) {
    event.preventDefault();
    if (isSubmittingOrder) return;
    showFormError("");

    if (window.__SKG_STORE_OPEN === false) {
        showFormError(`Website ordering is currently paused. Please call ${BUSINESS.phone} or message us on WhatsApp.`);
        return;
    }

    const unavailableInCart = orderItems().filter((item) => isDishUnavailable(item.name));
    if (unavailableInCart.length > 0) {
        showFormError(`Currently unavailable: ${unavailableInCart.map((i) => i.name).join(", ")}. Please remove unavailable items before ordering.`);
        return;
    }

    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const values = getFormValues();
    const error = validateOrder(values);

    if (error) {
        showFormError(error);
        return;
    }

    isSubmittingOrder = true;
    submit.disabled = true;
    submit.textContent = "Sending securely…";

    const orderRef = push(ref(db, "orders"));
    const orderId = orderRef.key;

    if (!orderId) {
        showFormError("Could not generate an order reference. Please try again.");
        submit.disabled = false;
        submit.textContent = "Send website order";
        return;
    }

    const trackingToken = createTrackingToken();
    const now = Date.now();
    const items = orderItems();
    const { user } = getCustomerState();

    const order = {
        id: orderId,
        customerName: values.name,
        customerPhone: values.phone,
        items,
        summary: items.map((item) => `${item.quantity} × ${item.name}`).join(", "),
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

    if (user?.uid) {
        order.customerUid = user.uid;
        if (user.email) order.customerEmail = user.email;
    }
    if (appliedCoupon) {
        order.couponCode = appliedCoupon.code;
        order.couponSummary = appliedCoupon.summary;
    }

    const tracking = {
        orderId,
        status: "pending",
        updatedAt: now
    };

    let trackingSaved = false;

    try {
        await set(orderRef, order);

        try {
            await set(ref(db, `orderTracking/${trackingToken}`), tracking);
            trackingSaved = true;
        } catch (trackingError) {
            console.error("Order was saved, but tracking could not be saved:", trackingError);
        }

        // Save strictly inside the authenticated customer's own UID namespace
        if (user?.uid) {
            try {
                await set(ref(db, `users/${user.uid}/orders/${orderId}`), {
                    ...order,
                    trackingSaved
                });
                if (appliedCoupon?.id) {
                    await set(ref(db, `users/${user.uid}/coupons/${appliedCoupon.id}`), {
                        id: appliedCoupon.id,
                        code: appliedCoupon.code,
                        title: appliedCoupon.title,
                        summary: appliedCoupon.summary,
                        used: true,
                        orderId,
                        usedAt: now
                    });
                    await logCustomerActivity(user.uid, "coupon_used", {
                        orderId,
                        code: appliedCoupon.code,
                        summary: appliedCoupon.summary
                    });
                }
                const templates = await getOrderNotificationTemplates();
                const receivedMsg = renderOrderTemplate(templates, "pending", orderId);
                await set(ref(db, `users/${user.uid}/notifications/ord_${orderId}_pending`), {
                    id: `ord_${orderId}_pending`,
                    orderId,
                    status: "pending",
                    title: `Order #${orderId.slice(-8).toUpperCase()} Received`,
                    body: receivedMsg,
                    createdAt: now,
                    read: false
                }).catch(() => {});
                await recordNotificationHistory("orders", {
                    id: `ord_${orderId}_pending`,
                    title: `Order #${orderId.slice(-8).toUpperCase()} Received`,
                    message: receivedMsg,
                    type: "order_received",
                    targetAudience: `customer:${user.uid}`,
                    status: "created",
                    actorUid: user.uid
                });
                await logCustomerActivity(user.uid, "order_placed", {
                    orderId,
                    orderType: values.method,
                    itemCount: items.reduce((s, i) => s + Number(i.quantity || 1), 0),
                    summary: order.summary.slice(0, 140)
                });
            } catch (userOrderErr) {
                console.warn("Could not mirror order under user profile:", userOrderErr);
            }
        }
        window.AnalyticsTracker?.trackEvent?.("order_submitted", {
            orderType: values.method,
            itemCount: items.reduce((s, i) => s + Number(i.quantity || 1), 0)
        });

        // Trigger multi-device push to all approved Owner & authorized Admin devices
        getPublicPushConfig().then(({ workerUrl }) => {
            if (!workerUrl) return;
            return dispatchWorkerPush({
                workerUrl,
                payload: {
                    type: "new_order_alert",
                    orderId,
                    trackingToken
                }
            });
        }).catch(() => {});

        if (trackingSaved) {
            try {
                localStorage.setItem(TRACKING_KEY, JSON.stringify({ id: orderId, token: trackingToken }));
            } catch {}
        }

        // Keep browser-local fallback only for guest convenience on the same device
        if (!user?.uid) {
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
                    couponCode: appliedCoupon?.code || "",
                    status: "pending",
                    createdAt: now
                });
                localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 50)));
            } catch {}
        }

        cart.clear();
        appliedCoupon = null;
        saveCart();
        refreshCart();
        renderCouponStatus();

        const result = document.getElementById("skg-result");
        result.hidden = false;
        result.innerHTML = `
          <strong>Order request received</strong>
          Your reference is <b>${escapeHTML(orderId.slice(-8).toUpperCase())}</b>.
          This is not an acceptance confirmation. Our team will contact you to confirm availability,
          final prices and delivery.
          <div class="skg-result-actions">
            ${trackingSaved ? `<button type="button" id="skg-enable-customer-notifications">Enable status alerts</button>` : ""}
            ${user?.uid ? `<a href="account.html#tracking">Track in My Account</a>` : ""}
            <a href="https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(`Namaste! I submitted website order ${orderId}. Please confirm it.`)}" target="_blank" rel="noopener noreferrer">Confirm on WhatsApp</a>
            <a href="tel:${BUSINESS.phone}">Call ${BUSINESS.phone}</a>
          </div>
          <div id="skg-customer-tracking" class="skg-tracking">
            ${trackingSaved ? "Current status: Waiting for the restaurant to review your order." : "Your order was received, but live tracking is temporarily unavailable."}
          </div>
        `;

        if (trackingSaved) {
            document.getElementById("skg-enable-customer-notifications")?.addEventListener("click", enableCustomerStatusAlerts);
            listenForCustomerUpdates(trackingToken, document.getElementById("skg-customer-tracking"));
        }

        form.reset();
        updateDeliveryField();
        submit.textContent = "Order sent";
    } catch (submissionError) {
        console.error("Website order submission failed:", submissionError);
        showFormError("We could not save your website order. Please try WhatsApp or call the restaurant.");
    } finally {
        isSubmittingOrder = false;
        submit.disabled = false;
        if (submit.textContent === "Sending securely…") {
            submit.textContent = "Send website order";
        }
    }
}

let customerNotificationPermission = false;

async function enableCustomerStatusAlerts() {
    if (!("Notification" in window)) {
        showFormError("This browser does not support notifications. Keep this page open to see updates.");
        return;
    }

    try {
        const permission = await Notification.requestPermission();
        customerNotificationPermission = permission === "granted";
        const button = document.getElementById("skg-enable-customer-notifications");
        if (button) {
            button.textContent = customerNotificationPermission ? "Status alerts enabled" : "Alerts not enabled";
        }
        if (permission !== "granted") {
            showFormError("Notifications were not allowed. You can still track your order on this page.");
        }
    } catch {
        showFormError("Could not enable notifications in this browser.");
    }
}

function listenForCustomerUpdates(token, element) {
    if (!element) return;
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
            element.textContent = `Order ${data.orderId || ""}: ${labels[status] || status}. ${data.customerMessage || ""}`;

            if (!firstSnapshot && previousStatus !== status && customerNotificationPermission && "Notification" in window) {
                try {
                    new Notification(`${BUSINESS.name} — order update`, {
                        body: labels[status] || status,
                        icon: "/assets/icons/favicon.svg"
                    });
                } catch {}
            }
            previousStatus = status;
            firstSnapshot = false;
        },
        () => {
            element.textContent = "Live tracking is temporarily unavailable. Please contact the restaurant.";
        }
    );
}

function restoreTracking() {
    try {
        const data = JSON.parse(localStorage.getItem(TRACKING_KEY) || "null");
        if (!data?.token || !data?.id) return;
        const main = document.querySelector("main");
        if (!main || document.getElementById("skg-restored-tracking")) return;

        const panel = document.createElement("div");
        panel.id = "skg-restored-tracking";
        panel.className = "skg-tracking container";
        panel.innerHTML = `
            <strong>Recent order tracking</strong>
            <div id="skg-restored-tracking-status">Loading your latest order…</div>
        `;
        main.prepend(panel);
        listenForCustomerUpdates(data.token, panel.querySelector("#skg-restored-tracking-status"));
    } catch {}
}

window.SKGCart = {
    open: openCart,
    close: closeCart,
    syncNavCount,
    applyCouponCode
};

document.addEventListener("DOMContentLoaded", () => {
    loadCart();
    mountUI();

    const menuContainer = document.getElementById("menu-grid-container");
    if (menuContainer) {
        const observer = new MutationObserver(() => mountUI());
        observer.observe(menuContainer, { childList: true, subtree: true });
    }

    document.querySelectorAll('a[href*="wa.me"]').forEach((link) => {
        if (link.dataset.skgCartBound === "true") return;
        if (link.closest("footer")) return;
        if (!link.classList.contains("btn") && !link.classList.contains("btn-sm") && !link.classList.contains("header-cta")) return;

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

    onCustomerAuthChange(() => {
        prefillAuthenticatedCustomer();
        syncNavCount();
    });

    window.addEventListener("skg:availability-updated", syncAddCartButtonsAvailability);
    window.addEventListener("skg:store-status-updated", syncStorePausedUI);

    restoreTracking();
});
