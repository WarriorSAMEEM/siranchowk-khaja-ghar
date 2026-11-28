// ============================================================================
// SIRANCHOWK KHAJA GHAR — ARTICLE VIEW, SOCIAL ACTIONS & COMMENTS CONTROLLER
// ============================================================================

import { onCustomerAuthChange } from "./customer-auth.js";
import {
    CATEGORY_MAP,
    escapeHTML,
    sanitizeUrl,
    extractHeadingsFromMarkdown,
    renderSafeMarkdownToHtml,
    buildArticleUrl,
    buildProfileUrl,
    buildCategoryUrl,
    SITE_ORIGIN
} from "./platform-core.js";
import { renderAuthorTicksHtml, renderProfileBadgesHtml } from "./badges.js";
import {
    resolveArticleBySlug,
    fetchPublishedArticles,
    fetchAllPublicProfilesMap,
    getRelatedArticles
} from "./blog-service.js";
import {
    isFollowingUser,
    toggleFollowUser,
    getUserArticleState,
    toggleArticleLike,
    toggleArticleBookmark,
    createRepost,
    fetchArticleComments,
    postArticleComment,
    editArticleComment,
    deleteArticleComment,
    submitContentReport,
    trackArticleEvent
} from "./social-service.js";

function readRequestedSlug() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("slug")) return params.get("slug");
    const path = window.location.pathname;
    if (path.startsWith("/blog/")) {
        return decodeURIComponent(path.slice("/blog/".length)).replace(/\/+$/, "");
    }
    return "";
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
    const root = document.getElementById("article-root");
    if (!root) return;

    const requestedSlug = readRequestedSlug();
    const ssr = readSsrState();

    const state = {
        user: null,
        article: ssr?.article || null,
        author: ssr?.author || null,
        allArticles: [],
        profiles: {},
        comments: [],
        liked: false,
        bookmarked: false,
        followingAuthor: false,
        replyingToId: "",
        editingCommentId: "",
        viewTracked: false,
        readCompleteTracked: false
    };

    if (!state.article && requestedSlug) {
        const resolved = await resolveArticleBySlug(requestedSlug);
        if (resolved.article) {
            state.article = resolved.article;
            if (resolved.redirectedFrom && window.history?.replaceState) {
                window.history.replaceState({}, "", buildArticleUrl(resolved.article.slug));
            }
        }
    } else if (requestedSlug) {
        // Hydrate latest engagement counters from live RTDB
        const resolved = await resolveArticleBySlug(requestedSlug);
        if (resolved.article) {
            state.article = resolved.article;
        }
    }

    if (!state.article) {
        root.innerHTML = `
          <section class="skg-empty-card">
            <h1>Article Not Found</h1>
            <p class="skg-story-excerpt" style="margin:0.5rem auto 1rem;">This story does not exist or may have been unpublished.</p>
            <a href="/explore.html" class="btn btn-primary">Explore Stories</a>
          </section>
        `;
        return;
    }

    const [allArticles, profiles, comments] = await Promise.all([
        fetchPublishedArticles(),
        fetchAllPublicProfilesMap(),
        fetchArticleComments(state.article.id, 60)
    ]);
    state.allArticles = allArticles;
    state.profiles = profiles;
    state.comments = comments;
    state.author = profiles[state.article.authorUid] || state.author || {
        uid: state.article.authorUid,
        username: state.article.authorUsername || "creator",
        displayName: state.article.authorName || "Creator",
        badges: {}
    };

    document.title = `${state.article.seoTitle || state.article.title} | Siranchowk Khaja Ghar`;

    function render() {
        const art = state.article;
        const author = state.author;
        const cat = CATEGORY_MAP[art.category] || { slug: art.category, name: art.category };
        const headings = extractHeadingsFromMarkdown(art.contentMarkdown || "");
        const bodyHtml = renderSafeMarkdownToHtml(art.contentMarkdown || "");
        const related = getRelatedArticles(art, state.allArticles, 3);
        const coverSafe = sanitizeUrl(art.coverImage || "", { allowRelative: true });
        const ticks = renderAuthorTicksHtml(author.badges || {}, author.specialtyNote || "");
        const fullUrl = `${SITE_ORIGIN}${buildArticleUrl(art.slug)}`;
        const isOwn = state.user?.uid === author.uid;

        const topComments = state.comments.filter((c) => !c.parentId);
        const repliesByParent = new Map();
        state.comments.filter((c) => c.parentId).forEach((rep) => {
            if (!repliesByParent.has(rep.parentId)) repliesByParent.set(rep.parentId, []);
            repliesByParent.get(rep.parentId).push(rep);
        });

        const renderCommentNode = (c, isReply = false) => {
            const cAuthor = state.profiles[c.authorUid];
            const cTicks = renderAuthorTicksHtml(cAuthor?.badges || c.authorBadges || {}, cAuthor?.specialtyNote || "");
            const canEdit = state.user?.uid === c.authorUid;
            const childReplies = !isReply ? (repliesByParent.get(c.id) || []) : [];

            return `
              <div class="skg-comment-item" id="comment-${escapeHTML(c.id)}">
                <div class="skg-story-meta" style="margin-bottom:0.35rem;">
                  <a href="${escapeHTML(buildProfileUrl(cAuthor?.username || c.authorUsername || "member"))}" class="skg-author-inline">
                    ${escapeHTML(cAuthor?.displayName || c.authorName || "Member")} ${cTicks}
                  </a>
                  <span>·</span>
                  <time>${escapeHTML(formatDate(c.createdAt))}</time>
                  ${c.edited ? "<span>· edited</span>" : ""}
                </div>

                ${state.editingCommentId === c.id ? `
                  <form data-edit-form="${escapeHTML(c.id)}" style="display:grid;gap:0.5rem;">
                    <textarea class="skg-textarea" rows="3" maxlength="1500">${escapeHTML(c.body)}</textarea>
                    <div style="display:flex;gap:0.5rem;">
                      <button type="submit" class="btn btn-primary" style="padding:0.4rem 0.9rem;">Save</button>
                      <button type="button" class="btn btn-outline" data-cancel-edit style="padding:0.4rem 0.9rem;">Cancel</button>
                    </div>
                  </form>
                ` : `<p style="white-space:pre-line;">${escapeHTML(c.body)}</p>`}

                <div class="skg-comment-actions">
                  ${!isReply ? `<button type="button" class="skg-link-btn" data-reply-to="${escapeHTML(c.id)}">Reply</button>` : ""}
                  ${canEdit ? `<button type="button" class="skg-link-btn" data-edit-comment="${escapeHTML(c.id)}">Edit</button>` : ""}
                  ${canEdit ? `<button type="button" class="skg-link-btn" data-delete-comment="${escapeHTML(c.id)}">Delete</button>` : ""}
                  <button type="button" class="skg-link-btn" data-report-comment="${escapeHTML(c.id)}">Report</button>
                </div>

                ${state.replyingToId === c.id ? `
                  <form data-reply-form="${escapeHTML(c.id)}" style="margin-top:0.75rem;display:grid;gap:0.5rem;">
                    <textarea class="skg-textarea" rows="2" maxlength="1500" placeholder="Write a reply…" required></textarea>
                    <div style="display:flex;gap:0.5rem;">
                      <button type="submit" class="btn btn-primary" style="padding:0.4rem 0.9rem;">Post Reply</button>
                      <button type="button" class="btn btn-outline" data-cancel-reply style="padding:0.4rem 0.9rem;">Cancel</button>
                    </div>
                  </form>
                ` : ""}

                ${childReplies.length ? `<div class="skg-comment-replies">${childReplies.map((r) => renderCommentNode(r, true)).join("")}</div>` : ""}
              </div>
            `;
        };

        root.innerHTML = `
          <div class="skg-article-layout">
            <article class="skg-article-sheet">
              <nav class="skg-breadcrumbs" aria-label="Breadcrumb">
                <a href="/">Home</a> <span>/</span>
                <a href="/blog.html">Blog</a> <span>/</span>
                <a href="${escapeHTML(buildCategoryUrl(cat.slug))}">${escapeHTML(cat.name)}</a>
              </nav>

              <header class="skg-article-header">
                <h1>${escapeHTML(art.title)}</h1>
                ${art.subtitle ? `<p class="skg-article-subtitle">${escapeHTML(art.subtitle)}</p>` : ""}
                <div class="skg-article-byline">
                  <a href="${escapeHTML(buildProfileUrl(author.username))}" class="skg-author-inline">${escapeHTML(author.displayName)} ${ticks}</a>
                  <span>·</span>
                  <time datetime="${new Date(Number(art.publishedAt) || Date.now()).toISOString()}">${escapeHTML(formatDate(art.publishedAt))}</time>
                  <span>·</span>
                  <span>${Number(art.readingTimeMin || 3)} min read</span>
                  <span>·</span>
                  <span class="skg-tabular">${Number(art.viewsCount || 0)} views</span>
                </div>
              </header>

              ${coverSafe ? `<img class="skg-article-cover" src="${escapeHTML(coverSafe)}" alt="${escapeHTML(art.title)}" referrerpolicy="no-referrer">` : ""}

              <div class="skg-article-prose" id="skg-article-prose-body">${bodyHtml}</div>

              ${Array.isArray(art.tags) && art.tags.length ? `
                <div class="skg-story-meta" style="margin-top:1.5rem;">
                  <strong>Topics:</strong>
                  ${art.tags.map((t) => `<a href="/explore.html?q=${encodeURIComponent(t)}">#${escapeHTML(t)}</a>`).join(" <span>·</span> ")}
                </div>
              ` : ""}

              <div class="skg-action-bar" role="group" aria-label="Article interactions">
                <button type="button" class="skg-action-btn ${state.liked ? "is-active" : ""}" id="btn-like-article">
                  ♥ Like (<span class="skg-tabular">${Number(art.likesCount || 0)}</span>)
                </button>
                <button type="button" class="skg-action-btn" id="btn-repost-article">
                  ↻ Repost (<span class="skg-tabular">${Number(art.repostsCount || 0)}</span>)
                </button>
                <button type="button" class="skg-action-btn ${state.bookmarked ? "is-active" : ""}" id="btn-bookmark-article">
                  ${state.bookmarked ? "★ Saved" : "☆ Save"}
                </button>
                <button type="button" class="skg-action-btn" id="btn-share-article">
                  ↗ Share (<span class="skg-tabular">${Number(art.sharesCount || 0)}</span>)
                </button>
                <a class="skg-action-btn" href="https://wa.me/?text=${encodeURIComponent(`${art.title} — ${fullUrl}`)}" target="_blank" rel="noopener noreferrer" id="btn-share-wa">
                  WhatsApp
                </a>
                <button type="button" class="skg-link-btn" id="btn-report-article" style="margin-left:auto;">
                  Report Article
                </button>
              </div>

              <div id="skg-action-feedback" class="skg-notice" hidden style="margin-bottom:1rem;"></div>

              <section class="skg-comments-section" id="comments">
                <h2 style="margin-bottom:0.85rem;">Comments &amp; Discussion (<span class="skg-tabular">${state.comments.length}</span>)</h2>
                <form id="skg-new-comment-form" style="display:grid;gap:0.65rem;margin-bottom:1.25rem;">
                  <textarea id="skg-new-comment-input" class="skg-textarea" rows="3" maxlength="1500" placeholder="${state.user ? "Share a thoughtful response…" : "Sign in to join the discussion…"}" ${state.user ? "" : "readonly"}></textarea>
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;">
                    ${state.user
                      ? `<button type="submit" class="btn btn-primary">Post Comment</button>`
                      : `<a href="/account.html?mode=login&redirect=${encodeURIComponent(buildArticleUrl(art.slug))}" class="btn btn-primary">Sign In to Comment</a>`}
                  </div>
                </form>
                ${topComments.length
                  ? topComments.map((c) => renderCommentNode(c)).join("")
                  : `<p class="skg-story-excerpt">No comments yet. Be the first to add perspective.</p>`}
              </section>
            </article>

            <aside class="skg-aside-stack">
              <div class="skg-panel">
                <h2 class="skg-panel-title">About the Author</h2>
                <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.65rem;">
                  ${author.photoURL
                    ? `<img class="skg-avatar" src="${escapeHTML(sanitizeUrl(author.photoURL))}" alt="${escapeHTML(author.displayName)}" referrerpolicy="no-referrer">`
                    : `<div class="skg-avatar">${escapeHTML(author.displayName.charAt(0).toUpperCase())}</div>`}
                  <div>
                    <a href="${escapeHTML(buildProfileUrl(author.username))}" class="skg-author-inline">${escapeHTML(author.displayName)} ${ticks}</a>
                    <div class="skg-story-meta">@${escapeHTML(author.username)}</div>
                  </div>
                </div>
                ${renderProfileBadgesHtml(author.badges || {}, { includeEmailVerified: false, specialtyNote: author.specialtyNote || "" })}
                ${author.bio ? `<p class="skg-story-excerpt" style="margin:0.6rem 0 0.85rem;">${escapeHTML(author.bio)}</p>` : ""}
                <div class="skg-story-meta" style="margin-bottom:0.85rem;">
                  <span class="skg-tabular">${Number(author.followersCount || 0)} followers</span>
                  <span>·</span>
                  <span class="skg-tabular">${Number(author.articlesCount || 0)} articles</span>
                </div>
                ${!isOwn ? `
                  <button type="button" class="btn ${state.followingAuthor ? "btn-outline" : "btn-primary"}" id="btn-follow-author" style="width:100%;">
                    ${state.followingAuthor ? "Following" : "Follow Author"}
                  </button>
                ` : `<a href="/creator-studio.html" class="btn btn-outline" style="width:100%;">Manage in Creator Studio</a>`}
              </div>

              ${headings.length ? `
                <div class="skg-panel">
                  <h2 class="skg-panel-title">Table of Contents</h2>
                  <nav class="skg-toc-list" aria-label="Table of contents">
                    ${headings.map((h) => `<a href="#${escapeHTML(h.id)}" class="${h.level === 3 ? "skg-toc-level-3" : ""}">${escapeHTML(h.text)}</a>`).join("")}
                  </nav>
                </div>
              ` : ""}

              ${related.length ? `
                <div class="skg-panel">
                  <h2 class="skg-panel-title">Related Stories</h2>
                  <div style="display:grid;gap:0.85rem;">
                    ${related.map((r) => `
                      <div style="border-top:1px solid var(--color-border);padding-top:0.65rem;">
                        <a href="${escapeHTML(buildArticleUrl(r.slug))}" style="font-weight:700;color:var(--color-dark);display:block;margin-bottom:0.2rem;">${escapeHTML(r.title)}</a>
                        <div class="skg-story-meta">${escapeHTML(r.authorName || "Creator")} · ${Number(r.readingTimeMin || 3)} min read</div>
                      </div>
                    `).join("")}
                  </div>
                </div>
              ` : ""}
            </aside>
          </div>
        `;

        wireHandlers(fullUrl);
      }

    function showFeedback(msg) {
        const box = document.getElementById("skg-action-feedback");
        if (!box) return;
        box.hidden = !msg;
        box.textContent = msg;
    }

    function requireSignIn() {
        if (state.user) return true;
        const returnTo = `${window.location.pathname || "/explore.html"}${window.location.search || ""}`;
        window.location.href = `/account.html?mode=login&redirect=${encodeURIComponent(returnTo)}`;
        return false;
    }

    function openConfirmModal({ title, message, confirmLabel = "Delete" }) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.className = "skg-modal-backdrop";
            overlay.innerHTML = `
              <div class="skg-modal-card" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
                <h2 style="margin-bottom:0.5rem;">${escapeHTML(title)}</h2>
                <p class="skg-story-excerpt" style="margin-bottom:1.1rem;">${escapeHTML(message)}</p>
                <div style="display:flex;justify-content:flex-end;gap:0.6rem;">
                  <button type="button" class="btn btn-outline" id="skg-confirm-cancel">Cancel</button>
                  <button type="button" class="btn btn-primary" id="skg-confirm-ok">${escapeHTML(confirmLabel)}</button>
                </div>
              </div>
            `;
            document.body.appendChild(overlay);
            const cleanup = (result) => {
                overlay.remove();
                resolve(result);
            };
            overlay.querySelector("#skg-confirm-cancel")?.addEventListener("click", () => cleanup(false));
            overlay.querySelector("#skg-confirm-ok")?.addEventListener("click", () => cleanup(true));
        });
    }

    function wireHandlers(fullUrl) {
        document.getElementById("btn-like-article")?.addEventListener("click", async (e) => {
            if (!requireSignIn()) return;
            const btn = e.currentTarget;
            if (btn.disabled) return;
            btn.disabled = true;
            try {
                const res = await toggleArticleLike(state.article);
                state.liked = res.liked;
                state.article.likesCount = Math.max(0, Number(state.article.likesCount || 0) + (res.liked ? 1 : -1));
                render();
            } catch (err) {
                btn.disabled = false;
                showFeedback(err?.message || "Could not update like right now.");
            }
        });

        document.getElementById("btn-bookmark-article")?.addEventListener("click", async (e) => {
            if (!requireSignIn()) return;
            const btn = e.currentTarget;
            if (btn.disabled) return;
            btn.disabled = true;
            try {
                const res = await toggleArticleBookmark(state.article);
                state.bookmarked = res.bookmarked;
                render();
                showFeedback(res.bookmarked ? "Saved to your private bookmarks in My Account." : "Removed from bookmarks.");
            } catch (err) {
                btn.disabled = false;
                showFeedback(err?.message || "Could not update bookmark right now.");
            }
        });

        document.getElementById("btn-repost-article")?.addEventListener("click", async (e) => {
            if (!requireSignIn()) return;
            const btn = e.currentTarget;
            if (btn.disabled) return;
            btn.disabled = true;
            try {
                const res = await createRepost(state.article);
                if (res.alreadyReposted) {
                    btn.disabled = false;
                    showFeedback("You already reposted this article to your profile.");
                    return;
                }
                state.article.repostsCount = Number(state.article.repostsCount || 0) + 1;
                render();
                showFeedback("Reposted to your public profile with original author attribution.");
            } catch (err) {
                btn.disabled = false;
                showFeedback(err?.message || "Could not repost article right now.");
            }
        });

        document.getElementById("btn-share-article")?.addEventListener("click", async () => {
            trackArticleEvent(state.article.id, "share").catch(() => {});
            state.article.sharesCount = Number(state.article.sharesCount || 0) + 1;
            if (navigator.share) {
                await navigator.share({ title: state.article.title, url: fullUrl }).catch(() => {});
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(fullUrl).catch(() => {});
            }
            render();
            showFeedback("Article link copied and ready to share.");
        });

        document.getElementById("btn-share-wa")?.addEventListener("click", () => {
            trackArticleEvent(state.article.id, "share").catch(() => {});
        });

        document.getElementById("btn-follow-author")?.addEventListener("click", async (e) => {
            if (!requireSignIn()) return;
            const btn = e.currentTarget;
            if (btn.disabled) return;
            btn.disabled = true;
            try {
                const res = await toggleFollowUser(state.author.uid);
                state.followingAuthor = res.following;
                state.author.followersCount = Math.max(0, Number(state.author.followersCount || 0) + (res.following ? 1 : -1));
                render();
            } catch (err) {
                btn.disabled = false;
                showFeedback(err?.message || "Could not update follow status.");
            }
        });

        document.getElementById("btn-report-article")?.addEventListener("click", () => {
            openReportModal("article", state.article.id);
        });

        document.getElementById("skg-new-comment-form")?.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!requireSignIn()) return;
            const input = document.getElementById("skg-new-comment-input");
            const txt = input?.value?.trim() || "";
            if (!txt) return;
            const submitBtn = e.currentTarget.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;
            try {
                const created = await postArticleComment(state.article, txt, "");
                state.comments.push(created);
                state.article.commentsCount = Number(state.article.commentsCount || 0) + 1;
                render();
            } catch (err) {
                if (submitBtn) submitBtn.disabled = false;
                showFeedback(err?.message || "Could not post comment.");
            }
        });

        root.querySelectorAll("[data-reply-to]").forEach((btn) => {
            btn.addEventListener("click", () => {
                if (!requireSignIn()) return;
                state.replyingToId = btn.dataset.replyTo || "";
                render();
            });
        });

        root.querySelectorAll("[data-cancel-reply]").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.replyingToId = "";
                render();
            });
        });

        root.querySelectorAll("[data-reply-form]").forEach((form) => {
            form.addEventListener("submit", async (e) => {
                e.preventDefault();
                if (!requireSignIn()) return;
                const parentId = form.dataset.replyForm;
                const txt = form.querySelector("textarea")?.value?.trim() || "";
                if (!txt) return;
                const submitBtn = form.querySelector('button[type="submit"]');
                if (submitBtn) submitBtn.disabled = true;
                try {
                    const created = await postArticleComment(state.article, txt, parentId);
                    state.comments.push(created);
                    state.replyingToId = "";
                    state.article.commentsCount = Number(state.article.commentsCount || 0) + 1;
                    render();
                } catch (err) {
                    if (submitBtn) submitBtn.disabled = false;
                    showFeedback(err?.message || "Could not post reply.");
                }
            });
        });

        root.querySelectorAll("[data-edit-comment]").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.editingCommentId = btn.dataset.editComment || "";
                render();
            });
        });

        root.querySelectorAll("[data-cancel-edit]").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.editingCommentId = "";
                render();
            });
        });

        root.querySelectorAll("[data-edit-form]").forEach((form) => {
            form.addEventListener("submit", async (e) => {
                e.preventDefault();
                const commentId = form.dataset.editForm;
                const txt = form.querySelector("textarea")?.value?.trim() || "";
                if (!txt) return;
                const submitBtn = form.querySelector('button[type="submit"]');
                if (submitBtn) submitBtn.disabled = true;
                try {
                    await editArticleComment(state.article.id, commentId, txt);
                    const target = state.comments.find((c) => c.id === commentId);
                    if (target) {
                        target.body = txt;
                        target.edited = true;
                    }
                    state.editingCommentId = "";
                    render();
                } catch (err) {
                    if (submitBtn) submitBtn.disabled = false;
                    showFeedback(err?.message || "Could not save comment edit.");
                }
            });
        });

        root.querySelectorAll("[data-delete-comment]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const commentId = btn.dataset.deleteComment;
                const confirmed = await openConfirmModal({
                    title: "Delete Comment?",
                    message: "This will permanently remove your comment from the discussion.",
                    confirmLabel: "Delete Comment"
                });
                if (!confirmed) return;
                btn.disabled = true;
                try {
                    await deleteArticleComment(state.article.id, commentId);
                    state.comments = state.comments.filter((c) => c.id !== commentId);
                    state.article.commentsCount = Math.max(0, Number(state.article.commentsCount || 0) - 1);
                    render();
                } catch (err) {
                    btn.disabled = false;
                    showFeedback(err?.message || "Could not delete comment.");
                }
            });
        });

        root.querySelectorAll("[data-report-comment]").forEach((btn) => {
            btn.addEventListener("click", () => {
                openReportModal("comment", btn.dataset.reportComment, state.article.id);
            });
        });
    }

    function openReportModal(targetType, targetId, parentId = "") {
        if (!requireSignIn()) return;
        const overlay = document.createElement("div");
        overlay.className = "skg-modal-backdrop";
        overlay.innerHTML = `
          <div class="skg-modal-card" role="dialog" aria-modal="true" aria-label="Report Content">
            <h2 style="margin-bottom:0.5rem;">Report ${escapeHTML(targetType)}</h2>
            <p class="skg-story-excerpt" style="margin-bottom:1rem;">Reports are reviewed privately by Siranchowk Khaja Ghar moderators.</p>
            <form id="skg-report-form" style="display:grid;gap:0.75rem;">
              <select class="skg-select" id="skg-report-reason" required>
                <option value="Misleading or inaccurate information">Misleading or inaccurate information</option>
                <option value="Spam or commercial promotion">Spam or commercial promotion</option>
                <option value="Harassment or abusive language">Harassment or abusive language</option>
                <option value="Copyright or impersonation">Copyright or impersonation</option>
              </select>
              <textarea class="skg-textarea" id="skg-report-details" rows="3" maxlength="400" placeholder="Optional context for moderators…"></textarea>
              <div style="display:flex;justify-content:flex-end;gap:0.6rem;">
                <button type="button" class="btn btn-outline" id="skg-report-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">Submit Report</button>
              </div>
            </form>
          </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector("#skg-report-cancel")?.addEventListener("click", () => overlay.remove());
        overlay.querySelector("#skg-report-form")?.addEventListener("submit", async (e) => {
            e.preventDefault();
            const submitBtn = overlay.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;
            const reason = overlay.querySelector("#skg-report-reason")?.value || "";
            const details = overlay.querySelector("#skg-report-details")?.value || "";
            try {
                await submitContentReport({ targetType, targetId, parentId, reason, details });
                overlay.remove();
                showFeedback("Report submitted. Our moderation team will review it.");
            } catch (err) {
                if (submitBtn) submitBtn.disabled = false;
                overlay.remove();
                showFeedback(err?.message || "Could not submit report.");
            }
        });
    }

    render();

    if (!state.viewTracked) {
        state.viewTracked = true;
        trackArticleEvent(state.article.id, "view").catch(() => {});
    }

    // Track honest read completion when reader scrolls past 75% of article body
    const onScroll = () => {
        if (state.readCompleteTracked) return;
        const prose = document.getElementById("skg-article-prose-body");
        if (!prose) return;
        const rect = prose.getBoundingClientRect();
        const scrolledRatio = (window.innerHeight - rect.top) / Math.max(1, rect.height);
        if (scrolledRatio >= 0.75) {
            state.readCompleteTracked = true;
            window.removeEventListener("scroll", onScroll);
            trackArticleEvent(state.article.id, "read_complete").catch(() => {});
        }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    onCustomerAuthChange(async ({ user }) => {
        state.user = user || null;
        if (user && state.article) {
            const [artState, following] = await Promise.all([
                getUserArticleState(state.article.id, user.uid),
                isFollowingUser(user.uid, state.author.uid)
            ]);
            state.liked = artState.liked;
            state.bookmarked = artState.bookmarked;
            state.followingAuthor = following;
        } else {
            state.liked = false;
            state.bookmarked = false;
            state.followingAuthor = false;
        }
        render();
    });
});
