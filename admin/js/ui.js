/**
 * UI Component & Interaction Controller
 * Manages Modals, Promise-based Confirm Dialogs, Toasts, Drawer navigation, and Nepal clock.
 */
import { Utils } from "./utils.js";

let initialized = false;
let activeConfirmResolve = null;

function getElements() {
    return {
        modalEl: document.getElementById("app-modal"),
        modalTitle: document.getElementById("modal-title"),
        modalBody: document.getElementById("modal-body"),
        modalFooter: document.getElementById("modal-footer"),
        toastContainer: document.getElementById("toast-container")
    };
}

export const UIModule = {
    init() {
        if (initialized) return;
        initialized = true;
        this.bindEvents();
        this.startLiveClock();
    },

    bindEvents() {
        const { modalEl } = getElements();
        document.getElementById("modal-close-btn")?.addEventListener("click", () => this.closeModal());
        document.getElementById("open-drawer-btn")?.addEventListener("click", () => this.openDrawer());
        document.getElementById("close-drawer-btn")?.addEventListener("click", () => this.closeDrawer());
        document.getElementById("drawer-backdrop")?.addEventListener("click", () => this.closeDrawer());

        modalEl?.addEventListener("click", (event) => {
            if (event.target === modalEl) {
                this.closeModal();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && modalEl?.classList.contains("active")) {
                this.closeModal();
            }
        });
    },

    openDrawer() {
        document.getElementById("sidebar")?.classList.add("drawer-open");
        document.getElementById("drawer-backdrop")?.classList.add("active");
    },

    closeDrawer() {
        document.getElementById("sidebar")?.classList.remove("drawer-open");
        document.getElementById("drawer-backdrop")?.classList.remove("active");
    },

    openModal(title, bodyHTML, footerHTML = "") {
        const { modalEl, modalTitle, modalBody, modalFooter } = getElements();
        if (!modalEl) return;
        if (modalTitle) modalTitle.textContent = title;
        if (modalBody) modalBody.innerHTML = bodyHTML;
        if (modalFooter) modalFooter.innerHTML = footerHTML;
        modalEl.classList.add("active");
        modalEl.setAttribute("aria-hidden", "false");
    },

    closeModal() {
        const { modalEl } = getElements();
        if (!modalEl) return;
        modalEl.classList.remove("active");
        modalEl.setAttribute("aria-hidden", "true");
        if (activeConfirmResolve) {
            const resolve = activeConfirmResolve;
            activeConfirmResolve = null;
            resolve(false);
        }
    },

    confirm({
        title = "Confirm Action",
        message = "Are you sure you want to proceed?",
        confirmText = "Confirm",
        cancelText = "Cancel",
        dangerous = false
    } = {}) {
        return new Promise((resolve) => {
            if (activeConfirmResolve) {
                activeConfirmResolve(false);
            }
            activeConfirmResolve = resolve;

            const bodyHTML = `
                <p class="skg-confirm-message">${Utils.escapeHTML(message)}</p>
            `;
            const footerHTML = `
                <button type="button" class="btn btn-secondary" id="skg-confirm-cancel">${Utils.escapeHTML(cancelText)}</button>
                <button type="button" class="btn ${dangerous ? "btn-danger" : "btn-primary"}" id="skg-confirm-ok">${Utils.escapeHTML(confirmText)}</button>
            `;

            this.openModal(title, bodyHTML, footerHTML);

            const cancelBtn = document.getElementById("skg-confirm-cancel");
            const okBtn = document.getElementById("skg-confirm-ok");

            cancelBtn?.addEventListener("click", () => {
                if (activeConfirmResolve) {
                    const r = activeConfirmResolve;
                    activeConfirmResolve = null;
                    this.closeModal();
                    r(false);
                }
            });

            okBtn?.addEventListener("click", () => {
                if (activeConfirmResolve) {
                    const r = activeConfirmResolve;
                    activeConfirmResolve = null;
                    this.closeModal();
                    r(true);
                }
            });
        });
    },

    showToast(message, type = "info") {
        const { toastContainer } = getElements();
        if (!toastContainer) return;
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.setAttribute("role", "status");
        toast.innerHTML = `<span>${Utils.escapeHTML(message)}</span>`;
        toastContainer.appendChild(toast);
        window.setTimeout(() => toast.remove(), 3800);
    },

    startLiveClock() {
        const clockTime = document.getElementById("clock-time");
        const clockDate = document.getElementById("clock-date");
        if (!clockTime && !clockDate) return;

        function updateClock() {
            const now = new Date();
            if (clockTime) {
                clockTime.textContent = new Intl.DateTimeFormat("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                    timeZone: "Asia/Kathmandu"
                }).format(now);
            }
            if (clockDate) {
                clockDate.textContent = new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "Asia/Kathmandu"
                }).format(now) + " NPT";
            }
        }

        updateClock();
        window.setInterval(updateClock, 1000);
    }
};

if (typeof window !== "undefined") {
    window.UIModule = UIModule;
}
