// ============================================================================
// SIRANCHOWK KHAJA GHAR — SHARED ANALYTICS, CHARTS, CSV & PRINT UTILITIES
// ============================================================================

import { db, ref, get, query, orderByChild, startAt } from "../../js/firebase.js";
import { Utils } from "./utils.js";

export const DEFAULT_ANALYTICS_SETTINGS = Object.freeze({
    retentionDays: 90,
    dormantDays: 30,
    highlyActiveMinOrders: 5,
    activeMinOrders: 2
});

export async function loadAnalyticsSettings() {
    try {
        const snap = await get(ref(db, "settings/analytics"));
        return {
            ...DEFAULT_ANALYTICS_SETTINGS,
            ...(snap.exists() ? snap.val() : {})
        };
    } catch {
        return { ...DEFAULT_ANALYTICS_SETTINGS };
    }
}

export function getDateRangeFromPreset(preset = "7d", customStartStr = "", customEndStr = "", nowMs = Date.now()) {
    const startOfToday = new Date(nowMs);
    startOfToday.setHours(0, 0, 0, 0);
    const todayStart = startOfToday.getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    let startMs = todayStart - 6 * dayMs;
    let endMs = nowMs;
    let label = "Last 7 Days";

    if (preset === "today") {
        startMs = todayStart;
        endMs = nowMs;
        label = "Today";
    } else if (preset === "yesterday") {
        startMs = todayStart - dayMs;
        endMs = todayStart - 1;
        label = "Yesterday";
    } else if (preset === "30d") {
        startMs = todayStart - 29 * dayMs;
        endMs = nowMs;
        label = "Last 30 Days";
    } else if (preset === "this_month") {
        const d = new Date(nowMs);
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        startMs = d.getTime();
        endMs = nowMs;
        label = "This Month";
    } else if (preset === "prev_month") {
        const d = new Date(nowMs);
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        endMs = d.getTime() - 1;
        const prevStart = new Date(d.getFullYear(), d.getMonth() - 1, 1, 0, 0, 0, 0);
        startMs = prevStart.getTime();
        label = "Previous Month";
    } else if (preset === "90d") {
        startMs = todayStart - 89 * dayMs;
        endMs = nowMs;
        label = "Last 90 Days";
    } else if (preset === "custom" && customStartStr && customEndStr) {
        const parsedStart = new Date(`${customStartStr}T00:00:00`).getTime();
        const parsedEnd = new Date(`${customEndStr}T23:59:59.999`).getTime();
        if (Number.isFinite(parsedStart) && Number.isFinite(parsedEnd) && parsedEnd >= parsedStart) {
            startMs = parsedStart;
            endMs = parsedEnd;
            label = `${customStartStr} to ${customEndStr}`;
        }
    }

    const span = Math.max(dayMs, endMs - startMs + 1);
    const prevEndMs = startMs - 1;
    const prevStartMs = prevEndMs - span + 1;

    return { preset, startMs, endMs, prevStartMs, prevEndMs, label };
}

export function formatPeriodComparison(currentValue, previousValue, suffix = "") {
    const curr = Number(currentValue || 0);
    const prev = Number(previousValue || 0);
    if (prev === 0 && curr === 0) {
        return { text: "0% vs prior period", direction: "neutral", cssClass: "skg-delta-neutral" };
    }
    if (prev === 0) {
        return { text: `+${curr}${suffix} vs 0 prior`, direction: "up", cssClass: "skg-delta-up" };
    }
    const pct = Math.round(((curr - prev) / prev) * 100);
    if (pct > 0) {
        return { text: `+${pct}% vs prior period`, direction: "up", cssClass: "skg-delta-up" };
    }
    if (pct < 0) {
        return { text: `${pct}% vs prior period`, direction: "down", cssClass: "skg-delta-down" };
    }
    return { text: "0% vs prior period", direction: "neutral", cssClass: "skg-delta-neutral" };
}

export function formatDuration(seconds) {
    const sec = Math.max(0, Math.round(Number(seconds || 0)));
    if (sec < 60) return `${sec}s`;
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    if (mins < 60) return `${mins}m ${rem}s`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
}

export function dayKeyFromMs(ms) {
    const d = new Date(Number(ms || 0));
    if (Number.isNaN(d.getTime())) return "unknown";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export function monthKeyFromMs(ms) {
    const d = new Date(Number(ms || 0));
    if (Number.isNaN(d.getTime())) return "unknown";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function enumerateDayKeys(startMs, endMs) {
    const keys = [];
    const cur = new Date(startMs);
    cur.setHours(0, 0, 0, 0);
    const limit = new Date(endMs);
    limit.setHours(23, 59, 59, 999);
    let guard = 0;
    while (cur.getTime() <= limit.getTime() && guard < 120) {
        keys.push(dayKeyFromMs(cur.getTime()));
        cur.setDate(cur.getDate() + 1);
        guard += 1;
    }
    return keys;
}

export function isSessionBounce(session, nowMs = Date.now()) {
    if (!session) return null;
    const isClosed = Boolean(session.endTime) || (nowMs - Number(session.lastActivityAt || session.startTime || 0)) > 30 * 60 * 1000;
    if (!isClosed) return null;
    const pages = Number(session.pageCount || 1);
    const dur = Number(session.estimatedDurationSec || 0);
    return pages <= 1 && dur <= 10;
}

export function classifyCustomerTier(metrics = {}, cfg = DEFAULT_ANALYTICS_SETTINGS, nowMs = Date.now()) {
    const orders30 = Number(metrics.ordersLast30Days || 0);
    const logins30 = Number(metrics.loginsLast30Days || 0);
    const lastActive = Number(metrics.lastActiveAt || metrics.lastLoginAt || metrics.createdAt || 0);
    const dormantMs = Number(cfg.dormantDays || 30) * 24 * 60 * 60 * 1000;

    if (orders30 >= Number(cfg.highlyActiveMinOrders || 5)) {
        return { key: "highly_active", label: "Highly Active", badgeClass: "badge-success" };
    }
    if (orders30 >= Number(cfg.activeMinOrders || 2) || logins30 >= 3) {
        return { key: "active", label: "Active", badgeClass: "badge-info" };
    }
    if (lastActive && (nowMs - lastActive) <= dormantMs && (orders30 >= 1 || logins30 >= 1)) {
        return { key: "occasional", label: "Occasionally Active", badgeClass: "badge-warning" };
    }
    return { key: "inactive", label: "Inactive", badgeClass: "badge-danger" };
}

export function maskEmail(email) {
    const str = String(email || "").trim();
    if (!str.includes("@")) return "Restricted";
    const [local, domain] = str.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
}

export function maskPhone(phone) {
    const str = String(phone || "").trim();
    if (!str) return "Not provided";
    return str.length > 4 ? `******${str.slice(-4)}` : "****";
}

export function sanitizeCsvCell(val) {
    let text = String(val ?? "");
    if (/^[=+\-@\t\r]/.test(text)) {
        text = `'${text}`;
    }
    if (/[",\n\r]/.test(text)) {
        text = `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

export function buildCSV(headers = [], rows = []) {
    const lines = [headers.map(sanitizeCsvCell).join(",")];
    rows.forEach((row) => {
        lines.push(row.map(sanitizeCsvCell).join(","));
    });
    return lines.join("\r\n");
}

export function downloadCSV(filename, headers, rows) {
    const csv = buildCSV(headers, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Triggers browser print using an inline `#skg-print-report-root` container
 * (avoids `window.open` completely).
 */
export function triggerPrintReport(title, subtitle, bodyHtml) {
    let root = document.getElementById("skg-print-report-root");
    if (!root) {
        root = document.createElement("div");
        root.id = "skg-print-report-root";
        document.body.appendChild(root);
    }
    root.innerHTML = `
      <div class="skg-print-sheet">
        <header class="skg-print-header">
          <div>
            <strong>Siranchowk Khaja Ghar (सिरानचोक खाजा घर)</strong>
            <div>Khairahani-6, Parsa, Chitwan · +977-9821233154</div>
          </div>
          <div style="text-align:right;">
            <div>Generated: ${Utils.escapeHTML(new Date().toLocaleString("en-NP", { timeZone: "Asia/Kathmandu" }))}</div>
          </div>
        </header>
        <h1>${Utils.escapeHTML(title)}</h1>
        <p class="skg-print-sub">${Utils.escapeHTML(subtitle)}</p>
        <div class="skg-print-body">${bodyHtml}</div>
      </div>
    `;
    window.print();
}

export function renderDailyTrendSVG(series = [], valueLabel = "Value") {
    if (!series.length) {
        return '<div class="empty-state"><p class="empty-state-desc">No trend data in the selected date range.</p></div>';
    }
    const width = 640;
    const height = 210;
    const padL = 36;
    const padR = 16;
    const padT = 18;
    const padB = 34;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxVal = Math.max(1, ...series.map((s) => Number(s.value || 0)));

    const stepX = series.length > 1 ? plotW / (series.length - 1) : plotW / 2;
    const coords = series.map((item, idx) => {
        const x = padL + (series.length === 1 ? plotW / 2 : idx * stepX);
        const y = padT + plotH - (Number(item.value || 0) / maxVal) * plotH;
        return { ...item, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    });

    const polyline = coords.map((c) => `${c.x},${c.y}`).join(" ");
    const areaPath = `M ${coords[0].x},${padT + plotH} L ${coords.map((c) => `${c.x},${c.y}`).join(" L ")} L ${coords[coords.length - 1].x},${padT + plotH} Z`;

    const labelStep = Math.max(1, Math.ceil(series.length / 7));

    return `
      <div class="skg-svg-chart-wrap">
        <svg viewBox="0 0 ${width} ${height}" class="skg-svg-chart" role="img" aria-label="${Utils.escapeHTML(valueLabel)} trend chart">
          <defs>
            <linearGradient id="skgAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#087f78" stop-opacity="0.28" />
              <stop offset="100%" stop-color="#087f78" stop-opacity="0.02" />
            </linearGradient>
          </defs>
          <line x1="${padL}" y1="${padT}" x2="${width - padR}" y2="${padT}" stroke="#e2ece9" stroke-dasharray="3 3" />
          <line x1="${padL}" y1="${padT + plotH / 2}" x2="${width - padR}" y2="${padT + plotH / 2}" stroke="#e2ece9" stroke-dasharray="3 3" />
          <line x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" stroke="#cbdcd8" />
          <text x="${padL - 6}" y="${padT + 4}" text-anchor="end" font-size="10" fill="#637b77">${maxVal}</text>
          <text x="${padL - 6}" y="${padT + plotH / 2 + 4}" text-anchor="end" font-size="10" fill="#637b77">${Math.round(maxVal / 2)}</text>
          <text x="${padL - 6}" y="${padT + plotH + 4}" text-anchor="end" font-size="10" fill="#637b77">0</text>
          <path d="${areaPath}" fill="url(#skgAreaGrad)" />
          <polyline fill="none" stroke="#087f78" stroke-width="2.5" stroke-linejoin="round" points="${polyline}" />
          ${coords.map((c, idx) => `
            <circle cx="${c.x}" cy="${c.y}" r="${series.length <= 20 ? 3.5 : 2.5}" fill="#087f78">
              <title>${Utils.escapeHTML(c.label)}: ${Utils.escapeHTML(c.value)}</title>
            </circle>
            ${idx % labelStep === 0 || idx === coords.length - 1
                ? `<text x="${c.x}" y="${height - 10}" text-anchor="middle" font-size="10" fill="#5d7470">${Utils.escapeHTML(String(c.label).slice(5))}</text>`
                : ""}
          `).join("")}
        </svg>
      </div>
    `;
}

export function renderBarChartSVG(items = [], ariaLabel = "Bar chart") {
    if (!items.length) {
        return '<div class="empty-state"><p class="empty-state-desc">No bar chart data in the selected period.</p></div>';
    }
    const width = 640;
    const height = 210;
    const padL = 36;
    const padR = 16;
    const padT = 18;
    const padB = 36;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxVal = Math.max(1, ...items.map((i) => Number(i.value || 0)));
    const slotW = plotW / items.length;
    const barW = Math.min(34, Math.max(8, slotW * 0.64));
    const labelStep = Math.max(1, Math.ceil(items.length / 8));

    return `
      <div class="skg-svg-chart-wrap">
        <svg viewBox="0 0 ${width} ${height}" class="skg-svg-chart" role="img" aria-label="${Utils.escapeHTML(ariaLabel)}">
          <line x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" stroke="#cbdcd8" />
          <text x="${padL - 6}" y="${padT + 6}" text-anchor="end" font-size="10" fill="#637b77">${maxVal}</text>
          <text x="${padL - 6}" y="${padT + plotH + 4}" text-anchor="end" font-size="10" fill="#637b77">0</text>
          ${items.map((item, idx) => {
              const h = (Number(item.value || 0) / maxVal) * plotH;
              const x = padL + idx * slotW + (slotW - barW) / 2;
              const y = padT + plotH - h;
              return `
                <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="4" fill="#087f78">
                  <title>${Utils.escapeHTML(item.label)}: ${Utils.escapeHTML(item.value)}</title>
                </rect>
                ${idx % labelStep === 0 || idx === items.length - 1
                    ? `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="10" fill="#5d7470">${Utils.escapeHTML(String(item.label).slice(0, 10))}</text>`
                    : ""}
              `;
          }).join("")}
        </svg>
      </div>
    `;
}

export function renderHorizontalBreakdown(mapOrEntries = [], emptyText = "No records yet.") {
    const entries = Array.isArray(mapOrEntries)
        ? mapOrEntries
        : Object.entries(mapOrEntries || {});
    const sorted = entries
        .map(([k, v]) => [String(k || "Unknown"), Number(v || 0)])
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

    if (!sorted.length) {
        return `<p class="form-hint">${Utils.escapeHTML(emptyText)}</p>`;
    }
    const maxVal = Math.max(1, ...sorted.map(([, v]) => v));
    const total = sorted.reduce((s, [, v]) => s + v, 0);

    return `
      <div class="skg-bar-list">
        ${sorted.slice(0, 10).map(([label, val]) => {
            const pctWidth = Math.round((val / maxVal) * 100);
            const pctShare = total > 0 ? Math.round((val / total) * 100) : 0;
            return `
              <div class="skg-bar-row">
                <div class="skg-bar-label">
                  <span>${Utils.escapeHTML(label)}</span>
                  <strong>${Utils.escapeHTML(val)} <small class="form-hint">(${pctShare}%)</small></strong>
                </div>
                <div class="skg-bar-track"><div class="skg-bar-fill" style="width:${pctWidth}%;"></div></div>
              </div>
            `;
        }).join("")}
      </div>
    `;
}

export function paginateList(items = [], page = 1, pageSize = 20) {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.max(1, Math.min(totalPages, Number(page || 1)));
    const startIdx = (safePage - 1) * pageSize;
    return {
        page: safePage,
        pageSize,
        total,
        totalPages,
        items: items.slice(startIdx, startIdx + pageSize)
    };
}

export function renderPaginationBar(pager, idPrefix = "pager") {
    if (!pager || pager.total <= pager.pageSize) return "";
    return `
      <div class="skg-pagination-bar" data-pager-prefix="${Utils.escapeHTML(idPrefix)}">
        <span class="form-hint">Showing page ${pager.page} of ${pager.totalPages} (${pager.total} records)</span>
        <div class="skg-table-actions">
          <button type="button" class="btn btn-sm btn-secondary" data-page-nav="prev" ${pager.page <= 1 ? "disabled" : ""}>← Previous</button>
          <button type="button" class="btn btn-sm btn-secondary" data-page-nav="next" ${pager.page >= pager.totalPages ? "disabled" : ""}>Next →</button>
        </div>
      </div>
    `;
}

export async function fetchIndexedSince(path, indexField = "timestamp", minMs = 0) {
    try {
        if (minMs > 0) {
            const snap = await get(query(ref(db, path), orderByChild(indexField), startAt(minMs)));
            return snap.exists() ? Object.values(snap.val() || {}) : [];
        }
        const snap = await get(ref(db, path));
        return snap.exists() ? Object.values(snap.val() || {}) : [];
    } catch {
        const fallbackSnap = await get(ref(db, path)).catch(() => null);
        return fallbackSnap && fallbackSnap.exists() ? Object.values(fallbackSnap.val() || {}) : [];
    }
}

export function renderDateFilterBar(state = {}, showCustom = true) {
    const p = state.preset || "7d";
    return `
      <div class="skg-date-filter-bar">
        <div class="skg-preset-pills">
          ${[
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["7d", "Last 7 Days"],
              ["30d", "Last 30 Days"],
              ["this_month", "This Month"],
              ["prev_month", "Previous Month"],
              ["90d", "Last 90 Days"],
              ...(showCustom ? [["custom", "Custom Range"]] : [])
          ].map(([key, label]) => `
            <button type="button" class="btn btn-sm ${p === key ? "btn-primary" : "btn-secondary"}" data-date-preset="${key}">${label}</button>
          `).join("")}
        </div>
        ${showCustom && p === "custom" ? `
          <div class="skg-custom-dates">
            <input type="date" id="skg-custom-start" value="${Utils.escapeHTML(state.customStart || "")}" aria-label="Start date">
            <span>to</span>
            <input type="date" id="skg-custom-end" value="${Utils.escapeHTML(state.customEnd || "")}" aria-label="End date">
            <button type="button" class="btn btn-sm btn-primary" id="skg-apply-custom-dates">Apply</button>
          </div>
        ` : ""}
      </div>
    `;
}
