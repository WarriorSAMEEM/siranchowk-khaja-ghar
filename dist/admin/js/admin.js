import {
    checkAdminAuth,
    logoutAdmin
} from "./auth.js";

import {
    AnalyticsModule
} from "./analytics.js";

import {
    auth
} from "../../js/firebase.js";


document.addEventListener("DOMContentLoaded", async () => {

    console.log("======================================");
    console.log("SIRANCHOWK ADMIN DASHBOARD");
    console.log("Initializing...");
    console.log("======================================");


    // ============================================================
    // 1. AUTHENTICATION
    // ============================================================

    let authenticatedUser = null;

    try {

        console.log("Checking Firebase authentication...");

        const authenticated = await checkAdminAuth();

        if (!authenticated) {
            console.warn("Admin is not authenticated.");
            return;
        }

        authenticatedUser = auth.currentUser;

        if (!authenticatedUser) {
            console.error(
                "Authentication was valid, but Firebase user is unavailable."
            );
            return;
        }

        console.log(
            "Admin authentication verified:",
            authenticatedUser.email
        );

    } catch (error) {

        console.error(
            "Admin authentication check failed:",
            error
        );

        return;
    }


    // ============================================================
    // 2. REVEAL ADMIN APPLICATION
    // ============================================================

    if (
        typeof window.revealAdminApplication === "function"
    ) {
        window.revealAdminApplication();
    }


    // ============================================================
    // 3. INITIALIZE UI
    // ============================================================

    if (
        typeof UIModule !== "undefined" &&
        typeof UIModule.init === "function"
    ) {

        try {

            UIModule.init();

            console.log("UI module initialized.");

        } catch (error) {

            console.error(
                "UI initialization failed:",
                error
            );

        }

    }


    // ============================================================
    // 4. ADMIN PROFILE
    // ============================================================

    const displayNameElement =
        document.getElementById("user-display-name");

    const roleElement =
        document.getElementById("user-role-label");

    const avatarElement =
        document.getElementById("user-avatar-initials");


    const adminEmail =
        authenticatedUser.email || "Administrator";


    const displayName =
        authenticatedUser.displayName ||
        adminEmail.split("@")[0] ||
        "Admin Manager";


    if (displayNameElement) {
        displayNameElement.textContent = displayName;
    }


    if (roleElement) {
        roleElement.textContent = "Siranchowk Admin";
    }


    if (avatarElement) {

        const initials = displayName
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(function (word) {
                return word.charAt(0).toUpperCase();
            })
            .join("") || "AD";

        avatarElement.textContent = initials;
    }


    // ============================================================
    // 5. VIEW REGISTRY
    // ============================================================

    const views = {

        dashboard:
            typeof DashboardModule !== "undefined"
                ? DashboardModule
                : null,

        menu:
            typeof MenuModule !== "undefined"
                ? MenuModule
                : null,

        orders:
            typeof OrdersModule !== "undefined"
                ? OrdersModule
                : null,

        offers:
            typeof OffersModule !== "undefined"
                ? OffersModule
                : null,

        gallery:
            typeof GalleryModule !== "undefined"
                ? GalleryModule
                : null,

        reviews:
            typeof ReviewsModule !== "undefined"
                ? ReviewsModule
                : null,

        customers:
            typeof CustomersModule !== "undefined"
                ? CustomersModule
                : null,

        announcements:
            typeof AnnouncementsModule !== "undefined"
                ? AnnouncementsModule
                : null,

        content:
            typeof ContentModule !== "undefined"
                ? ContentModule
                : null,

        seo:
            typeof SEOModule !== "undefined"
                ? SEOModule
                : null,

        analytics:
            AnalyticsModule,

        settings:
            typeof SettingsModule !== "undefined"
                ? SettingsModule
                : null

    };


    // ============================================================
    // 6. DEBUG MODULES
    // ============================================================

    console.log("Admin modules:", {

        DashboardModule:
            typeof DashboardModule !== "undefined",

        AnalyticsModule:
            typeof AnalyticsModule !== "undefined",

        MenuModule:
            typeof MenuModule !== "undefined",

        OrdersModule:
            typeof OrdersModule !== "undefined",

        OffersModule:
            typeof OffersModule !== "undefined",

        GalleryModule:
            typeof GalleryModule !== "undefined",

        ReviewsModule:
            typeof ReviewsModule !== "undefined",

        CustomersModule:
            typeof CustomersModule !== "undefined",

        AnnouncementsModule:
            typeof AnnouncementsModule !== "undefined",

        ContentModule:
            typeof ContentModule !== "undefined",

        SEOModule:
            typeof SEOModule !== "undefined",

        SettingsModule:
            typeof SettingsModule !== "undefined"

    });


    // ============================================================
    // 7. DOM ELEMENTS
    // ============================================================

    const mainContainer =
        document.getElementById("main-content");

    const pageTitleHeading =
        document.getElementById("page-title-heading");

    const navItems =
        document.querySelectorAll(".nav-item");


    if (!mainContainer) {

        console.error(
            "Admin dashboard: #main-content not found."
        );

        return;
    }


    // ============================================================
    // 8. NAVIGATION
    // ============================================================

    async function navigateTo(viewKey) {

        const requestedKey =
            String(viewKey || "")
                .trim()
                .toLowerCase();


        const key =
            views[requestedKey]
                ? requestedKey
                : "dashboard";


        const targetModule =
            views[key];


        // --------------------------------------------------------
        // Active navigation
        // --------------------------------------------------------

        navItems.forEach(function (item) {

            const isActive =
                item.dataset.view === key;

            item.classList.toggle(
                "active",
                isActive
            );

        });


        // --------------------------------------------------------
        // Page title
        // --------------------------------------------------------

        if (pageTitleHeading) {

            const title =
                key.charAt(0).toUpperCase() +
                key.slice(1);

            pageTitleHeading.textContent = title;
        }


        // --------------------------------------------------------
        // Close mobile drawer
        // --------------------------------------------------------

        if (
            typeof UIModule !== "undefined" &&
            typeof UIModule.closeDrawer === "function"
        ) {

            try {

                UIModule.closeDrawer();

            } catch (error) {

                console.warn(
                    "Unable to close navigation drawer:",
                    error
                );

            }

        }


        // --------------------------------------------------------
        // Render module
        // --------------------------------------------------------

        if (
            targetModule &&
            typeof targetModule.render === "function"
        ) {

            mainContainer.innerHTML =
                '<div class="skeleton skeleton-title"></div>' +
                '<div class="skeleton skeleton-text"></div>';


            try {

                await targetModule.render(
                    mainContainer
                );


                console.log(
                    "Admin view loaded:",
                    key
                );


            } catch (error) {

                console.error(
                    "Failed to render view:",
                    key,
                    error
                );


                mainContainer.innerHTML =
                    '<div class="admin-view-error">' +
                    '<h3>Unable to load this section</h3>' +
                    '<p>Something went wrong while loading this dashboard view.</p>' +
                    '<button type="button" id="retry-view-btn">Try Again</button>' +
                    '</div>';


                const retryButton =
                    document.getElementById(
                        "retry-view-btn"
                    );


                if (retryButton) {

                    retryButton.addEventListener(
                        "click",
                        function () {
                            navigateTo(key);
                        }
                    );

                }

            }

            return;
        }


        // --------------------------------------------------------
        // Module unavailable
        // --------------------------------------------------------

        console.warn(
            'Admin module "' + key + '" is not available.'
        );


        mainContainer.innerHTML =
            '<div class="admin-view-error">' +
            '<h3>Section unavailable</h3>' +
            '<p>The "' + key + '" module is not available.</p>' +
            '<button type="button" id="retry-module-btn">Retry</button>' +
            '</div>';


        const retryModuleButton =
            document.getElementById(
                "retry-module-btn"
            );


        if (retryModuleButton) {

            retryModuleButton.addEventListener(
                "click",
                function () {
                    navigateTo(key);
                }
            );

        }

    }


    // ============================================================
    // 9. HASH NAVIGATION
    // ============================================================

    window.addEventListener(
        "hashchange",
        function () {

            const hash =
                window.location.hash
                    .replace("#", "")
                    .trim()
                    .toLowerCase();


            navigateTo(
                hash || "dashboard"
            );

        }
    );


    // ============================================================
    // 10. NAVIGATION CLICK
    // ============================================================

    navItems.forEach(function (item) {

        item.addEventListener(
            "click",
            function (event) {

                const view =
                    item.dataset.view;


                if (!view) {
                    return;
                }


                event.preventDefault();


                const targetHash =
                    "#" + view;


                if (
                    window.location.hash !==
                    targetHash
                ) {

                    window.location.hash =
                        targetHash;

                } else {

                    navigateTo(view);

                }

            }
        );

    });


    // ============================================================
    // 11. QUICK REFRESH
    // ============================================================

    const refreshButton =
        document.getElementById(
            "quick-refresh-btn"
        );


    if (refreshButton) {

        refreshButton.addEventListener(
            "click",
            async function () {

                const currentHash =
                    window.location.hash
                        .replace("#", "")
                        .trim()
                        .toLowerCase() ||
                    "dashboard";


                try {

                    await navigateTo(
                        currentHash
                    );


                    if (
                        typeof UIModule !== "undefined" &&
                        typeof UIModule.showToast === "function"
                    ) {

                        UIModule.showToast(
                            "View refreshed",
                            "info"
                        );

                    }


                } catch (error) {

                    console.error(
                        "View refresh failed:",
                        error
                    );

                }

            }
        );

    }


    // ============================================================
    // 12. LOGOUT
    // ============================================================

    const logoutButton =
        document.getElementById(
            "logout-btn"
        );


    if (logoutButton) {

        logoutButton.addEventListener(
            "click",
            async function () {

                const confirmed =
                    window.confirm(
                        "Sign out of Siranchowk Khaja Ghar Admin?"
                    );


                if (!confirmed) {
                    return;
                }


                try {

                    console.log(
                        "Signing out admin..."
                    );


                    await logoutAdmin();


                    console.log(
                        "Admin logout successful."
                    );


                } catch (error) {

                    console.error(
                        "Admin logout failed:",
                        error
                    );


                    if (
                        typeof UIModule !== "undefined" &&
                        typeof UIModule.showToast === "function"
                    ) {

                        UIModule.showToast(
                            "Unable to sign out. Please try again.",
                            "error"
                        );

                    }

                }

            }
        );

    }


    // ============================================================
    // 13. INITIAL VIEW
    // ============================================================

    const initialHash =
        window.location.hash
            .replace("#", "")
            .trim()
            .toLowerCase() ||
        "dashboard";


    await navigateTo(
        initialHash
    );


    // ============================================================
    // 14. ACCESSIBILITY
    // ============================================================

    try {

        mainContainer.focus({
            preventScroll: true
        });

    } catch (error) {

        try {

            mainContainer.focus();

        } catch (focusError) {

            // Ignore focus errors.

        }

    }


    // ============================================================
    // 15. COMPLETE
    // ============================================================

    console.log("======================================");

    console.log(
        "ADMIN DASHBOARD READY"
    );

    console.log(
        "Logged in as:",
        authenticatedUser.email
    );

    console.log("======================================");

});