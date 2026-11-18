// ============================================================================
// SIRANCHOWK KHAJA GHAR — REPORTS, EXPORTS & SPARK DATA RETENTION MODULE
// ============================================================================

import { db, ref, get, remove } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";
import {
    loadAnalyticsSettings,
    getDateRangeFromPreset,
    formatDuration,
    maskEmail,
    maskPhone,
    downloadCSV,
    triggerPrintReport,
    renderDateFilterBar
} from "./analytics-utils.js";

function getEventTs(ev) {
    if (Number.isFinite(Number(ev?.numericTimestamp)) && Number(ev.numericTimestamp) > 0) {
        return Number(ev.numericTimestamp);
    }
    const t = new Date(ev?.timestamp || 0).getTime();
    return Number.isFinite(t) ? t : 0;
}

function buildHtmlTable(headers, rows, limit = 250) {
    const bodyRows = rows.slice(0, limit).map((row) => `
      <tr>${row.map((cell) => `<td>${Utils.escapeHTML(cell)}</td>`).join("")}</tr>
    `).join("");
    return `
      <p style="font-size:12px;color:#475569;margin-bottom:8px;">Showing ${Math.min(rows.length, limit)} of ${rows.length} rows.</p>
      <table class="skg-print-table">
        <thead><tr>${headers.map((h) => `<th>${Utils.escapeHTML(h)}</th>`).join("")}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `;
}

export const ReportsExportsModule = {
    async render(container) {
        if (!hasPermission("exportReports")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Owner Authority Required</h2><p class="card-subtitle">Reports, CSV Exports, and Data Retention pruning are restricted to the Owner or explicitly permitted roles.</p></section>';
            return;
        }

        const session = getAdminSession();
        const canSeePII = hasPermission("viewCustomerContactDetails");
        const canPrune = hasPermission("manageSettings");

        container.innerHTML = '<div class="skg-admin-loading">Preparing export datasets &amp; retention summary…</div>';

        const [
            eventsSnap,
            sessionsSnap,
            usersSnap,
            ordersSnap,
            loginSnap,
            auditSnap,
            secSnap,
            analyticsCfg
        ] = await Promise.all([
            get(ref(db, "analytics/events")).catch(() => null),
            get(ref(db, "visitorSessions")).catch(() => null),
            get(ref(db, "users")).catch(() => null),
            get(ref(db, "orders")).catch(() => null),
            get(ref(db, "loginHistory")).catch(() => null),
            get(ref(db, "auditLogs")).catch(() => null),
            get(ref(db, "securityLogs")).catch(() => null),
            loadAnalyticsSettings()
        ]);

        const allEvents = eventsSnap && eventsSnap.exists() ? Object.values(eventsSnap.val() || {}) : [];
        const allSessions = sessionsSnap && sessionsSnap.exists() ? Object.values(sessionsSnap.val() || {}) : [];
        const rawUsers = usersSnap && usersSnap.exists() ? (usersSnap.val() || {}) : {};
        const allOrders = ordersSnap && ordersSnap.exists()
            ? Object.entries(ordersSnap.val() || {}).map(([id, o]) => ({ id, ...(o || {}) }))
            : [];
        const allLogins = loginSnap && loginSnap.exists() ? Object.values(loginSnap.val() || {}) : [];
        const allAudits = auditSnap && auditSnap.exists() ? Object.values(auditSnap.val() || {}) : [];
        const allSecurity = secSnap && secSnap.exists() ? Object.values(secSnap.val() || {}) : [];

        const state = {
            preset: "30d",
            customStart: "",
            customEnd: ""
        };

        const logExportAudit = async (action, datasetKey, count) => {
            await logAuditEvent({
                actorUid: session?.user?.uid,
                actorName: session?.staff?.name,
                actorEmail: session?.user?.email,
                actorRole: session?.role,
                action,
                target: datasetKey,
                status: "success",
                metadata: { rows: count, datePreset: state.preset, piiIncluded: canSeePII }
            });
        };

        const draw = () => {
            const range = getDateRangeFromPreset(state.preset, state.customStart, state.customEnd);
            const inRange = (ms) => Number(ms || 0) >= range.startMs && Number(ms || 0) <= range.endMs;

            const eventsFiltered = allEvents.filter((e) => inRange(getEventTs(e)));
            const sessionsFiltered = allSessions.filter((s) => inRange(s.startTime));
            const ordersFiltered = allOrders.filter((o) => inRange(o.createdAt));
            const loginsFiltered = allLogins.filter((l) => inRange(l.timestamp));
            const auditsFiltered = allAudits.filter((a) => inRange(a.timestamp));
            const secFiltered = allSecurity.filter((s) => inRange(s.timestamp));

            const customersRows = Object.entries(rawUsers).map(([uid, rec]) => {
                const p = rec?.profile || {};
                const uOrders = rec?.orders
                    ? Object.values(rec.orders)
                    : allOrders.filter((o) => o.customerUid === uid);
                return {
                    uid,
                    name: p.name || "Customer",
                    email: canSeePII ? (p.email || "Not provided") : maskEmail(p.email),
                    phone: canSeePII ? (p.phone || "Not provided") : maskPhone(p.phone),
                    createdAt: p.createdAt ? Utils.formatDate(p.createdAt) : "Not provided",
                    lastLoginAt: p.lastLoginAt ? Utils.formatDate(p.lastLoginAt) : "Not recorded",
                    loginCount: Number(p.loginCount || 0),
                    ordersCount: uOrders.length,
                    offersOptIn: p.notificationPreferences?.offersOptIn ? "Yes" : "No"
                };
            });

            const datasets = [
                {
                    key: "website_traffic",
                    title: "Website Traffic & Events",
                    desc: "First-party page views, device/browser breakdown, and product/order funnel events.",
                    count: eventsFiltered.length,
                    build: () => ({
                        headers: ["Timestamp (NPT)", "Event Type", "Page", "Visitor ID", "Session ID", "Device", "Browser", "OS", "Referrer"],
                        rows: eventsFiltered.map((e) => [
                            Utils.formatDate(getEventTs(e)),
                            e.eventType || "event",
                            e.page || "/",
                            e.visitorId || "N/A",
                            e.sessionId || "N/A",
                            e.device || "unknown",
                            e.browser || "Other",
                            e.operatingSystem || "Other",
                            e.referrerHost || "Direct"
                        ])
                    })
                },
                {
                    key: "visitor_sessions",
                    title: "Visitor Sessions",
                    desc: "Anonymous visitor sessions with landing/exit pages and estimated active durations.",
                    count: sessionsFiltered.length,
                    build: () => ({
                        headers: ["Session ID", "Visitor ID", "Started (NPT)", "Pages Viewed", "Est. Duration", "Device", "Browser", "OS", "Landing Page", "Returning"],
                        rows: sessionsFiltered.map((s) => [
                            s.sessionId || "N/A",
                            s.visitorId || "N/A",
                            Utils.formatDate(s.startTime),
                            Number(s.pageCount || 1),
                            formatDuration(s.estimatedDurationSec || 0),
                            s.device || "unknown",
                            s.browser || "Other",
                            s.operatingSystem || "Other",
                            s.landingPage || "/",
                            s.isReturning ? "Returning" : "New"
                        ])
                    })
                },
                {
                    key: "customer_directory",
                    title: "Customer Directory (All Registered)",
                    desc: canSeePII
                        ? "Full registered customer accounts with login counts and order totals."
                        : "Customer accounts with contact PII masked according to your RBAC role.",
                    count: customersRows.length,
                    build: () => ({
                        headers: ["UID", "Name", "Email", "Phone", "Joined (NPT)", "Last Login (NPT)", "Login Count", "Orders", "Offers Opt-In"],
                        rows: customersRows.map((c) => [
                            canSeePII ? c.uid : `${c.uid.slice(0, 6)}...`,
                            c.name,
                            c.email,
                            c.phone,
                            c.createdAt,
                            c.lastLoginAt,
                            c.loginCount,
                            c.ordersCount,
                            c.offersOptIn
                        ])
                    })
                },
                {
                    key: "orders_report",
                    title: "Order Analytics Report",
                    desc: "Website order requests, status, method, items summary, and coupon usage.",
                    count: ordersFiltered.length,
                    build: () => ({
                        headers: ["Order ID", "Created (NPT)", "Customer", "Phone", "Type", "Status", "Coupon", "Summary"],
                        rows: ordersFiltered.map((o) => [
                            o.id || "N/A",
                            Utils.formatDate(o.createdAt),
                            o.customerName || "Customer",
                            canSeePII ? (o.customerPhone || "Not provided") : maskPhone(o.customerPhone),
                            o.orderType || "Pickup",
                            o.status || "pending",
                            o.couponCode || "None",
                            o.summary || ""
                        ])
                    })
                },
                {
                    key: "login_history",
                    title: "User Login History",
                    desc: "Successful and failed customer & staff authentication attempts (zero secrets).",
                    count: loginsFiltered.length,
                    build: () => ({
                        headers: ["Timestamp (NPT)", "Name", "Email", "Role", "Method", "Result", "Reason", "Device", "Browser"],
                        rows: loginsFiltered.map((l) => [
                            Utils.formatDate(l.timestamp),
                            l.name || "Unauthenticated",
                            (l.role === "customer" && !canSeePII) ? maskEmail(l.email) : (l.email || "Not provided"),
                            l.role || "customer",
                            l.method || "password",
                            l.result || "success",
                            l.reason || "",
                            l.deviceType || "unknown",
                            l.browser || "Other"
                        ])
                    })
                },
                {
                    key: "admin_audit_logs",
                    title: "Admin Activity Logs",
                    desc: "Immutable operational audit trail across staff actions and updates.",
                    count: auditsFiltered.length,
                    build: () => ({
                        headers: ["Timestamp (NPT)", "Action", "Status", "Actor", "Actor Role", "Target", "Metadata"],
                        rows: auditsFiltered.map((a) => [
                            Utils.formatDate(a.timestamp),
                            a.action || "event",
                            a.status || "success",
                            a.actorEmail || a.actorUid || "system",
                            a.actorRole || "system",
                            a.target || "",
                            a.metadata ? JSON.stringify(a.metadata) : ""
                        ])
                    })
                },
                {
                    key: "security_logs",
                    title: "Security Logs",
                    desc: "Failed login alerts, unauthorized access attempts, RBAC and device governance events.",
                    count: secFiltered.length,
                    build: () => ({
                        headers: ["Timestamp (NPT)", "Severity", "Event Type", "Actor Email", "Actor Role", "Target", "Details"],
                        rows: secFiltered.map((s) => [
                            Utils.formatDate(s.timestamp),
                            s.severity || "info",
                            s.eventType || "security_event",
                            s.actorEmail || s.actorUid || "unauthenticated",
                            s.actorRole || "system",
                            s.target || "",
                            s.details ? JSON.stringify(s.details) : ""
                        ])
                    })
                }
            ];

            const retentionCutoffMs = Date.now() - Number(analyticsCfg.retentionDays || 90) * 24 * 60 * 60 * 1000;
            const staleSessionsCount = allSessions.filter((s) => Number(s.startTime || 0) > 0 && Number(s.startTime || 0) < retentionCutoffMs).length;
            const staleEventsCount = allEvents.filter((e) => getEventTs(e) > 0 && getEventTs(e) < retentionCutoffMs).length;

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">Reports &amp; Exports</h2>
                      <p class="card-subtitle">Download formula-safe CSV spreadsheets or generate formatted printable reports (${Utils.escapeHTML(range.label)}). All exports are recorded in Admin Activity Logs.</p>
                    </div>
                  </div>
                  ${renderDateFilterBar(state, true)}
                </section>

                <div class="analytics-grid">
                  ${datasets.map((ds) => `
                    <section class="card">
                      <div class="card-header">
                        <div>
                          <h3 class="card-title">${Utils.escapeHTML(ds.title)}</h3>
                          <p class="card-subtitle">${Utils.escapeHTML(ds.desc)}</p>
                        </div>
                        <span class="badge badge-info">${ds.count} rows</span>
                      </div>
                      <div class="skg-quick-actions" style="margin-top:12px;">
                        <button type="button" class="btn btn-sm btn-primary" data-export-csv="${Utils.escapeHTML(ds.key)}" ${ds.count === 0 ? "disabled" : ""}>⬇ Download CSV</button>
                        <button type="button" class="btn btn-sm btn-secondary" data-export-print="${Utils.escapeHTML(ds.key)}" ${ds.count === 0 ? "disabled" : ""}>🖨 Print Report</button>
                      </div>
                    </section>
                  `).join("")}
                </div>

                ${canPrune ? `
                  <section class="card">
                    <div class="card-header">
                      <div>
                        <h3 class="card-title">Firebase Spark Plan Retention &amp; Storage Cleanup</h3>
                        <p class="card-subtitle">Current retention policy: <strong>${Number(analyticsCfg.retentionDays || 90)} days</strong> (editable in Settings). Pruning removes old anonymous visitor records while keeping customer accounts, orders, and security logs intact.</p>
                      </div>
                    </div>
                    <div class="skg-channel-note">
                      Eligible for cleanup (older than ${Number(analyticsCfg.retentionDays || 90)} days):
                      <strong>${staleSessionsCount}</strong> visitor session(s) and <strong>${staleEventsCount}</strong> analytics event(s).
                    </div>
                    <button type="button" class="btn btn-danger" id="skg-prune-analytics-btn" ${(staleSessionsCount + staleEventsCount) === 0 ? "disabled" : ""}>
                      Clean Up Records Older Than ${Number(analyticsCfg.retentionDays || 90)} Days
                    </button>
                  </section>
                ` : ""}
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

            container.querySelectorAll("[data-export-csv]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const ds = datasets.find((d) => d.key === btn.dataset.exportCsv);
                    if (!ds) return;
                    const { headers, rows } = ds.build();
                    const dateTag = new Date().toISOString().slice(0, 10);
                    downloadCSV(`siranchowk_${ds.key}_${dateTag}.csv`, headers, rows);
                    await logExportAudit("report_exported_csv", ds.key, rows.length);
                    UIModule.showToast(`Exported ${rows.length} row(s) to CSV.`, "success");
                });
            });

            container.querySelectorAll("[data-export-print]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const ds = datasets.find((d) => d.key === btn.dataset.exportPrint);
                    if (!ds) return;
                    const { headers, rows } = ds.build();
                    await logExportAudit("report_printed", ds.key, rows.length);
                    triggerPrintReport(
                        ds.title,
                        `Date Scope: ${range.label} · Exported by: ${session?.staff?.name || session?.user?.email || "Admin"}`,
                        buildHtmlTable(headers, rows)
                    );
                });
            });

            const pruneBtn = container.querySelector("#skg-prune-analytics-btn");
            pruneBtn?.addEventListener("click", async () => {
                const totalStale = staleSessionsCount + staleEventsCount;
                if (!totalStale) return;
                const ok = await UIModule.confirm({
                    title: "Prune Old Anonymous Analytics Records?",
                    message: `Delete ${staleSessionsCount} anonymous visitor session(s) and ${staleEventsCount} raw analytics event(s) older than ${Number(analyticsCfg.retentionDays || 90)} days? Orders, customers, and security logs are NOT affected.`,
                    confirmText: "Delete Old Anonymous Records",
                    dangerous: true
                });
                if (!ok) return;

                pruneBtn.disabled = true;
                try {
                    let deleted = 0;
                    const eventsRaw = eventsSnap && eventsSnap.exists() ? Object.entries(eventsSnap.val() || {}) : [];
                    for (const [k, v] of eventsRaw) {
                        const ts = getEventTs(v);
                        if (ts > 0 && ts < retentionCutoffMs) {
                            await remove(ref(db, `analytics/events/${k}`)).catch(() => {});
                            deleted += 1;
                        }
                    }
                    const sessionsRaw = sessionsSnap && sessionsSnap.exists() ? Object.entries(sessionsSnap.val() || {}) : [];
                    for (const [k, v] of sessionsRaw) {
                        const ts = Number(v?.startTime || 0);
                        if (ts > 0 && ts < retentionCutoffMs) {
                            await remove(ref(db, `visitorSessions/${k}`)).catch(() => {});
                            deleted += 1;
                        }
                    }
                    await logExportAudit("analytics_retention_pruned", "analytics_cleanup", deleted);
                    UIModule.showToast(`Removed ${deleted} expired anonymous analytics record(s).`, "success");
                    this.render(container);
                } catch (err) {
                    UIModule.showToast(err?.message || "Failed to prune analytics records.", "error");
                    pruneBtn.disabled = false;
                }
            });
        };

        draw();
    }
};
