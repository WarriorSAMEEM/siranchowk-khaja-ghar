// ============================================================================
// SIRANCHOWK KHAJA GHAR — ADMIN CREATORS & 4-TYPE VERIFICATION BADGES MODULE
// ============================================================================

import { db, ref, get, set, update } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { BADGE_DEFINITIONS, renderProfileBadgesHtml } from "../../js/badges.js";
import { DEFAULT_PUBLIC_PROFILES } from "../../js/platform-core.js";
import { getPublicPushConfig } from "../../js/notifications-client.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { logSecurityEvent } from "../../js/activity-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

const ADMIN_BADGE_TYPES = ["verifiedCreator", "officialOrg", "expertSpecialist"];

async function tryWorkerAdminCall(payload, user) {
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
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            return await res.json().catch(() => ({ ok: true }));
        }
    } catch {
        // Fallback to direct authorized RTDB write for Owner/Admin
    }
    return null;
}

export const CreatorsModule = {
    async render(container) {
        const session = getAdminSession();
        const canCreators = hasPermission("manageCreators");
        const canBadges = hasPermission("manageBadges");

        if (!canCreators && !canBadges) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">You do not have Creator or Verification Badge permissions.</p></section>';
            return;
        }

        container.innerHTML = '<div class="skg-admin-loading">Loading creator applications &amp; verification badges…</div>';

        const [appSnap, profSnap, auditSnap] = await Promise.all([
            canCreators ? get(ref(db, "creatorApplications")).catch(() => null) : Promise.resolve(null),
            get(ref(db, "publicProfiles")).catch(() => null),
            canBadges ? get(ref(db, "badgeAuditLogs")).catch(() => null) : Promise.resolve(null)
        ]);

        const applications = appSnap?.exists()
            ? Object.entries(appSnap.val() || {}).map(([uid, item]) => ({ uid, ...(item || {}) }))
            : [];
        applications.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));

        const profileMap = { ...DEFAULT_PUBLIC_PROFILES };
        if (profSnap?.exists()) {
            Object.entries(profSnap.val() || {}).forEach(([uid, prof]) => {
                if (prof) profileMap[uid] = { ...(profileMap[uid] || {}), ...prof, uid };
            });
        }
        const profiles = Object.values(profileMap).sort((a, b) => Number(b.joinedAt || 0) - Number(a.joinedAt || 0));

        const badgeLogs = auditSnap?.exists()
            ? Object.entries(auditSnap.val() || {}).map(([id, item]) => ({ id, ...(item || {}) }))
            : [];
        badgeLogs.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

        const state = {
            tab: canCreators ? "applications" : "badges",
            appFilter: "all",
            search: ""
        };

        const applyCreatorDecision = async (appOrUid, decision, reason = "") => {
            const targetUid = typeof appOrUid === "string" ? appOrUid : appOrUid.uid;
            const now = Date.now();
            const workerRes = await tryWorkerAdminCall({
                type: "platform_creator_decision",
                targetUid,
                decision,
                reason
            }, session?.user);

            if (!workerRes?.ok) {
                const appRef = applications.find((a) => a.uid === targetUid);
                if (appRef) {
                    await update(ref(db, `creatorApplications/${targetUid}`), {
                        status: decision,
                        reviewedByUid: session?.user?.uid || "",
                        reviewedByEmail: session?.user?.email || "",
                        reviewNote: reason,
                        reviewedAt: now,
                        updatedAt: now
                    });
                }
                if (profileMap[targetUid]) {
                    await update(ref(db, `publicProfiles/${targetUid}`), {
                        creatorStatus: decision,
                        updatedAt: now
                    });
                }
                const notifId = `notif_${now}_${Math.random().toString(36).slice(2, 8)}`;
                const titleMap = {
                    approved: "Creator Publishing Approved",
                    rejected: "Creator Application Update",
                    suspended: "Creator Publishing Suspended"
                };
                await set(ref(db, `userSocialNotifications/${targetUid}/${notifId}`), {
                    id: notifId,
                    type: "creator_status",
                    title: titleMap[decision] || "Creator Status Update",
                    body: reason || `Your creator publishing status is now ${decision}.`,
                    actorUid: session?.user?.uid || "admin",
                    read: false,
                    createdAt: now
                }).catch(() => {});
            }

            const foundApp = applications.find((a) => a.uid === targetUid);
            if (foundApp) {
                foundApp.status = decision;
                foundApp.reviewNote = reason;
                foundApp.updatedAt = now;
            }
            if (profileMap[targetUid]) {
                profileMap[targetUid].creatorStatus = decision;
            }

            await logAuditEvent({
                actorUid: session?.user?.uid,
                actorName: session?.staff?.name,
                actorEmail: session?.user?.email,
                actorRole: session?.role,
                action: `creator_${decision}`,
                target: targetUid,
                metadata: { reason }
            });
            await logSecurityEvent({
                eventType: `creator_${decision}`,
                severity: decision === "suspended" ? "high" : "info",
                actorUid: session?.user?.uid,
                actorEmail: session?.user?.email,
                actorRole: session?.role,
                target: targetUid,
                details: { decision, reason }
            });
        };

        const applyBadgeAction = async (profile, { badgeType, action, note, specialtyNote }) => {
            if (!ADMIN_BADGE_TYPES.includes(badgeType)) {
                throw new Error("Only Verified Creator, Official Organization, and Domain Specialist badges can be manually granted or revoked.");
            }
            const now = Date.now();
            const active = action === "grant";

            const workerRes = await tryWorkerAdminCall({
                type: "platform_manage_badge",
                targetUid: profile.uid,
                badgeType,
                action,
                note,
                specialtyNote
            }, session?.user);

            if (!workerRes?.ok) {
                const profilePatch = { updatedAt: now };
                if (badgeType === "expertSpecialist") {
                    profilePatch.specialtyNote = active ? (specialtyNote || profile.specialtyNote || "Domain Specialist") : "";
                }
                await Promise.all([
                    update(ref(db, `publicProfiles/${profile.uid}`), profilePatch),
                    update(ref(db, `publicProfiles/${profile.uid}/badges`), { [badgeType]: active }),
                    set(ref(db, `badgeRegistry/${profile.uid}/${badgeType}`), {
                        badgeType,
                        active,
                        specialtyNote: badgeType === "expertSpecialist" ? (specialtyNote || "") : "",
                        grantedByUid: session?.user?.uid || "",
                        updatedAt: now
                    })
                ]);

                const logId = `blog_${now}_${Math.random().toString(36).slice(2, 8)}`;
                const auditEntry = {
                    id: logId,
                    targetUid: profile.uid,
                    targetUsername: profile.username || "",
                    badgeType,
                    action,
                    note: note || specialtyNote || "",
                    actorUid: session?.user?.uid || "admin",
                    actorEmail: session?.user?.email || "",
                    timestamp: now
                };
                await set(ref(db, `badgeAuditLogs/${logId}`), auditEntry);
                badgeLogs.unshift(auditEntry);

                const notifId = `notif_${now}_${Math.random().toString(36).slice(2, 8)}`;
                const label = BADGE_DEFINITIONS[badgeType]?.label || badgeType;
                await set(ref(db, `userSocialNotifications/${profile.uid}/${notifId}`), {
                    id: notifId,
                    type: "badge_update",
                    title: active ? `${label} Badge Granted` : `${label} Badge Revoked`,
                    body: note || (active ? `Your profile now carries the ${label} badge.` : `Your ${label} badge was removed by administrators.`),
                    actorUid: session?.user?.uid || "admin",
                    read: false,
                    createdAt: now
                }).catch(() => {});
            } else {
                const logId = `blog_${now}_local`;
                badgeLogs.unshift({
                    id: logId,
                    targetUid: profile.uid,
                    targetUsername: profile.username || "",
                    badgeType,
                    action,
                    note: note || specialtyNote || "",
                    actorUid: session?.user?.uid || "admin",
                    actorEmail: session?.user?.email || "",
                    timestamp: now
                });
            }

            profile.badges = { ...(profile.badges || {}), [badgeType]: active };
            if (badgeType === "expertSpecialist") {
                profile.specialtyNote = active ? (specialtyNote || profile.specialtyNote || "Domain Specialist") : "";
            }

            await logAuditEvent({
                actorUid: session?.user?.uid,
                actorName: session?.staff?.name,
                actorEmail: session?.user?.email,
                actorRole: session?.role,
                action: active ? "badge_granted" : "badge_revoked",
                target: `${profile.uid}:${badgeType}`,
                metadata: { note, specialtyNote }
            });
            await logSecurityEvent({
                eventType: active ? "badge_granted" : "badge_revoked",
                severity: active ? "info" : "warning",
                actorUid: session?.user?.uid,
                actorEmail: session?.user?.email,
                actorRole: session?.role,
                target: `${profile.uid}:${badgeType}`,
                details: { badgeType, action, note }
            });
        };

        const openBadgeModal = (profile) => {
            const badges = profile.badges || {};
            UIModule.openModal(
                `Manage Badges: ${profile.displayName || profile.username}`,
                `
                  <div class="skg-channel-note" style="margin-bottom:14px;">
                    <strong>4 Distinct Badge Categories:</strong>
                    <br>1) <em>Email Verified</em> is strictly automatic from Firebase Authentication (current state: <strong>${badges.emailVerified ? "Verified" : "Unverified"}</strong>).
                    <br>2) <em>Verified Creator</em> (Blue Tick), <em>Official Organization</em> (Gold Shield), and <em>Domain Specialist</em> (Teal Ribbon) are manually administered below with audit logging.
                  </div>
                  <form id="skg-badge-manage-form">
                    <div class="form-group">
                      <label class="form-label" for="badge-select-type">Badge Category</label>
                      <select class="form-control" id="badge-select-type">
                        <option value="verifiedCreator">Verified Creator (Blue Tick) — currently ${badges.verifiedCreator ? "Active" : "Not granted"}</option>
                        <option value="officialOrg">Official Organization (Gold Shield) — currently ${badges.officialOrg ? "Active" : "Not granted"}</option>
                        <option value="expertSpecialist">Domain Specialist (Teal Ribbon) — currently ${badges.expertSpecialist ? "Active" : "Not granted"}</option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label class="form-label" for="badge-select-action">Action</label>
                      <select class="form-control" id="badge-select-action">
                        <option value="grant">Grant Badge</option>
                        <option value="revoke">Revoke Badge</option>
                      </select>
                    </div>
                    <div class="form-group" id="badge-specialty-group">
                      <label class="form-label" for="badge-specialty-note">Domain Specialty Label (for Domain Specialist)</label>
                      <input class="form-control" id="badge-specialty-note" type="text" maxlength="120" value="${Utils.escapeHTML(profile.specialtyNote || "")}" placeholder="e.g., Nepali Culinary Historian / Tech Writer">
                    </div>
                    <div class="form-group">
                      <label class="form-label" for="badge-audit-note">Audit Reason / Note *</label>
                      <input class="form-control" id="badge-audit-note" type="text" maxlength="240" required placeholder="e.g., Reviewed original articles & identity verification">
                    </div>
                  </form>
                `,
                `
                  <button type="button" class="btn btn-secondary" id="badge-cancel-btn">Cancel</button>
                  <button type="button" class="btn btn-primary" id="badge-save-btn">Apply Badge Change</button>
                `
            );

            document.getElementById("badge-cancel-btn")?.addEventListener("click", () => UIModule.closeModal());
            const saveBtn = document.getElementById("badge-save-btn");
            saveBtn?.addEventListener("click", async () => {
                const badgeType = document.getElementById("badge-select-type")?.value || "verifiedCreator";
                const action = document.getElementById("badge-select-action")?.value || "grant";
                const specialtyNote = document.getElementById("badge-specialty-note")?.value.trim() || "";
                const note = document.getElementById("badge-audit-note")?.value.trim() || "";

                if (!note) {
                    UIModule.showToast("Please provide a short audit note for this badge update.", "error");
                    return;
                }

                saveBtn.disabled = true;
                try {
                    await applyBadgeAction(profile, { badgeType, action, note, specialtyNote });
                    UIModule.closeModal();
                    UIModule.showToast(`${BADGE_DEFINITIONS[badgeType]?.label || badgeType} ${action === "grant" ? "granted" : "revoked"}.`, "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not update badge.", "error");
                    saveBtn.disabled = false;
                }
            });
        };

        const draw = () => {
            const q = state.search.trim().toLowerCase();
            const filteredApps = applications.filter((a) => {
                if (state.appFilter !== "all" && a.status !== state.appFilter) return false;
                if (q) {
                    const hay = `${a.displayName || ""} ${a.username || ""} ${a.specialty || ""} ${a.uid || ""}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });

            const filteredProfiles = profiles.filter((p) => {
                if (!q) return true;
                const hay = `${p.displayName || ""} ${p.username || ""} ${p.uid || ""} ${p.specialtyNote || ""}`.toLowerCase();
                return hay.includes(q);
            });

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">Creators &amp; Verification Badges</h2>
                      <p class="card-subtitle">Review publishing applications, suspend/reinstate creators, and administer independent verification badges with immutable audit trails.</p>
                    </div>
                  </div>

                  <div class="skg-tabs" role="tablist">
                    ${canCreators ? `<button type="button" class="skg-tab ${state.tab === "applications" ? "active" : ""}" data-cr-tab="applications">Creator Applications (${applications.length})</button>` : ""}
                    ${canBadges ? `<button type="button" class="skg-tab ${state.tab === "badges" ? "active" : ""}" data-cr-tab="badges">Public Profiles &amp; Badges (${profiles.length})</button>` : ""}
                    ${canBadges ? `<button type="button" class="skg-tab ${state.tab === "audit" ? "active" : ""}" data-cr-tab="audit">Badge Audit Logs (${badgeLogs.length})</button>` : ""}
                  </div>

                  <div class="skg-admin-order-toolbar">
                    <input type="search" id="skg-cr-search" placeholder="Search by name, @username, specialty, or UID…" value="${Utils.escapeHTML(state.search)}">
                    ${state.tab === "applications" ? `
                      <select class="form-control" id="skg-cr-status-filter" style="max-width:200px;">
                        <option value="all" ${state.appFilter === "all" ? "selected" : ""}>All Statuses</option>
                        <option value="pending" ${state.appFilter === "pending" ? "selected" : ""}>Pending</option>
                        <option value="approved" ${state.appFilter === "approved" ? "selected" : ""}>Approved</option>
                        <option value="rejected" ${state.appFilter === "rejected" ? "selected" : ""}>Rejected</option>
                        <option value="suspended" ${state.appFilter === "suspended" ? "selected" : ""}>Suspended</option>
                      </select>
                    ` : ""}
                  </div>

                  ${state.tab === "applications" && canCreators ? `
                    ${filteredApps.length === 0 ? `
                      <div class="empty-state">
                        <div class="empty-state-icon">✍</div>
                        <h3 class="empty-state-title">No Creator Applications Found</h3>
                        <p class="empty-state-desc">Community members who apply for publishing access in Creator Studio appear here for review.</p>
                      </div>
                    ` : `
                      <div class="table-responsive">
                        <table class="data-table">
                          <thead>
                            <tr>
                              <th>Applicant</th>
                              <th>Topic / Pitch</th>
                              <th>Status</th>
                              <th>Updated</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${filteredApps.map((app) => {
                                const badgeCls = app.status === "approved" ? "badge-success" : app.status === "suspended" || app.status === "rejected" ? "badge-danger" : "badge-warning";
                                return `
                                  <tr>
                                    <td>
                                      <strong>${Utils.escapeHTML(app.displayName || "Creator")}</strong>
                                      <div class="form-hint">@${Utils.escapeHTML(app.username || "unknown")} · <code>${Utils.escapeHTML(app.uid.slice(0, 12))}</code></div>
                                    </td>
                                    <td>
                                      ${app.specialty ? `<div><strong>${Utils.escapeHTML(app.specialty)}</strong></div>` : ""}
                                      <div class="form-hint">${Utils.escapeHTML(app.pitch || "")}</div>
                                      ${app.reviewNote ? `<div class="form-hint">Note: ${Utils.escapeHTML(app.reviewNote)}</div>` : ""}
                                    </td>
                                    <td><span class="badge ${badgeCls}">${Utils.escapeHTML(app.status || "pending")}</span></td>
                                    <td>${Utils.escapeHTML(Utils.formatDate(app.updatedAt || app.createdAt))}</td>
                                    <td>
                                      <div class="skg-table-actions">
                                        ${app.status !== "approved" ? `<button type="button" class="btn btn-sm btn-primary" data-cr-decision="approved" data-uid="${Utils.escapeHTML(app.uid)}">Approve</button>` : ""}
                                        ${app.status !== "rejected" ? `<button type="button" class="btn btn-sm btn-secondary" data-cr-decision="rejected" data-uid="${Utils.escapeHTML(app.uid)}">Reject</button>` : ""}
                                        ${app.status !== "suspended" ? `<button type="button" class="btn btn-sm btn-danger" data-cr-decision="suspended" data-uid="${Utils.escapeHTML(app.uid)}">Suspend</button>` : ""}
                                      </div>
                                    </td>
                                  </tr>
                                `;
                            }).join("")}
                          </tbody>
                        </table>
                      </div>
                    `}
                  ` : ""}

                  ${state.tab === "badges" && canBadges ? `
                    <div class="skg-channel-note" style="margin-bottom:14px;">
                      <strong>Badge Separation Policy:</strong> <em>Email Verified</em> reflects Firebase Auth email confirmation automatically and is not manually toggled here. <em>Verified Creator</em> (Blue Tick), <em>Official Organization</em> (Gold Shield), and <em>Domain Specialist</em> (Teal Ribbon) require explicit admin review.
                    </div>
                    <div class="table-responsive">
                      <table class="data-table">
                        <thead>
                          <tr>
                            <th>Profile</th>
                            <th>Creator Access</th>
                            <th>Active Badges (All 4 Types)</th>
                            <th>Stats</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${filteredProfiles.map((p) => {
                              const statusCls = p.creatorStatus === "approved" ? "badge-success" : p.creatorStatus === "suspended" ? "badge-danger" : "badge-info";
                              const badgesHtml = renderProfileBadgesHtml(p.badges || {}, { includeEmailVerified: true, specialtyNote: p.specialtyNote || "" });
                              return `
                                <tr>
                                  <td>
                                    <strong>${Utils.escapeHTML(p.displayName || p.username)}</strong>
                                    <div class="form-hint">@${Utils.escapeHTML(p.username)} · <code>${Utils.escapeHTML(p.uid.slice(0, 12))}</code></div>
                                  </td>
                                  <td><span class="badge ${statusCls}">${Utils.escapeHTML(p.creatorStatus || "none")}</span></td>
                                  <td>${badgesHtml || '<span class="form-hint">No badges</span>'}</td>
                                  <td>${Number(p.articlesCount || 0)} articles · ${Number(p.followersCount || 0)} followers</td>
                                  <td>
                                    <div class="skg-table-actions">
                                      <button type="button" class="btn btn-sm btn-primary" data-manage-badges="${Utils.escapeHTML(p.uid)}">Badges</button>
                                      ${canCreators && p.creatorStatus !== "approved" ? `<button type="button" class="btn btn-sm btn-secondary" data-cr-decision="approved" data-uid="${Utils.escapeHTML(p.uid)}">Approve Creator</button>` : ""}
                                      ${canCreators && p.creatorStatus === "approved" ? `<button type="button" class="btn btn-sm btn-danger" data-cr-decision="suspended" data-uid="${Utils.escapeHTML(p.uid)}">Suspend</button>` : ""}
                                    </div>
                                  </td>
                                </tr>
                              `;
                          }).join("")}
                        </tbody>
                      </table>
                    </div>
                  ` : ""}

                  ${state.tab === "audit" && canBadges ? `
                    ${badgeLogs.length === 0 ? `
                      <div class="empty-state">
                        <div class="empty-state-icon">🛡</div>
                        <h3 class="empty-state-title">No Badge Audit Logs Yet</h3>
                        <p class="empty-state-desc">Every manual badge grant and revocation records an immutable audit entry here.</p>
                      </div>
                    ` : `
                      <div class="table-responsive">
                        <table class="data-table">
                          <thead>
                            <tr>
                              <th>Timestamp</th>
                              <th>Target</th>
                              <th>Badge</th>
                              <th>Action</th>
                              <th>Actor</th>
                              <th>Note</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${badgeLogs.map((l) => `
                              <tr>
                                <td style="white-space:nowrap;">${Utils.escapeHTML(Utils.formatDate(l.timestamp))}</td>
                                <td><strong>@${Utils.escapeHTML(l.targetUsername || l.targetUid)}</strong></td>
                                <td><code>${Utils.escapeHTML(l.badgeType)}</code></td>
                                <td><span class="badge ${l.action === "grant" ? "badge-success" : "badge-warning"}">${Utils.escapeHTML(l.action)}</span></td>
                                <td>${Utils.escapeHTML(l.actorEmail || l.actorUid)}</td>
                                <td>${Utils.escapeHTML(l.note || "—")}</td>
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

            container.querySelectorAll("[data-cr-tab]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    state.tab = btn.dataset.crTab;
                    draw();
                });
            });
            container.querySelector("#skg-cr-search")?.addEventListener("input", (e) => {
                state.search = e.target.value;
                draw();
            });
            container.querySelector("#skg-cr-status-filter")?.addEventListener("change", (e) => {
                state.appFilter = e.target.value;
                draw();
            });
            container.querySelectorAll("[data-manage-badges]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const prof = profiles.find((p) => p.uid === btn.dataset.manageBadges);
                    if (prof) openBadgeModal(prof);
                });
            });
            container.querySelectorAll("[data-cr-decision]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const uid = btn.dataset.uid;
                    const decision = btn.dataset.crDecision;
                    const ok = await UIModule.confirm({
                        title: `Confirm Creator ${decision.toUpperCase()}?`,
                        message: `Update creator publishing status to "${decision}" for user ${uid}?`,
                        confirmText: `Set ${decision}`,
                        dangerous: decision === "suspended"
                    });
                    if (!ok) return;
                    btn.disabled = true;
                    try {
                        await applyCreatorDecision(uid, decision, `Updated by ${session?.staff?.name || session?.user?.email || "Admin"}`);
                        UIModule.showToast(`Creator status set to ${decision}.`, "success");
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Failed to update creator status.", "error");
                        btn.disabled = false;
                    }
                });
            });
        };

        draw();
    }
};
