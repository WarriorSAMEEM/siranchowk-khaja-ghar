// ============================================================================
// SIRANCHOWK KHAJA GHAR — FIRST-PARTY PRIVACY-CONSCIOUS ANALYTICS TRACKER
// ============================================================================
// Tracks anonymous visitor profiles, 30-min rolling sessions, page views,
// product views, and interaction events without browser fingerprinting or PII.
// Respects navigator.doNotTrack === "1" and user opt-out in localStorage.
// ============================================================================

import {
    auth,
    db,
    ref,
    push,
    set,
    update
} from "./firebase.js";

const VISITOR_ID_KEY = "skg_visitor_id_v1";
const VISITOR_FIRST_AT_KEY = "skg_visitor_first_at_v1";
const VISITOR_COUNT_KEY = "skg_visitor_count_v1";
const SESSION_KEY = "siranchowk_analytics_session";
const SESSION_META_KEY = "skg_session_meta_v1";
const OPTOUT_KEY = "skg_analytics_optout";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

function randomToken(prefix) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isOptedOut() {
    try {
        if (typeof navigator !== "undefined" && (navigator.doNotTrack === "1" || window.doNotTrack === "1")) {
            return true;
        }
        return localStorage.getItem(OPTOUT_KEY) === "1";
    } catch {
        return false;
    }
}

export function setOptOut(optOut) {
    try {
        if (optOut) {
            localStorage.setItem(OPTOUT_KEY, "1");
        } else {
            localStorage.removeItem(OPTOUT_KEY);
        }
        return true;
    } catch {
        return false;
    }
}

export function getDeviceType() {
    if (typeof window === "undefined") return "desktop";
    const ua = navigator.userAgent || "";
    const width = window.innerWidth || 1024;
    if (/Mobile|Android|iPhone|iPod/i.test(ua) || width <= 767) return "mobile";
    if (/iPad|Tablet/i.test(ua) || (width > 767 && width <= 1024)) return "tablet";
    return "desktop";
}

export function getBrowser() {
    if (typeof navigator === "undefined") return "Other";
    const ua = navigator.userAgent || "";
    if (ua.includes("Edg/") || ua.includes("Edg")) return "Edge";
    if (ua.includes("OPR/") || ua.includes("Opera")) return "Opera";
    if (ua.includes("Chrome/") || ua.includes("Chrome")) return "Chrome";
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Safari")) return "Safari";
    return "Other";
}

export function getOperatingSystem() {
    if (typeof navigator === "undefined") return "Other";
    const ua = navigator.userAgent || "";
    if (/Windows/i.test(ua)) return "Windows";
    if (/Android/i.test(ua)) return "Android";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
    if (/Mac/i.test(ua)) return "macOS";
    if (/Linux/i.test(ua)) return "Linux";
    return "Other";
}

function normalizePagePath(rawPath) {
    const clean = String(rawPath || "/").split("?")[0].split("#")[0] || "/";
    if (clean === "/index.html") return "/";
    return clean.slice(0, 120);
}

function pageSlugKey(path) {
    return String(path || "home")
        .replace(/^\/+/, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .slice(0, 64) || "home";
}

function parseReferrerHost(referrer) {
    if (!referrer) return "Direct";
    try {
        const url = new URL(referrer);
        if (typeof window !== "undefined" && url.hostname === window.location.hostname) {
            return "Internal";
        }
        return url.hostname.slice(0, 80) || "Direct";
    } catch {
        return "Direct";
    }
}

export function getOrCreateVisitorProfileLocal() {
    const now = Date.now();
    try {
        let visitorId = localStorage.getItem(VISITOR_ID_KEY);
        let firstVisitAt = Number(localStorage.getItem(VISITOR_FIRST_AT_KEY) || 0);
        let visitCount = Number(localStorage.getItem(VISITOR_COUNT_KEY) || 0);
        let isReturning = true;

        if (!visitorId || !/^vis_[a-zA-Z0-9_-]{8,64}$/.test(visitorId)) {
            visitorId = randomToken("vis");
            firstVisitAt = now;
            visitCount = 0;
            isReturning = false;
            localStorage.setItem(VISITOR_ID_KEY, visitorId);
            localStorage.setItem(VISITOR_FIRST_AT_KEY, String(firstVisitAt));
        }

        if (!firstVisitAt) {
            firstVisitAt = now;
            localStorage.setItem(VISITOR_FIRST_AT_KEY, String(firstVisitAt));
        }

        return { visitorId, firstVisitAt, visitCount, isReturning };
    } catch {
        return { visitorId: randomToken("vis"), firstVisitAt: now, visitCount: 1, isReturning: false };
    }
}

function readSessionMeta() {
    try {
        const raw = sessionStorage.getItem(SESSION_META_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeSessionMeta(meta) {
    try {
        sessionStorage.setItem(SESSION_KEY, meta.sessionId);
        sessionStorage.setItem(SESSION_META_KEY, JSON.stringify(meta));
    } catch {
        // Ignore private browsing quota errors
    }
}

export function getOrCreateSession() {
    const now = Date.now();
    const visitor = getOrCreateVisitorProfileLocal();
    const existing = readSessionMeta();

    if (existing && existing.sessionId && (now - Number(existing.lastActivityAt || 0)) <= SESSION_IDLE_MS) {
        return {
            session: existing,
            isNewSession: false,
            visitor
        };
    }

    const nextCount = Math.max(1, Number(visitor.visitCount || 0) + 1);
    const isReturning = nextCount > 1 || Boolean(existing);
    try {
        localStorage.setItem(VISITOR_COUNT_KEY, String(nextCount));
    } catch {}

    const currentPage = typeof window !== "undefined" ? normalizePagePath(window.location.pathname) : "/";
    const freshSession = {
        sessionId: randomToken("ses"),
        visitorId: visitor.visitorId,
        startTime: now,
        lastActivityAt: now,
        activeTimeMs: 0,
        pageCount: 0,
        pagesVisited: {},
        landingPage: currentPage,
        lastPage: currentPage,
        isReturning
    };
    writeSessionMeta(freshSession);
    return {
        session: freshSession,
        isNewSession: true,
        visitor: { ...visitor, visitCount: nextCount, isReturning }
    };
}

export function getVisitorId() {
    if (isOptedOut()) return null;
    return getOrCreateVisitorProfileLocal().visitorId;
}

export function getSessionId() {
    if (isOptedOut()) return null;
    return getOrCreateSession().session.sessionId;
}

let activeVisibleStartedAt = typeof document !== "undefined" && document.visibilityState === "visible" ? Date.now() : null;
let currentPageKey = null;
let heartbeatTimer = null;
let initialized = false;

function accumulateActiveMs(meta) {
    const now = Date.now();
    if (activeVisibleStartedAt && (typeof document === "undefined" || document.visibilityState === "visible")) {
        const delta = Math.max(0, Math.min(now - activeVisibleStartedAt, HEARTBEAT_INTERVAL_MS * 2));
        meta.activeTimeMs = Number(meta.activeTimeMs || 0) + delta;
        if (currentPageKey && meta.pagesVisited && meta.pagesVisited[currentPageKey]) {
            meta.pagesVisited[currentPageKey].estimatedDurationSec = Math.round(
                (Number(meta.pagesVisited[currentPageKey].activeMs || 0) + delta) / 1000
            );
            meta.pagesVisited[currentPageKey].activeMs = Number(meta.pagesVisited[currentPageKey].activeMs || 0) + delta;
        }
        activeVisibleStartedAt = now;
    }
    meta.lastActivityAt = now;
    writeSessionMeta(meta);
    return meta;
}

function buildSanitizedPagesMap(pagesVisited = {}) {
    const out = {};
    Object.entries(pagesVisited).forEach(([k, val]) => {
        if (!val) return;
        out[k] = {
            path: String(val.path || "/").slice(0, 120),
            views: Number(val.views || 1),
            estimatedDurationSec: Math.max(0, Math.round(Number(val.estimatedDurationSec || 0))),
            lastVisitedAt: Number(val.lastVisitedAt || Date.now())
        };
    });
    return out;
}

async function flushSessionSnapshot(markEnded = false) {
    if (isOptedOut() || typeof window === "undefined") return false;
    const { session, visitor } = getOrCreateSession();
    const meta = accumulateActiveMs(session);
    const now = Date.now();
    const estimatedDurationSec = Math.max(
        Math.round(Number(meta.activeTimeMs || 0) / 1000),
        Math.min(Math.round((now - Number(meta.startTime || now)) / 1000), 60)
    );
    const referrer = String(document.referrer || "").slice(0, 240);
    const referrerHost = parseReferrerHost(referrer);

    const sessionPayload = {
        sessionId: meta.sessionId,
        visitorId: meta.visitorId,
        startTime: Number(meta.startTime || now),
        lastActivityAt: now,
        estimatedDurationSec,
        pageCount: Math.max(1, Number(meta.pageCount || 1)),
        pagesVisited: buildSanitizedPagesMap(meta.pagesVisited),
        landingPage: String(meta.landingPage || "/").slice(0, 120),
        lastPage: String(meta.lastPage || "/").slice(0, 120),
        device: getDeviceType(),
        browser: getBrowser(),
        operatingSystem: getOperatingSystem(),
        referrer,
        referrerHost,
        isReturning: Boolean(meta.isReturning)
    };
    if (markEnded) {
        sessionPayload.endTime = now;
    }

    try {
        await update(ref(db, `visitorSessions/${meta.sessionId}`), sessionPayload);
        await update(ref(db, `visitorProfiles/${meta.visitorId}`), {
            visitorId: meta.visitorId,
            firstVisitAt: Number(visitor.firstVisitAt || now),
            lastVisitAt: now,
            visitCount: Math.max(1, Number(visitor.visitCount || 1)),
            lastSessionId: meta.sessionId,
            device: sessionPayload.device,
            browser: sessionPayload.browser,
            operatingSystem: sessionPayload.operatingSystem
        });
        return true;
    } catch {
        return false;
    }
}

function getCommonEventData() {
    const { session, visitor } = getOrCreateSession();
    const now = Date.now();
    const referrer = typeof document !== "undefined" ? String(document.referrer || "").slice(0, 240) : "";
    return {
        sessionId: session.sessionId,
        visitorId: visitor.visitorId,
        isReturning: Boolean(session.isReturning),
        authState: auth?.currentUser ? "authenticated" : "anonymous",
        page: typeof window !== "undefined" ? normalizePagePath(window.location.pathname) : "/",
        pageTitle: typeof document !== "undefined" ? String(document.title || "").slice(0, 120) : "",
        referrer,
        referrerHost: parseReferrerHost(referrer),
        device: getDeviceType(),
        browser: getBrowser(),
        operatingSystem: getOperatingSystem(),
        screenWidth: typeof window !== "undefined" ? Number(window.screen?.width || 0) : 0,
        screenHeight: typeof window !== "undefined" ? Number(window.screen?.height || 0) : 0,
        language: typeof navigator !== "undefined" ? String(navigator.language || "").slice(0, 24) : "",
        timestamp: new Date(now).toISOString(),
        numericTimestamp: now
    };
}

async function saveAnalyticsEvent(eventType, eventData = {}) {
    if (isOptedOut()) return false;
    try {
        const newEventRef = push(ref(db, "analytics/events"));
        const payload = {
            eventType: String(eventType || "event").slice(0, 48),
            ...getCommonEventData(),
            ...eventData
        };
        await set(newEventRef, payload);
        return true;
    } catch (error) {
        console.warn("Analytics save skipped:", error?.message || error);
        return false;
    }
}

export async function trackPageView(customPath = null) {
    if (isOptedOut() || typeof window === "undefined") return false;
    const { session } = getOrCreateSession();
    const meta = accumulateActiveMs(session);
    const pagePath = normalizePagePath(customPath || window.location.pathname);
    const key = pageSlugKey(pagePath);
    currentPageKey = key;

    meta.pageCount = Number(meta.pageCount || 0) + 1;
    meta.lastPage = pagePath;
    if (!meta.pagesVisited) meta.pagesVisited = {};
    const existingEntry = meta.pagesVisited[key] || { path: pagePath, views: 0, activeMs: 0, estimatedDurationSec: 0 };
    existingEntry.views = Number(existingEntry.views || 0) + 1;
    existingEntry.lastVisitedAt = Date.now();
    meta.pagesVisited[key] = existingEntry;
    writeSessionMeta(meta);

    await flushSessionSnapshot(false);
    return saveAnalyticsEvent("page_view", { page: pagePath });
}

export async function trackEvent(eventName, eventData = {}) {
    if (isOptedOut() || !eventName) return false;
    const { session } = getOrCreateSession();
    accumulateActiveMs(session);
    return saveAnalyticsEvent(eventName, eventData);
}

export async function trackProductView(productName, extra = {}) {
    if (isOptedOut() || !productName) return false;
    return trackEvent("product_view", {
        productName: String(productName).slice(0, 80),
        category: String(extra.category || "").slice(0, 48)
    });
}

function setupClickTracking() {
    if (typeof document === "undefined") return;
    document.addEventListener("click", (event) => {
        const analyticsTarget = event.target.closest("[data-analytics]");
        if (analyticsTarget) {
            const eventName = analyticsTarget.dataset.analytics;
            const label = analyticsTarget.dataset.analyticsLabel || analyticsTarget.textContent.trim().slice(0, 80);
            trackEvent(eventName, { label });
        }

        const dishTrigger = event.target.closest(".dish-card .dish-img-wrapper, .dish-card h3");
        if (dishTrigger) {
            const card = dishTrigger.closest(".dish-card");
            const dishName = card?.querySelector("h3")?.textContent?.trim();
            if (dishName) {
                trackProductView(dishName);
            }
        }
    });
}

function setupHeartbeatAndLifecycle() {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
        if (document.visibilityState === "visible" && !isOptedOut()) {
            flushSessionSnapshot(false);
        }
    }, HEARTBEAT_INTERVAL_MS);

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            flushSessionSnapshot(false);
            activeVisibleStartedAt = null;
        } else {
            activeVisibleStartedAt = Date.now();
        }
    });

    window.addEventListener("pagehide", () => {
        flushSessionSnapshot(true);
    });
}

export function initializeAnalyticsTracker() {
    if (initialized || typeof window === "undefined") return;
    initialized = true;

    window.AnalyticsTracker = {
        trackPageView,
        trackEvent,
        trackProductView,
        getSessionId,
        getVisitorId,
        setOptOut,
        isOptedOut
    };

    if (isOptedOut()) return;

    trackPageView();
    setupClickTracking();
    setupHeartbeatAndLifecycle();
}

if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeAnalyticsTracker, { once: true });
    } else {
        initializeAnalyticsTracker();
    }
}