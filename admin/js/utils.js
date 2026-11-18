/**
 * Utility Helper Functions for Siranchowk Khaja Ghar Admin Panel
 */
import { ADMIN_CONFIG } from "./config.js";

export const Utils = {
    escapeHTML(str) {
        if (str === null || str === undefined) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },

    formatCurrency(amount) {
        if (amount === null || amount === undefined || amount === "") {
            return "Confirm price";
        }
        const num = Number(amount);
        if (!Number.isFinite(num) || num <= 0) {
            return "Confirm price";
        }
        return `${ADMIN_CONFIG.business.currencySymbol} ${num.toLocaleString("en-IN")}`;
    },

    formatDate(dateInput) {
        if (!dateInput) return "N/A";
        const d = typeof dateInput === "number" ? new Date(dateInput) : new Date(dateInput);
        if (Number.isNaN(d.getTime())) return String(dateInput);
        return new Intl.DateTimeFormat("en-NP", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: ADMIN_CONFIG.business.timezone
        }).format(d);
    },

    formatShortDate(dateInput) {
        if (!dateInput) return "N/A";
        const d = typeof dateInput === "number" ? new Date(dateInput) : new Date(dateInput);
        if (Number.isNaN(d.getTime())) return String(dateInput);
        return new Intl.DateTimeFormat("en-NP", {
            dateStyle: "medium",
            timeZone: ADMIN_CONFIG.business.timezone
        }).format(d);
    },

    generateId(prefix = "id") {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    },

    slugify(value) {
        return String(value || "")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)+/g, "");
    },

    debounce(func, delay = 250) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => func.apply(this, args), delay);
        };
    }
};

if (typeof window !== "undefined") {
    window.Utils = Utils;
}
