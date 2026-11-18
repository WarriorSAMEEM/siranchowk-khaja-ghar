// ============================================================================
// SIRANCHOWK KHAJA GHAR — REGISTERED USER ACTIVITY TIMELINE MODULE
// ============================================================================

import { db, ref, get } from "../../js/firebase.js";
import { hasPermission } from "./auth.js";
import { Utils } from "./utils.js";
import {
    getDateRangeFromPreset,
    maskEmail,
    paginateList,
    renderPaginationBar,
    renderDateFilterBar
} from "./analytics-utils.js";

const ACTIVITY_LABELS = {
    account_registered: { label: "Account Registered", icon: "🆕", badge: "badge-success" },
    login: { label: "Signed In", icon: "🔓", badge: "badge-info" },
    logout: { label: "Signed Out", icon: "🔒", badge: "badge-warning" },
    product_viewed: { label: "Viewed Dish", icon: "🍽️", badge: "badge-info" },
    add_to_cart: { label: "Added Item to Cart", icon: "🛒", badge: "badge-info" },
    checkout_started: { label: "Opened Checkout", icon: "🧾", badge: "badge-info" },
    order_placed: { label: "Order Placed", icon: "✅", badge: "badge-success" },
    order_status_changed: { label: "Order Status Updated", icon: "📦", badge: "badge-info" },
    coupon_used: { label: "Coupon Applied & Redeemed", icon: "🏷️", badge: "badge-success" },
    whatsapp_order_clicked: { label: "WhatsApp Handoff Clicked", icon: "💬", badge: "badge-info" },
    notification_preferences_updated: { label: "Notification Preferences Updated", icon: "🔔", badge: "badge-warning" },
    profile_updated: { label: "Profile Details Updated", icon: "👤", badge: "badge-info" }
};

export const UserActivityModule = {
    async render(container) {
        if (!hasPermission("viewUserActivity")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Owner Authority Required</h2><p class="card-subtitle">Individual customer activity timelines are restricted to the Owner or explicitly permitted roles.</p></section>';
            return;
        }

        const canSeePII = hasPermission("viewCustomerContactDetails");
        container.innerHTML = '<div class="skg-admin-loading">Loading customer activity timelines…</div>';

        const usersSnap = await get(ref(db, "users")).catch(() => null);
        const rawUsers = usersSnap && usersSnap.exists() ? (usersSnap.val() || {}) : {};

        const customers = Object.entries(rawUsers)
            .map(([uid, rec]) => {
                const profile = rec?.profile || {};
                const actMap = rec?.activity || {};
                const events = Object.values(actMap).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
                return {
                    uid,
                    name: profile.name || "Customer",
                    email: profile.email || "",
                    phone: profile.phone || "",
                    createdAt: profile.createdAt || null,
                    lastActiveAt: profile.lastActiveAt || profile.lastLoginAt || profile.createdAt || null,
                    events
                };
            })
            .sort((a, b) => Number(b.lastActiveAt || 0) - Number(a.lastActiveAt || 0));

        const preselected = window.__SKG_SELECTED_ACTIVITY_UID || "";
        window.__SKG_SELECTED_ACTIVITY_UID = "";

        const state = {
            selectedUid: (preselected && customers.some((c) => c.uid === preselected)) ? preselected : (customers[0]?.uid || ""),
            preset: "30d",
            customStart: "",
            customEnd: "",
            typeFilter: "all",
            search: "",
            page: 1
        };

        const draw = () => {
            const range = getDateRangeFromPreset(state.preset, state.customStart, state.customEnd);
            const selected = customers.find((c) => c.uid === state.selectedUid) || null;
            const q = state.search.trim().toLowerCase();

            const rawEvents = selected ? selected.events : [];
            const filtered = rawEvents.filter((ev) => {
                const ts = Number(ev.timestamp || 0);
                if (ts < range.startMs || ts > range.endMs) return false;
                if (state.typeFilter !== "all" && ev.type !== state.typeFilter) return false;
                if (q) {
                    const hay = `${ev.type} ${JSON.stringify(ev.details || {})} ${ev.sessionId || ""}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });

            const pager = paginateList(filtered, state.page, 20);
            state.page = pager.page;

            const eventTypes = [...new Set(rawEvents.map((e) => e.type).filter(Boolean))];

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">User Activity Timeline</h2>
                      <p class="card-subtitle">Chronological account events recorded strictly while authenticated. Anonymous guest browsing is never merged into customer timelines.</p>
                    </div>
                    <button type="button" class="btn btn-secondary" id="skg-ua-refresh">↻ Refresh</button>
                  </div>

                  ${customers.length === 0 ? `
                    <div class="empty-state">
                      <div class="empty-state-icon">📋</div>
                      <h3 class="empty-state-title">No Registered Customers Yet</h3>
                      <p class="empty-state-desc">Customer activity timelines appear here after users sign up or log in.</p>
                    </div>
                  ` : `
                    <div class="skg-admin-order-toolbar">
                      <select id="skg-ua-customer" aria-label="Select customer">
                        ${customers.map((c) => {
                            const emailLabel = canSeePII ? (c.email || c.uid.slice(0, 8)) : maskEmail(c.email);
                            return `<option value="${Utils.escapeHTML(c.uid)}" ${c.uid === state.selectedUid ? "selected" : ""}>${Utils.escapeHTML(c.name)} (${Utils.escapeHTML(emailLabel)}) — ${c.events.length} events</option>`;
                        }).join("")}
                      </select>
                      <select id="skg-ua-type" aria-label="Filter event type">
                        <option value="all" ${state.typeFilter === "all" ? "selected" : ""}>All Event Types</option>
                        ${eventTypes.map((t) => `<option value="${Utils.escapeHTML(t)}" ${state.typeFilter === t ? "selected" : ""}>${Utils.escapeHTML(ACTIVITY_LABELS[t]?.label || t)}</option>`).join("")}
                      </select>
                      <input type="search" id="skg-ua-search" placeholder="Search event details or order ID" value="${Utils.escapeHTML(state.search)}">
                    </div>

                    ${renderDateFilterBar(state, true)}

                    ${selected ? `
                      <div class="skg-channel-note">
                        <strong>Inspecting:</strong> ${Utils.escapeHTML(selected.name)}
                        (${Utils.escapeHTML(canSeePII ? (selected.email || "No email") : maskEmail(selected.email))}) ·
                        <strong>Last Active:</strong> ${Utils.escapeHTML(selected.lastActiveAt ? Utils.formatDate(selected.lastActiveAt) : "Not recorded")} ·
                        <strong>Events in Range:</strong> ${filtered.length}
                      </div>
                    ` : ""}

                    ${pager.items.length === 0 ? `
                      <div class="empty-state">
                        <div class="empty-state-icon">🕒</div>
                        <h3 class="empty-state-title">No Recorded Events in This Range</h3>
                        <p class="empty-state-desc">Events are recorded when this customer logs in, updates their profile or preferences, adds items to cart, applies coupons, or places orders.</p>
                      </div>
                    ` : `
                      <div class="skg-timeline-list">
                        ${pager.items.map((ev) => {
                            const meta = ACTIVITY_LABELS[ev.type] || { label: ev.type || "Activity", icon: "•", badge: "badge-info" };
                            const detailPairs = ev.details && typeof ev.details === "object"
                                ? Object.entries(ev.details).map(([k, v]) => `<span class="skg-detail-pill"><strong>${Utils.escapeHTML(k)}:</strong> ${Utils.escapeHTML(v)}</span>`).join("")
                                : "";
                            return `
                              <article class="skg-timeline-item">
                                <div class="skg-timeline-icon" aria-hidden="true">${meta.icon}</div>
                                <div class="skg-timeline-content">
                                  <div class="skg-timeline-head">
                                    <div>
                                      <span class="badge ${meta.badge}">${Utils.escapeHTML(meta.label)}</span>
                                      ${ev.sessionId ? `<code class="form-hint" style="margin-left:8px;">${Utils.escapeHTML(ev.sessionId)}</code>` : ""}
                                    </div>
                                    <time class="form-hint">${Utils.escapeHTML(Utils.formatDate(ev.timestamp))}</time>
                                  </div>
                                  ${detailPairs ? `<div class="skg-detail-pills">${detailPairs}</div>` : '<p class="form-hint">No additional metadata recorded.</p>'}
                                </div>
                              </article>
                            `;
                        }).join("")}
                      </div>
                      ${renderPaginationBar(pager, "user-activity")}
                    `}
                  `}
                </section>
              </div>
            `;

            container.querySelector("#skg-ua-customer")?.addEventListener("change", (e) => {
                state.selectedUid = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-ua-type")?.addEventListener("change", (e) => {
                state.typeFilter = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-ua-search")?.addEventListener("input", (e) => {
                state.search = e.target.value;
                state.page = 1;
                draw();
            });
            container.querySelectorAll("[data-date-preset]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    state.preset = btn.dataset.datePreset;
                    state.page = 1;
                    draw();
                });
            });
            container.querySelector("#skg-apply-custom-dates")?.addEventListener("click", () => {
                state.customStart = container.querySelector("#skg-custom-start")?.value || "";
                state.customEnd = container.querySelector("#skg-custom-end")?.value || "";
                state.page = 1;
                draw();
            });
            container.querySelector("#skg-ua-refresh")?.addEventListener("click", () => this.render(container));
            container.querySelectorAll("[data-page-nav]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    if (btn.dataset.pageNav === "prev" && state.page > 1) state.page -= 1;
                    if (btn.dataset.pageNav === "next" && state.page < pager.totalPages) state.page += 1;
                    draw();
                });
            });
        };

        draw();
    }
};
