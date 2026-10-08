// ============================================================================
// SIRANCHOWK KHAJA GHAR - MAIN JAVASCRIPT
// ============================================================================
// Website functionality + Firebase Realtime Database integration
// ============================================================================

import {
    db,
    ref,
    get,
    child,
    push,
    set
} from "./firebase.js";

console.log("Firebase initialized successfully:", db);


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

const menuItems = [

    // ------------------------------------------------------------------------
    // MOMO
    // ------------------------------------------------------------------------

    {
        id: "momo-chicken",
        category: "momo",
        categoryLabel: "Momo",
        name: "Chicken Momo",
        nepaliName: "चिकेन म:म",
        description:
            "Steamed dumplings filled with spiced minced chicken, fresh herbs, and served with signature chutney.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Prepared fresh daily",
        image: "https://i.postimg.cc/B67vSQNg/chicken-momo.jpg",
        alt: "Steamed Nepali Chicken Momo served with spicy chutney"
    },

    {
        id: "momo-buff",
        category: "momo",
        categoryLabel: "Momo",
        name: "Buff Momo",
        nepaliName: "बफ म:म",
        description:
            "Traditional Nepali buff dumplings steamed hot and served with fresh tomato-sesame chutney.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Prepared fresh daily",
        image: "https://i.postimg.cc/3ryGkPpY/buff-momo.jpg",
        alt: "Steamed Nepali Buff Momo with spicy sauce"
    },


    // ------------------------------------------------------------------------
    // CHOWMEIN
    // ------------------------------------------------------------------------

    {
        id: "chowmein-veg",
        category: "chowmein",
        categoryLabel: "Chowmein",
        name: "Veg Chowmein",
        nepaliName: "भेज चाउमिन",
        description:
            "Stir-fried Nepali-style noodles tossed with crisp cabbage, carrots, onion, and savory spices.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Prepared fresh daily",
        image: "https://i.postimg.cc/5yGj3NCL/veg-choumin.jpg",
        alt: "Nepali Vegetable Chowmein noodles"
    },

    {
        id: "chowmein-chicken",
        category: "chowmein",
        categoryLabel: "Chowmein",
        name: "Chicken Chowmein",
        nepaliName: "चिकेन चाउमिन",
        description:
            "Fresh wok-fried noodles tossed with spiced chicken strips, mixed vegetables, and local seasonings.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Prepared fresh daily",
        image: "https://i.postimg.cc/MTHWFJxD/chicken-choumin.jpg",
        alt: "Nepali Chicken Chowmein noodles"
    },


    // ------------------------------------------------------------------------
    // BREAD / ROTI
    // ------------------------------------------------------------------------

    {
        id: "roti-plain",
        category: "roti",
        categoryLabel: "Bread / Roti",
        name: "Roti",
        nepaliName: "रोटी",
        description:
            "Soft whole wheat flatbread made warm on the griddle upon request.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Available all day",
        image: "https://i.postimg.cc/qqYgLM3x/roti.jpg",
        alt: "Fresh hot whole wheat Nepali Roti"
    },

    {
        id: "roti-paratha",
        category: "roti",
        categoryLabel: "Bread / Roti",
        name: "Paratha",
        nepaliName: "पराठा",
        description:
            "Warm, layered flatbread fried lightly with ghee/oil. Ideal with morning tea or curry.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Available all day",
        image: "https://i.postimg.cc/6617wz1b/parathaa.jpg",
        alt: "Golden crispy Nepali Paratha"
    },


    // ------------------------------------------------------------------------
    // TEA
    // ------------------------------------------------------------------------

    {
        id: "tea-milk",
        category: "tea",
        categoryLabel: "Tea",
        name: "Milk Tea",
        nepaliName: "चिया (दुध)",
        description:
            "Traditional Nepali milk tea brewed hot with quality CTC tea leaves and fresh milk.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Freshly brewed",
        image: "https://i.postimg.cc/sx1v7Z1t/milk-tea.jpg",
        alt: "Hot Nepali milk tea in a glass cup"
    },

    {
        id: "tea-black",
        category: "tea",
        categoryLabel: "Tea",
        name: "Black Tea",
        nepaliName: "कालो चिया",
        description:
            "Aromatic black tea brewed hot with optional ginger or lemon touch.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Freshly brewed",
        image: "https://i.postimg.cc/FFfSY2cL/black-tea.jpg",
        alt: "Fresh hot black tea in a glass"
    },


    // ------------------------------------------------------------------------
    // RICE / SPECIAL
    // ------------------------------------------------------------------------

    {
        id: "special-biryani",
        category: "special",
        categoryLabel: "Rice & Special",
        name: "Biryani",
        nepaliName: "बिरयानी",
        description:
            "Fragrant rice dish cooked with herbs, rich spices, and marinated chicken.",
        priceNote: "Available on Fridays and special days",
        available: true,
        availabilityNote: "Friday & Special Days Only",
        image: "https://i.postimg.cc/wMs9951T/biryani.jpg",
        alt: "Special Chicken Biryani rice dish"
    },


    // ------------------------------------------------------------------------
    // SNACKS / OTHER
    // ------------------------------------------------------------------------

    {
        id: "snack-chana",
        category: "snacks",
        categoryLabel: "Snacks / Other",
        name: "Chana",
        nepaliName: "चना",
        description:
            "Spiced chickpeas sauteed with onions, green chilies, and Nepali masalas.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Great with hot tea",
        image: "https://i.postimg.cc/Dmkn0WGQ/chana.jpg",
        alt: "Spiced Nepali Chana snack"
    },

    {
        id: "snack-keema",
        category: "snacks",
        categoryLabel: "Snacks / Other",
        name: "Keema",
        nepaliName: "कीमा",
        description:
            "Minced meat cooked with garlic, onions, and spicy gravy.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Prepared fresh",
        image: "https://i.postimg.cc/CxbdG0LF/keema.jpg",
        alt: "Spiced Keema fry"
    },

    {
        id: "snack-sukuti",
        category: "snacks",
        categoryLabel: "Snacks / Other",
        name: "Sukuti",
        nepaliName: "सुकुटी",
        description:
            "Traditional seasoned local fried dish enjoyed with tea or snacks.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Local favorite",
        image: "https://i.postimg.cc/YCg6PT8C/sukuti.jpg",
        alt: "Nepali local snack dish"
    },

    {
        id: "snack-boiled-egg",
        category: "snacks",
        categoryLabel: "Snacks / Other",
        name: "Boiled Egg",
        nepaliName: "उसिनेको अण्डा",
        description:
            "Fresh boiled eggs served with salt and chili pepper seasoning.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Quick healthy option",
        image: "https://i.postimg.cc/hjZGDPMz/egg.jpg",
        alt: "Fresh Boiled Eggs with salt and pepper"
    },

    {
        id: "snack-fried-chicken",
        category: "snacks",
        categoryLabel: "Snacks / Other",
        name: "Fried Chicken",
        nepaliName: "फ्राइड चिकेन",
        description:
            "Crispy seasoned chicken pieces fried to golden perfection.",
        priceNote: "Price available at counter",
        available: true,
        availabilityNote: "Crispy and fresh",
        image: "https://i.postimg.cc/d1V1cTR8/fried-chicken.jpg",
        alt: "Golden crispy fried chicken"
    }

];


// ============================================================================
// 3. PWA INSTALL PROMPT
// ============================================================================
//
// The browser's beforeinstallprompt event is captured here.
//
// IMPORTANT:
// We call preventDefault() only when an actual install control exists.
// This prevents the browser console warning:
// "beforeinstallprompt event.preventDefault() called..."
//
// The install prompt itself is shown only after a real user click.
// ============================================================================

let deferredInstallPrompt = null;
let installPromptReady = false;


function initPWAInstall() {

    const installButtons = document.querySelectorAll(
        "#install-app-btn, " +
        "#pwa-install-btn, " +
        "[data-install-app], " +
        ".install-app-btn"
    );

    window.addEventListener("beforeinstallprompt", (event) => {

        // If there is no custom install button/banner,
        // allow the browser to handle the event normally.
        if (!installButtons.length) {
            return;
        }

        event.preventDefault();

        deferredInstallPrompt = event;
        installPromptReady = true;

        installButtons.forEach((button) => {

            button.hidden = false;
            button.disabled = false;

            button.addEventListener(
                "click",
                handleInstallClick,
                { once: true }
            );

        });

        console.log("PWA install prompt is ready.");

    });


    window.addEventListener("appinstalled", () => {

        deferredInstallPrompt = null;
        installPromptReady = false;

        installButtons.forEach((button) => {
            button.hidden = true;
        });

        console.log("Siranchowk Khaja Ghar app installed successfully.");

    });

}


async function handleInstallClick() {

    if (!deferredInstallPrompt || !installPromptReady) {
        console.log("PWA install prompt is not available yet.");
        return;
    }

    try {

        const promptEvent = deferredInstallPrompt;

        deferredInstallPrompt = null;
        installPromptReady = false;

        await promptEvent.prompt();

        const choiceResult = await promptEvent.userChoice;

        console.log(
            "PWA installation result:",
            choiceResult.outcome
        );

    } catch (error) {

        console.error(
            "PWA installation prompt failed:",
            error
        );

    }

}


// ============================================================================
// 4. DOM READY
// ============================================================================

    document.addEventListener("DOMContentLoaded", () => {

        initMobileNav();

        initCountdown();

        initMenuPage();

        setCurrentYear();

        highlightActiveNav();

        initPWAInstall();

    });


// ============================================================================
// 5. MOBILE NAVIGATION
// ============================================================================

function initMobileNav() {

    const toggleBtn =
        document.querySelector(".mobile-nav-toggle");

    const nav =
        document.getElementById("primary-nav");

    if (!toggleBtn || !nav) return;


    toggleBtn.addEventListener("click", () => {

        const isExpanded =
            toggleBtn.getAttribute("aria-expanded") === "true";

        toggleBtn.setAttribute(
            "aria-expanded",
            String(!isExpanded)
        );

        nav.classList.toggle("is-open");

    });


    document.addEventListener("click", (event) => {

        if (
            !nav.contains(event.target) &&
            !toggleBtn.contains(event.target) &&
            nav.classList.contains("is-open")
        ) {

            nav.classList.remove("is-open");

            toggleBtn.setAttribute(
                "aria-expanded",
                "false"
            );

        }

    });

}


// ============================================================================
// 6. OPENING STATUS
// ============================================================================
//
// Business is already open.
// Countdown remains only as compatibility support for older HTML.
// ============================================================================

function initCountdown() {

    const timerDays =
        document.getElementById("timer-days");

    const timerHours =
        document.getElementById("timer-hours");

    const timerMins =
        document.getElementById("timer-mins");

    const timerSecs =
        document.getElementById("timer-secs");

    const countdownTimer =
        document.getElementById("countdown-timer");

    const openStatusMsg =
        document.getElementById("open-status-message");

    const openingBadge =
        document.getElementById("opening-badge");


    if (
        !timerDays ||
        !timerHours ||
        !timerMins ||
        !timerSecs
    ) {
        return;
    }


    const openingDate =
        new Date(SITE_CONFIG.openingTime).getTime();


    function updateTimer() {

        const now = Date.now();

        const timeDifference =
            openingDate - now;


        if (timeDifference <= 0) {

            if (countdownTimer) {
                countdownTimer.classList.add("hidden");
            }

            if (openStatusMsg) {
                openStatusMsg.classList.remove("hidden");
            }

            if (openingBadge) {

                openingBadge.textContent =
                    "NOW OPEN";

                openingBadge.style.backgroundColor =
                    "var(--color-whatsapp)";

                openingBadge.style.color =
                    "#ffffff";

            }

            return;
        }


        const days =
            Math.floor(
                timeDifference /
                (1000 * 60 * 60 * 24)
            );


        const hours =
            Math.floor(
                (timeDifference %
                    (1000 * 60 * 60 * 24)) /
                (1000 * 60 * 60)
            );


        const minutes =
            Math.floor(
                (timeDifference %
                    (1000 * 60 * 60)) /
                (1000 * 60)
            );


        const seconds =
            Math.floor(
                (timeDifference %
                    (1000 * 60)) /
                1000
            );


        timerDays.textContent =
            String(days).padStart(2, "0");

        timerHours.textContent =
            String(hours).padStart(2, "0");

        timerMins.textContent =
            String(minutes).padStart(2, "0");

        timerSecs.textContent =
            String(seconds).padStart(2, "0");

    }


    updateTimer();

    setInterval(updateTimer, 1000);

}


// ============================================================================
// 7. MENU PAGE
// ============================================================================

function initMenuPage() {

    const menuContainer =
        document.getElementById(
            "menu-grid-container"
        );

    if (!menuContainer) return;


    const filterBtns =
        document.querySelectorAll(
            ".filter-btn"
        );


    const urlParams =
        new URLSearchParams(
            window.location.search
        );


    const initialCategory =
        urlParams.get("category") || "all";


    renderMenuItems(initialCategory);


    filterBtns.forEach((btn) => {

        if (
            btn.getAttribute("data-category") ===
            initialCategory
        ) {

            btn.classList.add("active");

        } else {

            btn.classList.remove("active");

        }


        btn.addEventListener("click", () => {

            filterBtns.forEach((button) => {
                button.classList.remove("active");
            });

            btn.classList.add("active");


            const category =
                btn.getAttribute(
                    "data-category"
                );


            renderMenuItems(category);

        });

    });

}


// ============================================================================
// 8. RENDER MENU
// ============================================================================

function renderMenuItems(category) {

    const menuContainer =
        document.getElementById(
            "menu-grid-container"
        );

    if (!menuContainer) return;


    menuContainer.innerHTML = "";


    const filteredItems =
        category === "all"
            ? menuItems
            : menuItems.filter(
                (item) =>
                    item.category === category
            );


    if (filteredItems.length === 0) {

        menuContainer.innerHTML = `
            <p
                style="
                    grid-column: 1 / -1;
                    text-align: center;
                    padding: 2rem;
                "
            >
                No menu items found in this category.
            </p>
        `;

        return;
    }


    filteredItems.forEach((item) => {

        const isSpecial =
            item.category === "special";


        const waText =
            encodeURIComponent(
                `Hello Siranchowk Khaja Ghar, I would like to order ${item.name}.`
            );


        const waUrl =
            `https://wa.me/${SITE_CONFIG.whatsapp}?text=${waText}`;


        const cardHtml = `
            <div class="dish-card ${
                isSpecial
                    ? "special-dish-card"
                    : ""
            }">

                <div class="dish-img-wrapper">

                    <img
                        src="${item.image}"
                        alt="${item.alt}"
                        loading="lazy"
                    >

                    ${
                        isSpecial
                            ? `
                                <span class="dish-badge special-badge">
                                    Friday & Special Days
                                </span>
                            `
                            : ""
                    }

                </div>


                <div class="dish-info">

                    <div class="dish-title-row">

                        <h3>
                            ${item.name}
                        </h3>

                        <span class="dish-nepali">
                            ${item.nepaliName}
                        </span>

                    </div>


                    <p class="dish-desc">
                        ${item.description}
                    </p>


                    <div class="dish-footer">

                        <span class="dish-price">
                            ${item.priceNote}
                        </span>

                        <a
                            href="${waUrl}"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="btn-sm btn-whatsapp"
                        >
                            ${
                                isSpecial
                                    ? "Inquire"
                                    : "Order"
                            }
                        </a>

                    </div>

                </div>

            </div>
        `;


        menuContainer.insertAdjacentHTML(
            "beforeend",
            cardHtml
        );

    });

}


// ============================================================================
// 9. FIREBASE REALTIME DATABASE
// ============================================================================
//
// Realtime Database functions are imported from ./firebase.js.
//
// This avoids browser module-resolution errors such as:
// "Failed to resolve module specifier firebase/database"
// ============================================================================


// ============================================================================
// 10. ADD SAMPLE MENU ITEM TO REALTIME DATABASE
// ============================================================================

async function addSampleMenu() {

    try {

        const menuListRef =
            ref(db, "menu_items");


        const newItemRef =
            push(menuListRef);


        await set(newItemRef, {

            name: "Special Buff Momo",

            price: 150,

            category: "momo",

            categoryLabel: "Momo",

            description:
                "Special Buff Momo prepared fresh at Siranchowk Khaja Ghar.",

            available: true,

            createdAt:
                new Date().toISOString()

        });


        console.log(
            "Menu item saved successfully:",
            newItemRef.key
        );


        return newItemRef.key;

    } catch (error) {

        console.error(
            "Error adding menu item:",
            error
        );

        throw error;

    }

}


// ============================================================================
// 11. FETCH MENU ITEMS FROM REALTIME DATABASE
// ============================================================================

async function fetchMenu() {

    try {

        const dbRef =
            ref(db);


        const snapshot =
            await get(
                child(
                    dbRef,
                    "menu_items"
                )
            );


        if (snapshot.exists()) {

            const menuData =
                snapshot.val();


            console.log(
                "Menu fetched successfully:",
                menuData
            );


            return menuData;

        }


        console.log(
            "No menu data available in Realtime Database."
        );


        return {};

    } catch (error) {

        console.error(
            "Error fetching menu:",
            error
        );

        return {};

    }

}


// ============================================================================
// 12. HELPER FUNCTIONS
// ============================================================================

function setCurrentYear() {

    const yearEls =
        document.querySelectorAll(
            "#current-year"
        );


    const currentYear =
        new Date().getFullYear();


    yearEls.forEach((el) => {

        el.textContent =
            currentYear;

    });

}


// ============================================================================
// 13. ACTIVE NAVIGATION
// ============================================================================

function highlightActiveNav() {

    const currentPath =
        window.location.pathname
            .split("/")
            .pop() || "index.html";


    const navLinks =
        document.querySelectorAll(
            ".nav-link"
        );


    navLinks.forEach((link) => {

        const href =
            link.getAttribute("href");


        if (
            href === currentPath ||
            (
                currentPath === "" &&
                href === "index.html"
            )
        ) {

            link.classList.add("active");

        } else {

            link.classList.remove("active");

        }

    });

}


// ============================================================================
// 14. OPTIONAL GLOBAL ACCESS FOR TESTING
// ============================================================================

window.addSampleMenu =
    addSampleMenu;

window.fetchMenu =
    fetchMenu;

window.SITE_CONFIG =
    SITE_CONFIG;


// ============================================================================
// 15. OPTIONAL PWA GLOBAL ACCESS
// ============================================================================

window.showInstallPrompt =
    handleInstallClick;