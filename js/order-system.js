// ============================================================================
// SIRANCHOWK KHAJA GHAR — CART, CHECKOUT, COUPONS, BILLING & LIVE ORDER TRACKING
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
import {
    mergeMenuWithDefaults,
    findMenuItem,
    isItemPriceValid,
    calculateOrderBill,
    computeCouponDiscount,
    slugifyDishKey
} from "./menu-catalog.js";

const BUSINESS = {
    name: "Siranchowk Khaja Ghar",
    nepaliName: "सिरानचोक खाजा घर",
    address: "Khairahani-6, Parsa, Chitwan (Behind Chaudhary Medical)",
    phone: "9821233154",
    whatsapp: "9779821233154"
};

const CART_KEY = "skg_cart_v2";
const TRACKING_KEY = "skg_customer_tracking_v2";
const COUPON_KEY = "skg_applied_coupon_v1";
let activeStorageUid = getCustomerState().user?.uid || "signed_out";

const cart = new Map();
let appliedCoupon = null;
let isSubmittingOrder = false;
let lastConfirmedTotal = null;
let lastReceiptHtml = "";

const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));

function getLiveMenu() {
    if (Array.isArray(window.__SKG_MENU_ITEMS) && window.__SKG_MENU_ITEMS.length) {
        return window.__SKG_MENU_ITEMS;
    }
    return mergeMenuWithDefaults({}, {});
}

async function getPendingOrderReference(uid, orderIntent) {
    const storageKey = `${PENDING_ORDER_KEY}_${uid}`;
    const fingerprintBytes = new TextEncoder().encode(JSON.stringify(orderIntent));
    const digest = await crypto.subtle.digest("SHA-256", fingerprintBytes);
    const fingerprint = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (saved?.orderId && saved?.trackingToken && saved.fingerprint === fingerprint &&
            Date.now() - Number(saved.createdAt || 0) < 24 * 60 * 60 * 1000) {
            return { orderId: saved.orderId, trackingToken: saved.trackingToken, storageKey };
        }
    } catch {}

    const orderId = push(ref(db, "orders")).key;
    const trackingToken = createTrackingToken();
    if (!orderId) throw new Error("Could not generate a secure order reference.");
    try {
        localStorage.setItem(storageKey, JSON.stringify({ orderId, trackingToken, fingerprint, createdAt: Date.now() }));
    } catch {}
    return { orderId, trackingToken, storageKey };
}

function clearPendingOrderReference(storageKey) {
    try { if (storageKey) localStorage.removeItem(storageKey); } catch {}
}

function getMenuItemForCardOrName(nameOrId) {
    return findMenuItem(getLiveMenu(), nameOrId);
}

function isDishUnavailable(nameOrId) {
    const item = getMenuItemForCardOrName(nameOrId);
    if (item && item.available === false) return true;
    const key = slugifyDishKey(nameOrId);
    if (!key) return false;
    return Boolean(window.__SKG_UNAVAILABLE_DISHES && window.__SKG_UNAVAILABLE_DISHES.has(key));
}

function isDishPriceMissing(nameOrId) {
    const item = getMenuItemForCardOrName(nameOrId);
    if (!item) return false;
    return !isItemPriceValid(item);
}

function syncAddCartButtonsAvailability() {
    document.querySelectorAll(".dish-card").forEach((card) => {
        const dishId = card.dataset.dishId || "";
        const name = card.querySelector("h3")?.textContent?.trim();
        const button = card.querySelector(".skg-add-cart");
        if (!button || !name) return;

        const lookupKey = dishId || name;
        const unavailable = card.classList.contains("dish-sold-out") || isDishUnavailable(lookupKey);
        const unpriced = card.classList.contains("dish-price-unset") || isDishPriceMissing(lookupKey);

        button.disabled = unavailable || unpriced;
        if (unavailable) {
            button.textContent = "Currently Unavailable";
            button.style.opacity = "0.55";
            button.style.cursor = "not-allowed";
            button.title = "This dish is currently out of stock.";
        } else if (unpriced) {
            button.textContent = "Counter / WhatsApp Only";
            button.style.opacity = "0.65";
            button.style.cursor = "not-allowed";
            button.title = "Online price not set yet. Please ask at the counter or on WhatsApp.";
        } else {
            if (button.textContent !== "Added") {
                button.textContent = "+ Add to cart";
            }
            button.style.opacity = "";
            button.style.cursor = "";
            button.title = "";
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

function scopedStorageKey(baseKey) {
    return `${baseKey}_${activeStorageUid || "signed_out"}`;
}

function switchCartStorageScope(user) {
    const nextUid = user?.uid || "signed_out";
    if (nextUid === activeStorageUid) return;
    activeStorageUid = nextUid;
    cart.clear();
    appliedCoupon = null;
    lastConfirmedTotal = null;
    document.getElementById("skg-restored-tracking")?.remove();
    loadCart();
    refreshCart();
    renderCouponStatus();
    restoreTracking();
}

function loadCart() {
    try {
        const saved = JSON.parse(localStorage.getItem(scopedStorageKey(CART_KEY)) || "[]");
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
        const savedCoupon = JSON.parse(localStorage.getItem(scopedStorageKey(COUPON_KEY)) || "null");
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
            scopedStorageKey(CART_KEY),
            JSON.stringify([...cart].map(([name, quantity]) => ({ name, quantity })))
        );
        if (appliedCoupon) {
            localStorage.setItem(scopedStorageKey(COUPON_KEY), JSON.stringify(appliedCoupon));
        } else {
            localStorage.removeItem(scopedStorageKey(COUPON_KEY));
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

const PENDING_CART_KEY = "skg_pending_cart_intent_v1";
const PENDING_ORDER_KEY = "skg_pending_order_v1";

function customerLoginRedirect(pendingItem = null) {
    if (pendingItem) {
        try {
            localStorage.setItem(PENDING_CART_KEY, JSON.stringify({
                id: String(pendingItem.id || pendingItem.name || "").slice(0, 100),
                createdAt: Date.now()
            }));
        } catch {}
    }
    const path = window.location.pathname === "/" ? "/index.html" : window.location.pathname;
    const returnTo = `${path}${window.location.search}${window.location.hash}`;
    window.location.assign(`/account.html?mode=login&redirect=${encodeURIComponent(returnTo)}`);
}

function addResolvedItemToCart(lookupKey, { authenticated = false, button = null, userOverride = null } = {}) {
    const currentUser = userOverride || getCustomerState().user;
    switchCartStorageScope(currentUser);
    const resolved = getMenuItemForCardOrName(lookupKey);
    if (!resolved) {
        showCartMessage("This menu item could not be found. Please refresh the menu and try again.");
        return false;
    }
    const canonicalName = resolved.name;
    if (resolved.available === false || isDishUnavailable(lookupKey)) {
        syncAddCartButtonsAvailability();
        showCartMessage(`${canonicalName} is currently unavailable.`);
        return false;
    }
    if (!isItemPriceValid(resolved)) {
        syncAddCartButtonsAvailability();
        showCartMessage(`${canonicalName} does not have an online price yet. Please inquire on WhatsApp or at the counter.`);
        return false;
    }
    if (!authenticated && !currentUser?.uid) {
        customerLoginRedirect({ id: resolved.id || canonicalName });
        return false;
    }

    const nextQuantity = (cart.get(canonicalName) || 0) + 1;
    if (nextQuantity > 20) {
        showCartMessage("Maximum 20 portions per menu item.");
        return false;
    }
    cart.set(canonicalName, nextQuantity);
    lastConfirmedTotal = null;
    saveCart();
    const submit = document.querySelector("#skg-checkout-form [type='submit']");
    if (submit && window.__SKG_STORE_OPEN !== false) submit.textContent = "Send website order";
    refreshCart();
    window.AnalyticsTracker?.trackEvent?.("add_to_cart", { productName: canonicalName, quantity: nextQuantity });
    if (currentUser?.uid) {
        logCustomerActivity(currentUser.uid, "add_to_cart", { productName: canonicalName, quantity: nextQuantity });
    }
    if (button) {
        button.textContent = "Added";
        window.setTimeout(() => {
            syncAddCartButtonsAvailability();
            if (!button.disabled) button.textContent = "+ Add to cart";
        }, 900);
    }
    return true;
}

function restorePendingCartIntent(user) {
    if (!user?.uid) return;
    try {
        const raw = localStorage.getItem(PENDING_CART_KEY);
        if (!raw) return;
        localStorage.removeItem(PENDING_CART_KEY);
        const pending = JSON.parse(raw);
        if (!pending?.id || Date.now() - Number(pending.createdAt || 0) > 20 * 60 * 1000) return;
        addResolvedItemToCart(pending.id, { authenticated: true, userOverride: user });
    } catch {
        try { localStorage.removeItem(PENDING_CART_KEY); } catch {}
    }
}

function addStyles() {
    if (document.getElementById("skg-order-styles")) return;

    const style = document.createElement("style");
    style.id = "skg-order-styles";
    style.textContent = `
      .skg-add-cart{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:42px;padding:10px 15px;border:1px solid var(--color-primary, #A8442B);border-radius:12px;background:var(--color-primary, #A8442B);color:#fff;font-family:inherit;font-size:14px;font-weight:700;line-height:1.2;cursor:pointer;transition:transform .18s ease,background .18s ease}
      .skg-add-cart:hover:not(:disabled){background:var(--color-primary-dark, #85351F);transform:translateY(-1px)}
      .skg-add-cart:focus-visible,.skg-cart-fab:focus-visible,.skg-panel button:focus-visible{outline:3px solid #D5A25B;outline-offset:3px}
      .skg-cart-fab{position:fixed;z-index:1000;right:20px;bottom:20px;display:flex;align-items:center;gap:10px;padding:13px 18px;border:0;border-radius:999px;background:var(--color-primary, #A8442B);color:#fff;font-weight:800;box-shadow:0 12px 34px rgba(41,54,62,.22);cursor:pointer}
      .skg-cart-count{display:grid;place-items:center;min-width:23px;height:23px;padding:0 6px;border-radius:99px;background:#FFFCF7;color:var(--color-primary, #A8442B);font-size:12px;font-variant-numeric:tabular-nums}
      .skg-modal{position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(35,44,50,.72);backdrop-filter:blur(5px)}
      .skg-modal.open{display:flex}
      .skg-panel{width:min(640px,100%);max-height:min(92vh,880px);overflow:auto;padding:clamp(20px,4vw,30px);border:1px solid var(--color-border, #E5D9C9);border-radius:20px;background:var(--color-surface-light, #FFFCF7);color:var(--color-dark, #29363E);box-shadow:0 25px 90px rgba(41,54,62,.18)}
      .skg-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}
      .skg-panel h2{margin:0 0 5px;font-size:clamp(22px,4vw,28px);letter-spacing:-.03em}
      .skg-panel-subtitle{margin:0;color:var(--color-text-muted, #58676D);font-size:13px;line-height:1.5}
      .skg-close{flex:0 0 auto;width:38px;height:38px;border:0;border-radius:50%;background:#F1E8DC;color:var(--color-dark, #29363E);font-size:19px;cursor:pointer}
      .skg-cart-lines{margin:12px 0 12px}
      .skg-line{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--color-border, #E5D9C9)}
      .skg-line-info{display:grid;gap:2px;min-width:0}
      .skg-line-name{font-weight:700;overflow-wrap:anywhere}
      .skg-line-meta{font-size:12px;color:var(--color-text-muted, #58676D)}
      .skg-line-warn{font-size:12px;color:#a53e35;font-weight:700}
      .skg-line-right{display:flex;align-items:center;gap:12px}
      .skg-line-total{font-weight:800;font-variant-numeric:tabular-nums;color:var(--color-primary, #A8442B);min-width:68px;text-align:right}
      .skg-qty-controls{display:flex;align-items:center;gap:8px;white-space:nowrap}
      .skg-qty-controls button{width:32px;height:32px;border:1px solid var(--color-border, #E5D9C9);border-radius:9px;background:#F7F3EB;color:#40515A;font-weight:800;cursor:pointer}
      .skg-remove{border-color:#f0d8d5!important;background:#fff7f6!important;color:#a53e35!important}
      .skg-empty{padding:22px 10px;text-align:center;color:#647178}
      .skg-bill-summary{margin:10px 0 14px;padding:12px 14px;border:1px solid var(--color-border, #E5D9C9);border-radius:12px;background:#F8F4EC;display:grid;gap:6px;font-size:14px}
      .skg-bill-row{display:flex;justify-content:space-between;align-items:center;gap:10px}
      .skg-bill-row.discount{color:#15803d;font-weight:700}
      .skg-bill-row.total{padding-top:8px;border-top:1px dashed #D8CBB9;font-size:16px;font-weight:800;color:var(--color-primary, #A8442B)}
      .skg-coupon-box{display:flex;gap:8px;align-items:center;margin:12px 0;padding:10px;border:1px solid var(--color-border, #E5D9C9);border-radius:12px;background:#F8F4EC}
      .skg-coupon-box input{flex:1;min-height:40px;padding:8px 11px;border:1px solid #D3C6B6;border-radius:9px;background:var(--color-surface-light, #FFFCF7);color:var(--color-dark, #29363E);font:inherit;text-transform:uppercase}
      .skg-coupon-box button{min-height:40px;padding:8px 14px;border:0;border-radius:9px;background:var(--color-primary, #A8442B);color:#fff;font-weight:700;cursor:pointer;white-space:nowrap}
      .skg-coupon-applied{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;margin:10px 0;border:1px solid #b9e1d6;border-radius:10px;background:#f0faf6;color:#195947;font-size:13px}
      .skg-coupon-applied button{border:0;background:transparent;color:#9b2c2c;font-weight:700;cursor:pointer}
      .skg-field{display:grid;gap:6px;margin:13px 0}
      .skg-field label{font-size:13px;font-weight:800;color:#35434B}
      .skg-field input,.skg-field select,.skg-field textarea{width:100%;min-height:44px;box-sizing:border-box;padding:10px 12px;border:1px solid #D3C6B6;border-radius:10px;background:var(--color-surface-light, #FFFCF7);color:var(--color-dark, #29363E);font:inherit}
      .skg-field textarea{min-height:78px;resize:vertical}
      .skg-field input:focus,.skg-field select:focus,.skg-field textarea:focus{outline:0;border-color:var(--color-primary, #A8442B);box-shadow:0 0 0 3px rgba(168,68,43,.12)}
      .skg-form-error{margin:10px 0;padding:11px 13px;border:1px solid #f0c3be;border-radius:10px;background:#fff5f4;color:#9f2c22;font-size:13px;font-weight:600}
      .skg-order-notice{margin:14px 0;padding:12px 14px;border:1px solid #e6d7b9;border-radius:12px;background:#fffbf2;color:#6d4f1d;font-size:13px;line-height:1.55}
      .skg-order-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
      .skg-order-actions button,.skg-order-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 16px;border:0;border-radius:11px;font-family:inherit;font-size:14px;font-weight:800;text-decoration:none;cursor:pointer}
      .skg-submit{flex:1 1 190px;background:var(--color-primary, #A8442B);color:#fff}
      .skg-whatsapp{flex:1 1 170px;background:#e8f7ef;color:#176b3b}
      .skg-call{flex:1 1 130px;background:#F0ECE4;color:#40515A}
      .skg-submit:disabled{opacity:.6;cursor:wait}
      .skg-result{margin-top:16px;padding:15px;border:1px solid #b9e1d6;border-radius:14px;background:#f0faf6;color:#205a49;line-height:1.55}
      .skg-result strong{display:block;margin-bottom:4px}
      .skg-result-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:11px}
      .skg-result-actions button,.skg-result-actions a{padding:9px 12px;border:1px solid #cbded8;border-radius:10px;background:var(--color-surface-light, #FFFCF7);color:#205a49;font-weight:700;text-decoration:none;cursor:pointer}
      .skg-tracking{margin:14px 0;padding:12px 14px;border:1px solid #d9e9e5;border-radius:12px;background:#F4F0E8;color:#465B56;font-size:13px}
      .skg-receipt-card{margin-top:12px;padding:14px;border:1px solid #D8CBB9;border-radius:12px;background:var(--color-surface-light, #FFFCF7);color:var(--color-dark, #29363E);font-size:13px}
      .skg-receipt-table{width:100%;border-collapse:collapse;margin:8px 0}
      .skg-receipt-table th,.skg-receipt-table td{padding:5px 4px;border-bottom:1px solid #ECE5DA;text-align:left}
      .skg-receipt-table th:last-child,.skg-receipt-table td:last-child{text-align:right;font-variant-numeric:tabular-nums}
      @media(max-width:520px){.skg-cart-fab{right:14px;bottom:14px;padding:11px 15px}.skg-order-actions{display:grid}.skg-order-actions>*{width:100%}.skg-line{align-items:flex-start;flex-direction:column}}
      @media(prefers-reduced-motion:reduce){.skg-add-cart{transition:none}}
    `;
    document.head.appendChild(style);
}

function orderItems() {
    return [...cart].map(([name, quantity]) => {
        const resolved = getMenuItemForCardOrName(name);
        return {
            id: resolved?.id || slugifyDishKey(name),
            name: resolved?.name || name,
            quantity
        };
    });
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

        const currentBill = calculateOrderBill(orderItems(), getLiveMenu(), null);
        if (currentBill.subtotalAmount > 0) {
            const check = computeCouponDiscount(match, currentBill.subtotalAmount, now);
            if (!check.valid) {
                showFormError(check.reason);
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
            discountType: match.discountType || "flat",
            discountValue: Number(match.discountValue || 0),
            minOrderNpr: Number(match.minOrderNpr || match.minOrder || 0),
            summary
        };
        saveCart();
        renderCouponStatus();
        refreshCart();
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
        refreshCart();
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
                <p class="skg-panel-subtitle">Live menu pricing &amp; itemized bill preview in NPR.</p>
              </div>
              <button class="skg-close" type="button" aria-label="Close order panel">×</button>
            </div>

            <div id="skg-cart-lines" class="skg-cart-lines" aria-live="polite"></div>
            <div id="skg-bill-summary" class="skg-bill-summary" hidden></div>

            <div class="skg-coupon-box">
              <input id="skg-coupon-input" type="text" maxlength="24" placeholder="Promo / Coupon code (optional)" aria-label="Promo or coupon code">
              <button type="button" id="skg-apply-coupon-btn">Apply</button>
            </div>
            <div id="skg-coupon-status"></div>

            <div class="skg-order-notice">
              <strong>Order confirmation notice</strong><br>
              All line items use live verified menu prices. If a dish is unavailable or unpriced (such as Roti when price is unset), please order via WhatsApp or call ${BUSINESS.phone}.
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
        const dishId = card.dataset.dishId || "";
        const name = card.querySelector("h3")?.textContent?.trim();
        if (!name) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "skg-add-cart";
        button.setAttribute("aria-label", `Add ${name} to cart`);

        button.addEventListener("click", () => {
            const lookupKey = card.dataset.dishId || card.querySelector("h3")?.textContent?.trim() || name;
            if (card.classList.contains("dish-sold-out") || card.classList.contains("dish-price-unset")) {
                syncAddCartButtonsAvailability();
                return;
            }
            addResolvedItemToCart(lookupKey, { button });
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
    const billSummaryEl = document.getElementById("skg-bill-summary");
    if (!lines) return;

    if (!cart.size) {
        lines.innerHTML = `
            <div class="skg-empty">
                Your cart is empty.<br>
                Add a few favourites from the menu to get started.
            </div>
        `;
        if (billSummaryEl) {
            billSummaryEl.hidden = true;
            billSummaryEl.innerHTML = "";
        }
        lastConfirmedTotal = null;
        return;
    }

    const menuList = getLiveMenu();
    let subtotal = 0;

    lines.innerHTML = [...cart.entries()].map(([name, quantity]) => {
        const item = findMenuItem(menuList, name);
        const unavailable = !item || item.available === false;
        const unpriced = item && !isItemPriceValid(item);
        const unitPrice = item && isItemPriceValid(item) ? Math.round(item.price) : null;
        const lineTotal = unitPrice ? unitPrice * quantity : 0;
        if (!unavailable && !unpriced) subtotal += lineTotal;

        let warnMsg = "";
        if (!item) warnMsg = "Not found on live menu — remove to continue";
        else if (unavailable) warnMsg = "Currently out of stock — remove to continue";
        else if (unpriced) warnMsg = "Online price not set — Counter / WhatsApp only";

        return `
          <div class="skg-line">
            <div class="skg-line-info">
              <span class="skg-line-name">${escapeHTML(item?.name || name)}</span>
              ${warnMsg
                  ? `<span class="skg-line-warn">${escapeHTML(warnMsg)}</span>`
                  : `<span class="skg-line-meta">Rs. ${unitPrice} × ${quantity}</span>`}
            </div>
            <div class="skg-line-right">
              <span class="skg-line-total">${unitPrice ? `Rs. ${lineTotal}` : "Unset"}</span>
              <span class="skg-qty-controls">
                <button type="button" data-dec="${escapeHTML(name)}" aria-label="Decrease ${escapeHTML(name)}">−</button>
                <strong>${quantity}</strong>
                <button type="button" data-inc="${escapeHTML(name)}" aria-label="Increase ${escapeHTML(name)}" ${unpriced || unavailable ? "disabled" : ""}>+</button>
                <button type="button" class="skg-remove" data-del="${escapeHTML(name)}" aria-label="Remove ${escapeHTML(name)}">×</button>
              </span>
            </div>
          </div>
        `;
    }).join("");

    if (billSummaryEl) {
        let discountAmount = 0;
        let couponNotice = "";
        if (appliedCoupon && subtotal > 0) {
            const couponRes = computeCouponDiscount(appliedCoupon, subtotal);
            if (couponRes.valid) {
                discountAmount = couponRes.discountAmount;
            } else {
                couponNotice = couponRes.reason;
            }
        }
        const total = Math.max(0, subtotal - discountAmount);
        lastConfirmedTotal = total;

        billSummaryEl.hidden = false;
        billSummaryEl.innerHTML = `
          <div class="skg-bill-row"><span>Items Subtotal</span><strong>Rs. ${subtotal}</strong></div>
          ${discountAmount > 0 ? `<div class="skg-bill-row discount"><span>Coupon (${escapeHTML(appliedCoupon.code)})</span><span>− Rs. ${discountAmount}</span></div>` : ""}
          ${couponNotice ? `<div class="skg-line-warn">${escapeHTML(couponNotice)}</div>` : ""}
          <div class="skg-bill-row total"><span>Estimated Total</span><span>Rs. ${total}</span></div>
        `;
    }

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
    const menu = getLiveMenu();
    const bill = calculateOrderBill(orderItems(), menu, appliedCoupon);
    const lines = [
        `Namaste ${BUSINESS.name}! I would like to place an order:`,
        "",
        ...orderItems().map((item) => {
            const match = findMenuItem(menu, item.id || item.name);
            return match && isItemPriceValid(match)
                ? `${item.quantity} × ${match.name} (Rs. ${match.price} = Rs. ${match.price * item.quantity})`
                : `${item.quantity} × ${item.name}`;
        }),
        "",
        bill.ok ? `Estimated Total: Rs. ${bill.totalAmount}` : "",
        `Name: ${values.name || "Not provided"}`,
        `Phone: ${values.phone || "Not provided"}`,
        `Order type: ${values.method}`,
        `Address: ${values.address || "Not applicable"}`,
        `Instructions: ${values.notes || "None"}`
    ].filter(Boolean);
    if (appliedCoupon) {
        lines.push(`Coupon: ${appliedCoupon.code} (${appliedCoupon.summary})`);
    }
    lines.push("", "Please confirm availability and final prices. Thank you.");
    return lines.join("\n");
}

function sendWhatsApp() {
    showFormError("");
    const { user } = getCustomerState();
    if (!user?.uid) {
        customerLoginRedirect();
        return;
    }
    switchCartStorageScope(user);
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

function renderReceiptCardHtml(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const shortId = escapeHTML(String(order.id || "").slice(-8).toUpperCase());
    const createdStr = new Date(Number(order.createdAt || Date.now())).toLocaleString("en-NP", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kathmandu"
    });
    return `
      <div class="skg-receipt-card" id="skg-printable-receipt">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;border-bottom:1px solid #e4ecea;padding-bottom:8px;">
          <div>
            <strong>${BUSINESS.name}</strong>
            <div class="skg-line-meta">${BUSINESS.address} · Tel: ${BUSINESS.phone}</div>
          </div>
          <div style="text-align:right;">
            <strong>Bill #${shortId}</strong>
            <div class="skg-line-meta">${escapeHTML(createdStr)}</div>
          </div>
        </div>
        <div style="margin:8px 0;font-size:12px;">
          Customer: <strong>${escapeHTML(order.customerName)}</strong> (${escapeHTML(order.customerPhone)}) · ${escapeHTML(order.orderType)}
        </div>
        <table class="skg-receipt-table">
          <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>
            ${items.map((it) => `
              <tr>
                <td>${escapeHTML(it.name)}</td>
                <td>${escapeHTML(it.quantity)}</td>
                <td>${it.unitPrice ? `Rs. ${escapeHTML(it.unitPrice)}` : "—"}</td>
                <td>${it.lineTotal ? `Rs. ${escapeHTML(it.lineTotal)}` : "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="skg-bill-row"><span>Subtotal</span><span>Rs. ${escapeHTML(order.subtotalAmount ?? 0)}</span></div>
        ${Number(order.discountAmount || 0) > 0 ? `<div class="skg-bill-row discount"><span>Discount (${escapeHTML(order.couponCode || "Coupon")})</span><span>− Rs. ${escapeHTML(order.discountAmount)}</span></div>` : ""}
        <div class="skg-bill-row total"><span>Total (NPR)</span><span>Rs. ${escapeHTML(order.totalAmount ?? order.subtotalAmount ?? 0)}</span></div>
      </div>
    `;
}

function triggerInPlaceReceiptPrint(receiptHtml) {
    let host = document.getElementById("skg-print-host");
    if (!host) {
        host = document.createElement("div");
        host.id = "skg-print-host";
        host.style.cssText = "display:none;";
        document.body.appendChild(host);
    }
    host.innerHTML = receiptHtml;
    host.style.display = "block";
    window.print();
    host.style.display = "none";
}

async function placeOrder(event) {
    event.preventDefault();
    if (isSubmittingOrder) return;
    showFormError("");

    const { user } = getCustomerState();
    if (!user?.uid) {
        customerLoginRedirect();
        return;
    }
    switchCartStorageScope(user);

    if (window.__SKG_STORE_OPEN === false) {
        showFormError(`Website ordering is currently paused. Please call ${BUSINESS.phone} or message us on WhatsApp.`);
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
    submit.textContent = "Verifying live prices…";

    try {
        // Fetch fresh menu, stock availability, and offer rules before placing order
        const [menuSnap, stockSnap, offersSnap] = await Promise.all([
            get(ref(db, "menu_items")).catch(() => null),
            get(ref(db, "inventory/stockAvailability")).catch(() => null),
            appliedCoupon ? get(ref(db, "offers")).catch(() => null) : Promise.resolve(null)
        ]);

        const freshMenuMap = menuSnap?.exists() ? (menuSnap.val() || {}) : {};
        const freshStockMap = stockSnap?.exists() ? (stockSnap.val() || {}) : {};
        const freshMenu = mergeMenuWithDefaults(freshMenuMap, freshStockMap);
        window.__SKG_MENU_ITEMS = freshMenu;

        let freshCoupon = null;
        if (appliedCoupon?.code && offersSnap?.exists()) {
            const nowCheck = Date.now();
            freshCoupon = Object.entries(offersSnap.val() || {})
                .map(([id, val]) => ({ id, ...val }))
                .find((off) =>
                    off &&
                    off.active !== false &&
                    String(off.code || "").trim().toUpperCase() === appliedCoupon.code &&
                    (!off.expiresAt || Number(off.expiresAt) > nowCheck)
                ) || null;
            if (!freshCoupon) {
                appliedCoupon = null;
                saveCart();
                renderCouponStatus();
                refreshCart();
                showFormError("Your applied coupon has expired or is no longer active. Please review your updated total and submit again.");
                isSubmittingOrder = false;
                submit.disabled = false;
                submit.textContent = "Send website order";
                return;
            }
            appliedCoupon = {
                ...freshCoupon,
                id: freshCoupon.id,
                summary: freshCoupon.summary || freshCoupon.title || freshCoupon.code
            };
            saveCart();
            renderCouponStatus();
        }

        const requested = orderItems();
        const bill = calculateOrderBill(requested, freshMenu, freshCoupon);

        if (!bill.ok) {
            refreshCart();
            showFormError(bill.errors.join(" "));
            isSubmittingOrder = false;
            submit.disabled = false;
            submit.textContent = "Send website order";
            return;
        }

        // Price-drift confirmation guard: if the verified total changed since displayed, pause and ask customer to confirm
        if (lastConfirmedTotal !== null && lastConfirmedTotal !== bill.totalAmount) {
            const prev = lastConfirmedTotal;
            refreshCart();
            lastConfirmedTotal = bill.totalAmount;
            showFormError(`Menu price updated (was Rs. ${prev}, now Rs. ${bill.totalAmount}). Please confirm your updated bill and click "Confirm & Send Order".`);
            isSubmittingOrder = false;
            submit.disabled = false;
            submit.textContent = "Confirm & Send Order";
            return;
        }

        const { workerUrl } = await getPublicPushConfig().catch(() => ({ workerUrl: "" }));
        if (!workerUrl) {
            showFormError("Secure ordering is temporarily unavailable. Please try again later or contact the restaurant on WhatsApp.");
            isSubmittingOrder = false;
            submit.disabled = false;
            submit.textContent = "Try order again";
            return;
        }

        const orderIntent = {
            items: requested.map((item) => ({ id: item.id, quantity: item.quantity })),
            customerName: values.name,
            customerPhone: values.phone,
            orderType: values.method,
            deliveryAddress: values.address,
            notes: values.notes,
            couponCode: bill.coupon?.code || ""
        };
        const pendingOrder = await getPendingOrderReference(user.uid, orderIntent);
        const { orderId, trackingToken } = pendingOrder;
        submit.textContent = "Verifying and placing securely…";
        let serverResult;
        try {
            const authToken = await user.getIdToken(true);
            const response = await fetch(workerUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    type: "create_order",
                    orderId,
                    trackingToken,
                    expectedTotal: bill.totalAmount,
                    customerName: values.name,
                    customerPhone: values.phone,
                    orderType: values.method,
                    deliveryAddress: values.address,
                    notes: values.notes,
                    items: requested,
                    couponCode: bill.coupon?.code || ""
                })
            });
            serverResult = await response.json().catch(() => ({}));
            if (!response.ok || serverResult?.ok !== true || !serverResult?.order) {
                if (response.status === 409 && serverResult?.bill?.items) {
                    const liveItems = Array.isArray(window.__SKG_MENU_ITEMS) ? window.__SKG_MENU_ITEMS : [];
                    serverResult.bill.items.forEach((verifiedItem) => {
                        const target = findMenuItem(liveItems, verifiedItem.id || verifiedItem.name);
                        if (target) {
                            target.price = Number(verifiedItem.unitPrice);
                            target.priceUnset = false;
                        }
                    });
                    window.__SKG_MENU_ITEMS = liveItems;
                    refreshCart();
                    showFormError(`The live total has changed to Rs. ${Number(serverResult.bill.totalAmount || 0)}. Review the updated bill and submit again to confirm.`);
                } else {
                    showFormError(serverResult?.error || `Secure order submission failed (${response.status}). Your order was not submitted.`);
                }
                isSubmittingOrder = false;
                submit.disabled = false;
                submit.textContent = "Confirm & Send Order";
                return;
            }
        } catch (networkError) {
            console.error("Secure order request failed:", networkError);
            showFormError("We could not reach the secure order service. Your order was not submitted. Please try again or contact us on WhatsApp.");
            isSubmittingOrder = false;
            submit.disabled = false;
            submit.textContent = "Try order again";
            return;
        }

        const finalOrder = serverResult.order;
        clearPendingOrderReference(pendingOrder.storageKey);
        const items = Array.isArray(finalOrder.items) ? finalOrder.items : [];
        const now = Number(finalOrder.createdAt || Date.now());
        const trackingSaved = serverResult.trackingSaved === true;
        const serverVerified = finalOrder.priceStatus === "server_verified" && trackingSaved;
        if (!serverVerified || finalOrder.id !== orderId || finalOrder.customerUid !== user.uid || finalOrder.customerTrackingToken !== trackingToken) {
            showFormError("The secure order service returned an invalid confirmation. Please contact the restaurant before retrying.");
            isSubmittingOrder = false;
            submit.disabled = false;
            submit.textContent = "Try order again";
            return;
        }
        if (user?.uid) {
            if (finalOrder.couponCode) {
                logCustomerActivity(user.uid, "coupon_used", {
                    orderId,
                    code: finalOrder.couponCode,
                    summary: finalOrder.couponSummary || ""
                }).catch(() => {});
            }

            const templates = await getOrderNotificationTemplates().catch(() => null);
            const receivedMsg = renderOrderTemplate(templates, "pending", orderId);

            await set(ref(db, `users/${user.uid}/notifications/ord_${orderId}_pending`), {
                id: `ord_${orderId}_pending`,
                orderId,
                status: "pending",
                title: `Order #${orderId.slice(-8).toUpperCase()} Received`,
                body: receivedMsg,
                createdAt: now,
                read: false
            }).catch((notifErr) => {
                console.warn("Could not save customer inbox notification:", notifErr?.message || notifErr);
            });

            await recordNotificationHistory("orders", {
                id: `ord_${orderId}_pending`,
                title: `Order #${orderId.slice(-8).toUpperCase()} Received`,
                message: receivedMsg,
                type: "order_received",
                targetAudience: `customer:${user.uid}`,
                status: "created",
                actorUid: user.uid
            }).catch(() => {});

            logCustomerActivity(user.uid, "order_placed", {
                orderId,
                orderType: values.method,
                itemCount: items.reduce((s, i) => s + Number(i.quantity || 1), 0),
                totalAmount: finalOrder.totalAmount,
                summary: finalOrder.summary.slice(0, 140)
            }).catch(() => {});
        }
        window.AnalyticsTracker?.trackEvent?.("order_submitted", {
            orderType: values.method,
            itemCount: items.reduce((s, i) => s + Number(i.quantity || 1), 0)
        });

        if (workerUrl) {
            dispatchWorkerPush({
                workerUrl,
                payload: {
                    type: "new_order_alert",
                    orderId,
                    trackingToken
                }
            }).catch(() => {});
        }

        if (trackingSaved) {
            try {
                localStorage.setItem(scopedStorageKey(TRACKING_KEY), JSON.stringify({ id: orderId, token: trackingToken }));
            } catch {}
        }


        cart.clear();
        appliedCoupon = null;
        lastConfirmedTotal = null;
        saveCart();
        refreshCart();
        renderCouponStatus();

        lastReceiptHtml = renderReceiptCardHtml(finalOrder);
        const result = document.getElementById("skg-result");
        result.hidden = false;
        result.innerHTML = `
          <strong>Order request received ${serverVerified ? "· Server-verified total" : ""}</strong>
          Your reference is <b>${escapeHTML(orderId.slice(-8).toUpperCase())}</b>.
          Our team will contact you shortly to confirm preparation &amp; ${escapeHTML(finalOrder.orderType.toLowerCase())}.
          ${lastReceiptHtml}
          <div class="skg-result-actions">
            <button type="button" id="skg-print-receipt-btn">Print / Save Bill</button>
            ${trackingSaved ? `<button type="button" id="skg-enable-customer-notifications">Enable status alerts</button>` : ""}
            ${user?.uid ? `<a href="account.html#tracking">Track in My Account</a>` : ""}
            <a href="https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(`Namaste! I submitted website order ${orderId} (Total Rs. ${finalOrder.totalAmount}). Please confirm it.`)}" target="_blank" rel="noopener noreferrer">Confirm on WhatsApp</a>
            <a href="tel:${BUSINESS.phone}">Call ${BUSINESS.phone}</a>
          </div>
          <div id="skg-customer-tracking" class="skg-tracking">
            ${trackingSaved ? "Current status: Waiting for the restaurant to review your order." : "Your order was received, but live tracking is temporarily unavailable."}
          </div>
        `;

        document.getElementById("skg-print-receipt-btn")?.addEventListener("click", () => {
            triggerInPlaceReceiptPrint(lastReceiptHtml);
        });

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
        if (submit.textContent === "Sending securely…" || submit.textContent === "Verifying live prices…") {
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
        const data = JSON.parse(localStorage.getItem(scopedStorageKey(TRACKING_KEY)) || "null");
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

    if (!window.__SKG_HAS_MENU_LISTENER) {
        onValue(ref(db, "menu_items"), (snap) => {
            const rawMap = snap.exists() ? (snap.val() || {}) : {};
            window.__SKG_MENU_ITEMS = mergeMenuWithDefaults(rawMap, {});
            syncAddCartButtonsAvailability();
            refreshCart();
        }, () => {});
    }

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
            const lookupKey = card?.dataset.dishId || card?.querySelector("h3")?.textContent?.trim();
            const resolved = lookupKey ? getMenuItemForCardOrName(lookupKey) : null;
            const dishName = resolved?.name || card?.querySelector("h3")?.textContent?.trim();
            if (dishName) {
                const { user } = getCustomerState();
                if (!user?.uid) {
                    customerLoginRedirect(resolved ? { id: resolved.id || dishName } : { name: dishName });
                    return;
                }
                switchCartStorageScope(user);
                if (resolved && (!isItemPriceValid(resolved) || resolved.available === false)) {
                    openCart();
                    showCartMessage(`${dishName} is ${resolved.available === false ? "currently unavailable" : "Counter / WhatsApp only (price unset)"}.`);
                    return;
                }
                const quantity = cart.get(dishName) || 0;
                if (quantity < 20) cart.set(dishName, quantity + 1);
                saveCart();
                refreshCart();
            }
            openCart();
        });
    });

    onCustomerAuthChange(({ user }) => {
        switchCartStorageScope(user);
        prefillAuthenticatedCustomer();
        syncNavCount();
        restorePendingCartIntent(user);
    });

    window.addEventListener("skg:availability-updated", syncAddCartButtonsAvailability);
    window.addEventListener("skg:menu-updated", () => {
        mountUI();
        syncAddCartButtonsAvailability();
        refreshCart();
    });
    window.addEventListener("skg:store-status-updated", syncStorePausedUI);

    restoreTracking();
});
