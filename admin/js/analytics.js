// ============================================================================
// SIRANCHOWK KHAJA GHAR — WEBSITE ANALYTICS MODULE (REAL FIRST-PARTY DATA)
// ============================================================================

import { db, ref, get } from "../../js/firebase.js";
import { hasPermission, getAdminSession } from "./auth.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";
import {
    getDateRangeFromPreset,
    formatPeriodComparison,
    formatDuration,
    dayKeyFromMs,
    enumerateDayKeys,
    isSessionBounce,
    downloadCSV,
    renderDailyTrendSVG,
    renderHorizontalBreakdown,
    renderDateFilterBar
} from "./analytics-utils.js";

function eventTimestampMs(ev) {
    if (Number.isFinite(Number(ev?.numericTimestamp)) && Number(ev.numericTimestamp) > 0) {
        return Number(ev.numericTimestamp);
    }
    const parsed = new Date(ev?.timestamp || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

export function computeWebsiteAnalyticsMetrics(events = [], sessions = [], range) {
    const now = Date.now();
    const { startMs, endMs, prevStartMs, prevEndMs } = range;

    const inCurrent = (ms) => ms >= startMs && ms <= endMs;
    const inPrev = (ms) => ms >= prevStartMs && ms <= prevEndMs;

    const todayRange = getDateRangeFromPreset("today", "", "", now);
    const weekRange = getDateRangeFromPreset("7d", "", "", now);
    const monthRange = getDateRangeFromPreset("this_month", "", "", now);

    const uniqueVisitorsToday = new Set();
    const uniqueVisitorsWeek = new Set();
    const uniqueVisitorsMonth = new Set();
    sessions.forEach((s) => {
        if (!s) return;
        const ts = Number(s.startTime || 0);
        const vid = s.visitorId || s.sessionId;
        if (!vid) return;
        if (ts >= todayRange.startMs && ts <= todayRange.endMs) uniqueVisitorsToday.add(vid);
        if (ts >= weekRange.startMs && ts <= weekRange.endMs) uniqueVisitorsWeek.add(vid);
        if (ts >= monthRange.startMs && ts <= monthRange.endMs) uniqueVisitorsMonth.add(vid);
    });

    const pageViewsCurr = [];
    const pageViewsPrev = [];
    const interactionCounts = { product_view: 0, add_to_cart: 0, checkout_started: 0, order_submitted: 0, whatsapp_click: 0 };

    events.forEach((ev) => {
        if (!ev) return;
        const ts = eventTimestampMs(ev);
        if (ev.eventType === "page_view") {
            if (inCurrent(ts)) pageViewsCurr.push(ev);
            else if (inPrev(ts)) pageViewsPrev.push(ev);
        } else if (inCurrent(ts) && ev.eventType) {
            if (ev.eventType === "whatsapp_click" || ev.eventType === "whatsapp") interactionCounts.whatsapp_click += 1;
            else if (interactionCounts[ev.eventType] !== undefined) interactionCounts[ev.eventType] += 1;
        }
    });

    const sessionsCurr = sessions.filter((s) => inCurrent(Number(s.startTime || 0)));
    const sessionsPrev = sessions.filter((s) => inPrev(Number(s.startTime || 0)));

    const uniqueVisitorsCurr = new Set(sessionsCurr.map((s) => s.visitorId || s.sessionId).filter(Boolean));
    const uniqueVisitorsPrev = new Set(sessionsPrev.map((s) => s.visitorId || s.sessionId).filter(Boolean));

    // Fallback to page_view sessionIds if older events predate visitorSessions
    if (!sessionsCurr.length && pageViewsCurr.length) {
        pageViewsCurr.forEach((ev) => uniqueVisitorsCurr.add(ev.visitorId || ev.sessionId));
    }
    if (!sessionsPrev.length && pageViewsPrev.length) {
        pageViewsPrev.forEach((ev) => uniqueVisitorsPrev.add(ev.visitorId || ev.sessionId));
    }

    const activeVisitorsNow = sessions.filter(
        (s) => s && !s.endTime && (now - Number(s.lastActivityAt || 0)) <= 5 * 60 * 1000
    ).length;

    let newVisitors = 0;
    let returningVisitors = 0;
    const visitorFirstSeenInRange = new Map();
    sessionsCurr.forEach((s) => {
        const vid = s.visitorId || s.sessionId;
        if (!vid || visitorFirstSeenInRange.has(vid)) return;
        visitorFirstSeenInRange.set(vid, Boolean(s.isReturning));
    });
    visitorFirstSeenInRange.forEach((ret) => {
        if (ret) returningVisitors += 1;
        else newVisitors += 1;
    });

    const totalDurationSec = sessionsCurr.reduce((sum, s) => sum + Number(s.estimatedDurationSec || 0), 0);
    const avgDurationSec = sessionsCurr.length ? Math.round(totalDurationSec / sessionsCurr.length) : 0;
    const totalPagesInSessions = sessionsCurr.reduce((sum, s) => sum + Number(s.pageCount || 1), 0);
    const avgPagesPerSession = sessionsCurr.length
        ? Math.round((totalPagesInSessions / sessionsCurr.length) * 10) / 10
        : (pageViewsCurr.length ? 1 : 0);

    const closedResults = sessionsCurr.map((s) => isSessionBounce(s, now)).filter((v) => v !== null);
    const bounceCount = closedResults.filter(Boolean).length;
    const bounceRatePct = closedResults.length ? Math.round((bounceCount / closedResults.length) * 100) : null;

    const pageCounts = {};
    const deviceCounts = {};
    const browserCounts = {};
    const osCounts = {};
    const referrerCounts = {};

    const sourceRows = sessionsCurr.length ? sessionsCurr : pageViewsCurr;
    sourceRows.forEach((row) => {
        const dev = row.device || "unknown";
        const brw = row.browser || "Other";
        const os = row.operatingSystem || "Other";
        const refHost = row.referrerHost || (row.referrer ? row.referrer : "Direct");
        deviceCounts[dev] = (deviceCounts[dev] || 0) + 1;
        browserCounts[brw] = (browserCounts[brw] || 0) + 1;
        osCounts[os] = (osCounts[os] || 0) + 1;
        referrerCounts[refHost] = (referrerCounts[refHost] || 0) + 1;
    });

    pageViewsCurr.forEach((ev) => {
        const pg = ev.page || "/";
        pageCounts[pg] = (pageCounts[pg] || 0) + 1;
    });

    const dayKeys = enumerateDayKeys(startMs, endMs);
    const viewsByDayMap = {};
    const visitsByDayMap = {};
    dayKeys.forEach((k) => {
        viewsByDayMap[k] = 0;
        visitsByDayMap[k] = 0;
    });
    pageViewsCurr.forEach((ev) => {
        const k = dayKeyFromMs(eventTimestampMs(ev));
        if (viewsByDayMap[k] !== undefined) viewsByDayMap[k] += 1;
    });
    sessionsCurr.forEach((s) => {
        const k = dayKeyFromMs(s.startTime);
        if (visitsByDayMap[k] !== undefined) visitsByDayMap[k] += 1;
    });

    const dailyViewsSeries = dayKeys.map((k) => ({ label: k, value: viewsByDayMap[k] }));
    const dailyVisitsSeries = dayKeys.map((k) => ({ label: k, value: visitsByDayMap[k] }));

    return {
        totalSessions: sessionsCurr.length || uniqueVisitorsCurr.size,
        prevSessions: sessionsPrev.length || uniqueVisitorsPrev.size,
        uniqueVisitors: uniqueVisitorsCurr.size,
        prevUniqueVisitors: uniqueVisitorsPrev.size,
        visitorsToday: uniqueVisitorsToday.size,
        visitorsThisWeek: uniqueVisitorsWeek.size,
        visitorsThisMonth: uniqueVisitorsMonth.size,
        totalPageViews: pageViewsCurr.length,
        prevPageViews: pageViewsPrev.length,
        newVisitors,
        returningVisitors,
        activeVisitorsNow,
        avgDurationSec,
        avgPagesPerSession,
        bounceRatePct,
        closedSessionsCount: closedResults.length,
        mobileVisits: deviceCounts.mobile || 0,
        desktopVisits: deviceCounts.desktop || 0,
        tabletVisits: deviceCounts.tablet || 0,
        pageCounts,
        deviceCounts,
        browserCounts,
        osCounts,
        referrerCounts,
        interactionCounts,
        dailyViewsSeries,
        dailyVisitsSeries
    };
}

export const AnalyticsModule = {
    async render(container) {
        if (!hasPermission("viewAnalytics")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">Website Analytics requires the View Website Analytics permission.</p></section>';
            return;
        }

        const canExport = hasPermission("exportReports");
        const session = getAdminSession();
        const state = {
            preset: "7d",
            customStart: "",
            customEnd: ""
        };

        container.innerHTML = '<div class="skg-admin-loading">Loading first-party website analytics…</div>';

        let events = [];
        let sessions = [];
        try {
            const [evSnap, sesSnap] = await Promise.all([
                get(ref(db, "analytics/events")).catch(() => null),
                get(ref(db, "visitorSessions")).catch(() => null)
            ]);
            events = evSnap && evSnap.exists() ? Object.values(evSnap.val() || {}) : [];
            sessions = sesSnap && sesSnap.exists() ? Object.values(sesSnap.val() || {}) : [];
        } catch (err) {
            container.innerHTML = `<section class="card"><p class="skg-dashboard-error">Unable to load analytics: ${Utils.escapeHTML(err.message)}</p></section>`;
            return;
        }

        const draw = () => {
            const range = getDateRangeFromPreset(state.preset, state.customStart, state.customEnd);
            const stats = computeWebsiteAnalyticsMetrics(events, sessions, range);
            const cmpSessions = formatPeriodComparison(stats.totalSessions, stats.prevSessions);
            const cmpUnique = formatPeriodComparison(stats.uniqueVisitors, stats.prevUniqueVisitors);
            const cmpViews = formatPeriodComparison(stats.totalPageViews, stats.prevPageViews);

            const hasAnyData = events.length > 0 || sessions.length > 0;

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">Website Analytics (${Utils.escapeHTML(range.label)})</h2>
                      <p class="card-subtitle">First-party visitor &amp; traffic intelligence. Distinct counts for sessions, unique visitors, and page views.</p>
                    </div>
                    <div class="skg-quick-actions">
                      ${canExport && hasAnyData ? '<button type="button" class="btn btn-primary" id="skg-wa-export">⬇ Export CSV</button>' : ""}
                      <button type="button" class="btn btn-secondary" id="skg-wa-refresh">↻ Refresh</button>
                    </div>
                  </div>
                  ${renderDateFilterBar(state, true)}
                </section>

                ${!hasAnyData ? `
                  <section class="card">
                    <div class="empty-state">
                      <div class="empty-state-icon">📊</div>
                      <h3 class="empty-state-title">No Website Traffic Recorded Yet</h3>
                      <p class="empty-state-desc">Real page views and visitor sessions appear here automatically as guests browse public pages (unless Do Not Track or analytics opt-out is enabled).</p>
                    </div>
                  </section>
                ` : `
                  <div class="metrics-grid">
                    <div class="metric-card">
                      <div class="metric-info">
                        <span class="metric-label">Total Sessions</span>
                        <span class="metric-value">${stats.totalSessions.toLocaleString()}</span>
                        <span class="metric-subtext ${cmpSessions.cssClass}">${Utils.escapeHTML(cmpSessions.text)}</span>
                      </div>
                      <div class="metric-icon-box">🧭</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-info">
                        <span class="metric-label">Unique Visitors</span>
                        <span class="metric-value">${stats.uniqueVisitors.toLocaleString()}</span>
                        <span class="metric-subtext ${cmpUnique.cssClass}">${Utils.escapeHTML(cmpUnique.text)}</span>
                      </div>
                      <div class="metric-icon-box">👥</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-info">
                        <span class="metric-label">Today / Week / Month</span>
                        <span class="metric-value">${stats.visitorsToday} / ${stats.visitorsThisWeek} / ${stats.visitorsThisMonth}</span>
                        <span class="metric-subtext">Unique visitors by calendar window</span>
                      </div>
                      <div class="metric-icon-box">📅</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-info">
                        <span class="metric-label">Total Page Views</span>
                        <span class="metric-value">${stats.totalPageViews.toLocaleString()}</span>
                        <span class="metric-subtext ${cmpViews.cssClass}">${Utils.escapeHTML(cmpViews.text)} · Avg ${stats.avgPagesPerSession} pg/session</span>
                      </div>
                      <div class="metric-icon-box">📄</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-info">
                        <span class="metric-label">New vs Returning</span>
                        <span class="metric-value">${stats.newVisitors} / ${stats.returningVisitors}</span>
                        <span class="metric-subtext">New / Returning visitors</span>
                      </div>
                      <div class="metric-icon-box">🔁</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-info">
                        <span class="metric-label">Active Now (5 min)</span>
                        <span class="metric-value">${stats.activeVisitorsNow}</span>
                        <span class="metric-subtext">Live visible heartbeat</span>
                      </div>
                      <div class="metric-icon-box">🟢</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-info">
                        <span class="metric-label">Avg Session Duration</span>
                        <span class="metric-value">${Utils.escapeHTML(formatDuration(stats.avgDurationSec))}</span>
                        <span class="metric-subtext">Visible tab heartbeat</span>
                      </div>
                      <div class="metric-icon-box">⏱️</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-info">
                        <span class="metric-label">Bounce Rate (Closed)</span>
                        <span class="metric-value">${stats.bounceRatePct === null ? "N/A" : `${stats.bounceRatePct}%`}</span>
                        <span class="metric-subtext" title="Single-page closed/idle sessions with <= 10s estimated duration">${stats.closedSessionsCount ? `Across ${stats.closedSessionsCount} closed sessions (1 page, ≤10s)` : "Awaiting closed sessions"}</span>
                      </div>
                      <div class="metric-icon-box">↩️</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-info">
                        <span class="metric-label">Mobile vs Desktop</span>
                        <span class="metric-value">${stats.mobileVisits} / ${stats.desktopVisits}</span>
                        <span class="metric-subtext">Tablet: ${stats.tabletVisits}</span>
                      </div>
                      <div class="metric-icon-box">📱</div>
                    </div>
                  </div>

                  <div class="skg-overview-split">
                    <section class="card">
                      <div class="card-header">
                        <div>
                          <h3 class="card-title">Page Views by Date</h3>
                          <p class="card-subtitle">Daily page view volume in selected range</p>
                        </div>
                      </div>
                      ${renderDailyTrendSVG(stats.dailyViewsSeries, "Page Views")}
                    </section>
                    <section class="card">
                      <div class="card-header">
                        <div>
                          <h3 class="card-title">Visitors / Sessions by Date</h3>
                          <p class="card-subtitle">Daily visitor sessions started</p>
                        </div>
                      </div>
                      ${renderDailyTrendSVG(stats.dailyVisitsSeries, "Visitor Sessions")}
                    </section>
                  </div>

                  <div class="analytics-grid">
                    <section class="card">
                      <div class="card-header"><div><h3 class="card-title">Most Visited Pages</h3><p class="card-subtitle">Page views breakdown</p></div></div>
                      ${renderHorizontalBreakdown(stats.pageCounts, "No page views in this range.")}
                    </section>
                    <section class="card">
                      <div class="card-header"><div><h3 class="card-title">Traffic Sources / Referrers</h3><p class="card-subtitle">Referrer domains &amp; direct visits</p></div></div>
                      ${renderHorizontalBreakdown(stats.referrerCounts, "No referrer data in this range.")}
                    </section>
                    <section class="card">
                      <div class="card-header"><div><h3 class="card-title">Devices</h3><p class="card-subtitle">Mobile, Desktop &amp; Tablet</p></div></div>
                      ${renderHorizontalBreakdown(stats.deviceCounts, "No device data.")}
                    </section>
                    <section class="card">
                      <div class="card-header"><div><h3 class="card-title">Browsers &amp; OS</h3><p class="card-subtitle">Browser share</p></div></div>
                      ${renderHorizontalBreakdown(stats.browserCounts, "No browser data.")}
                      <h4 class="skg-subhead">Operating Systems</h4>
                      ${renderHorizontalBreakdown(stats.osCounts, "No OS data.")}
                    </section>
                  </div>

                  <section class="card">
                    <div class="card-header">
                      <div>
                        <h3 class="card-title">Website Conversion &amp; Engagement Events</h3>
                        <p class="card-subtitle">Anonymous interaction funnel recorded during ${Utils.escapeHTML(range.label)}</p>
                      </div>
                    </div>
                    <div class="metrics-grid">
                      <div class="metric-card"><div class="metric-info"><span class="metric-label">Dish Views</span><span class="metric-value">${stats.interactionCounts.product_view}</span><span class="metric-subtext">Menu item inspections</span></div></div>
                      <div class="metric-card"><div class="metric-info"><span class="metric-label">Add to Cart</span><span class="metric-value">${stats.interactionCounts.add_to_cart}</span><span class="metric-subtext">Cart additions</span></div></div>
                      <div class="metric-card"><div class="metric-info"><span class="metric-label">Checkout Opened</span><span class="metric-value">${stats.interactionCounts.checkout_started}</span><span class="metric-subtext">Checkout drawer opens</span></div></div>
                      <div class="metric-card"><div class="metric-info"><span class="metric-label">Orders Submitted</span><span class="metric-value">${stats.interactionCounts.order_submitted}</span><span class="metric-subtext">Completed web requests</span></div></div>
                      <div class="metric-card"><div class="metric-info"><span class="metric-label">WhatsApp Clicks</span><span class="metric-value">${stats.interactionCounts.whatsapp_click}</span><span class="metric-subtext">Direct WhatsApp handoffs</span></div></div>
                    </div>
                  </section>
                `}
              </div>
            `;

            container.querySelectorAll("[data-date-preset]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    state.preset = btn.dataset.datePreset;
                    draw();
                });
            });
            container.querySelector("#skg-apply-custom-dates")?.addEventListener("click", () => {
                state.customStart = container.querySelector("#skg-custom-start")?.value || "";
                state.customEnd = container.querySelector("#skg-custom-end")?.value || "";
                draw();
            });
            container.querySelector("#skg-wa-refresh")?.addEventListener("click", () => this.render(container));
            container.querySelector("#skg-wa-export")?.addEventListener("click", async () => {
                const headers = ["Date", "Visitor Sessions", "Page Views"];
                const rows = stats.dailyViewsSeries.map((v, i) => [
                    v.label,
                    stats.dailyVisitsSeries[i]?.value || 0,
                    v.value
                ]);
                downloadCSV(`siranchowk_website_analytics_${state.preset}.csv`, headers, rows);
                await logAuditEvent({
                    actorUid: session?.user?.uid,
                    actorEmail: session?.user?.email,
                    actorRole: session?.role,
                    action: "website_analytics_exported",
                    target: state.preset,
                    metadata: { rows: rows.length }
                });
                UIModule.showToast("Website analytics CSV exported.", "success");
            });
        };

        draw();
    }
};

if (typeof window !== "undefined") {
    window.AnalyticsModule = AnalyticsModule;
}