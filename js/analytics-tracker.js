// ============================================================
// SIRANCHOWK KHAJA GHAR
// FIREBASE REALTIME DATABASE ANALYTICS TRACKER
// ============================================================

import {
    db,
    ref,
    push,
    set
} from "./firebase.js";

(function () {
    "use strict";

    console.log(
        "Firebase Analytics Tracker initialized."
    );

    // ========================================================
    // SESSION
    // ========================================================

    const SESSION_KEY =
        "siranchowk_analytics_session";

    function getSessionId() {
        let sessionId =
            sessionStorage.getItem(
                SESSION_KEY
            );

        if (!sessionId) {
            sessionId =
                "session_" +
                Date.now() +
                "_" +
                Math.random()
                    .toString(36)
                    .substring(2, 10);

            sessionStorage.setItem(
                SESSION_KEY,
                sessionId
            );
        }

        return sessionId;
    }

    // ========================================================
    // DEVICE INFORMATION
    // ========================================================

    function getDeviceType() {
        const width =
            window.innerWidth;

        if (width <= 767) {
            return "mobile";
        }

        if (width <= 1024) {
            return "tablet";
        }

        return "desktop";
    }

    function getBrowser() {
        const ua =
            navigator.userAgent;

        if (ua.includes("Edg")) {
            return "Edge";
        }

        if (ua.includes("Chrome")) {
            return "Chrome";
        }

        if (ua.includes("Firefox")) {
            return "Firefox";
        }

        if (ua.includes("Safari")) {
            return "Safari";
        }

        if (ua.includes("Opera")) {
            return "Opera";
        }

        return "Other";
    }

    function getOperatingSystem() {
        const ua =
            navigator.userAgent;

        if (/Windows/i.test(ua)) {
            return "Windows";
        }

        if (/Android/i.test(ua)) {
            return "Android";
        }

        if (/iPhone|iPad|iPod/i.test(ua)) {
            return "iOS";
        }

        if (/Mac/i.test(ua)) {
            return "macOS";
        }

        if (/Linux/i.test(ua)) {
            return "Linux";
        }

        return "Other";
    }

    // ========================================================
    // COMMON ANALYTICS DATA
    // ========================================================

    function getCommonData() {
        return {
            sessionId: getSessionId(),

            page:
                window.location.pathname,

            pageTitle:
                document.title || "",

            referrer:
                document.referrer || "",

            device:
                getDeviceType(),

            browser:
                getBrowser(),

            operatingSystem:
                getOperatingSystem(),

            screenWidth:
                window.screen.width,

            screenHeight:
                window.screen.height,

            language:
                navigator.language || "",

            timestamp:
                new Date().toISOString()
        };
    }

    // ========================================================
    // SAVE TO FIREBASE
    // ========================================================

    async function saveAnalytics(
        eventType,
        eventData = {}
    ) {
        try {
            const analyticsRef =
                ref(
                    db,
                    "analytics/events"
                );

            const newEventRef =
                push(analyticsRef);

            const data = {
                eventType,

                ...getCommonData(),

                ...eventData
            };

            await set(
                newEventRef,
                data
            );

            console.log(
                "Analytics saved:",
                eventType
            );

            return true;

        } catch (error) {

            console.error(
                "Analytics save failed:",
                error
            );

            return false;
        }
    }

    // ========================================================
    // PAGE VIEW
    // ========================================================

    async function trackPageView() {

        return saveAnalytics(
            "page_view"
        );
    }

    // ========================================================
    // CUSTOM EVENT
    // ========================================================

    async function trackEvent(
        eventName,
        eventData = {}
    ) {

        if (!eventName) {
            console.warn(
                "Analytics event name is required."
            );

            return false;
        }

        return saveAnalytics(
            eventName,
            eventData
        );
    }

    // ========================================================
    // BUTTON / LINK CLICK
    // ========================================================

    function setupClickTracking() {

        document.addEventListener(
            "click",
            function (event) {

                const target =
                    event.target.closest(
                        "[data-analytics]"
                    );

                if (!target) {
                    return;
                }

                const eventName =
                    target.dataset.analytics;

                const label =
                    target.dataset.analyticsLabel ||
                    target.textContent.trim();

                trackEvent(
                    eventName,
                    {
                        label
                    }
                );
            }
        );
    }

    // ========================================================
    // PUBLIC API
    // ========================================================

    window.AnalyticsTracker = {

        trackPageView,

        trackEvent,

        getSessionId

    };

    // ========================================================
    // INITIALIZE
    // ========================================================

    function initialize() {

        console.log(
            "Initializing Firebase analytics..."
        );

        trackPageView();

        setupClickTracking();

        console.log(
            "Firebase analytics tracking active."
        );
    }

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once: true
            }
        );

    } else {

        initialize();

    }

})();