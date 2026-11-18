// ============================================================================
// SIRANCHOWK KHAJA GHAR — CUSTOMER CUSTOM ANNOUNCEMENTS MODULE (MODULE 6)
// ============================================================================
// Separate section for promotional/business customer announcements with:
// - Audience targeting (Opted-in, Active 30d, Repeat Buyers, Account Feed Only)
// - Optional schedule timestamp (honest 'scheduled' state + manual dispatch trigger)
// - Live preview before confirmation
// - Mandatory confirmation dialog & honest delivery tracking
// ============================================================================

import { db, ref, get, push, set, update } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { getPublicPushConfig, dispatchWorkerPush } from "../../js/notifications-client.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { recordNotificationHistory } from "../../js/activity-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

const AUDIENCE_LABELS = {
    opted_in: "All Opted-In Customers (offersOptIn)",
    active_30d: "Active Opted-In Customers (Last 30 Days)",
    repeat_buyers: "Repeat Buyer Opted-In Customers (2+ Orders)",
    all_in_app_feed: "Account Announcement Feed Only (No Push)"
};

export const CustomerAnnouncementsModule = {
    async render(container) {
        if (!hasPermission("sendCustomerCampaigns")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">Customer Announcements require the Send Customer Campaigns permission.</p></section>';
            return;
        }

        const session = getAdminSession();
        container.innerHTML = '<div class="skg-admin-loading">Loading customer announcements &amp; audience summary…</div>';

        const [annSnap, usersSnap, ordersSnap, pushConfig] = await Promise.all([
            get(ref(db, "announcements/customer")).catch(() => null),
            get(ref(db, "users")).catch(() => null),
            get(ref(db, "orders")).catch(() => null),
            getPublicPushConfig()
        ]);

        const rawUsers = usersSnap && usersSnap.exists() ? (usersSnap.val() || {}) : {};
        const rawOrders = ordersSnap && ordersSnap.exists() ? (ordersSnap.val() || {}) : {};
        const orderCountsByUid = new Map();
        Object.values(rawOrders).forEach((o) => {
            if (o?.customerUid) {
                orderCountsByUid.set(o.customerUid, (orderCountsByUid.get(o.customerUid) || 0) + 1);
            }
        });

        const nowMs = Date.now();
        const thirtyDaysAgo = nowMs - 30 * 24 * 60 * 60 * 1000;

        const computeAudienceUids = (audienceKey) => {
            const uids = [];
            Object.entries(rawUsers).forEach(([uid, rec]) => {
                const profile = rec?.profile || {};
                const offersOptIn = Boolean(profile?.notificationPreferences?.offersOptIn);
                if (!offersOptIn) return;
                const lastActive = Number(profile.lastActiveAt || profile.lastLoginAt || profile.createdAt || 0);
                const ordCount = orderCountsByUid.get(uid) || (rec?.orders ? Object.keys(rec.orders).length : 0);

                if (audienceKey === "active_30d" && lastActive < thirtyDaysAgo) return;
                if (audienceKey === "repeat_buyers" && ordCount < 2) return;
                uids.push(uid);
            });
            return uids;
        };

        const optedInCount = computeAudienceUids("opted_in").length;
        const active30Count = computeAudienceUids("active_30d").length;
        const repeatCount = computeAudienceUids("repeat_buyers").length;

        let campaigns = annSnap && annSnap.exists()
            ? Object.entries(annSnap.val() || {}).map(([id, item]) => ({ id, ...(item || {}) }))
                .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
            : [];

        const executeCampaignDispatch = async (campaign) => {
            const sendPush = campaign.audience !== "all_in_app_feed";
            let notifStatus = "created";
            let targetedCount = 0;
            let sentCount = 0;
            let failedCount = 0;
            let deliveryResults = [];
            let failureDetails = "";

            if (sendPush && pushConfig.workerUrl && session?.user) {
                try {
                    const authToken = await session.user.getIdToken();
                    const targetUids = computeAudienceUids(campaign.audience || "opted_in");
                    const res = await dispatchWorkerPush({
                        workerUrl: pushConfig.workerUrl,
                        authToken,
                        payload: {
                            type: "customer_campaign",
                            title: campaign.title,
                            body: campaign.body,
                            targetUids
                        }
                    });
                    targetedCount = res.targeted;
                    sentCount = res.sentToProvider;
                    failedCount = res.failed;
                    deliveryResults = res.deliveryResults || [];
                    if (sentCount > 0) notifStatus = "sent_to_provider";
                    else if (targetedCount > 0 && failedCount === targetedCount) notifStatus = "failed";
                } catch (err) {
                    notifStatus = "failed";
                    failureDetails = String(err?.message || "Worker push error").slice(0, 180);
                }
            } else if (sendPush && !pushConfig.workerUrl) {
                failureDetails = "Saved to Customer Account feed (Push Worker URL not configured).";
            }

            await update(ref(db, `announcements/customer/${campaign.id}`), {
                active: true,
                status: notifStatus,
                dispatchedAt: Date.now(),
                targetedCount,
                sentCount,
                failedCount,
                failureDetails
            });

            await recordNotificationHistory("campaigns", {
                id: campaign.id,
                title: campaign.title,
                message: campaign.body,
                type: campaign.badge || "Promotional Announcement",
                targetAudience: AUDIENCE_LABELS[campaign.audience] || campaign.audience || "opted_in",
                status: notifStatus,
                actorUid: session?.user?.uid || "system",
                failureDetails,
                targetedCount,
                sentCount,
                failedCount,
                deliveryResults
            });

            return { notifStatus, targetedCount, sentCount, failedCount, failureDetails };
        };

        const draw = () => {
            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">Customer Announcements &amp; Campaigns</h2>
                      <p class="card-subtitle">Compose promotional offers, kitchen notices, or holiday hours updates. Pushes strictly respect customer opt-in preferences.</p>
                    </div>
                    <span class="badge ${pushConfig.workerUrl ? "badge-success" : "badge-warning"}">
                      ${pushConfig.workerUrl ? "Worker Push Ready" : "Account Feed Mode (Configure Worker in Settings)"}
                    </span>
                  </div>

                  <div class="metrics-grid" style="margin-bottom:16px;">
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Opted-In Customers</span><span class="metric-value">${optedInCount}</span><span class="metric-subtext">offersOptIn enabled</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Active 30d Opt-In</span><span class="metric-value">${active30Count}</span><span class="metric-subtext">Recently active subscribers</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Repeat Buyer Opt-In</span><span class="metric-value">${repeatCount}</span><span class="metric-subtext">2+ orders placed</span></div></div>
                    <div class="metric-card"><div class="metric-info"><span class="metric-label">Total Campaigns</span><span class="metric-value">${campaigns.length}</span><span class="metric-subtext">Published &amp; scheduled</span></div></div>
                  </div>

                  <div class="skg-overview-split">
                    <form id="skg-ca-form" class="skg-stack-form">
                      <div class="form-group">
                        <label class="form-label" for="ca-title">Announcement Title *</label>
                        <input class="form-control" id="ca-title" type="text" required maxlength="90" placeholder="e.g., Fresh Buff &amp; Chicken Momo Special Today">
                      </div>
                      <div class="skg-modal-row">
                        <div class="form-group">
                          <label class="form-label" for="ca-badge">Category / Tag</label>
                          <select class="form-control" id="ca-badge">
                            <option value="Offer">Promotional Offer</option>
                            <option value="Kitchen Update">Kitchen Update</option>
                            <option value="Seasonal Special">Seasonal Special</option>
                            <option value="Schedule Notice">Hours / Holiday Notice</option>
                          </select>
                        </div>
                        <div class="form-group">
                          <label class="form-label" for="ca-audience">Target Audience</label>
                          <select class="form-control" id="ca-audience">
                            <option value="opted_in">Opted-In Customers (${optedInCount})</option>
                            <option value="active_30d">Active Last 30d Opt-In (${active30Count})</option>
                            <option value="repeat_buyers">Repeat Buyers Opt-In (${repeatCount})</option>
                            <option value="all_in_app_feed">Account Announcement Feed Only (No Push)</option>
                          </select>
                        </div>
                      </div>
                      <div class="form-group">
                        <label class="form-label" for="ca-body">Announcement Message *</label>
                        <textarea class="form-control" id="ca-body" required maxlength="320" placeholder="Write the clear message customers will read..."></textarea>
                      </div>
                      <div class="form-group">
                        <label class="form-label" for="ca-schedule">Schedule Dispatch Time (Optional — leave blank to send immediately)</label>
                        <input class="form-control" id="ca-schedule" type="datetime-local">
                        <span class="form-hint">Scheduled notices are queued honestly and can be triggered from the history list below when ready.</span>
                      </div>
                      <div class="skg-quick-actions">
                        <button type="submit" class="btn btn-primary" id="ca-submit-btn">Preview &amp; Confirm Announcement</button>
                      </div>
                    </form>

                    <div>
                      <h3 class="card-title" style="margin-bottom:8px;">Live Customer Preview</h3>
                      <p class="form-hint" style="margin-bottom:12px;">Preview of how this announcement appears in Customer Account &amp; Push Notifications.</p>
                      <article class="card" style="background:var(--surface-muted); border-style:dashed;">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
                          <strong id="ca-prev-title">Your Announcement Title</strong>
                          <span class="badge badge-info" id="ca-prev-badge">Offer</span>
                        </div>
                        <p id="ca-prev-body" style="color:var(--text-secondary);font-size:0.88rem;line-height:1.5;margin-bottom:8px;">Write a message on the left to preview customer rendering before sending.</p>
                        <div class="form-hint" id="ca-prev-meta">Audience: Opted-In Customers · Dispatch: Immediate</div>
                      </article>
                    </div>
                  </div>
                </section>

                <section class="card">
                  <div class="card-header">
                    <div>
                      <h3 class="card-title">Announcement History &amp; Delivery Results (${campaigns.length})</h3>
                      <p class="card-subtitle">Status values reflect actual provider acceptance (<code>sent_to_provider</code>) or feed storage (<code>created</code>).</p>
                    </div>
                    <button type="button" class="btn btn-secondary" id="skg-ca-refresh">↻ Refresh</button>
                  </div>

                  ${campaigns.length === 0 ? `
                    <div class="empty-state">
                      <div class="empty-state-icon">📣</div>
                      <h3 class="empty-state-title">No Customer Announcements Yet</h3>
                      <p class="empty-state-desc">Create an announcement above to reach opted-in customers.</p>
                    </div>
                  ` : `
                    <div class="table-responsive">
                      <table class="data-table">
                        <thead>
                          <tr>
                            <th>Created (NPT)</th>
                            <th>Title &amp; Message</th>
                            <th>Audience</th>
                            <th>Status</th>
                            <th>Delivery Count</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${campaigns.map((c) => {
                              const st = c.status || (c.active ? "created" : "scheduled");
                              const badgeCls = st === "failed" ? "badge-danger" : (st === "sent_to_provider" ? "badge-success" : "badge-info");
                              return `
                                <tr>
                                  <td style="white-space:nowrap;">${Utils.escapeHTML(Utils.formatDate(c.createdAt))}</td>
                                  <td>
                                    <strong>${Utils.escapeHTML(c.title)}</strong>
                                    ${c.badge ? `<span class="badge badge-info" style="margin-left:6px;">${Utils.escapeHTML(c.badge)}</span>` : ""}
                                    <div class="form-hint">${Utils.escapeHTML(c.body)}</div>
                                  </td>
                                  <td>${Utils.escapeHTML(AUDIENCE_LABELS[c.audience] || c.audience || "Opted-in")}</td>
                                  <td>
                                    <span class="badge ${badgeCls}">${Utils.escapeHTML(st)}</span>
                                    ${c.scheduledFor && st === "scheduled" ? `<div class="form-hint">For: ${Utils.escapeHTML(Utils.formatDate(c.scheduledFor))}</div>` : ""}
                                  </td>
                                  <td>
                                    ${c.targetedCount ? `${c.sentCount || 0} sent / ${c.targetedCount} targeted (${c.failedCount || 0} failed)` : (c.failureDetails ? Utils.escapeHTML(c.failureDetails) : "Feed published")}
                                  </td>
                                  <td>
                                    ${st === "scheduled" ? `<button type="button" class="btn btn-sm btn-primary" data-dispatch-scheduled="${Utils.escapeHTML(c.id)}">Dispatch Now</button>` : '<span class="form-hint">—</span>'}
                                  </td>
                                </tr>
                              `;
                          }).join("")}
                        </tbody>
                      </table>
                    </div>
                  `}
                </section>
              </div>
            `;

            const titleEl = container.querySelector("#ca-title");
            const badgeEl = container.querySelector("#ca-badge");
            const audEl = container.querySelector("#ca-audience");
            const bodyEl = container.querySelector("#ca-body");
            const schedEl = container.querySelector("#ca-schedule");

            const syncPreview = () => {
                const pTitle = container.querySelector("#ca-prev-title");
                const pBadge = container.querySelector("#ca-prev-badge");
                const pBody = container.querySelector("#ca-prev-body");
                const pMeta = container.querySelector("#ca-prev-meta");
                if (pTitle) pTitle.textContent = titleEl?.value.trim() || "Your Announcement Title";
                if (pBadge) pBadge.textContent = badgeEl?.value || "Offer";
                if (pBody) pBody.textContent = bodyEl?.value.trim() || "Write a message on the left to preview customer rendering before sending.";
                if (pMeta) {
                    const audLabel = AUDIENCE_LABELS[audEl?.value] || "Opted-In Customers";
                    const schedLabel = schedEl?.value ? `Scheduled (${schedEl.value.replace("T", " ")})` : "Immediate";
                    pMeta.textContent = `Audience: ${audLabel} · Dispatch: ${schedLabel}`;
                }
            };
            [titleEl, badgeEl, audEl, bodyEl, schedEl].forEach((el) => el?.addEventListener("input", syncPreview));
            [badgeEl, audEl, schedEl].forEach((el) => el?.addEventListener("change", syncPreview));

            container.querySelector("#skg-ca-refresh")?.addEventListener("click", () => this.render(container));

            container.querySelector("#skg-ca-form")?.addEventListener("submit", async (e) => {
                e.preventDefault();
                const title = titleEl?.value.trim();
                const badge = badgeEl?.value || "Offer";
                const audience = audEl?.value || "opted_in";
                const body = bodyEl?.value.trim();
                const schedRaw = schedEl?.value || "";
                const scheduledFor = schedRaw ? new Date(schedRaw).getTime() : 0;
                const isScheduledFuture = Boolean(scheduledFor && scheduledFor > Date.now() + 30000);

                if (!title || !body) return;

                const confirmed = await UIModule.confirm({
                    title: isScheduledFuture ? "Save Scheduled Announcement?" : "Publish & Send Customer Announcement?",
                    message: isScheduledFuture
                        ? `Queue "${title}" scheduled for ${new Date(scheduledFor).toLocaleString()} targeting ${AUDIENCE_LABELS[audience]}?`
                        : `Publish "${title}" now to ${AUDIENCE_LABELS[audience]}?`,
                    confirmText: isScheduledFuture ? "Save Schedule" : "Confirm & Publish"
                });
                if (!confirmed) return;

                const btn = container.querySelector("#ca-submit-btn");
                if (btn) btn.disabled = true;

                try {
                    const now = Date.now();
                    const annRef = push(ref(db, "announcements/customer"));
                    const record = {
                        id: annRef.key,
                        title,
                        badge,
                        body,
                        audience,
                        active: !isScheduledFuture,
                        status: isScheduledFuture ? "scheduled" : "created",
                        ...(isScheduledFuture ? { scheduledFor } : {}),
                        senderUid: session?.user?.uid || "",
                        createdAt: now
                    };
                    await set(annRef, record);

                    if (!isScheduledFuture) {
                        const res = await executeCampaignDispatch(record);
                        record.status = res.notifStatus;
                        record.targetedCount = res.targetedCount;
                        record.sentCount = res.sentCount;
                        record.failedCount = res.failedCount;
                        record.failureDetails = res.failureDetails;
                    } else {
                        await recordNotificationHistory("campaigns", {
                            id: record.id,
                            title: record.title,
                            message: record.body,
                            type: badge,
                            targetAudience: AUDIENCE_LABELS[audience] || audience,
                            status: "queued",
                            actorUid: session?.user?.uid || "system",
                            failureDetails: `Scheduled for ${Utils.formatDate(scheduledFor)}`
                        });
                    }

                    campaigns.unshift(record);
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: isScheduledFuture ? "customer_campaign_scheduled" : "customer_campaign_sent",
                        target: record.id,
                        metadata: { title, audience, status: record.status }
                    });

                    UIModule.showToast(isScheduledFuture ? "Announcement scheduled." : "Customer announcement dispatched.", "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Failed to publish announcement.", "error");
                    if (btn) btn.disabled = false;
                }
            });

            container.querySelectorAll("[data-dispatch-scheduled]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const id = btn.dataset.dispatchScheduled;
                    const campaign = campaigns.find((c) => c.id === id);
                    if (!campaign) return;
                    const ok = await UIModule.confirm({
                        title: "Dispatch Scheduled Announcement Now?",
                        message: `Send "${campaign.title}" now to ${AUDIENCE_LABELS[campaign.audience] || "opted-in customers"}?`,
                        confirmText: "Dispatch Now"
                    });
                    if (!ok) return;
                    btn.disabled = true;
                    try {
                        const res = await executeCampaignDispatch(campaign);
                        campaign.active = true;
                        campaign.status = res.notifStatus;
                        campaign.targetedCount = res.targetedCount;
                        campaign.sentCount = res.sentCount;
                        campaign.failedCount = res.failedCount;
                        campaign.failureDetails = res.failureDetails;
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "customer_campaign_dispatched",
                            target: id,
                            metadata: { title: campaign.title, status: campaign.status }
                        });
                        UIModule.showToast("Scheduled announcement dispatched.", "success");
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Dispatch failed.", "error");
                        btn.disabled = false;
                    }
                });
            });
        };

        draw();
    }
};
