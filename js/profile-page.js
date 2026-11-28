// ============================================================================
// SIRANCHOWK KHAJA GHAR — PUBLIC USER PROFILE CONTROLLER (/user/:username)
// ============================================================================
// Shows ONLY safe public profile information (never PII, drafts, or analytics).
// Supports Follow/Unfollow, paginated Followers/Following modal, Share, Report,
// and Tabs: Articles, Reposts (hiding removed originals), and About.
// ============================================================================

import { onCustomerAuthChange } from "./customer-auth.js";
import {
    CATEGORY_MAP,
    SITE_ORIGIN,
    escapeHTML,
    sanitizeUrl,
    buildArticleUrl,
    buildProfileUrl,
    buildCategoryUrl
} from "./platform-core.js";
import { renderAuthorTicksHtml, renderProfileBadgesHtml } from "./badges.js";
import {
    fetchPublishedArticles,
    fetchAllPublicProfilesMap
} from "./blog-service.js";
import {
    resolvePublicProfileByUsername,
    isFollowingUser,
    toggleFollowUser,
    fetchFollowList,
    fetchUserReposts,
    submitContentReport
} from "./social-service.js";

function readRequestedUsername() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("u")) return params.get("u");
    const path = window.location.pathname;
    if (path.startsWith("/user/")) {
        return decodeURIComponent(path.slice("/user/".length)).replace(/\/+$/, "");
    }
    return "siranchowk";
}

function readSsrState() {
    const el = document.getElementById("skg-ssr-state");
    if (!el) return null;
    try {
        return JSON.parse(el.textContent || "null");
    } catch {
        return null;
    }
}

function formatDate(ms) {
    try {
        return new Date(Number(ms) || Date.now()).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            timeZone: "Asia/Kathmandu"
        });
    } catch {
        return "2026";
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    const root = document.getElementById("profile-root");
    if (!root) return;

    const requestedUsername = readRequestedUsername();
    const ssr = readSsrState();

    const state = {
        user: null,
        profile: ssr?.profile || null,
        articles: [],
        reposts: [],
        profilesMap: {},
        activeTab: "articles",
        following: false
    };

    const [resolvedProfile, allArticles, profilesMap] = await Promise.all([
        resolvePublicProfileByUsername(requestedUsername),
        fetchPublishedArticles(),
        fetchAllPublicProfilesMap()
    ]);

    state.profilesMap = profilesMap;
    if (resolvedProfile) {
        state.profile = resolvedProfile;
    }

    if (!state.profile || (state.profile.visibility === "private" && state.user?.uid !== state.profile.uid)) {
        root.innerHTML = `
          <section class="skg-empty-card">
            <h1>Profile Unavailable</h1>
            <p class="skg-story-excerpt" style="margin:0.5rem auto 1rem;">This profile does not exist or has been set to private by its owner.</p>
            <a href="/explore.html" class="btn btn-primary">Explore Creators</a>
          </section>
        `;
        return;
    }

    const publishedMap = new Map(allArticles.map((a) => [a.id, a]));
    state.articles = allArticles.filter((a) => a.authorUid === state.profile.uid);
    state.reposts = await fetchUserReposts(state.profile.uid, publishedMap);

    document.title = `${state.profile.displayName} (@${state.profile.username}) | Siranchowk Khaja Ghar`;

    function render() {
        const p = state.profile;
        const isOwn = state.user?.uid === p.uid;
        const coverUrl = sanitizeUrl(p.coverURL || "", { allowRelative: true });
        const photoUrl = sanitizeUrl(p.photoURL || "", { allowRelative: true });
        const websiteUrl = sanitizeUrl(p.website || "", { allowRelative: false });
        const ticks = renderAuthorTicksHtml(p.badges || {}, p.specialtyNote || "");
        const profileUrl = `${SITE_ORIGIN}${buildProfileUrl(p.username)}`;

        let tabHtml = "";
        if (state.activeTab === "articles") {
            tabHtml = state.articles.length
                ? `<div class="skg-feed-grid is-two-col">${state.articles.map((art) => `
                    <article class="skg-story-card">
                      <div class="skg-story-meta">
                        <a href="${escapeHTML(buildCategoryUrl(art.category))}">${escapeHTML(CATEGORY_MAP[art.category]?.name || art.category)}</a>
                        <span>·</span>
                        <time>${escapeHTML(formatDate(art.publishedAt))}</time>
                        <span>·</span>
                        <span>${Number(art.readingTimeMin || 3)} min read</span>
                      </div>
                      <h2 class="skg-story-title"><a href="${escapeHTML(buildArticleUrl(art.slug))}">${escapeHTML(art.title)}</a></h2>
                      ${art.subtitle ? `<p class="skg-story-excerpt">${escapeHTML(art.subtitle)}</p>` : ""}
                      <div class="skg-story-footer">
                        <span class="skg-story-stats">${Number(art.likesCount || 0)} likes · ${Number(art.commentsCount || 0)} comments · ${Number(art.repostsCount || 0)} reposts</span>
                      </div>
                    </article>
                  `).join("")}</div>`
                : `<div class="skg-empty-card"><p class="skg-story-excerpt">No published articles yet.</p></div>`;
        } else if (state.activeTab === "reposts") {
            tabHtml = state.reposts.length
                ? `<div class="skg-feed-grid">${state.reposts.map((rp) => {
                    const orig = rp.originalArticle;
                    const origAuthor = state.profilesMap[orig.authorUid];
                    return `
                      <article class="skg-story-card">
                        <div class="skg-story-meta">
                          <span>↻ Reposted by @${escapeHTML(p.username)} on ${escapeHTML(formatDate(rp.repostedAt))}</span>
                        </div>
                        <h2 class="skg-story-title"><a href="${escapeHTML(buildArticleUrl(orig.slug))}">${escapeHTML(orig.title)}</a></h2>
                        <div class="skg-story-footer">
                          <a href="${escapeHTML(buildProfileUrl(origAuthor?.username || orig.authorUsername || "creator"))}" class="skg-author-inline">
                            Original by ${escapeHTML(origAuthor?.displayName || orig.authorName || "Creator")}
                          </a>
                          <span>${escapeHTML(CATEGORY_MAP[orig.category]?.name || orig.category)}</span>
                        </div>
                      </article>
                    `;
                  }).join("")}</div>`
                : `<div class="skg-empty-card"><p class="skg-story-excerpt">No reposts yet.</p></div>`;
        } else {
            tabHtml = `
              <div class="skg-panel">
                <h2 class="skg-panel-title">About ${escapeHTML(p.displayName)}</h2>
                <p style="margin-bottom:0.9rem;">${escapeHTML(p.bio || "Community member on Siranchowk Khaja Ghar.")}</p>
                <div class="skg-story-meta" style="display:grid;gap:0.4rem;">
                  <div><strong>Handle:</strong> @${escapeHTML(p.username)}</div>
                  <div><strong>Joined:</strong> ${escapeHTML(formatDate(p.joinedAt || Date.now()))}</div>
                  ${p.location ? `<div><strong>Location:</strong> ${escapeHTML(p.location)}</div>` : ""}
                  ${websiteUrl ? `<div><strong>Website:</strong> <a href="${escapeHTML(websiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(websiteUrl)}</a></div>` : ""}
                  ${p.specialtyNote ? `<div><strong>Specialty:</strong> ${escapeHTML(p.specialtyNote)}</div>` : ""}
                </div>
              </div>
            `;
        }

        root.innerHTML = `
          <section class="skg-profile-banner">
            <div class="skg-profile-cover">
              ${coverUrl ? `<img src="${escapeHTML(coverUrl)}" alt="${escapeHTML(p.displayName)} cover" referrerpolicy="no-referrer">` : ""}
            </div>
            <div class="skg-profile-head-body">
              <div style="flex:1 1 320px;">
                <div class="skg-profile-identity">
                  ${photoUrl
                    ? `<img class="skg-avatar is-lg" src="${escapeHTML(photoUrl)}" alt="${escapeHTML(p.displayName)}" referrerpolicy="no-referrer">`
                    : `<div class="skg-avatar is-lg">${escapeHTML(p.displayName.charAt(0).toUpperCase())}</div>`}
                  <div>
                    <h1 style="font-size:clamp(1.4rem,2.4vw,1.95rem);color:var(--color-dark);display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;">
                      ${escapeHTML(p.displayName)} ${ticks}
                    </h1>
                    <div class="skg-story-meta">@${escapeHTML(p.username)} · Joined ${escapeHTML(formatDate(p.joinedAt || Date.now()))}</div>
                    ${renderProfileBadgesHtml(p.badges || {}, { includeEmailVerified: true, specialtyNote: p.specialtyNote || "" })}
                  </div>
                </div>
                ${p.bio ? `<p style="margin-top:0.85rem;max-width:65ch;color:var(--color-text-main);">${escapeHTML(p.bio)}</p>` : ""}
                <div class="skg-profile-stats-row">
                  <button type="button" class="skg-link-btn" id="btn-open-followers"><strong>${Number(p.followersCount || 0)}</strong> Followers</button>
                  <button type="button" class="skg-link-btn" id="btn-open-following"><strong>${Number(p.followingCount || 0)}</strong> Following</button>
                  <span><strong>${state.articles.length}</strong> Articles</span>
                </div>
              </div>

              <div style="display:flex;flex-wrap:wrap;gap:0.6rem;">
                ${!isOwn ? `
                  <button type="button" class="btn ${state.following ? "btn-outline" : "btn-primary"}" id="btn-toggle-follow-profile">
                    ${state.following ? "Following" : "Follow"}
                  </button>
                ` : `<a href="/creator-studio.html" class="btn btn-primary">Open Creator Studio</a>`}
                <button type="button" class="btn btn-outline" id="btn-share-profile">Share Profile</button>
                ${!isOwn ? `<button type="button" class="skg-action-btn" id="btn-report-profile">Report</button>` : ""}
              </div>
            </div>
          </section>

          <div id="skg-profile-feedback" class="skg-notice" hidden style="margin-bottom:1rem;"></div>

          <div class="skg-toolbar">
            <div class="skg-tab-strip" role="tablist">
              <button type="button" class="skg-tab-btn ${state.activeTab === "articles" ? "active" : ""}" data-ptab="articles">Articles (${state.articles.length})</button>
              <button type="button" class="skg-tab-btn ${state.activeTab === "reposts" ? "active" : ""}" data-ptab="reposts">Reposts (${state.reposts.length})</button>
              <button type="button" class="skg-tab-btn ${state.activeTab === "about" ? "active" : ""}" data-ptab="about">About</button>
            </div>
          </div>

          ${tabHtml}
        `;

        wireHandlers(profileUrl);
    }

    function showFeedback(msg) {
        const el = document.getElementById("skg-profile-feedback");
        if (!el) return;
        el.hidden = !msg;
        el.textContent = msg;
    }

    function wireHandlers(profileUrl) {
        root.querySelectorAll("[data-ptab]").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.activeTab = btn.dataset.ptab || "articles";
                render();
            });
        });

        document.getElementById("btn-toggle-follow-profile")?.addEventListener("click", async (e) => {
            if (!state.user) {
                const returnTo = `${window.location.pathname || "/explore.html"}${window.location.search || ""}`;
                window.location.href = `/account.html?mode=login&redirect=${encodeURIComponent(returnTo)}`;
                return;
            }
            const btn = e.currentTarget;
            if (btn.disabled) return;
            btn.disabled = true;
            try {
                const res = await toggleFollowUser(state.profile.uid);
                state.following = res.following;
                state.profile.followersCount = Math.max(0, Number(state.profile.followersCount || 0) + (res.following ? 1 : -1));
                render();
            } catch (err) {
                btn.disabled = false;
                showFeedback(err?.message || "Could not update follow status.");
            }
        });

        document.getElementById("btn-share-profile")?.addEventListener("click", async () => {
            if (navigator.share) {
                await navigator.share({ title: state.profile.displayName, url: profileUrl }).catch(() => {});
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(profileUrl).catch(() => {});
            }
            showFeedback("Profile URL copied to clipboard.");
        });

        document.getElementById("btn-open-followers")?.addEventListener("click", () => openFollowModal("followers"));
        document.getElementById("btn-open-following")?.addEventListener("click", () => openFollowModal("following"));
        document.getElementById("btn-report-profile")?.addEventListener("click", () => {
            if (!state.user) {
                const returnTo = `${window.location.pathname || "/explore.html"}${window.location.search || ""}`;
                window.location.href = `/account.html?mode=login&redirect=${encodeURIComponent(returnTo)}`;
                return;
            }
            const reason = "Inappropriate or impersonating profile";
            submitContentReport({ targetType: "profile", targetId: state.profile.uid, reason })
                .then(() => showFeedback("Profile report submitted for moderator review."))
                .catch((err) => showFeedback(err?.message || "Could not submit report."));
        });
    }

    async function openFollowModal(mode) {
        let list = [];
        try {
            list = await fetchFollowList(state.profile.uid, mode, 30);
        } catch (err) {
            showFeedback(err?.message || "Could not load list right now.");
            return;
        }
        const overlay = document.createElement("div");
        overlay.className = "skg-modal-backdrop";
        overlay.innerHTML = `
          <div class="skg-modal-card" role="dialog" aria-modal="true" aria-label="${escapeHTML(mode)}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
              <h2>${mode === "following" ? "Following" : "Followers"}</h2>
              <button type="button" class="btn btn-outline" id="skg-close-fmodal" style="padding:0.35rem 0.75rem;">Close</button>
            </div>
            ${list.length
              ? list.map((u) => `
                  <div class="skg-creator-row">
                    <div>
                      <a href="${escapeHTML(buildProfileUrl(u.username))}" class="skg-author-inline">${escapeHTML(u.displayName)}</a>
                      <div class="skg-story-meta">@${escapeHTML(u.username)}</div>
                    </div>
                    <a href="${escapeHTML(buildProfileUrl(u.username))}" class="btn btn-outline" style="padding:0.3rem 0.65rem;">View</a>
                  </div>
                `).join("")
              : `<p class="skg-story-excerpt">No ${escapeHTML(mode)} to display yet.</p>`}
          </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector("#skg-close-fmodal")?.addEventListener("click", () => overlay.remove());
    }

    render();

    onCustomerAuthChange(async ({ user }) => {
        state.user = user || null;
        if (user && state.profile) {
            state.following = await isFollowingUser(user.uid, state.profile.uid);
        } else {
            state.following = false;
        }
        render();
    });
});
