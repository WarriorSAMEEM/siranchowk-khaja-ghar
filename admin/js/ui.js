/**
 * UI Component & Interaction Controller
 * Manages Modals, Toasts, Skeletons, Drawer navigation, and live clock.
 */

const UIModule = (() => {
    const modalEl = document.getElementById('app-modal');
    const toastContainer = document.getElementById('toast-container');

    return {
        init() {
            this.bindEvents();
            this.startLiveClock();
        },

        bindEvents() {
            document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
            document.getElementById('open-drawer-btn')?.addEventListener('click', () => this.openDrawer());
            document.getElementById('close-drawer-btn')?.addEventListener('click', () => this.closeDrawer());
            document.getElementById('drawer-backdrop')?.addEventListener('click', () => this.closeDrawer());
        },

        openDrawer() {
            document.getElementById('sidebar')?.classList.add('drawer-open');
            document.getElementById('drawer-backdrop')?.classList.add('active');
        },

        closeDrawer() {
            document.getElementById('sidebar')?.classList.remove('drawer-open');
            document.getElementById('drawer-backdrop')?.classList.remove('active');
        },

        openModal(title, bodyHTML, footerHTML = '') {
            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-body').innerHTML = bodyHTML;
            document.getElementById('modal-footer').innerHTML = footerHTML;
            modalEl.classList.add('active');
            modalEl.setAttribute('aria-hidden', 'false');
        },

        closeModal() {
            modalEl.classList.remove('active');
            modalEl.setAttribute('aria-hidden', 'true');
        },

        showToast(message, type = 'info') {
            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            toast.innerHTML = `<span>${Utils.escapeHTML(message)}</span>`;
            toastContainer.appendChild(toast);
            setTimeout(() => toast.remove(), 3500);
        },

        startLiveClock() {
            const clockTime = document.getElementById('clock-time');
            const clockDate = document.getElementById('clock-date');
            
            function update() {
                const now = new Date();
                if (clockTime) clockTime.textContent = now.toLocaleTimeString('en-US', { hour12: false });
                if (clockDate) clockDate.textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }
            update();
            setInterval(update, 1000);
        }
    };
})();