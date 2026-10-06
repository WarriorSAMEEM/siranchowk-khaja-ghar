import {
    checkAdminAuth,
    logoutAdmin
} from "./auth.js";


// ============================================================
// ADMIN AUTH GUARD
// ============================================================
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
// The dashboard remains hidden until authentication
// has been successfully verified.
// ============================================================


document.addEventListener("DOMContentLoaded", async () => {

    // ========================================================
    // 1. VERIFY ADMIN AUTHENTICATION FIRST
    // ========================================================

    let authenticatedUser = null;

    try {
        authenticatedUser = await checkAdminAuth();

    } catch (error) {

        console.error(
            "Admin authentication check failed:",
            error
        );

        return;
    }


    // --------------------------------------------------------
    // If authentication failed, auth.js should redirect
    // to login.html. Do NOT initialize the dashboard.
    // --------------------------------------------------------

    if (!authenticatedUser) {
        return;
    }


    // ========================================================
    // 2. REVEAL AUTHENTICATED APPLICATION
    // ========================================================

    if (
        typeof window.revealAdminApplication === "function"
    ) {
        window.revealAdminApplication();
    }


    // ========================================================
    // 3. INITIALIZE GLOBAL UI HELPERS
    // ========================================================

    if (
        typeof UIModule !== "undefined" &&
        typeof UIModule.init === "function"
    ) {
        try {
            UIModule.init();
        } catch (error) {
            console.error(
                "UI initialization failed:",
                error
            );
        }
    }


    // ========================================================
    // 4. UPDATE ADMIN PROFILE INFORMATION
    // ========================================================

    const displayNameElement =
        document.getElementById("user-display-name");

    const roleElement =
        document.getElementById("user-role-label");

    const avatarElement =
        document.getElementById("user-avatar-initials");


    const adminEmail =
        authenticatedUser.email || "Administrator";


    // Use email as fallback because Firebase users
    // may not have a displayName.
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

        const initials =
            displayName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map(word => word.charAt(0).toUpperCase())
                .join("") || "AD";

        avatarElement.textContent = initials;
    }


    // ========================================================
    // 5. VIEW ROUTER REGISTRY
    // ========================================================

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


    // ========================================================
    // 6. MAIN DOM ELEMENTS
    // ========================================================

    const mainContainer =
        document.getElementById("main-content");

    const pageTitleHeading =
        document.getElementById("page-title-heading");

    const navItems =
        document.querySelectorAll(".nav-item");


    // ========================================================
    // 7. VIEW NAVIGATION
    // ========================================================

    async function navigateTo(viewKey) {

        const key =
            views[viewKey]
                ? viewKey
                : "dashboard";

        const targetModule =
            views[key];


        // ----------------------------------------------------
        // Update active navigation state
        // ----------------------------------------------------

        navItems.forEach((item) => {

            const isActive =
                item.dataset.view === key;

            item.classList.toggle(
                "active",
                isActive
            );

        });


        // ----------------------------------------------------
        // Update page title
        // ----------------------------------------------------

        if (pageTitleHeading) {

            const title =
                key.charAt(0).toUpperCase() +
                key.slice(1);

            pageTitleHeading.textContent = title;
        }


        // ----------------------------------------------------
        // Close mobile navigation drawer
        // ----------------------------------------------------

        if (
            typeof UIModule !== "undefined" &&
            typeof UIModule.closeDrawer === "function"
        ) {
            UIModule.closeDrawer();
        }


        // ----------------------------------------------------
        // Make sure main container exists
        // ----------------------------------------------------

        if (!mainContainer) {

            console.error(
                "Admin dashboard: #main-content not found."
            );

            return;
        }


        // ----------------------------------------------------
        // Render selected module
        // ----------------------------------------------------

        if (
            targetModule &&
            typeof targetModule.render === "function"
        ) {

            // Loading skeleton
            mainContainer.innerHTML = `
                <div class="skeleton skeleton-title"></div>
                <div class="skeleton skeleton-text"></div>
            `;


            try {

                await targetModule.render(
                    mainContainer
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
                    .getElementById("retry-view-btn")
                    ?.addEventListener(
                        "click",
                        () => navigateTo(key)
                    );
            }

            return;
        }


        // ----------------------------------------------------
        // Module unavailable
        // ----------------------------------------------------

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


    // ========================================================
    // 8. HASH NAVIGATION
    // ========================================================

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


    // ========================================================
    // 9. QUICK REFRESH BUTTON
    // ========================================================

    document
        .getElementById("quick-refresh-btn")
        ?.addEventListener(
            "click",
            async () => {

                const currentHash =
                    window.location.hash
                        .replace("#", "")
                        .trim() ||
                    "dashboard";


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
            }
        );


    // ========================================================
    // 10. LOGOUT BUTTON
    // ========================================================

    document
        .getElementById("logout-btn")
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

                    await logoutAdmin();

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


    // ========================================================
    // 11. INITIAL VIEW
    // ========================================================

    const initialHash =
        window.location.hash
            .replace("#", "")
            .trim() ||
        "dashboard";


    await navigateTo(
        initialHash
    );


    // ========================================================
    // 12. ACCESSIBILITY
    // ========================================================

    if (mainContainer) {

        try {
            mainContainer.focus({
                preventScroll: true
            });
        } catch {
            mainContainer.focus();
        }
    }

});