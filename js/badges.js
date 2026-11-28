// ============================================================================
// SIRANCHOWK KHAJA GHAR — VERIFICATION BADGE SYSTEM (4 DISTINCT TYPES)
// ============================================================================
// 1. Email Verified       — Automatic from Firebase Auth (NOT creator badge)
// 2. Verified Creator     — Blue Tick (manually admin-granted)
// 3. Official / Org       — Amber/Gold Shield (manually admin-granted)
// 4. Expert / Specialist  — Teal Ribbon (manually admin-granted with specialty)
// ============================================================================

import { escapeHTML } from "./platform-core.js";

export const BADGE_DEFINITIONS = Object.freeze({
    emailVerified: {
        key: "emailVerified",
        label: "Email Verified",
        shortLabel: "Email Verified",
        description: "Account email address was confirmed via Firebase Authentication. Does not indicate creator or official verification.",
        colorClass: "skg-badge-email",
        grantMode: "automatic_auth"
    },
    verifiedCreator: {
        key: "verifiedCreator",
        label: "Verified Creator",
        shortLabel: "Verified Creator",
        description: "Verified independent creator identity reviewed and manually approved by Siranchowk Khaja Ghar administrators.",
        colorClass: "skg-badge-creator-blue",
        grantMode: "manual_admin"
    },
    officialOrg: {
        key: "officialOrg",
        label: "Official Organization",
        shortLabel: "Official",
        description: "Official Siranchowk Khaja Ghar account or verified partner organization.",
        colorClass: "skg-badge-official",
        grantMode: "manual_admin"
    },
    expertSpecialist: {
        key: "expertSpecialist",
        label: "Domain Specialist",
        shortLabel: "Specialist",
        description: "Recognized contributor with reviewed domain expertise and supporting credentials.",
        colorClass: "skg-badge-specialist",
        grantMode: "manual_admin"
    }
});

export function getBadgeIconSvg(type, size = 16) {
    const s = Number(size) || 16;
    if (type === "verifiedCreator") {
        // Authentic Blue Tick SVG
        return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true" class="skg-badge-svg skg-svg-blue"><circle cx="12" cy="12" r="10" fill="#1D9BF0"/><path d="M8.5 12.4l2.3 2.3 4.8-5.1" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (type === "officialOrg") {
        // Gold Shield Official Check SVG
        return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true" class="skg-badge-svg skg-svg-official"><path d="M12 2l7 3v6c0 5-3.1 9.4-7 11-3.9-1.6-7-6-7-11V5l7-3z" fill="#D49A3A"/><path d="M9 12.2l2.1 2.1 4-4.2" fill="none" stroke="#1E2923" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (type === "expertSpecialist") {
        // Forest-Teal Specialist Award SVG
        return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true" class="skg-badge-svg skg-svg-specialist"><circle cx="12" cy="10" r="6.5" fill="#0F766E"/><path d="M9 15.5L7.5 22l4.5-2.2L16.5 22 15 15.5" fill="#0F766E"/><path d="M9.6 10.2l1.6 1.6 3.3-3.4" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (type === "emailVerified") {
        // Distinct neutral Mail Check SVG (never blue tick)
        return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true" class="skg-badge-svg skg-svg-email"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="#475569" stroke-width="2"/><path d="M4 7l8 5.5L20 7" fill="none" stroke="#475569" stroke-width="2" stroke-linecap="round"/><circle cx="18.5" cy="17" r="4" fill="#15803D"/><path d="M16.8 17l1.1 1.1 2.2-2.2" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    }
    return "";
}

export function normalizeBadgeState(rawBadges = {}) {
    const src = rawBadges && typeof rawBadges === "object" ? rawBadges : {};
    return {
        emailVerified: Boolean(src.emailVerified),
        verifiedCreator: Boolean(src.verifiedCreator),
        officialOrg: Boolean(src.officialOrg),
        expertSpecialist: Boolean(src.expertSpecialist)
    };
}

/**
 * Renders inline verified ticks (compact for author bylines, comments, cards).
 * Intentionally excludes emailVerified here so readers do not confuse confirmed email with Verified Creator.
 */
export function renderAuthorTicksHtml(rawBadges = {}, specialtyNote = "") {
    const badges = normalizeBadgeState(rawBadges);
    const items = [];

    if (badges.verifiedCreator) {
        const def = BADGE_DEFINITIONS.verifiedCreator;
        items.push(`<span class="skg-tick-inline" title="${escapeHTML(def.label)}: ${escapeHTML(def.description)}" aria-label="${escapeHTML(def.label)}">${getBadgeIconSvg("verifiedCreator", 15)}</span>`);
    }
    if (badges.officialOrg) {
        const def = BADGE_DEFINITIONS.officialOrg;
        items.push(`<span class="skg-tick-inline" title="${escapeHTML(def.label)}: ${escapeHTML(def.description)}" aria-label="${escapeHTML(def.label)}">${getBadgeIconSvg("officialOrg", 15)}</span>`);
    }
    if (badges.expertSpecialist) {
        const def = BADGE_DEFINITIONS.expertSpecialist;
        const extra = specialtyNote ? ` (${specialtyNote})` : "";
        items.push(`<span class="skg-tick-inline" title="${escapeHTML(def.label + extra)}: ${escapeHTML(def.description)}" aria-label="${escapeHTML(def.label)}">${getBadgeIconSvg("expertSpecialist", 15)}</span>`);
    }

    return items.length ? `<span class="skg-author-ticks">${items.join("")}</span>` : "";
}

/**
 * Renders the full badge summary strip for Public Profiles & Account Verification Panels
 * showing clear distinction across all 4 badge categories.
 */
export function renderProfileBadgesHtml(rawBadges = {}, { includeEmailVerified = true, specialtyNote = "" } = {}) {
    const badges = normalizeBadgeState(rawBadges);
    const order = includeEmailVerified
        ? ["verifiedCreator", "officialOrg", "expertSpecialist", "emailVerified"]
        : ["verifiedCreator", "officialOrg", "expertSpecialist"];

    const active = order.filter((k) => badges[k]);
    if (!active.length) return "";

    return `<div class="skg-badges-row" role="list" aria-label="Account verification badges">${active.map((key) => {
        const def = BADGE_DEFINITIONS[key];
        const titleText = key === "expertSpecialist" && specialtyNote
            ? `${def.label} — ${specialtyNote}`
            : def.label;
        return `<span class="skg-badge-item ${def.colorClass}" role="listitem" title="${escapeHTML(def.description)}">${getBadgeIconSvg(key, 15)}<span>${escapeHTML(titleText)}</span></span>`;
    }).join("")}</div>`;
}
