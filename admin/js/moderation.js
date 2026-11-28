// ============================================================================
// SIRANCHOWK KHAJA GHAR — CONTENT MODERATION & REPORTS QUEUE MODULE
// ============================================================================

import { db, ref, get, set, update, remove, runTransaction } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { getPublicPushConfig } from "../../js/notifications-client.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { logSecurityEvent } from "../../js/activity-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

async function tryWorkerModerate(payload, user) {
    try {
        const { workerUrl } = await getPublicPushConfig();
        if (!workerUrl || !user) return null;
        const token = await user.getIdToken();
        const res = await fetch(workerUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ type: "platform_moderate_content", ...payload })
        });
        if (res.ok) return await res.json().catch(() => ({ ok: true }));
    } catch {
        // Fallback to direct authorized RTDB moderation for Owner/Moderator
    }
    return null;
}

export const ModerationModule = {
    async render(container) {
        const session = getAdminSession();
        if (!hasPermission("moderateContent")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">Only Owner, Admin, and Moderator roles with Content Moderation permission can review reports.</p></section>';
            return;
        }

        container.innerHTML = '<div class="skg-admin-loading">Loading moderation queue &amp; community reports…</div>';

        const [repSnap, pubSnap, modSnap, repostSnap] = await Promise.all([
            get(ref(db, "contentReports")).catch(() => null),
            get(ref(db, "publishedArticles")).catch(() => null),
            get(ref(db, "moderatedArticles")).catch(() => null),
            get(ref(db, "articleReposts")).catch(() => null)
        ]);

        let reports = repSnap?.exists()
            ? Object.entries(repSnap.val() || {}).map(([id, r]) => ({ id, ...(r || {}) }))
            : [];
        reports.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

        let published = pubSnap?.exists()
            ? Object.entries(pubSnap.val() || {}).map(([id, a]) => ({ id, ...(a || {}) }))
            : [];
        published.sort((a, b) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0));

        let moderated = modSnap?.exists()
            ? Object.entries(modSnap.val() || {}).map(([id, a]) => ({ id, ...(a || {}) }))
            : [];
        moderated.sort((a, b) => Number(b.moderatedAt || 0) - Number(a.moderatedAt || 0));

        let reposts = repostSnap?.exists()
            ? Object.entries(repostSnap.val() || {}).map(([id, r]) => ({ id, ...(r || {}) }))
            : [];
        reposts.sort((a, b) => Number(b.repostedAt || 0) - Number(a.repostedAt || 0));

        const state = {
            tab: "reports",
            reportFilter: "open",
            search: ""
        };

        const runAction = async ({ action, targetId = "", parentId = "", reportId = "", reason = "Policy moderation action" }) => {
            const now = Date.now();
            const workerRes = await tryWorkerModerate({ action, targetId, parentId, reportId, reason }, session?.user);

            if (!workerRes?.ok) {
                if (action === "hide_article" && targetId) {
                    const art = published.find((a) => a.id === targetId);
                    if (art) {
                        const modCopy = {
                            ...art,
                            status: "hidden",
                            moderatedAt: now,
                            moderatedByUid: session?.user?.uid || "",
                            moderationReason: reason
                        };
                        await set(ref(db, `moderatedArticles/${targetId}`), modCopy);
                        await remove(ref(db, `publishedArticles/${targetId}`));
                        published = published.filter((a) => a.id !== targetId);
                        moderated.unshift(modCopy);
                    }
                } else if (action === "restore_article" && targetId) {
                    const mod = moderated.find((a) => a.id === targetId);
                    if (mod) {
                        const restored = { ...mod, status: "published", updatedAt: now };
                        delete restored.moderatedAt;
                        delete restored.moderatedByUid;
                        delete restored.moderationReason;
                        delete restored.deletedAt;
                        delete restored.recoverableUntil;
                        await set(ref(db, `publishedArticles/${targetId}`), restored);
                        await remove(ref(db, `moderatedArticles/${targetId}`));
                        moderated = moderated.filter((a) => a.id !== targetId);
                        published.unshift(restored);
                    }
                } else if (action === "delete_comment" && parentId && targetId) {
                    await remove(ref(db, `articleComments/${parentId}/${targetId}`));
                    await runTransaction(ref(db, `publishedArticles/${parentId}/commentsCount`), (c) => Math.max(0, Number(c || 0) - 1)).catch(() => {});
                } else if (action === "delete_repost" && targetId) {
                    await remove(ref(db, `articleReposts/${targetId}`));
                    reposts = reposts.filter((r) => r.id !== targetId);
                } else if (action === "suspend_profile" && targetId) {
                    await update(ref(db, `publicProfiles/${targetId}`), {
                        creatorStatus: "suspended",
                        updatedAt: now
                    });
                } else if (action === "restore_profile" && targetId) {
                    await update(ref(db, `publicProfiles/${targetId}`), {
                        creatorStatus: "approved",
                        updatedAt: now
                    });
                }

                if (reportId) {
                    await update(ref(db, `contentReports/${reportId}`), {
                        status: action === "dismiss_report" ? "dismissed" : "resolved",
                        resolutionAction: action,
                        resolutionNote: reason,
                        resolvedByUid: session?.user?.uid || "",
                        resolvedAt: now
                    });
                }
            } else {
                if (action === "hide_article") {
                    const art = published.find((a) => a.id === targetId);
                    if (art) {
                        published = published.filter((a) => a.id !== targetId);
                        moderated.unshift({ ...art, status: "hidden", moderatedAt: now, moderationReason: reason });
                    }
                } else if (action === "restore_article") {
                    const mod = moderated.find((a) => a.id === targetId);
                    if (mod) {
                        moderated = moderated.filter((a) => a.id !== targetId);
                        published.unshift({ ...mod, status: "published", updatedAt: now });
                    }
                } else if (action === "delete_repost") {
                    reposts = reposts.filter((r) => r.id !== targetId);
                }
            }

            if (reportId) {
                const rep = reports.find((r) => r.id === reportId);
                if (rep) {
                    rep.status = action === "dismiss_report" ? "dismissed" : "resolved";
                    rep.resolutionAction = action;
                    rep.resolutionNote = reason;
                    rep.resolvedAt = now;
                }
            }

            await logAuditEvent({
                actorUid: session?.user?.uid,
                actorName: session?.staff?.name,
                actorEmail: session?.user?.email,
                actorRole: session?.role,
                action: `content_moderation_${action}`,
                target: targetId || reportId,
                metadata: { action, parentId, reportId, reason }
            });
            await logSecurityEvent({
                eventType: "content_moderated",
                severity: "warning",
                actorUid: session?.user?.uid,
                actorEmail: session?.user?.email,
                actorRole: session?.role,
                target: `${action}:${targetId || reportId}`,
                details: { action, parentId, reportId, reason }
            });
        };

        const draw = () => {
            const q = state.search.trim().toLowerCase();
            const openCount = reports.filter((r) => (r.status || "open") === "open").length;

            const filteredReports = reports.filter((r) => {
                if (state.reportFilter !== "all" && (r.status || "open") !== state.reportFilter) return false;
                if (q) {
                    const hay = `${r.targetType || ""} ${r.targetId || ""} ${r.reason || ""} ${r.details || ""} ${r.reporterUid || ""}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });

            const filteredPublished = published.filter((a) => !q || `${a.title || ""} ${a.slug || ""} ${a.authorName || ""}`.toLowerCase().includes(q));
            const filteredModerated = moderated.filter((a) => !q || `${a.title || ""} ${a.slug || ""} ${a.authorName || ""}`.toLowerCase().includes(q));
            const filteredReposts = reposts.filter((r) => !q || `${r.originalTitle || ""} ${r.repostedByName || ""} ${r.note || ""}`.toLowerCase().includes(q));

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">Content Moderation &amp; Safety Queue</h2>
                      <p class="card-subtitle">Review user reports, move policy-violating articles out of public feeds, remove abusive comments/reposts, and restore cleared articles.</p>
                    </div>
                    <span class="badge ${openCount > 0 ? "badge-warning" : "badge-success"}">${openCount} Open Report${openCount === 1 ? "" : "s"}</span>
                  </div>

                  <div class="skg-tabs" role="tablist">
                    <button type="button" class="skg-tab ${state.tab === "reports" ? "active" : ""}" data-mod-tab="reports">Reports Queue (${reports.length})</button>
                    <button type="button" class="skg-tab ${state.tab === "articles" ? "active" : ""}" data-mod-tab="articles">Published &amp; Hidden (${published.length} / ${moderated.length})</button>
                    <button type="button" class="skg-tab ${state.tab === "reposts" ? "active" : ""}" data-mod-tab="reposts">Reposts (${reposts.length})</button>
                  </div>

                  <div class="skg-admin-order-toolbar">
                    <input type="search" id="skg-mod-search" placeholder="Search title, reason, target ID, or author…" value="${Utils.escapeHTML(state.search)}">
                    ${state.tab === "reports" ? `
                      <select class="form-control" id="skg-mod-status" style="max-width:200px;">
                        <option value="open" ${state.reportFilter === "open" ? "selected" : ""}>Open Reports</option>
                        <option value="resolved" ${state.reportFilter === "resolved" ? "selected" : ""}>Resolved</option>
                        <option value="dismissed" ${state.reportFilter === "dismissed" ? "selected" : ""}>Dismissed</option>
                        <option value="all" ${state.reportFilter === "all" ? "selected" : ""}>All Reports</option>
                      </select>
                    ` : ""}
                  </div>

                  ${state.tab === "reports" ? `
                    ${filteredReports.length === 0 ? `
                      <div class="empty-state">
                        <div class="empty-state-icon">🛡</div>
                        <h3 class="empty-state-title">No ${Utils.escapeHTML(state.reportFilter)} Reports</h3>
                        <p class="empty-state-desc">When readers report articles, comments, or profiles, actionable tickets appear here.</p>
                      </div>
                    ` : `
                      <div class="table-responsive">
                        <table class="data-table">
                          <thead>
                            <tr>
                              <th>Submitted</th>
                              <th>Target</th>
                              <th>Reason &amp; Details</th>
                              <th>Status</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${filteredReports.map((r) => {
                                const st = r.status || "open";
                                const badgeCls = st === "open" ? "badge-warning" : st === "resolved" ? "badge-success" : "badge-info";
                                let primaryAction = "";
                                if (r.targetType === "article") primaryAction = "hide_article";
                                else if (r.targetType === "comment") primaryAction = "delete_comment";
                                else if (r.targetType === "repost") primaryAction = "delete_repost";
                                else if (r.targetType === "profile") primaryAction = "suspend_profile";

                                return `
                                  <tr>
                                    <td style="white-space:nowrap;">${Utils.escapeHTML(Utils.formatDate(r.createdAt))}</td>
                                    <td>
                                      <span class="badge badge-info">${Utils.escapeHTML(r.targetType)}</span>
                                      <div class="form-hint"><code>${Utils.escapeHTML(r.targetId)}</code></div>
                                      ${r.parentId ? `<div class="form-hint">Parent: <code>${Utils.escapeHTML(r.parentId)}</code></div>` : ""}
                                    </td>
                                    <td>
                                      <strong>${Utils.escapeHTML(r.reason)}</strong>
                                      ${r.details ? `<div class="form-hint">${Utils.escapeHTML(r.details)}</div>` : ""}
                                      <div class="form-hint">Reporter: <code>${Utils.escapeHTML((r.reporterUid || "").slice(0, 12))}</code></div>
                                    </td>
                                    <td><span class="badge ${badgeCls}">${Utils.escapeHTML(st)}</span></td>
                                    <td>
                                      ${st === "open" ? `
                                        <div class="skg-table-actions">
                                          ${primaryAction ? `<button type="button" class="btn btn-sm btn-danger" data-mod-act="${Utils.escapeHTML(primaryAction)}" data-target="${Utils.escapeHTML(r.targetId)}" data-parent="${Utils.escapeHTML(r.parentId || "")}" data-report="${Utils.escapeHTML(r.id)}">Take Action</button>` : ""}
                                          <button type="button" class="btn btn-sm btn-secondary" data-mod-act="dismiss_report" data-target="${Utils.escapeHTML(r.targetId)}" data-report="${Utils.escapeHTML(r.id)}">Dismiss</button>
                                        </div>
                                      ` : `<span class="form-hint">${Utils.escapeHTML(r.resolutionAction || st)}</span>`}
                                    </td>
                                  </tr>
                                `;
                            }).join("")}
                          </tbody>
                        </table>
                      </div>
                    `}
                  ` : ""}

                  ${state.tab === "articles" ? `
                    <h3 style="margin:0.5rem 0 0.75rem;">Hidden / Moderated Articles (${filteredModerated.length})</h3>
                    ${filteredModerated.length === 0 ? `<p class="form-hint">No articles are currently hidden by moderation.</p>` : `
                      <div class="table-responsive" style="margin-bottom:1.5rem;">
                        <table class="data-table">
                          <thead><tr><th>Article</th><th>Author</th><th>Reason</th><th>Action</th></tr></thead>
                          <tbody>
                            ${filteredModerated.map((a) => `
                              <tr>
                                <td><strong>${Utils.escapeHTML(a.title)}</strong><div class="form-hint"><code>/blog/${Utils.escapeHTML(a.slug)}</code></div></td>
                                <td>${Utils.escapeHTML(a.authorName || a.authorUsername || a.authorUid)}</td>
                                <td>${Utils.escapeHTML(a.moderationReason || "Moderated")}</td>
                                <td><button type="button" class="btn btn-sm btn-primary" data-mod-act="restore_article" data-target="${Utils.escapeHTML(a.id)}">Restore Article</button></td>
                              </tr>
                            `).join("")}
                          </tbody>
                        </table>
                      </div>
                    `}

                    <h3 style="margin:0.5rem 0 0.75rem;">Published Articles (${filteredPublished.length})</h3>
                    <div class="table-responsive">
                      <table class="data-table">
                        <thead><tr><th>Title</th><th>Author</th><th>Metrics</th><th>Action</th></tr></thead>
                        <tbody>
                          ${filteredPublished.map((a) => `
                            <tr>
                              <td><strong>${Utils.escapeHTML(a.title)}</strong><div class="form-hint"><code>/blog/${Utils.escapeHTML(a.slug)}</code></div></td>
                              <td>${Utils.escapeHTML(a.authorName || a.authorUsername || a.authorUid)}</td>
                              <td>${Number(a.viewsCount || 0)} views · ${Number(a.likesCount || 0)} likes · ${Number(a.commentsCount || 0)} comments</td>
                              <td><button type="button" class="btn btn-sm btn-danger" data-mod-act="hide_article" data-target="${Utils.escapeHTML(a.id)}">Hide Article</button></td>
                            </tr>
                          `).join("")}
                        </tbody>
                      </table>
                    </div>
                  ` : ""}

                  ${state.tab === "reposts" ? `
                    ${filteredReposts.length === 0 ? `<p class="form-hint">No community reposts recorded yet.</p>` : `
                      <div class="table-responsive">
                        <table class="data-table">
                          <thead><tr><th>Reposted By</th><th>Original Article</th><th>Note</th><th>Action</th></tr></thead>
                          <tbody>
                            ${filteredReposts.map((r) => `
                              <tr>
                                <td><strong>${Utils.escapeHTML(r.repostedByName || r.repostedByUsername)}</strong></td>
                                <td>${Utils.escapeHTML(r.originalTitle || r.originalArticleId)}<div class="form-hint">Author: ${Utils.escapeHTML(r.originalAuthorName || r.originalAuthorUsername)}</div></td>
                                <td>${Utils.escapeHTML(r.note || "—")}</td>
                                <td><button type="button" class="btn btn-sm btn-danger" data-mod-act="delete_repost" data-target="${Utils.escapeHTML(r.id)}">Remove Repost</button></td>
                              </tr>
                            `).join("")}
                          </tbody>
                        </table>
                      </div>
                    `}
                  ` : ""}
                </section>
              </div>
            `;

            container.querySelectorAll("[data-mod-tab]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    state.tab = btn.dataset.modTab;
                    draw();
                });
            });
            container.querySelector("#skg-mod-search")?.addEventListener("input", (e) => {
                state.search = e.target.value;
                draw();
            });
            container.querySelector("#skg-mod-status")?.addEventListener("change", (e) => {
                state.reportFilter = e.target.value;
                draw();
            });
            container.querySelectorAll("[data-mod-act]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const action = btn.dataset.modAct;
                    const targetId = btn.dataset.target || "";
                    const parentId = btn.dataset.parent || "";
                    const reportId = btn.dataset.report || "";
                    const ok = await UIModule.confirm({
                        title: `Confirm ${action.replace(/_/g, " ")}?`,
                        message: "This moderation update takes effect immediately and writes an immutable audit log entry.",
                        confirmText: "Confirm Action",
                        dangerous: action !== "dismiss_report" && action !== "restore_article"
                    });
                    if (!ok) return;
                    btn.disabled = true;
                    try {
                        await runAction({
                            action,
                            targetId,
                            parentId,
                            reportId,
                            reason: `Moderated by ${session?.staff?.name || session?.user?.email || "Staff"}`
                        });
                        UIModule.showToast("Moderation action completed.", "success");
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Moderation action failed.", "error");
                        btn.disabled = false;
                    }
                });
            });
        };

        draw();
    }
};
