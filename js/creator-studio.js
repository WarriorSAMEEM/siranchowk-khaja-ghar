// ============================================================================
// SIRANCHOWK KHAJA GHAR — PRIVATE CREATOR STUDIO WORKSPACE
// ============================================================================
// Authenticated creator dashboard & rich Markdown/SEO publisher.
// Enforces per-UID draft isolation (creatorDrafts/{uid}), honest recorded vs
// unconfigured analytics (never fakes GSC data), and Unicode-friendly slugs.
// ============================================================================

import { onCustomerAuthChange } from "./customer-auth.js";
import {
    PLATFORM_CATEGORIES,
    CATEGORY_MAP,
    escapeHTML,
    slugifyUnicode,
    renderSafeMarkdownToHtml,
    calculateReadingTimeMinutes,
    buildArticleUrl,
    buildProfileUrl,
    sanitizeUrl
} from "./platform-core.js";
import { renderProfileBadgesHtml } from "./badges.js";
import {
    fetchCreatorDrafts,
    saveCreatorDraft,
    deleteCreatorDraft,
    publishCreatorArticle,
    unpublishArticleToDraft,
    deletePublishedArticle,
    fetchPublishedArticles
} from "./blog-service.js";
import {
    ensurePublicProfile,
    updatePublicProfile,
    submitCreatorApplication,
    getMyCreatorApplication,
    fetchCreatorAnalytics,
    syncEmailVerificationBadge
} from "./social-service.js";

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

document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("creator-studio-root");
    if (!root) return;

    const state = {
        user: null,
        profile: null,
        application: null,
        activeTab: "overview",
        dateRange: "28d",
        drafts: [],
        published: [],
        analytics: null,
        autosaveEnabled: true,
        autosaveTimer: null,
        autosaveStatus: "",
        editor: {
            id: "",
            title: "",
            subtitle: "",
            slug: "",
            category: "food",
            tags: "",
            coverImage: "",
            seoTitle: "",
            seoDescription: "",
            language: "en",
            visibility: "public",
            contentMarkdown: "",
            isPublished: false
        }
    };

    function resetEditor() {
        state.editor = {
            id: "",
            title: "",
            subtitle: "",
            slug: "",
            category: "food",
            tags: "",
            coverImage: "",
            seoTitle: "",
            seoDescription: "",
            language: "en",
            visibility: "public",
            contentMarkdown: "",
            isPublished: false
        };
    }

    function filterDailySeries(dailyMap = {}) {
        const entries = Object.values(dailyMap || {}).sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const days = state.dateRange === "7d" ? 7 : state.dateRange === "90d" ? 90 : 28;
        return entries.slice(-days);
    }

    async function loadStudioData(user) {
        const profile = await ensurePublicProfile(user);
        state.profile = profile;
        await syncEmailVerificationBadge(user);
        const [app, drafts, allPub, analytics] = await Promise.all([
            getMyCreatorApplication(user.uid),
            fetchCreatorDrafts(user.uid).catch(() => []),
            fetchPublishedArticles({ includeUnlisted: true }).catch(() => []),
            fetchCreatorAnalytics(user.uid).catch(() => null)
        ]);
        state.application = app;
        state.drafts = drafts;
        state.published = allPub.filter((a) => a.authorUid === user.uid);
        state.analytics = analytics || {
            summary: { totalViews: 0, readCompletes: 0, totalShares: 0 },
            daily: {},
            articles: {},
            referrers: {}
        };
    }

    function renderSignedOut() {
        root.innerHTML = `
          <section class="skg-empty-card" style="max-width:620px;margin:2rem auto;">
            <span class="skg-kicker">Creator Studio</span>
            <h1 style="margin-bottom:0.65rem;">Sign in to access your private Creator Studio</h1>
            <p class="skg-story-excerpt" style="margin:0 auto 1.25rem;">Write drafts privately, publish multilingual articles, and track honest engagement analytics for your public profile.</p>
            <a href="/account.html?mode=login&redirect=creator-studio.html" class="btn btn-primary">Sign In / Create Account</a>
          </section>
        `;
    }

    function renderStudio() {
        if (!state.user || !state.profile) {
            renderSignedOut();
            return;
        }

        const p = state.profile;
        const canPublish = p.creatorStatus === "approved" || p.uid === "47SB1i4UL5hlUVPqM1tQoKJFdaM2";
        const totalLikes = state.published.reduce((sum, a) => sum + Number(a.likesCount || 0), 0);
        const totalComments = state.published.reduce((sum, a) => sum + Number(a.commentsCount || 0), 0);
        const totalReposts = state.published.reduce((sum, a) => sum + Number(a.repostsCount || 0), 0);
        const recordedViews = Number(state.analytics?.summary?.totalViews || 0)
            || state.published.reduce((sum, a) => sum + Number(a.viewsCount || 0), 0);
        const readCompletes = Number(state.analytics?.summary?.readCompletes || 0);
        const completionPct = recordedViews > 0 ? Math.min(100, Math.round((readCompletes / recordedViews) * 100)) : 0;

        const dailySeries = filterDailySeries(state.analytics?.daily || {});
        const refs = state.analytics?.referrers || {};
        const organicViews = Number(refs.search_organic?.count || 0);

        const navItems = [
            { id: "overview", label: "Overview" },
            { id: "editor", label: "Write / Edit Article" },
            { id: "content", label: "Drafts & Published" },
            { id: "analytics", label: "Content & Engagement" },
            { id: "audience", label: "Audience & Sources" },
            { id: "search", label: "Search Performance" },
            { id: "settings", label: "Creator Profile & Access" }
        ];

        let panelHtml = "";

        if (state.activeTab === "overview") {
            panelHtml = `
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;margin-bottom:1.1rem;">
                <div>
                  <h2 style="font-size:1.35rem;color:var(--color-dark);">Studio Overview</h2>
                  <p class="skg-story-meta">Recorded first-party metrics only · No simulated traffic</p>
                </div>
                <div style="display:flex;gap:0.45rem;">
                  ${["7d", "28d", "90d"].map((r) => `
                    <button type="button" class="skg-tab-btn ${state.dateRange === r ? "active" : ""}" data-range="${r}">${r.toUpperCase()}</button>
                  `).join("")}
                </div>
              </div>

              ${!canPublish ? `
                <div class="skg-notice" style="margin-bottom:1.25rem;">
                  <strong>Creator Publishing Status: ${escapeHTML(p.creatorStatus || "none")}</strong> — You can draft articles privately right now. Apply under <em>Creator Profile &amp; Access</em> to unlock public publishing.
                </div>
              ` : ""}

              <div class="skg-kpi-grid">
                <div class="skg-kpi-card"><span class="skg-kpi-label">Recorded Views</span><div class="skg-kpi-value">${recordedViews}</div><div class="skg-kpi-note">30-min session deduplicated</div></div>
                <div class="skg-kpi-card"><span class="skg-kpi-label">Read Completion</span><div class="skg-kpi-value">${completionPct}%</div><div class="skg-kpi-note">${readCompletes} completed reads</div></div>
                <div class="skg-kpi-card"><span class="skg-kpi-label">Followers</span><div class="skg-kpi-value">${Number(p.followersCount || 0)}</div><div class="skg-kpi-note">Verified profile count</div></div>
                <div class="skg-kpi-card"><span class="skg-kpi-label">Engagement</span><div class="skg-kpi-value">${totalLikes + totalComments + totalReposts}</div><div class="skg-kpi-note">${totalLikes} likes · ${totalComments} comments · ${totalReposts} reposts</div></div>
              </div>

              <div class="skg-panel">
                <h3 class="skg-panel-title">Daily Recorded Activity (${escapeHTML(state.dateRange.toUpperCase())})</h3>
                ${dailySeries.length ? `
                  <div class="skg-table-wrap">
                    <table class="skg-table">
                      <thead><tr><th>Date</th><th>Views</th><th>Read Completes</th><th>Shares</th></tr></thead>
                      <tbody>
                        ${dailySeries.map((d) => `<tr><td>${escapeHTML(d.date)}</td><td class="skg-tabular">${Number(d.views || 0)}</td><td class="skg-tabular">${Number(d.readCompletes || 0)}</td><td class="skg-tabular">${Number(d.shares || 0)}</td></tr>`).join("")}
                      </tbody>
                    </table>
                  </div>
                ` : `<p class="skg-story-excerpt">No recorded article views yet for this period. Published articles automatically track privacy-respecting metrics.</p>`}
              </div>
            `;
        } else if (state.activeTab === "editor") {
            const ed = state.editor;
            const effectiveSlug = slugifyUnicode(ed.slug || ed.title || "your-article-slug");
            const previewTitle = ed.seoTitle || ed.title || "Article Title";
            const previewDesc = ed.seoDescription || ed.subtitle || "Meta description preview shown in search results.";
            panelHtml = `
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
                <h2>${ed.id ? "Edit Article" : "New Article Draft"}</h2>
                <div style="display:flex;align-items:center;gap:0.75rem;font-size:0.85rem;">
                  <label style="display:inline-flex;align-items:center;gap:0.35rem;cursor:pointer;">
                    <input type="checkbox" id="ed-autosave-toggle" ${state.autosaveEnabled ? "checked" : ""}> Autosave Drafts
                  </label>
                  <span id="ed-autosave-status" class="skg-story-meta">${escapeHTML(state.autosaveStatus)}</span>
                </div>
              </div>

              <div id="ed-feedback" class="skg-notice" hidden style="margin-bottom:1rem;"></div>

              <div class="skg-editor-split">
                <form id="skg-editor-form" class="skg-panel" style="display:grid;gap:0.85rem;">
                  <label><strong>Title *</strong><input class="skg-input" id="ed-title" required maxlength="180" value="${escapeHTML(ed.title)}" placeholder="Write a clear English or नेपाली headline…"></label>
                  <label><strong>Subtitle / Excerpt</strong><input class="skg-input" id="ed-subtitle" maxlength="280" value="${escapeHTML(ed.subtitle)}" placeholder="Brief summary for readers and social previews"></label>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                    <label><strong>Category</strong>
                      <select class="skg-select" id="ed-category">
                        ${PLATFORM_CATEGORIES.map((c) => `<option value="${escapeHTML(c.slug)}" ${ed.category === c.slug ? "selected" : ""}>${escapeHTML(c.name)}</option>`).join("")}
                      </select>
                    </label>
                    <label><strong>Language</strong>
                      <select class="skg-select" id="ed-language">
                        <option value="en" ${ed.language === "en" ? "selected" : ""}>English</option>
                        <option value="ne" ${ed.language === "ne" ? "selected" : ""}>Nepali (नेपाली)</option>
                        <option value="mixed" ${ed.language === "mixed" ? "selected" : ""}>Bilingual</option>
                      </select>
                    </label>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                    <label><strong>Tags (comma separated)</strong><input class="skg-input" id="ed-tags" value="${escapeHTML(ed.tags)}" placeholder="chitwan, food, recipe"></label>
                    <label><strong>Visibility</strong>
                      <select class="skg-select" id="ed-visibility">
                        <option value="public" ${ed.visibility === "public" ? "selected" : ""}>Public (Indexed &amp; Discovery)</option>
                        <option value="unlisted" ${ed.visibility === "unlisted" ? "selected" : ""}>Unlisted (Direct link only)</option>
                      </select>
                    </label>
                  </div>
                  <label><strong>Featured Image URL (HTTPS or /assets/…)</strong><input class="skg-input" id="ed-cover" value="${escapeHTML(ed.coverImage)}" placeholder="https://..."></label>
                  <label><strong>Content (Markdown) *</strong>
                    <textarea class="skg-textarea" id="ed-markdown" rows="13" required placeholder="## Heading&#10;&#10;Write your story here. Supports headings, lists, quotes, code blocks, links, and inline images ![alt](url).">${escapeHTML(ed.contentMarkdown)}</textarea>
                  </label>

                  <details style="border-top:1px solid var(--color-border);padding-top:0.75rem;">
                    <summary style="cursor:pointer;font-weight:700;">SEO &amp; Slug Settings</summary>
                    <div style="display:grid;gap:0.7rem;margin-top:0.75rem;">
                      <label><strong>Custom Slug (Unicode / Nepali supported)</strong><input class="skg-input" id="ed-slug" value="${escapeHTML(ed.slug)}" placeholder="${escapeHTML(effectiveSlug)}"></label>
                      <label><strong>SEO Title</strong><input class="skg-input" id="ed-seo-title" maxlength="120" value="${escapeHTML(ed.seoTitle)}"></label>
                      <label><strong>SEO Meta Description</strong><textarea class="skg-textarea" id="ed-seo-desc" rows="2" maxlength="220">${escapeHTML(ed.seoDescription)}</textarea></label>
                    </div>
                  </details>

                  <div style="display:flex;flex-wrap:wrap;gap:0.6rem;padding-top:0.5rem;">
                    <button type="button" class="btn btn-outline" id="ed-save-draft-btn">Save Private Draft</button>
                    <button type="submit" class="btn btn-primary" ${!canPublish ? "disabled title='Creator publishing approval required'" : ""}>
                      ${ed.isPublished ? "Update Published Article" : "Publish Article"}
                    </button>
                    <button type="button" class="skg-link-btn" id="ed-reset-btn" style="margin-left:auto;">Clear Editor</button>
                  </div>
                </form>

                <div style="display:grid;gap:1rem;">
                  <div class="skg-panel">
                    <h3 class="skg-panel-title">Search Snippet Preview</h3>
                    <div style="font-size:0.8rem;color:#15803d;">https://siranchowk-khaja-ghar.pages.dev/blog/${escapeHTML(effectiveSlug)}</div>
                    <div style="font-size:1.08rem;font-weight:700;color:#1d4ed8;margin:0.15rem 0;">${escapeHTML(previewTitle)}</div>
                    <p class="skg-story-excerpt">${escapeHTML(previewDesc)}</p>
                  </div>
                  <div class="skg-panel">
                    <h3 class="skg-panel-title">Live Article Preview · <span id="ed-readtime">${calculateReadingTimeMinutes(ed.contentMarkdown)} min read</span></h3>
                    <div class="skg-article-prose" id="ed-live-preview">${renderSafeMarkdownToHtml(ed.contentMarkdown || "_Start writing to see live formatted preview…_")}</div>
                  </div>
                </div>
              </div>
            `;
        } else if (state.activeTab === "content") {
            panelHtml = `
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <h2>Drafts &amp; Published Content</h2>
                <button type="button" class="btn btn-primary" id="btn-new-article">Write New Article</button>
              </div>
              <div id="content-feedback" class="skg-notice" hidden style="margin-bottom:1rem;"></div>
              <div class="skg-panel" style="margin-bottom:1.25rem;">
                <h3 class="skg-panel-title">Private Drafts (${state.drafts.length})</h3>
                ${state.drafts.length ? state.drafts.map((d) => `
                  <div class="skg-creator-row">
                    <div>
                      <strong>${escapeHTML(d.title)}</strong>
                      <div class="skg-story-meta">Private Draft · Updated ${escapeHTML(formatDate(d.updatedAt))} · ${Number(d.readingTimeMin || 1)} min read</div>
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                      <button type="button" class="btn btn-outline" data-edit-draft="${escapeHTML(d.id)}" style="padding:0.35rem 0.7rem;">Edit</button>
                      <button type="button" class="skg-link-btn" data-delete-draft="${escapeHTML(d.id)}">Delete</button>
                    </div>
                  </div>
                `).join("") : `<p class="skg-story-excerpt">No saved drafts right now.</p>`}
              </div>

              <div class="skg-panel">
                <h3 class="skg-panel-title">Published Articles (${state.published.length})</h3>
                ${state.published.length ? state.published.map((a) => `
                  <div class="skg-creator-row">
                    <div>
                      <a href="${escapeHTML(buildArticleUrl(a.slug))}" style="font-weight:700;">${escapeHTML(a.title)}</a>
                      <div class="skg-story-meta">${escapeHTML(CATEGORY_MAP[a.category]?.name || a.category)} · ${Number(a.viewsCount || 0)} views · ${Number(a.likesCount || 0)} likes · ${Number(a.commentsCount || 0)} comments</div>
                    </div>
                    <div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
                      <button type="button" class="btn btn-outline" data-edit-pub="${escapeHTML(a.id)}" style="padding:0.35rem 0.7rem;">Edit</button>
                      <button type="button" class="skg-link-btn" data-unpublish-pub="${escapeHTML(a.id)}">Move to Draft</button>
                      <button type="button" class="skg-link-btn" data-delete-pub="${escapeHTML(a.id)}">Delete</button>
                    </div>
                  </div>
                `).join("") : `<p class="skg-story-excerpt">You have not published any articles yet.</p>`}
              </div>
            `;
        } else if (state.activeTab === "analytics") {
            const artStats = Object.values(state.analytics?.articles || {});
            panelHtml = `
              <h2 style="margin-bottom:1rem;">Article-Level Content &amp; Engagement Analytics</h2>
              <div class="skg-panel">
                ${state.published.length ? `
                  <div class="skg-table-wrap">
                    <table class="skg-table">
                      <thead><tr><th>Article</th><th>Views</th><th>Completes</th><th>Likes</th><th>Comments</th><th>Reposts</th><th>Shares</th></tr></thead>
                      <tbody>
                        ${state.published.map((a) => {
                          const stat = artStats.find((s) => s.articleId === a.id) || {};
                          return `<tr>
                            <td><a href="${escapeHTML(buildArticleUrl(a.slug))}">${escapeHTML(a.title)}</a></td>
                            <td class="skg-tabular">${Number(a.viewsCount || stat.views || 0)}</td>
                            <td class="skg-tabular">${Number(stat.readCompletes || 0)}</td>
                            <td class="skg-tabular">${Number(a.likesCount || 0)}</td>
                            <td class="skg-tabular">${Number(a.commentsCount || 0)}</td>
                            <td class="skg-tabular">${Number(a.repostsCount || 0)}</td>
                            <td class="skg-tabular">${Number(a.sharesCount || stat.shares || 0)}</td>
                          </tr>`;
                        }).join("")}
                      </tbody>
                    </table>
                  </div>
                ` : `<p class="skg-story-excerpt">Publish an article to begin collecting honest article-level metrics.</p>`}
              </div>
            `;
        } else if (state.activeTab === "audience") {
            const buckets = [
                { key: "direct", label: "Direct / Bookmarks" },
                { key: "internal", label: "Internal Discovery & Explore" },
                { key: "search_organic", label: "Search Engine Referrals" },
                { key: "social", label: "Social & Messaging (WhatsApp, X, FB)" },
                { key: "external", label: "Other External Websites" }
            ];
            panelHtml = `
              <h2 style="margin-bottom:1rem;">Audience &amp; Traffic Sources</h2>
              <div class="skg-kpi-grid">
                <div class="skg-kpi-card"><span class="skg-kpi-label">Total Followers</span><div class="skg-kpi-value">${Number(p.followersCount || 0)}</div></div>
                <div class="skg-kpi-card"><span class="skg-kpi-label">Following</span><div class="skg-kpi-value">${Number(p.followingCount || 0)}</div></div>
              </div>
              <div class="skg-panel">
                <h3 class="skg-panel-title">Recorded Referrer Breakdown</h3>
                <div class="skg-table-wrap">
                  <table class="skg-table">
                    <thead><tr><th>Source Category</th><th>Recorded Visits</th><th>Latest Host</th></tr></thead>
                    <tbody>
                      ${buckets.map((b) => {
                        const row = refs[b.key] || {};
                        return `<tr><td>${escapeHTML(b.label)}</td><td class="skg-tabular">${Number(row.count || 0)}</td><td>${escapeHTML(row.lastHost || "None recorded")}</td></tr>`;
                      }).join("")}
                    </tbody>
                  </table>
                </div>
              </div>
            `;
        } else if (state.activeTab === "search") {
            panelHtml = `
              <h2 style="margin-bottom:1rem;">Search Performance</h2>
              <div class="skg-notice" style="margin-bottom:1.25rem;">
                <strong>Google Search Console Not Connected:</strong> Impressions, average search rank position, and keyword CTR require Google Search Console integration and are intentionally not estimated or fabricated here.
              </div>
              <div class="skg-kpi-grid">
                <div class="skg-kpi-card"><span class="skg-kpi-label">Recorded Search Referrals</span><div class="skg-kpi-value">${organicViews}</div><div class="skg-kpi-note">Observed from document.referrer</div></div>
                <div class="skg-kpi-card"><span class="skg-kpi-label">Indexed Public Articles</span><div class="skg-kpi-value">${state.published.filter((a) => a.visibility !== "unlisted").length}</div><div class="skg-kpi-note">Included in /sitemap.xml</div></div>
              </div>
            `;
        } else {
            panelHtml = `
              <h2 style="margin-bottom:1rem;">Creator Profile &amp; Verification</h2>
              <div id="settings-feedback" class="skg-notice" hidden style="margin-bottom:1rem;"></div>
              <div class="skg-panel" style="margin-bottom:1.25rem;">
                <h3 class="skg-panel-title">Verification Badges</h3>
                ${renderProfileBadgesHtml(p.badges || {}, { includeEmailVerified: true, specialtyNote: p.specialtyNote || "" }) || `<p class="skg-story-excerpt">No badges active yet. Verify your email in My Account for Email Verified status; creator, official, and specialist badges are granted manually by admins.</p>`}
                <p class="skg-story-meta" style="margin-top:0.75rem;">Public profile link: <a href="${escapeHTML(buildProfileUrl(p.username))}">@${escapeHTML(p.username)}</a></p>
              </div>

              <form id="studio-profile-form" class="skg-panel" style="display:grid;gap:0.8rem;margin-bottom:1.25rem;">
                <h3 class="skg-panel-title">Edit Public Profile</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                  <label><strong>Display Name</strong><input class="skg-input" id="prof-display-name" required maxlength="80" value="${escapeHTML(p.displayName)}"></label>
                  <label><strong>Username</strong><input class="skg-input" id="prof-username" required maxlength="30" value="${escapeHTML(p.username)}"></label>
                </div>
                <label><strong>Bio</strong><textarea class="skg-textarea" id="prof-bio" rows="3" maxlength="320">${escapeHTML(p.bio || "")}</textarea></label>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                  <label><strong>Avatar URL</strong><input class="skg-input" id="prof-photo" value="${escapeHTML(p.photoURL || "")}"></label>
                  <label><strong>Visibility</strong>
                    <select class="skg-select" id="prof-visibility">
                      <option value="public" ${p.visibility !== "private" ? "selected" : ""}>Public</option>
                      <option value="private" ${p.visibility === "private" ? "selected" : ""}>Private</option>
                    </select>
                  </label>
                </div>
                <button type="submit" class="btn btn-primary" style="justify-self:start;">Save Public Profile</button>
              </form>

              ${!canPublish ? `
                <form id="studio-apply-form" class="skg-panel" style="display:grid;gap:0.8rem;">
                  <h3 class="skg-panel-title">Apply for Creator Publishing Access</h3>
                  <p class="skg-story-excerpt">Current Status: <strong>${escapeHTML(state.application?.status || p.creatorStatus || "not_applied")}</strong></p>
                  <label><strong>Topic Specialty</strong><input class="skg-input" id="apply-specialty" maxlength="100" value="${escapeHTML(state.application?.specialty || "")}" placeholder="e.g. Chitwan Food &amp; Culture, AI &amp; Student Notes"></label>
                  <label><strong>Publishing Pitch (min. 20 characters)</strong><textarea class="skg-textarea" id="apply-pitch" rows="3" required minlength="20" maxlength="800" placeholder="Describe what helpful topics you plan to publish…">${escapeHTML(state.application?.pitch || "")}</textarea></label>
                  <button type="submit" class="btn btn-primary" style="justify-self:start;">Submit Creator Application</button>
                </form>
              ` : ""}
            `;
        }

        root.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;margin-bottom:1.5rem;">
            <div>
              <span class="skg-kicker">Private Workspace · Noindex</span>
              <h1 style="font-size:clamp(1.5rem,2.6vw,2.1rem);color:var(--color-dark);">Creator Studio</h1>
            </div>
            <div style="display:flex;gap:0.6rem;">
              <a href="${escapeHTML(buildProfileUrl(p.username))}" class="btn btn-outline">View Public Profile</a>
              <a href="/explore.html" class="btn btn-outline">Explore Feed</a>
            </div>
          </div>

          <div class="skg-studio-shell">
            <nav class="skg-studio-nav" aria-label="Creator Studio Sections">
              ${navItems.map((n) => `
                <button type="button" class="skg-studio-nav-btn ${state.activeTab === n.id ? "active" : ""}" data-stab="${n.id}">${escapeHTML(n.label)}</button>
              `).join("")}
            </nav>
            <section>${panelHtml}</section>
          </div>
        `;

        wireStudioHandlers();
    }

    function wireStudioHandlers() {
        root.querySelectorAll("[data-stab]").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.activeTab = btn.dataset.stab || "overview";
                renderStudio();
            });
        });

        root.querySelectorAll("[data-range]").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.dateRange = btn.dataset.range || "28d";
                renderStudio();
            });
        });

        document.getElementById("btn-new-article")?.addEventListener("click", () => {
            resetEditor();
            state.activeTab = "editor";
            renderStudio();
        });

        // Editor live bindings & autosave
        const readEditorInputs = () => {
            state.editor.title = document.getElementById("ed-title")?.value || "";
            state.editor.subtitle = document.getElementById("ed-subtitle")?.value || "";
            state.editor.category = document.getElementById("ed-category")?.value || "food";
            state.editor.language = document.getElementById("ed-language")?.value || "en";
            state.editor.tags = document.getElementById("ed-tags")?.value || "";
            state.editor.visibility = document.getElementById("ed-visibility")?.value || "public";
            state.editor.coverImage = document.getElementById("ed-cover")?.value || "";
            state.editor.contentMarkdown = document.getElementById("ed-markdown")?.value || "";
            state.editor.slug = document.getElementById("ed-slug")?.value || "";
            state.editor.seoTitle = document.getElementById("ed-seo-title")?.value || "";
            state.editor.seoDescription = document.getElementById("ed-seo-desc")?.value || "";
        };

        const scheduleAutosave = () => {
            readEditorInputs();
            const previewEl = document.getElementById("ed-live-preview");
            const rtEl = document.getElementById("ed-readtime");
            if (previewEl) previewEl.innerHTML = renderSafeMarkdownToHtml(state.editor.contentMarkdown || "_Start writing…_");
            if (rtEl) rtEl.textContent = `${calculateReadingTimeMinutes(state.editor.contentMarkdown)} min read`;

            if (!state.autosaveEnabled || state.editor.isPublished) return;
            clearTimeout(state.autosaveTimer);
            state.autosaveTimer = setTimeout(async () => {
                if (!state.editor.title.trim() && !state.editor.contentMarkdown.trim()) return;
                try {
                    const saved = await saveCreatorDraft(state.user.uid, state.editor);
                    state.editor.id = saved.id;
                    state.autosaveStatus = `Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
                    const statusEl = document.getElementById("ed-autosave-status");
                    if (statusEl) statusEl.textContent = state.autosaveStatus;
                    state.drafts = await fetchCreatorDrafts(state.user.uid);
                } catch {
                    // Non-blocking autosave skip
                }
            }, 1500);
        };

        ["ed-title", "ed-subtitle", "ed-markdown", "ed-slug", "ed-seo-title", "ed-seo-desc"].forEach((id) => {
            document.getElementById(id)?.addEventListener("input", scheduleAutosave);
        });

        document.getElementById("ed-autosave-toggle")?.addEventListener("change", (e) => {
            state.autosaveEnabled = Boolean(e.target.checked);
        });

        const openConfirmModal = ({ title, message, confirmLabel = "Delete" }) => new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.className = "skg-modal-backdrop";
            overlay.innerHTML = `
              <div class="skg-modal-card" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
                <h2 style="margin-bottom:0.5rem;">${escapeHTML(title)}</h2>
                <p class="skg-story-excerpt" style="margin-bottom:1.1rem;">${escapeHTML(message)}</p>
                <div style="display:flex;justify-content:flex-end;gap:0.6rem;">
                  <button type="button" class="btn btn-outline" id="skg-studio-confirm-cancel">Cancel</button>
                  <button type="button" class="btn btn-primary" id="skg-studio-confirm-ok">${escapeHTML(confirmLabel)}</button>
                </div>
              </div>
            `;
            document.body.appendChild(overlay);
            const cleanup = (res) => {
                overlay.remove();
                resolve(res);
            };
            overlay.querySelector("#skg-studio-confirm-cancel")?.addEventListener("click", () => cleanup(false));
            overlay.querySelector("#skg-studio-confirm-ok")?.addEventListener("click", () => cleanup(true));
        });

        const showContentFeedback = (msg) => {
            const fb = document.getElementById("content-feedback");
            if (!fb) return;
            fb.hidden = !msg;
            fb.textContent = msg;
        };

        document.getElementById("ed-save-draft-btn")?.addEventListener("click", async (e) => {
            const btn = e.currentTarget;
            if (btn.disabled) return;
            btn.disabled = true;
            readEditorInputs();
            const fb = document.getElementById("ed-feedback");
            try {
                const saved = await saveCreatorDraft(state.user.uid, state.editor);
                state.editor.id = saved.id;
                state.drafts = await fetchCreatorDrafts(state.user.uid);
                if (fb) {
                    fb.hidden = false;
                    fb.textContent = "Private draft saved to your isolated drafts workspace.";
                }
            } catch (err) {
                if (fb) {
                    fb.hidden = false;
                    fb.textContent = err?.message || "Could not save draft.";
                }
            } finally {
                btn.disabled = false;
            }
        });

        document.getElementById("ed-reset-btn")?.addEventListener("click", () => {
            resetEditor();
            renderStudio();
        });

        document.getElementById("skg-editor-form")?.addEventListener("submit", async (e) => {
            e.preventDefault();
            readEditorInputs();
            const fb = document.getElementById("ed-feedback");
            const submitBtn = e.currentTarget.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;
            try {
                const pub = await publishCreatorArticle(state.user.uid, state.editor, state.profile);
                await loadStudioData(state.user);
                state.editor.id = pub.id;
                state.editor.slug = pub.slug;
                state.editor.isPublished = true;
                renderStudio();
                const fbAfter = document.getElementById("ed-feedback");
                if (fbAfter) {
                    fbAfter.hidden = false;
                    fbAfter.innerHTML = `Published! <a href="${escapeHTML(buildArticleUrl(pub.slug))}">View live article</a>`;
                }
            } catch (err) {
                if (submitBtn) submitBtn.disabled = false;
                if (fb) {
                    fb.hidden = false;
                    fb.textContent = err?.message || "Could not publish article.";
                }
            }
        });

        root.querySelectorAll("[data-edit-draft]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const d = state.drafts.find((x) => x.id === btn.dataset.editDraft);
                if (!d) return;
                state.editor = {
                    id: d.id,
                    title: d.title || "",
                    subtitle: d.subtitle || "",
                    slug: d.slug || "",
                    category: d.category || "food",
                    tags: Array.isArray(d.tags) ? d.tags.join(", ") : "",
                    coverImage: d.coverImage || "",
                    seoTitle: d.seoTitle || "",
                    seoDescription: d.seoDescription || "",
                    language: d.language || "en",
                    visibility: d.visibility || "public",
                    contentMarkdown: d.contentMarkdown || "",
                    isPublished: false
                };
                state.activeTab = "editor";
                renderStudio();
            });
        });

        root.querySelectorAll("[data-delete-draft]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const confirmed = await openConfirmModal({
                    title: "Delete Private Draft?",
                    message: "This private draft will be permanently removed.",
                    confirmLabel: "Delete Draft"
                });
                if (!confirmed) return;
                btn.disabled = true;
                try {
                    await deleteCreatorDraft(state.user.uid, btn.dataset.deleteDraft);
                    state.drafts = await fetchCreatorDrafts(state.user.uid);
                    renderStudio();
                } catch (err) {
                    btn.disabled = false;
                    showContentFeedback(err?.message || "Could not delete draft.");
                }
            });
        });

        root.querySelectorAll("[data-edit-pub]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const a = state.published.find((x) => x.id === btn.dataset.editPub);
                if (!a) return;
                state.editor = {
                    id: a.id,
                    title: a.title || "",
                    subtitle: a.subtitle || "",
                    slug: a.slug || "",
                    category: a.category || "food",
                    tags: Array.isArray(a.tags) ? a.tags.join(", ") : "",
                    coverImage: a.coverImage || "",
                    seoTitle: a.seoTitle || "",
                    seoDescription: a.seoDescription || "",
                    language: a.language || "en",
                    visibility: a.visibility || "public",
                    contentMarkdown: a.contentMarkdown || "",
                    isPublished: true
                };
                state.activeTab = "editor";
                renderStudio();
            });
        });

        root.querySelectorAll("[data-unpublish-pub]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                btn.disabled = true;
                try {
                    await unpublishArticleToDraft(state.user.uid, btn.dataset.unpublishPub);
                    await loadStudioData(state.user);
                    renderStudio();
                    showContentFeedback("Article moved back to your private drafts.");
                } catch (err) {
                    btn.disabled = false;
                    showContentFeedback(err?.message || "Could not move article to drafts.");
                }
            });
        });

        root.querySelectorAll("[data-delete-pub]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const confirmed = await openConfirmModal({
                    title: "Delete Published Article?",
                    message: "This will permanently unpublish and delete the article from public feeds.",
                    confirmLabel: "Delete Article"
                });
                if (!confirmed) return;
                btn.disabled = true;
                try {
                    await deletePublishedArticle(state.user.uid, btn.dataset.deletePub);
                    await loadStudioData(state.user);
                    renderStudio();
                } catch (err) {
                    btn.disabled = false;
                    showContentFeedback(err?.message || "Could not delete published article.");
                }
            });
        });

        document.getElementById("studio-profile-form")?.addEventListener("submit", async (e) => {
            e.preventDefault();
            const fb = document.getElementById("settings-feedback");
            const submitBtn = e.currentTarget.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;
            try {
                state.profile = await updatePublicProfile(state.user.uid, {
                    displayName: document.getElementById("prof-display-name")?.value,
                    username: document.getElementById("prof-username")?.value,
                    bio: document.getElementById("prof-bio")?.value,
                    photoURL: document.getElementById("prof-photo")?.value,
                    visibility: document.getElementById("prof-visibility")?.value
                });
                renderStudio();
                const fbAfter = document.getElementById("settings-feedback");
                if (fbAfter) {
                    fbAfter.hidden = false;
                    fbAfter.textContent = "Public profile updated.";
                }
            } catch (err) {
                if (submitBtn) submitBtn.disabled = false;
                if (fb) {
                    fb.hidden = false;
                    fb.textContent = err?.message || "Could not save profile.";
                }
            }
        });

        document.getElementById("studio-apply-form")?.addEventListener("submit", async (e) => {
            e.preventDefault();
            const fb = document.getElementById("settings-feedback");
            const submitBtn = e.currentTarget.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;
            try {
                state.application = await submitCreatorApplication(state.user.uid, {
                    specialty: document.getElementById("apply-specialty")?.value,
                    pitch: document.getElementById("apply-pitch")?.value
                });
                await loadStudioData(state.user);
                renderStudio();
                const fbAfter = document.getElementById("settings-feedback");
                if (fbAfter) {
                    fbAfter.hidden = false;
                    fbAfter.textContent = "Creator application submitted for admin review.";
                }
            } catch (err) {
                if (submitBtn) submitBtn.disabled = false;
                if (fb) {
                    fb.hidden = false;
                    fb.textContent = err?.message || "Application failed.";
                }
            }
        });
    }

    onCustomerAuthChange(async ({ user }) => {
        state.user = user || null;
        if (!user) {
            renderSignedOut();
            return;
        }
        try {
            await loadStudioData(user);
            renderStudio();
        } catch (err) {
            root.innerHTML = `
              <section class="skg-empty-card" style="max-width:620px;margin:2rem auto;">
                <h1>Unable to Load Creator Studio</h1>
                <p class="skg-story-excerpt" style="margin:0.5rem auto 1rem;">${escapeHTML(err?.message || "Please check your connection and try refreshing.")}</p>
                <a href="/explore.html" class="btn btn-outline">Back to Explore</a>
              </section>
            `;
        }
    });
});
