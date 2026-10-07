// ============================================================================
// SIRANCHOWK KHAJA GHAR - ADMIN DASHBOARD CONTROLLER
// ============================================================================

import {
    checkAdminAuth,
    logoutAdmin
} from "./auth.js";

import {
    auth
} from "../../js/firebase.js";


// ============================================================================
// ADMIN AUTH GUARD
// ============================================================================
//
// Direct access:
//
// /admin/admin.html
//        ↓
// Firebase Authentication Check
//        ↓
// NOT AUTHENTICATED → login.html
//        ↓
// AUTHENTICATED → Admin Dashboard
//
// Dashboard remains hidden until authentication is verified.
// ============================================================================


document.addEventListener("DOMContentLoaded", async () => {

    console.log("======================================");
    console.log("SIRANCHOWK ADMIN DASHBOARD");
    console.log("Initializing...");
    console.log("======================================");


    // ========================================================================
    // 1. VERIFY ADMIN AUTHENTICATION
    // ========================================================================

    let authenticatedUser = null;

    try {

        console.log(
            "Checking Firebase authentication..."
        );

        const authenticated =
            await checkAdminAuth();

        if (!authenticated) {

            console.warn(
                "Admin is not authenticated."
            );

            return;
        }


        // Firebase may restore the user asynchronously.
        // Read the actual current Firebase user.
        authenticatedUser =
            auth.currentUser;


        if (!authenticatedUser) {

            console.error(
                "Authentication was reported as valid, but Firebase user is unavailable."
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


    // ========================================================================
    // 2. REVEAL AUTHENTICATED APPLICATION
    // ========================================================================

    if (
        typeof window.revealAdminApplication === "function"
    ) {

        window.revealAdminApplication();

    } else {

        console.warn(
            "revealAdminApplication() is not available."
        );

    }


    // ========================================================================
    // 3. INITIALIZE GLOBAL UI
    // ========================================================================

    if (
        typeof UIModule !== "undefined" &&
        typeof UIModule.init === "function"
    ) {

        try {

            UIModule.init();

            console.log(
                "UI module initialized."
            );

        } catch (error) {

            console.error(
                "UI initialization failed:",
                error
            );
        }
    }


    // ========================================================================
    // 4. ADMIN PROFILE
    // ========================================================================

    const displayNameElement =
        document.getElementById(
            "user-display-name"
        );

    const roleElement =
        document.getElementById(
            "user-role-label"
        );

    const avatarElement =
        document.getElementById(
            "user-avatar-initials"
        );


    const adminEmail =
        authenticatedUser.email ||
        "Administrator";


    const displayName =
        authenticatedUser.displayName ||
        adminEmail.split("@")[0] ||
        "Admin Manager";


    if (displayNameElement) {

        displayNameElement.textContent =
            displayName;
    }


    if (roleElement) {

        roleElement.textContent =
            "Siranchowk Admin";
    }


    if (avatarElement) {

        const initials =
            displayName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map(
                    word =>
                        word
                            .charAt(0)
                            .toUpperCase()
                )
                .join("") || "AD";


        avatarElement.textContent =
            initials;
    }


    // ========================================================================
    // 5. VIEW REGISTRY
    // ========================================================================

    const views = {

        dashboard:
            typeof AnalyticsModule !== "undefined"
                ? AnalyticsModule
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
            typeof AnalyticsModule !== "undefined"
                ? AnalyticsModule
                : null,

        settings:
            typeof SettingsModule !== "undefined"
                ? SettingsModule
                : null

    };


    // ========================================================================
    // 6. MAIN DOM ELEMENTS
    // ========================================================================

    const mainContainer =
        document.getElementById(
            "main-content"
        );

    const pageTitleHeading =
        document.getElementById(
            "page-title-heading"
        );

    const navItems =
        document.querySelectorAll(
            ".nav-item"
        );


    if (!mainContainer) {

        console.error(
            "Admin dashboard: #main-content not found."
        );

        return;
    }


    // ========================================================================
    // 7. VIEW NAVIGATION
    // ========================================================================

    async function navigateTo(viewKey) {

        const key =
            views[viewKey]
                ? viewKey
                : "dashboard";


        const targetModule =
            views[key];


        // --------------------------------------------------------------------
        // Active navigation
        // --------------------------------------------------------------------

        navItems.forEach((item) => {

            const isActive =
                item.dataset.view === key;

            item.classList.toggle(
                "active",
                isActive
            );

        });


        // --------------------------------------------------------------------
        // Page title
        // --------------------------------------------------------------------

        if (pageTitleHeading) {

            const title =
                key.charAt(0).toUpperCase() +
                key.slice(1);

            pageTitleHeading.textContent =
                title;
        }


        // --------------------------------------------------------------------
        // Close mobile drawer
        // --------------------------------------------------------------------

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


        // --------------------------------------------------------------------
        // Loading state
        // --------------------------------------------------------------------

        if (
            targetModule &&
            typeof targetModule.render === "function"
        ) {

            mainContainer.innerHTML = `
                <div class="skeleton skeleton-title"></div>
                <div class="skeleton skeleton-text"></div>
            `;


            try {

                await targetModule.render(
                    mainContainer
                );


                console.log(
                    `Admin view loaded: ${key}`
                );


            } catch (error) {

                console.error(
                    `Failed to render "${key}" view:`,
                    error
                );


                mainContainer.innerHTML = `
                    <div class="admin-view-error">

                        <h3>
                            Unable to load this section
                        </h3>

                        <p>
                            Something went wrong while
                            loading this dashboard view.
                        </p>

                        <button
                            type="button"
                            id="retry-view-btn"
                        >
                            Try Again
                        </button>

                    </div>
                `;


                document
                    .getElementById(
                        "retry-view-btn"
                    )
                    ?.addEventListener(
                        "click",
                        () => navigateTo(key)
                    );
            }


            return;
        }


        // --------------------------------------------------------------------
        // Module unavailable
        // --------------------------------------------------------------------

        console.warn(
            `Admin module "${key}" is not available.`
        );


        mainContainer.innerHTML = `
            <div class="admin-view-error">

                <h3>
                    Section unavailable
                </h3>

                <p>
                    The "${key}" module is not available.
                </p>

            </div>
        `;
    }


    // ========================================================================
    // 8. HASH NAVIGATION
    // ========================================================================

    window.addEventListener(
        "hashchange",
        () => {

            const hash =
                window.location.hash
                    .replace("#", "")
                    .trim();


            navigateTo(
                hash || "dashboard"
            );
        }
    );


    // ========================================================================
    // 9. NAVIGATION CLICK HANDLERS
    // ========================================================================

    navItems.forEach((item) => {

        item.addEventListener(
            "click",
            (event) => {

                const view =
                    item.dataset.view;

                if (!view) {
                    return;
                }


                event.preventDefault();


                const targetHash =
                    `#${view}`;


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


    // ========================================================================
    // 10. QUICK REFRESH
    // ========================================================================

    document
        .getElementById(
            "quick-refresh-btn"
        )
        ?.addEventListener(
            "click",
            async () => {

                const currentHash =
                    window.location.hash
                        .replace("#", "")
                        .trim() ||
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


    // ========================================================================
    // 11. LOGOUT
    // ========================================================================

    document
        .getElementById(
            "logout-btn"
        )
        ?.addEventListener(
            "click",
            async () => {

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


    // ========================================================================
    // 12. INITIAL VIEW
    // ========================================================================

    const initialHash =
        window.location.hash
            .replace("#", "")
            .trim() ||
        "dashboard";


    await navigateTo(
        initialHash
    );


    // ========================================================================
    // 13. ACCESSIBILITY
    // ========================================================================

    if (mainContainer) {

        try {

            mainContainer.focus({
                preventScroll: true
            });

        } catch {

            try {

                mainContainer.focus();

            } catch {
                // Ignore focus errors.
            }
        }
    }


    // ========================================================================
    // 14. FINISHED
    // ========================================================================

    console.log("======================================");
    console.log("ADMIN DASHBOARD READY");
    console.log(
        "Logged in as:",
        authenticatedUser.email
    );
    console.log("======================================");

});