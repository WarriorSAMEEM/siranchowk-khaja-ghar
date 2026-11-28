// ============================================================================
// SIRANCHOWK KHAJA GHAR - MAIN JAVASCRIPT
// ============================================================================
// Website functionality + Firebase Realtime Database integration + Auth Nav
// ============================================================================

import {
    db,
    ref,
    get,
    child,
    push,
    set,
    onValue
} from "./firebase.js";
import "./customer-auth.js";
import "./maps-locator.js";
import {
    CANONICAL_MENU_ITEMS,
    slugifyDishKey,
    mergeMenuWithDefaults,
    findMenuItem,
    isItemPriceValid,
    formatPriceLabel
} from "./menu-catalog.js";


// ============================================================================
// 1. CENTRAL BUSINESS CONFIGURATION
// ============================================================================

const SITE_CONFIG = {
    businessName: "Siranchowk Khaja Ghar",
    nepaliName: "सिरानचोक खाजा घर",
    tagline: "Your Satisfaction Is Our Satisfaction",
    phone: "9821233154",
    whatsapp: "9779821233154",
    address: "Khairahani 6, Parsa, Chitwan, Nepal",
    landmark: "Behind Chaudhary Medical",
    hours: "6:30 AM – 9:00 PM",
    openingTime: "2026-09-28T09:00:00+05:45",
    timezone: "Asia/Kathmandu",
    mapsUrl: "https://share.google/TQzV5f70BfISX9l1h"
};

// ============================================================================
// 2. DEFAULT / FALLBACK MENU DATA
// ============================================================================

const DEFAULT_MENU_ITEMS = CANONICAL_MENU_ITEMS;

let liveRtdbMenuMap = {};
let liveStockAvailability = {};
let liveMenuItems = mergeMenuWithDefaults({}, {});
let activeCategory = "all";
let menuSearchQuery = "";

function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function rebuildMergedMenuAndHydrate() {
    liveMenuItems = mergeMenuWithDefaults(liveRtdbMenuMap, liveStockAvailability);
    window.__SKG_MENU_ITEMS = liveMenuItems;

    const unavailable = new Set();
    liveMenuItems.forEach((item) => {
        if (item && item.available === false) {
            const key = slugifyDishKey(item.name);
            if (key) unavailable.add(key);
            if (item.id) unavailable.add(slugifyDishKey(item.id));
        }
    });
    window.__SKG_UNAVAILABLE_DISHES = unavailable;

    // Hydrate static featured dish cards outside #menu-grid-container (e.g., index.html)
    document.querySelectorAll(".dish-card").forEach((card) => {
        if (card.closest("#menu-grid-container")) return;
        const cardId = card.dataset.dishId || card.querySelector("h3")?.textContent?.trim();
        const item = findMenuItem(liveMenuItems, cardId);
        if (!item) return;

        card.dataset.dishId = item.id;
        const titleEl = card.querySelector("h3");
        if (titleEl) titleEl.textContent = item.name;
        const nepaliEl = card.querySelector(".dish-nepali");
        if (nepaliEl && item.nepaliName) nepaliEl.textContent = item.nepaliName;
        const descEl = card.querySelector(".dish-desc");
        if (descEl && item.description) descEl.textContent = item.description;

        const priceEl = card.querySelector(".dish-price");
        if (priceEl) {
            priceEl.textContent = formatPriceLabel(item);
        }

        const isUnavailable = item.available === false;
        const isUnpriced = !isItemPriceValid(item);
        card.classList.toggle("dish-sold-out", isUnavailable);
        card.classList.toggle("dish-price-unset", !isUnavailable && isUnpriced);

        const imgWrapper = card.querySelector(".dish-img-wrapper");
        if (imgWrapper) {
            const img = imgWrapper.querySelector("img");
            if (img && item.image && img.getAttribute("src") !== item.image) {
                img.setAttribute("src", item.image);
            }
            let badge = imgWrapper.querySelector(".soldout-badge");
            if (isUnavailable && !badge) {
                badge = document.createElement("span");
                badge.className = "dish-badge soldout-badge";
                badge.textContent = "Currently Unavailable";
                imgWrapper.appendChild(badge);
            } else if (!isUnavailable && badge) {
                badge.remove();
            }
        }
    });

    if (document.getElementById("menu-grid-container")) {
        renderMenuItems(activeCategory);
    }

    window.dispatchEvent(new CustomEvent("skg:availability-updated", { detail: { unavailable } }));
    window.dispatchEvent(new CustomEvent("skg:menu-updated", { detail: { items: liveMenuItems } }));
}

function initLiveStoreAndStockListeners() {
    window.__SKG_STORE_OPEN = true;
    window.__SKG_HAS_MENU_LISTENER = true;
    rebuildMergedMenuAndHydrate();

    onValue(ref(db, "menu_items"), (snap) => {
        liveRtdbMenuMap = snap.exists() ? (snap.val() || {}) : {};
        rebuildMergedMenuAndHydrate();
    }, () => {
        liveRtdbMenuMap = {};
        rebuildMergedMenuAndHydrate();
    });

    onValue(ref(db, "inventory/stockAvailability"), (snap) => {
        liveStockAvailability = snap.exists() ? (snap.val() || {}) : {};
        rebuildMergedMenuAndHydrate();
    }, () => {});

    onValue(ref(db, "settings/business/storeOpen"), (snap) => {
        const isOpen = snap.exists() ? snap.val() !== false : true;
        window.__SKG_STORE_OPEN = isOpen;

        const main = document.querySelector("main");
        let banner = document.getElementById("skg-store-paused-banner");
        if (!isOpen && main) {
            if (!banner) {
                banner = document.createElement("div");
                banner.id = "skg-store-paused-banner";
                banner.className = "container";
                banner.style.cssText = "margin-top:14px;padding:12px 16px;border:1px solid #f0c38a;border-radius:12px;background:#fff8eb;color:#7a4d0c;font-size:14px;font-weight:600;";
                banner.innerHTML = `Website ordering is temporarily paused. For current availability or inquiries, please call <a href="tel:${SITE_CONFIG.phone}" style="color:var(--color-primary, #A8442B);text-decoration:underline;">${SITE_CONFIG.phone}</a> or message us on WhatsApp.`;
                main.prepend(banner);
            }
        } else if (banner) {
            banner.remove();
        }

        window.dispatchEvent(new CustomEvent("skg:store-status-updated", { detail: { storeOpen: isOpen } }));
    }, () => {});
}

// ============================================================================
// 3. PWA INSTALL PROMPT
// ============================================================================

let deferredInstallPrompt = null;
let installPromptReady = false;

function initPWAInstall() {
    const installButtons = document.querySelectorAll(
        "#install-app-btn, #pwa-install-btn, [data-install-app], .install-app-btn"
    );

    window.addEventListener("beforeinstallprompt", (event) => {
        if (!installButtons.length) return;
        event.preventDefault();
        deferredInstallPrompt = event;
        installPromptReady = true;

        installButtons.forEach((button) => {
            button.hidden = false;
            button.disabled = false;
            button.addEventListener("click", handleInstallClick, { once: true });
        });
    });

    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        installPromptReady = false;
        installButtons.forEach((button) => {
            button.hidden = true;
        });
    });
}

async function handleInstallClick() {
    if (!deferredInstallPrompt || !installPromptReady) return;
    try {
        const promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = null;
        installPromptReady = false;
        await promptEvent.prompt();
        await promptEvent.userChoice;
    } catch (error) {
        console.error("PWA installation prompt failed:", error);
    }
}

// ============================================================================
// 4. DOM READY
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
    initMobileNav();
    initCountdown();
    initLiveStoreAndStockListeners();
    initMenuPage();
    initPublicOffersSection();
    initImageFallbacks();
    setCurrentYear();
    highlightActiveNav();
    initPWAInstall();
    initPrivacyControls();
});

// ============================================================================
// 5. MOBILE NAVIGATION
// ============================================================================

function initMobileNav() {
    const toggleBtn = document.querySelector(".mobile-nav-toggle");
    const nav = document.getElementById("primary-nav");
    if (!toggleBtn || !nav) return;

    toggleBtn.addEventListener("click", () => {
        const isExpanded = toggleBtn.getAttribute("aria-expanded") === "true";
        toggleBtn.setAttribute("aria-expanded", String(!isExpanded));
        nav.classList.toggle("is-open");
    });

    document.addEventListener("click", (event) => {
        if (
            !nav.contains(event.target) &&
            !toggleBtn.contains(event.target) &&
            nav.classList.contains("is-open")
        ) {
            nav.classList.remove("is-open");
            toggleBtn.setAttribute("aria-expanded", "false");
        }
    });
}

// ============================================================================
// 6. OPENING STATUS
// ============================================================================

function initCountdown() {
    const timerDays = document.getElementById("timer-days");
    const timerHours = document.getElementById("timer-hours");
    const timerMins = document.getElementById("timer-mins");
    const timerSecs = document.getElementById("timer-secs");
    const countdownTimer = document.getElementById("countdown-timer");
    const openStatusMsg = document.getElementById("open-status-message");
    const openingBadge = document.getElementById("opening-badge");

    if (!timerDays || !timerHours || !timerMins || !timerSecs) return;

    const openingDate = new Date(SITE_CONFIG.openingTime).getTime();

    function updateTimer() {
        const now = Date.now();
        const timeDifference = openingDate - now;

        if (timeDifference <= 0) {
            if (countdownTimer) countdownTimer.classList.add("hidden");
            if (openStatusMsg) openStatusMsg.classList.remove("hidden");
            if (openingBadge) {
                openingBadge.textContent = "NOW OPEN";
                openingBadge.style.backgroundColor = "var(--color-whatsapp)";
                openingBadge.style.color = "#ffffff";
            }
            return;
        }

        const days = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeDifference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeDifference % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeDifference % (1000 * 60)) / 1000);

        timerDays.textContent = String(days).padStart(2, "0");
        timerHours.textContent = String(hours).padStart(2, "0");
        timerMins.textContent = String(minutes).padStart(2, "0");
        timerSecs.textContent = String(seconds).padStart(2, "0");
    }

    updateTimer();
    setInterval(updateTimer, 1000);
}

// ============================================================================
// 7. MENU PAGE + LIVE FIREBASE MENU SYNC
// ============================================================================

function initMenuPage() {
    const menuContainer = document.getElementById("menu-grid-container");
    if (!menuContainer) return;

    const urlParams = new URLSearchParams(window.location.search);
    activeCategory = (urlParams.get("category") || "all").toLowerCase();

    const searchInput = document.getElementById("menu-search-input");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            menuSearchQuery = searchInput.value.trim().toLowerCase();
            renderMenuItems(activeCategory);
        });
    }

    bindCategoryButtons();
    renderMenuItems(activeCategory);

    // Sync categories from Firebase RTDB when available
    onValue(ref(db, "categories"), (catSnap) => {
        if (!catSnap.exists()) return;
        const cats = Object.entries(catSnap.val() || {})
            .map(([id, val]) => ({ id, ...val, _slug: String(val?.slug || id || "").trim().toLowerCase() }))
            .filter((c) => c && c.active !== false && c._slug && c.name);
        if (!cats.length) return;

        const filterWrapper = document.querySelector(".menu-filter-wrapper");
        if (!filterWrapper) return;
        filterWrapper.innerHTML = `
            <button class="filter-btn ${activeCategory === "all" ? "active" : ""}" data-category="all">All Items</button>
            ${cats.map((c) => `
                <button class="filter-btn ${activeCategory === c._slug ? "active" : ""}" data-category="${escapeText(c._slug)}">
                    ${escapeText(c.name)}
                </button>
            `).join("")}
        `;
        bindCategoryButtons();
    }, () => {});
}

function bindCategoryButtons() {
    const filterBtns = document.querySelectorAll(".filter-btn");
    filterBtns.forEach((btn) => {
        const cat = (btn.getAttribute("data-category") || "all").toLowerCase();
        btn.classList.toggle("active", cat === activeCategory);

        btn.addEventListener("click", () => {
            filterBtns.forEach((button) => button.classList.remove("active"));
            btn.classList.add("active");
            activeCategory = cat;
            renderMenuItems(activeCategory);
        });
    });
}

function renderMenuItems(category = "all") {
    const menuContainer = document.getElementById("menu-grid-container");
    if (!menuContainer) return;

    menuContainer.replaceChildren();
    const selectedCategory = String(category || "all").toLowerCase();

    const filteredItems = liveMenuItems.filter((item) => {
        if (!item || !item.name) return false;
        const catMatch = selectedCategory === "all" || String(item.category).toLowerCase() === selectedCategory;
        const queryMatch = !menuSearchQuery ||
            item.name.toLowerCase().includes(menuSearchQuery) ||
            (item.nepaliName || "").toLowerCase().includes(menuSearchQuery) ||
            (item.description || "").toLowerCase().includes(menuSearchQuery);
        return catMatch && queryMatch;
    });

    if (filteredItems.length === 0) {
        const message = document.createElement("p");
        message.className = "menu-empty-message";
        message.textContent = "No menu items matched your filter.";
        message.style.gridColumn = "1 / -1";
        message.style.textAlign = "center";
        message.style.padding = "2rem";
        menuContainer.appendChild(message);
        return;
    }

    filteredItems.forEach((item) => {
        const isSpecial = item.category === "special";
        const isUnavailable = item.available === false;
        const isUnpriced = !isItemPriceValid(item);

        const card = document.createElement("article");
        card.className = "dish-card";
        card.dataset.dishId = item.id;
        if (isSpecial) card.classList.add("special-dish-card");
        if (isUnavailable) card.classList.add("dish-sold-out");
        else if (isUnpriced) card.classList.add("dish-price-unset");

        const imageWrapper = document.createElement("div");
        imageWrapper.className = "dish-img-wrapper";

        const image = document.createElement("img");
        image.alt = item.alt || item.name;
        image.loading = "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";

        if (item.image) {
            image.src = item.image;
            image.addEventListener("error", () => {
                imageWrapper.classList.add("dish-image-error");
                image.remove();
            });
        } else {
            imageWrapper.classList.add("dish-image-error");
        }

        imageWrapper.appendChild(image);

        if (isUnavailable) {
            const badge = document.createElement("span");
            badge.className = "dish-badge soldout-badge";
            badge.textContent = "Currently Unavailable";
            imageWrapper.appendChild(badge);
        } else if (isSpecial) {
            const badge = document.createElement("span");
            badge.className = "dish-badge special-badge";
            badge.textContent = item.badge || "Friday & Special Days";
            imageWrapper.appendChild(badge);
        } else if (item.badge) {
            const badge = document.createElement("span");
            badge.className = "dish-badge";
            badge.textContent = item.badge;
            imageWrapper.appendChild(badge);
        }

        const info = document.createElement("div");
        info.className = "dish-info";

        const titleRow = document.createElement("div");
        titleRow.className = "dish-title-row";

        const title = document.createElement("h3");
        title.textContent = item.name;

        const nepaliName = document.createElement("span");
        nepaliName.className = "dish-nepali";
        nepaliName.textContent = item.nepaliName || "";

        titleRow.append(title, nepaliName);

        const description = document.createElement("p");
        description.className = "dish-desc";
        description.textContent = item.description || "";

        const metaNote = document.createElement("span");
        metaNote.className = "dish-availability-note";
        metaNote.textContent = isUnpriced
            ? "Online ordering opens once counter price is set by admin."
            : (item.availabilityNote || "100% Halal · Freshly prepared");

        const footer = document.createElement("div");
        footer.className = "dish-footer";

        const price = document.createElement("span");
        price.className = "dish-price";
        price.textContent = formatPriceLabel(item);

        footer.append(price);
        info.append(titleRow, description, metaNote, footer);
        card.append(imageWrapper, info);
        menuContainer.appendChild(card);
    });
}

// ============================================================================
// 8. PUBLIC OFFERS & COUPONS BANNER/GRID
// ============================================================================

function initPublicOffersSection() {
    const offersContainer = document.getElementById("public-offers-grid");
    if (!offersContainer) return;

    onValue(ref(db, "offers"), (snap) => {
        if (!snap.exists()) {
            offersContainer.innerHTML = `
                <div class="offer-empty-note">
                    Check back soon for seasonal offers and local Khaja combos at Siranchowk Khaja Ghar.
                </div>`;
            return;
        }

        const now = Date.now();
        const activeOffers = Object.entries(snap.val() || {})
            .map(([id, val]) => ({ id, ...val }))
            .filter((off) => off && off.active !== false && (!off.expiresAt || Number(off.expiresAt) > now));

        if (!activeOffers.length) {
            offersContainer.innerHTML = `
                <div class="offer-empty-note">
                    No promotional coupon codes are active right now. Daily fresh food is served from 6:30 AM – 9:00 PM.
                </div>`;
            return;
        }

        offersContainer.replaceChildren();
        activeOffers.forEach((off) => {
            const card = document.createElement("article");
            card.className = "public-offer-card";

            const discountLabel = off.discountType === "percent"
                ? `${off.discountValue}% Off`
                : (off.discountValue ? `Rs. ${off.discountValue} Off` : "Special Offer");

            const head = document.createElement("div");
            head.className = "public-offer-head";
            const title = document.createElement("h3");
            title.textContent = off.title || "Special Offer";
            const value = document.createElement("span");
            value.className = "public-offer-value";
            value.textContent = discountLabel;
            head.append(title, value);

            const desc = document.createElement("p");
            desc.textContent = off.description || "";

            const actions = document.createElement("div");
            actions.className = "public-offer-actions";

            const codeEl = document.createElement("code");
            codeEl.className = "public-offer-code";
            codeEl.textContent = off.code || "OFFER";

            const applyBtn = document.createElement("button");
            applyBtn.type = "button";
            applyBtn.className = "btn-sm btn-primary";
            applyBtn.textContent = "Apply in Cart";
            applyBtn.addEventListener("click", () => {
                if (window.SKGCart && typeof window.SKGCart.applyCouponCode === "function") {
                    window.SKGCart.applyCouponCode(off.code || "");
                    window.SKGCart.open();
                }
            });

            actions.append(codeEl, applyBtn);
            card.append(head, desc, actions);
            offersContainer.appendChild(card);
        });
    }, () => {});
}

// ============================================================================
// 9. IMAGE FALLBACK PROTECTION
// ============================================================================

function initImageFallbacks() {
    document.querySelectorAll("img").forEach((img) => {
        if (!img.getAttribute("referrerpolicy")) {
            img.setAttribute("referrerpolicy", "no-referrer");
        }
        img.addEventListener("error", () => {
            const wrapper = img.closest(".dish-img-wrapper, .hero-image-frame");
            if (wrapper) wrapper.classList.add("dish-image-error");
            img.style.display = "none";
        });
    });
}

// ============================================================================
// 10. HELPERS & EXPORTS
// ============================================================================

async function fetchMenu() {
    try {
        const snapshot = await get(child(ref(db), "menu_items"));
        return snapshot.exists() ? snapshot.val() : {};
    } catch {
        return {};
    }
}

function setCurrentYear() {
    const currentYear = new Date().getFullYear();
    document.querySelectorAll("#current-year").forEach((el) => {
        el.textContent = currentYear;
    });
}

function highlightActiveNav() {
    const currentPath = window.location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".nav-link").forEach((link) => {
        const href = link.getAttribute("href");
        if (href === currentPath || (currentPath === "" && href === "index.html")) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });
}

function initPrivacyControls() {
    const footerBottom = document.querySelector(".footer-bottom") || document.querySelector("footer .container");
    if (!footerBottom || document.getElementById("skg-privacy-trigger")) return;

    const trigger = document.createElement("button");
    trigger.id = "skg-privacy-trigger";
    trigger.type = "button";
    trigger.textContent = "Privacy & Analytics Preferences";
    trigger.style.cssText = "background:none;border:0;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;font-size:0.85rem;margin-left:12px;opacity:0.88;";
    footerBottom.appendChild(trigger);

    trigger.addEventListener("click", () => {
        let modal = document.getElementById("skg-privacy-modal");
        if (!modal) {
            modal = document.createElement("div");
            modal.id = "skg-privacy-modal";
            modal.style.cssText = "position:fixed;inset:0;z-index:2100;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(16,43,43,0.72);backdrop-filter:blur(4px);";
            modal.innerHTML = `
              <section role="dialog" aria-modal="true" aria-labelledby="skg-privacy-title" style="width:min(460px,100%);background:#fff;color:#183b39;border-radius:16px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,0.28);">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;">
                  <h2 id="skg-privacy-title" style="margin:0;font-size:1.15rem;">Privacy &amp; Analytics Preferences</h2>
                  <button type="button" id="skg-privacy-close" aria-label="Close privacy settings" style="width:32px;height:32px;border:0;border-radius:50%;background:#eef5f3;color:#183b39;font-size:18px;cursor:pointer;">×</button>
                </div>
                <p style="font-size:0.9rem;line-height:1.55;color:#47615e;margin:0 0 12px;">
                  Siranchowk Khaja Ghar uses lightweight first-party analytics (page views, device/browser category, and estimated active session duration) to improve our menu and website. We never sell data, do not use cross-site advertising trackers, and respect your browser's Do Not Track setting.
                </p>
                <label style="display:flex;align-items:center;gap:10px;padding:12px;border:1px solid #d7e5e2;border-radius:10px;background:#f8fbfa;font-size:0.9rem;font-weight:600;cursor:pointer;">
                  <input type="checkbox" id="skg-optout-checkbox">
                  <span>Opt out of anonymous website analytics on this browser</span>
                </label>
                <p id="skg-optout-status" style="font-size:0.82rem;color:#5d7370;margin:10px 0 0;"></p>
              </section>
            `;
            document.body.appendChild(modal);

            const closeBtn = modal.querySelector("#skg-privacy-close");
            closeBtn.addEventListener("click", () => { modal.style.display = "none"; });
            modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });

            const checkbox = modal.querySelector("#skg-optout-checkbox");
            const statusEl = modal.querySelector("#skg-optout-status");
            const refreshState = () => {
                const dnt = navigator.doNotTrack === "1" || window.doNotTrack === "1";
                const optedOut = window.AnalyticsTracker?.isOptedOut?.() || localStorage.getItem("skg_analytics_optout") === "1";
                checkbox.checked = Boolean(optedOut);
                checkbox.disabled = dnt;
                statusEl.textContent = dnt
                    ? "Your browser has Do Not Track enabled, so analytics tracking is automatically disabled."
                    : (optedOut ? "Anonymous analytics tracking is currently paused on this browser." : "Anonymous analytics tracking is active.");
            };

            checkbox.addEventListener("change", () => {
                if (window.AnalyticsTracker?.setOptOut) {
                    window.AnalyticsTracker.setOptOut(checkbox.checked);
                } else if (checkbox.checked) {
                    localStorage.setItem("skg_analytics_optout", "1");
                } else {
                    localStorage.removeItem("skg_analytics_optout");
                }
                refreshState();
            });
            refreshState();
        } else {
            modal.style.display = "flex";
        }
    });
}

window.fetchMenu = fetchMenu;
window.SITE_CONFIG = SITE_CONFIG;
window.showInstallPrompt = handleInstallClick;