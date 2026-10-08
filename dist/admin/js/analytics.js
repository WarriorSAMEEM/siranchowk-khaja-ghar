/**
 * ============================================================
 * SIRANCHOWK KHAJA GHAR
 * ADMIN ANALYTICS MODULE
 * ============================================================
 *
 * Reads real visitor analytics from:
 *
 * analytics/
 * └── events/
 *
 * No fake/demo statistics.
 * ============================================================
 */

import {
    db,
    ref,
    get
} from "../../js/firebase.js";


const AnalyticsModule = (() => {

    // ========================================================
    // CONFIGURATION
    // ========================================================

    const ANALYTICS_PATH =
        "analytics/events";


    // ========================================================
    // HELPERS
    // ========================================================

    function escapeHTML(value) {

        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }


    function formatNumber(value) {

        return Number(value || 0)
            .toLocaleString();
    }


    function getDate(timestamp) {

        const date =
            new Date(timestamp);

        return Number.isNaN(
            date.getTime()
        )
            ? null
            : date;
    }


    function isToday(timestamp) {

        const date =
            getDate(timestamp);

        if (!date) {
            return false;
        }

        const now =
            new Date();

        return (
            date.getFullYear() ===
                now.getFullYear() &&
            date.getMonth() ===
                now.getMonth() &&
            date.getDate() ===
                now.getDate()
        );
    }


    function isWithinDays(
        timestamp,
        days
    ) {

        const date =
            getDate(timestamp);

        if (!date) {
            return false;
        }

        const now =
            Date.now();

        const difference =
            now - date.getTime();

        return (
            difference >= 0 &&
            difference <=
                days *
                24 *
                60 *
                60 *
                1000
        );
    }


    function formatTime(timestamp) {

        const date =
            getDate(timestamp);

        if (!date) {
            return "Unknown";
        }

        return date.toLocaleString(
            undefined,
            {
                dateStyle: "medium",
                timeStyle: "short"
            }
        );
    }


    // ========================================================
    // LOAD FIREBASE ANALYTICS
    // ========================================================

    async function loadAnalytics() {

        const analyticsRef =
            ref(
                db,
                ANALYTICS_PATH
            );

        const snapshot =
            await get(
                analyticsRef
            );

        if (!snapshot.exists()) {
            return [];
        }

        const rawData =
            snapshot.val();

        return Object.entries(
            rawData
        ).map(
            ([id, value]) => ({
                id,
                ...(value || {})
            })
        );
    }


    // ========================================================
    // CALCULATE STATISTICS
    // ========================================================

    function calculateStats(
        events
    ) {

        const pageViews =
            events.filter(
                event =>
                    event.eventType ===
                    "page_view"
            );

        const sessions =
            new Set();

        pageViews.forEach(
            event => {

                if (
                    event.sessionId
                ) {
                    sessions.add(
                        event.sessionId
                    );
                }

            }
        );


        const todayViews =
            pageViews.filter(
                event =>
                    isToday(
                        event.timestamp
                    )
            );


        const weekViews =
            pageViews.filter(
                event =>
                    isWithinDays(
                        event.timestamp,
                        7
                    )
            );


        const monthViews =
            pageViews.filter(
                event =>
                    isWithinDays(
                        event.timestamp,
                        30
                    )
            );


        const menuViews =
            pageViews.filter(
                event =>
                    event.page ===
                    "/menu.html" ||
                    event.page ===
                    "/menu"
            );


        const whatsappClicks =
            events.filter(
                event =>
                    event.eventType ===
                        "whatsapp_click" ||
                    event.eventType ===
                        "whatsapp"
            );


        return {

            totalViews:
                pageViews.length,

            uniqueVisitors:
                sessions.size,

            today:
                todayViews.length,

            last7Days:
                weekViews.length,

            last30Days:
                monthViews.length,

            menuViews:
                menuViews.length,

            whatsappClicks:
                whatsappClicks.length

        };
    }


    // ========================================================
    // TOP PAGES
    // ========================================================

    function getTopPages(
        events
    ) {

        const counts = {};

        events
            .filter(
                event =>
                    event.eventType ===
                    "page_view"
            )
            .forEach(
                event => {

                    const page =
                        event.page ||
                        "/";

                    counts[page] =
                        (counts[page] || 0) +
                        1;

                }
            );


        return Object.entries(
            counts
        )
            .sort(
                (a, b) =>
                    b[1] - a[1]
            )
            .slice(0, 8);
    }


    // ========================================================
    // DEVICE STATISTICS
    // ========================================================

    function getDeviceStats(
        events
    ) {

        const counts = {};

        events
            .filter(
                event =>
                    event.eventType ===
                    "page_view"
            )
            .forEach(
                event => {

                    const device =
                        event.device ||
                        "Unknown";

                    counts[device] =
                        (counts[device] || 0) +
                        1;

                }
            );


        return Object.entries(
            counts
        )
            .sort(
                (a, b) =>
                    b[1] - a[1]
            );
    }


    // ========================================================
    // BROWSER STATISTICS
    // ========================================================

    function getBrowserStats(
        events
    ) {

        const counts = {};

        events
            .filter(
                event =>
                    event.eventType ===
                    "page_view"
            )
            .forEach(
                event => {

                    const browser =
                        event.browser ||
                        "Unknown";

                    counts[browser] =
                        (counts[browser] || 0) +
                        1;

                }
            );


        return Object.entries(
            counts
        )
            .sort(
                (a, b) =>
                    b[1] - a[1]
            );
    }


    // ========================================================
    // RECENT ACTIVITY
    // ========================================================

    function getRecentEvents(
        events
    ) {

        return [
            ...events
        ]
            .sort(
                (a, b) => {

                    const dateA =
                        getDate(
                            a.timestamp
                        );

                    const dateB =
                        getDate(
                            b.timestamp
                        );

                    return (
                        (dateB?.getTime() || 0) -
                        (dateA?.getTime() || 0)
                    );

                }
            )
            .slice(0, 10);
    }


    // ========================================================
    // EMPTY STATE
    // ========================================================

    function renderEmptyState() {

        return `

            <div class="card">

                <div class="card-header">

                    <div>

                        <h2 class="card-title">
                            Visitor Analytics
                        </h2>

                        <p class="card-subtitle">
                            Real visitor activity from Firebase
                        </p>

                    </div>

                    <span class="badge badge-info">
                        Live Data
                    </span>

                </div>


                <div class="empty-state">

                    <div class="empty-state-icon">
                        📊
                    </div>

                    <h3 class="empty-state-title">
                        No Visitor Data Yet
                    </h3>

                    <p class="empty-state-desc">
                        Visitor analytics will appear here
                        automatically when people visit your
                        website.
                    </p>

                </div>

            </div>

        `;
    }


    // ========================================================
    // METRIC CARD
    // ========================================================

    function metricCard(
        label,
        value,
        description,
        icon
    ) {

        return `

            <div class="metric-card">

                <div class="metric-info">

                    <span class="metric-label">
                        ${escapeHTML(label)}
                    </span>

                    <span class="metric-value">
                        ${formatNumber(value)}
                    </span>

                    <span class="metric-subtext">
                        ${escapeHTML(description)}
                    </span>

                </div>

                <div class="metric-icon-box">
                    ${icon}
                </div>

            </div>

        `;
    }


    // ========================================================
    // LIST COMPONENT
    // ========================================================

    function renderList(
        items,
        emptyText
    ) {

        if (!items.length) {

            return `

                <div class="analytics-empty-small">
                    ${escapeHTML(emptyText)}
                </div>

            `;

        }


        return items
            .map(
                ([name, count]) => `

                    <div class="analytics-list-row">

                        <span class="analytics-list-name">
                            ${escapeHTML(name)}
                        </span>

                        <strong class="analytics-list-value">
                            ${formatNumber(count)}
                        </strong>

                    </div>

                `
            )
            .join("");
    }


    // ========================================================
    // RENDER
    // ========================================================

    async function render(
        container
    ) {

        if (!container) {
            return;
        }


        // ----------------------------------------------------
        // LOADING
        // ----------------------------------------------------

        container.innerHTML = `

            <div class="card">

                <div class="card-header">

                    <div>

                        <h2 class="card-title">
                            Visitor Analytics
                        </h2>

                        <p class="card-subtitle">
                            Loading real visitor data...
                        </p>

                    </div>

                    <span class="badge badge-info">
                        Loading
                    </span>

                </div>


                <div class="analytics-loading">

                    <div class="skeleton skeleton-title"></div>

                    <div class="skeleton skeleton-text"></div>

                    <div class="skeleton skeleton-text"></div>

                </div>

            </div>

        `;


        try {

            const events =
                await loadAnalytics();


            // ------------------------------------------------
            // NO DATA
            // ------------------------------------------------

            if (!events.length) {

                container.innerHTML =
                    renderEmptyState();

                return;
            }


            // ------------------------------------------------
            // CALCULATE DATA
            // ------------------------------------------------

            const stats =
                calculateStats(
                    events
                );


            const topPages =
                getTopPages(
                    events
                );


            const devices =
                getDeviceStats(
                    events
                );


            const browsers =
                getBrowserStats(
                    events
                );


            const recentEvents =
                getRecentEvents(
                    events
                );


            // ------------------------------------------------
            // MAIN UI
            // ------------------------------------------------

            container.innerHTML = `

                <div class="analytics-page">


                    <!-- HEADER -->

                    <div class="card analytics-header-card">

                        <div class="card-header">

                            <div>

                                <h2 class="card-title">
                                    Visitor Analytics
                                </h2>

                                <p class="card-subtitle">
                                    Real-time website activity
                                    collected from Firebase
                                </p>

                            </div>

                            <button
                                type="button"
                                class="btn btn-secondary"
                                id="analytics-refresh"
                            >
                                ↻ Refresh
                            </button>

                        </div>

                    </div>


                    <!-- METRICS -->

                    <div class="metrics-grid">

                        ${metricCard(
                            "Unique Visitors",
                            stats.uniqueVisitors,
                            "Unique sessions",
                            "👥"
                        )}

                        ${metricCard(
                            "Page Views",
                            stats.totalViews,
                            "All tracked views",
                            "📊"
                        )}

                        ${metricCard(
                            "Today",
                            stats.today,
                            "Views today",
                            "📅"
                        )}

                        ${metricCard(
                            "Last 7 Days",
                            stats.last7Days,
                            "Recent page views",
                            "📈"
                        )}

                        ${metricCard(
                            "Menu Views",
                            stats.menuViews,
                            "Menu page views",
                            "📖"
                        )}

                        ${metricCard(
                            "WhatsApp Clicks",
                            stats.whatsappClicks,
                            "Tracked interactions",
                            "💬"
                        )}

                    </div>


                    <!-- OVERVIEW -->

                    <div class="analytics-grid">


                        <!-- TOP PAGES -->

                        <div class="card">

                            <div class="card-header">

                                <div>

                                    <h3 class="card-title">
                                        Top Pages
                                    </h3>

                                    <p class="card-subtitle">
                                        Most viewed pages
                                    </p>

                                </div>

                            </div>


                            <div class="analytics-list">

                                ${renderList(
                                    topPages,
                                    "No page views recorded yet."
                                )}

                            </div>

                        </div>


                        <!-- DEVICES -->

                        <div class="card">

                            <div class="card-header">

                                <div>

                                    <h3 class="card-title">
                                        Devices
                                    </h3>

                                    <p class="card-subtitle">
                                        Visitor device types
                                    </p>

                                </div>

                            </div>


                            <div class="analytics-list">

                                ${renderList(
                                    devices,
                                    "No device data available."
                                )}

                            </div>

                        </div>


                        <!-- BROWSERS -->

                        <div class="card">

                            <div class="card-header">

                                <div>

                                    <h3 class="card-title">
                                        Browsers
                                    </h3>

                                    <p class="card-subtitle">
                                        Visitor browsers
                                    </p>

                                </div>

                            </div>


                            <div class="analytics-list">

                                ${renderList(
                                    browsers,
                                    "No browser data available."
                                )}

                            </div>

                        </div>


                        <!-- PERIOD -->

                        <div class="card">

                            <div class="card-header">

                                <div>

                                    <h3 class="card-title">
                                        Traffic Summary
                                    </h3>

                                    <p class="card-subtitle">
                                        Visitor activity periods
                                    </p>

                                </div>

                            </div>


                            <div class="analytics-summary">

                                <div class="analytics-summary-row">

                                    <span>
                                        Today
                                    </span>

                                    <strong>
                                        ${formatNumber(
                                            stats.today
                                        )}
                                    </strong>

                                </div>


                                <div class="analytics-summary-row">

                                    <span>
                                        Last 7 Days
                                    </span>

                                    <strong>
                                        ${formatNumber(
                                            stats.last7Days
                                        )}
                                    </strong>

                                </div>


                                <div class="analytics-summary-row">

                                    <span>
                                        Last 30 Days
                                    </span>

                                    <strong>
                                        ${formatNumber(
                                            stats.last30Days
                                        )}
                                    </strong>

                                </div>

                            </div>

                        </div>

                    </div>


                    <!-- RECENT ACTIVITY -->

                    <div class="card">

                        <div class="card-header">

                            <div>

                                <h3 class="card-title">
                                    Recent Activity
                                </h3>

                                <p class="card-subtitle">
                                    Latest visitor events
                                </p>

                            </div>

                        </div>


                        <div class="analytics-activity-list">

                            ${
                                recentEvents
                                    .map(
                                        event => `

                                            <div
                                                class="analytics-activity-row"
                                            >

                                                <div>

                                                    <strong>
                                                        ${escapeHTML(
                                                            event.eventType ||
                                                            "event"
                                                        )}
                                                    </strong>

                                                    <span>
                                                        ${escapeHTML(
                                                            event.page ||
                                                            "Unknown page"
                                                        )}
                                                    </span>

                                                </div>

                                                <time>
                                                    ${escapeHTML(
                                                        formatTime(
                                                            event.timestamp
                                                        )
                                                    )}
                                                </time>

                                            </div>

                                        `
                                    )
                                    .join("")
                            }

                        </div>

                    </div>


                </div>

            `;


            // ------------------------------------------------
            // REFRESH
            // ------------------------------------------------

            document
                .getElementById(
                    "analytics-refresh"
                )
                ?.addEventListener(
                    "click",
                    () => {

                        render(
                            container
                        );

                    }
                );


        } catch (error) {

            console.error(
                "Analytics loading failed:",
                error
            );


            container.innerHTML = `

                <div class="card">

                    <div class="card-header">

                        <div>

                            <h2 class="card-title">
                                Visitor Analytics
                            </h2>

                            <p class="card-subtitle">
                                Unable to load Firebase analytics.
                            </p>

                        </div>

                        <span class="badge badge-error">
                            Error
                        </span>

                    </div>


                    <div class="empty-state">

                        <div class="empty-state-icon">
                            ⚠️
                        </div>

                        <h3 class="empty-state-title">
                            Analytics Could Not Be Loaded
                        </h3>

                        <p class="empty-state-desc">
                            Check Firebase Realtime Database
                            permissions and try again.
                        </p>

                        <button
                            type="button"
                            class="btn btn-secondary"
                            id="analytics-retry"
                        >
                            Try Again
                        </button>

                    </div>

                </div>

            `;


            document
                .getElementById(
                    "analytics-retry"
                )
                ?.addEventListener(
                    "click",
                    () => {

                        render(
                            container
                        );

                    }
                );

        }

    }


    // ========================================================
    // PUBLIC API
    // ========================================================

    return {

        render

    };

})();


// ============================================================
// GLOBAL MODULE
// ============================================================

window.AnalyticsModule =
    AnalyticsModule;
    export { AnalyticsModule };