/**
 * Main Application Entry Point & SPA Router
 * Coordinates view mounting, navigation active state tracking, and initialization.
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize UI global helpers
    UIModule.init();

    // 2. View Router Registry
    const views = {
        dashboard: AnalyticsModule,
        menu: MenuModule,
        orders: OrdersModule,
        offers: OffersModule,
        gallery: GalleryModule,
        reviews: ReviewsModule,
        customers: CustomersModule,
        announcements: AnnouncementsModule,
        content: ContentModule,
        seo: SEOModule,
        analytics: AnalyticsModule,
        settings: SettingsModule
    };

    const mainContainer = document.getElementById('main-content');
    const pageTitleHeading = document.getElementById('page-title-heading');
    const navItems = document.querySelectorAll('.nav-item');

    async function navigateTo(viewKey) {
        const key = views[viewKey] ? viewKey : 'dashboard';
        const targetModule = views[key];

        // Update active navigation visual state
        navItems.forEach(item => {
            if (item.dataset.view === key) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Set page header title
        if (pageTitleHeading) {
            pageTitleHeading.textContent = key.charAt(0).toUpperCase() + key.slice(1);
        }

        // Close drawer on mobile selection
        UIModule.closeDrawer();

        // Render view component
        if (targetModule && typeof targetModule.render === 'function') {
            mainContainer.innerHTML = '<div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div>';
            await targetModule.render(mainContainer);
        }
    }

    // 3. Listen for URL hash navigation
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.replace('#', '');
        navigateTo(hash);
    });

    // 4. Quick Refresh Button
    document.getElementById('quick-refresh-btn')?.addEventListener('click', () => {
        const currentHash = window.location.hash.replace('#', '') || 'dashboard';
        navigateTo(currentHash);
        UIModule.showToast("View refreshed", "info");
    });

    // 5. Logout Button
    document.getElementById('logout-btn')?.addEventListener('click', () => {
        if (confirm("Sign out of Siranchowk Khaja Ghar Admin?")) {
            AuthModule.logout();
        }
    });

    // 6. Initial Mount
    const initialHash = window.location.hash.replace('#', '') || 'dashboard';
    navigateTo(initialHash);
});