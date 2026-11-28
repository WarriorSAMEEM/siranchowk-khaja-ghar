// ============================================================================
// SIRANCHOWK KHAJA GHAR — EXPLORE & EDITORIAL BLOG CONTROLLER
// ============================================================================

import {
    onCustomerAuthChange
} from "./customer-auth.js";
import {
    PLATFORM_CATEGORIES,
    CATEGORY_MAP,
    escapeHTML,
    sanitizeUrl,
    buildArticleUrl,
    buildProfileUrl,
    buildCategoryUrl
} from "./platform-core.js";
import { renderAuthorTicksHtml } from "./badges.js";
import {
    fetchPublishedArticles,
    fetchAllPublicProfilesMap,
    getPlatformCategories,
    buildDiscoveryFeeds
} from "./blog-service.js";
import {
    getFollowingUidsSet,
    fetchUserBookmarks,
    toggleFollowUser
} from "./social-service.js";

function parseInitialContext() {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    let categorySlug = params.get("category") || "all";
    if (path.startsWith("/category/")) {
        categorySlug = decodeURIComponent(path.slice("/category/".length)).replace(/\/+$/, "") || "all";
    }
    const isBlog = path.startsWith("/blog");
    return {
        isBlog,
        categorySlug,
        tab: params.get("tab") || (isBlog ? "latest" : "explore"),
        searchQuery: params.get("q") || ""
    };
}

function formatDate(ms) {
    try {
        return new Date(Number(ms) || Date.now()).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "Asia/Kathmandu"
        });
    } catch {
        return "2026";
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    const ctx = parseInitialContext();
    const state = {
        user: null,
        articles: [],
        profiles: {},
        categories: [...PLATFORM_CATEGORIES],
        followedUids: new Set(),
        bookmarkedCategories: new Set(),
        activeTab: ctx.tab,
        categorySlug: ctx.categorySlug,
        searchQuery: ctx.searchQuery
    };

    const feedHost = document.getElementById("discovery-feed-ssr-slot");
    const catBar = document.getElementById("discovery-categories-bar");
    const creatorsHost = document.getElementById("discovery-creators-aside");
    const searchInput = document.getElementById("discovery-search-input");
    const tabBtns = [...document.querySelectorAll(".skg-tab-btn[data-tab]")];

    if (searchInput) searchInput.value = state.searchQuery;

    function renderCategoryBar() {
        if (!catBar) return;
        const allItems = [
            { slug: "all", name: "All Topics" },
            ...state.categories
        ];
        catBar.innerHTML = allItems
            .map((cat) => {
                const href = cat.slug === "all" ? "/explore" : buildCategoryUrl(cat.slug);
                const active = state.categorySlug.toLowerCase() === cat.slug.toLowerCase();
                return `<a href="${escapeHTML(href)}" data-cat="${escapeHTML(cat.slug)}" class="skg-cat-link ${active ? "active" : ""}">${escapeHTML(cat.name)}</a>`;
            })
            .join("");

        catBar.querySelectorAll("[data-cat]").forEach((el) => {
            el.addEventListener("click", (e) => {
                e.preventDefault();
                state.categorySlug = el.dataset.cat || "all";
                renderCategoryBar();
                renderFeeds();
            });
        });
    }

    function renderCreatorsAside() {
        if (!creatorsHost) return;
        const publicCreators = Object.values(state.profiles)
            .filter((p) => p && p.username && p.visibility !== "private")
            .sort((a, b) => Number(b.followersCount || 0) - Number(a.followersCount || 0))
            .slice(0, 5);

        if (!publicCreators.length) {
            creatorsHost.innerHTML = `<p class="skg-story-excerpt">Apply from your account to become a featured community creator.</p>`;
            return;
        }

        creatorsHost.innerHTML = publicCreators
            .map((p) => {
                const isMe = state.user?.uid === p.uid;
                const isFollowing = state.followedUids.has(p.uid);
                const ticks = renderAuthorTicksHtml(p.badges || {}, p.specialtyNote || "");
                return `
                  <div class="skg-creator-row">
                    <div style="display:flex;align-items:center;gap:0.65rem;min-width:0;">
                      ${p.photoURL
                        ? `<img class="skg-avatar" src="${escapeHTML(sanitizeUrl(p.photoURL))}" alt="${escapeHTML(p.displayName)}" referrerpolicy="no-referrer">`
                        : `<div class="skg-avatar">${escapeHTML(p.displayName.charAt(0).toUpperCase())}</div>`}
                      <div style="min-width:0;">
                        <a href="${escapeHTML(buildProfileUrl(p.username))}" class="skg-author-inline">${escapeHTML(p.displayName)} ${ticks}</a>
                        <div class="skg-story-meta">@${escapeHTML(p.username)} · ${Number(p.followersCount || 0)} followers</div>
                      </div>
                    </div>
                    ${!isMe ? `
                      <button type="button" class="skg-action-btn ${isFollowing ? "is-active" : ""}" data-follow-uid="${escapeHTML(p.uid)}" style="padding:0.35rem 0.65rem;font-size:0.8rem;">
                        ${isFollowing ? "Following" : "Follow"}
                      </button>
                    ` : ""}
                  </div>
                `;
            })
            .join("");

        creatorsHost.querySelectorAll("[data-follow-uid]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                if (!state.user) {
                    window.location.href = `/account.html?mode=login&redirect=${encodeURIComponent("explore.html")}`;
                    return;
                }
                const targetUid = btn.dataset.followUid;
                btn.disabled = true;
                try {
                    const res = await toggleFollowUser(targetUid);
                    if (res.following) state.followedUids.add(targetUid);
                    else state.followedUids.delete(targetUid);
                    state.profiles = await fetchAllPublicProfilesMap();
                    renderCreatorsAside();
                    renderFeeds();
                } catch (err) {
                    console.warn("Follow action failed:", err?.message || err);
                } finally {
                    btn.disabled = false;
                }
            });
        });
    }

    function renderFeeds() {
        if (!feedHost) return;
        const feeds = buildDiscoveryFeeds(state.articles, state.profiles, {
            followedUids: state.followedUids,
            bookmarkedCategories: state.bookmarkedCategories,
            searchQuery: state.searchQuery,
            categorySlug: state.categorySlug
        });

        let list = feeds.latest;
        if (state.activeTab === "trending") list = feeds.trending;
        else if (state.activeTab === "following") list = feeds.following;
        else if (state.activeTab === "recommended") list = feeds.recommended;
        else if (state.activeTab === "explore") list = feeds.recommended;

        tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === state.activeTab));

        if (state.activeTab === "following" && !state.user) {
            feedHost.innerHTML = `
              <div class="skg-empty-card">
                <h2>Sign in to see your Following feed</h2>
                <p class="skg-story-excerpt" style="margin:0.5rem auto 1rem;max-width:48ch;">Follow writers and topic specialists across Siranchowk Khaja Ghar to keep up with their latest stories here.</p>
                <a href="/account.html?mode=login&redirect=explore.html" class="btn btn-primary">Sign In</a>
              </div>
            `;
            return;
        }

        if (!list.length) {
            feedHost.innerHTML = `
              <div class="skg-empty-card">
                <h2>No matching stories yet</h2>
                <p class="skg-story-excerpt" style="margin:0.5rem auto 1rem;max-width:48ch;">Try another keyword or topic filter, or become a contributor in Creator Studio.</p>
                <button type="button" class="btn btn-outline" id="skg-reset-filters-btn">Show All Topics</button>
              </div>
            `;
            feedHost.querySelector("#skg-reset-filters-btn")?.addEventListener("click", () => {
                state.categorySlug = "all";
                state.searchQuery = "";
                state.activeTab = "latest";
                if (searchInput) searchInput.value = "";
                renderCategoryBar();
                renderFeeds();
            });
            return;
        }

        feedHost.innerHTML = `<div class="skg-feed-grid ${ctx.isBlog ? "is-two-col" : ""}">${list
            .map((art) => {
                const author = state.profiles[art.authorUid];
                const catName = CATEGORY_MAP[art.category]?.name || art.category;
                const authorName = author?.displayName || art.authorName || "Siranchowk Khaja Ghar";
                const authorHref = author?.username ? buildProfileUrl(author.username) : "/explore";
                const ticks = renderAuthorTicksHtml(author?.badges || {}, author?.specialtyNote || "");
                const coverSafe = sanitizeUrl(art.coverImage || "", { allowRelative: true });
                return `
                  <article class="skg-story-card">
                    ${coverSafe ? `<a href="${escapeHTML(buildArticleUrl(art.slug))}"><img class="skg-story-cover" src="${escapeHTML(coverSafe)}" alt="${escapeHTML(art.title)}" loading="lazy" referrerpolicy="no-referrer"></a>` : ""}
                    <div class="skg-story-meta">
                      <a href="${escapeHTML(buildCategoryUrl(art.category))}">${escapeHTML(catName)}</a>
                      <span>·</span>
                      <time datetime="${new Date(Number(art.publishedAt) || Date.now()).toISOString()}">${escapeHTML(formatDate(art.publishedAt))}</time>
                      <span>·</span>
                      <span>${Number(art.readingTimeMin || 3)} min read</span>
                    </div>
                    <h2 class="skg-story-title"><a href="${escapeHTML(buildArticleUrl(art.slug))}">${escapeHTML(art.title)}</a></h2>
                    ${art.subtitle ? `<p class="skg-story-excerpt">${escapeHTML(art.subtitle)}</p>` : ""}
                    ${(state.activeTab === "recommended" || state.activeTab === "explore") && art.recommendReason ? `<div class="skg-story-reason">${escapeHTML(art.recommendReason)}</div>` : ""}
                    <div class="skg-story-footer">
                      <a href="${escapeHTML(authorHref)}" class="skg-author-inline">${escapeHTML(authorName)} ${ticks}</a>
                      <span class="skg-story-stats">${Number(art.viewsCount || 0)} views · ${Number(art.likesCount || 0)} likes · ${Number(art.commentsCount || 0)} comments</span>
                    </div>
                  </article>
                `;
            })
            .join("")}</div>`;
    }

    tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            state.activeTab = btn.dataset.tab || "latest";
            renderFeeds();
        });
    });

    searchInput?.addEventListener("input", () => {
        state.searchQuery = searchInput.value;
        renderFeeds();
    });

    const [articles, profiles, categories] = await Promise.all([
        fetchPublishedArticles(),
        fetchAllPublicProfilesMap(),
        getPlatformCategories()
    ]);
    state.articles = articles;
    state.profiles = profiles;
    state.categories = categories;
    renderCategoryBar();
    renderCreatorsAside();
    renderFeeds();

    onCustomerAuthChange(async ({ user }) => {
        state.user = user || null;
        if (user) {
            const [followed, bookmarks] = await Promise.all([
                getFollowingUidsSet(user.uid),
                fetchUserBookmarks(user.uid)
            ]);
            state.followedUids = followed;
            state.bookmarkedCategories = new Set(bookmarks.map((b) => b.category).filter(Boolean));
        } else {
            state.followedUids = new Set();
            state.bookmarkedCategories = new Set();
        }
        renderCreatorsAside();
        renderFeeds();
    });
});
