import { checkAdminAuth, logoutAdmin } from "./auth.js";
import { auth } from "../../js/firebase.js";
import { DashboardModule } from "./dashboard.js";
import { OrdersModule, startOrderMonitor } from "./orders.js";

document.addEventListener("DOMContentLoaded", async () => {
    let authenticatedUser = null;

    try {
        const authenticated = await checkAdminAuth();
        if (!authenticated) return;
        authenticatedUser = auth.currentUser;
        if (!authenticatedUser) return;
    } catch (error) {
        console.error("Admin authentication check failed:", error);
        return;
    }

    if (typeof window.revealAdminApplication === "function") {
        window.revealAdminApplication();
    }

    if (typeof window.UIModule !== "undefined" && typeof window.UIModule.init === "function") {
        try { window.UIModule.init(); }
        catch (error) { console.warn("Admin UI initialization warning:", error); }
    }

    const displayNameElement = document.getElementById("user-display-name");
    const roleElement = document.getElementById("user-role-label");
    const avatarElement = document.getElementById("user-avatar-initials");
    const email = authenticatedUser.email || "Administrator";
    const displayName = authenticatedUser.displayName || email.split("@")[0] || "Admin";

    if (displayNameElement) displayNameElement.textContent = displayName;
    if (roleElement) roleElement.textContent = "Siranchowk Admin";
    if (avatarElement) {
        avatarElement.textContent = displayName.split(/\s+/).filter(Boolean)
            .slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "AD";
    }

    // Keep a single live Firebase listener for dashboard and order alerts.
    startOrderMonitor();

    const views = {
        dashboard: DashboardModule,
        orders: OrdersModule
    };

    const titles = {
        dashboard: "Dashboard",
        orders: "Customer Orders"
    };

    const main = document.getElementById("main-content");
    const title = document.getElementById("page-title-heading");
    const navItems = [...document.querySelectorAll(".nav-item[data-view]")];

    if (!main) {
        console.error("Admin main content container is missing.");
        return;
    }

    async function navigateTo(viewName) {
        const key = Object.prototype.hasOwnProperty.call(views, viewName) ? viewName : "dashboard";

        navItems.forEach((item) => {
            const active = item.dataset.view === key;
            item.classList.toggle("active", active);
            if (active) item.setAttribute("aria-current", "page");
            else item.removeAttribute("aria-current");
        });

        if (title) title.textContent = titles[key];

        if (typeof window.UIModule !== "undefined" && typeof window.UIModule.closeDrawer === "function") {
            window.UIModule.closeDrawer();
        }

        if (typeof main._skgOrderUnsubscribe === "function") {
            main._skgOrderUnsubscribe();
            main._skgOrderUnsubscribe = null;
        }
        if (typeof main._skgDashboardUnsubscribe === "function") {
            main._skgDashboardUnsubscribe();
            main._skgDashboardUnsubscribe = null;
        }

        main.innerHTML = '<div class="skg-admin-loading" role="status">Loading…</div>';

        try {
            await views[key].render(main);
        } catch (error) {
            console.error(`Could not render admin view "${key}":`, error);
            main.innerHTML = `
              <section class="card">
                <h2 class="card-title">This section could not be loaded</h2>
                <p class="card-subtitle">Check your connection and Firebase database permissions, then try again.</p>
                <button type="button" class="btn btn-primary" id="skg-retry-view">Try again</button>
              </section>`;
            main.querySelector("#skg-retry-view")?.addEventListener("click", () => navigateTo(key));
        }
    }

    window.addEventListener("hashchange", () => {
        const requested = window.location.hash.replace("#", "").trim().toLowerCase();
        navigateTo(requested || "dashboard");
    });

    navItems.forEach((item) => {
        item.addEventListener("click", (event) => {
            event.preventDefault();
            const key = item.dataset.view;
            const hash = `#${key}`;
            if (window.location.hash !== hash) window.location.hash = hash;
            else navigateTo(key);
        });
    });

    document.getElementById("quick-refresh-btn")?.addEventListener("click", () => {
        const key = window.location.hash.replace("#", "").trim().toLowerCase() || "dashboard";
        navigateTo(key);
    });

    document.getElementById("logout-btn")?.addEventListener("click", async () => {
        if (!window.confirm("Sign out of Siranchowk Khaja Ghar Admin?")) return;
        try {
            await logoutAdmin();
        } catch (error) {
            console.error("Admin logout failed:", error);
            if (typeof window.UIModule !== "undefined" && typeof window.UIModule.showToast === "function") {
                window.UIModule.showToast("Unable to sign out. Please try again.", "error");
            } else {
                alert("Unable to sign out. Please try again.");
            }
        }
    });

    const initialView = window.location.hash.replace("#", "").trim().toLowerCase() || "dashboard";
    await navigateTo(initialView);
});
