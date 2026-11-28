// ============================================================================
// SIRANCHOWK KHAJA GHAR — BLOG, PUBLISHING & DISCOVERY SERVICE
// ============================================================================
// Manages creator drafts (isolated per UID), published articles, Unicode-safe
// slugs + disambiguation + 301 redirect mappings, discovery feeds (Latest,
// Trending, Following, Explainable Recommended), search, and related posts.
// ============================================================================

import {
    auth,
    db,
    ref,
    get,
    set,
    update,
    remove
} from "./firebase.js";
import {
    PLATFORM_CATEGORIES,
    CATEGORY_MAP,
    DEFAULT_EDITORIAL_ARTICLES,
    DEFAULT_PUBLIC_PROFILES,
    slugifyUnicode,
    ensureUniqueSlug,
    calculateReadingTimeMinutes,
    computeTrendingScore,
    sanitizeUrl
} from "./platform-core.js";

function sanitizeTags(rawTags) {
    const arr = Array.isArray(rawTags)
        ? rawTags
        : String(rawTags || "").split(",");
    const seen = new Set();
    const clean = [];
    for (const item of arr) {
        const tag = String(item || "")
            .trim()
            .toLowerCase()
            .replace(/^#+/, "")
            .replace(/[^\p{L}\p{M}\p{N}-]+/gu, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 32);
        if (tag && !seen.has(tag)) {
            seen.add(tag);
            clean.push(tag);
        }
        if (clean.length >= 8) break;
    }
    return clean;
}

export async function getPlatformCategories() {
    try {
        const snap = await get(ref(db, "platformCategories"));
        if (snap.exists()) {
            const val = snap.val();
            const list = Array.isArray(val) ? val : Object.values(val || {});
            const valid = list.filter((c) => c && c.slug && c.name && c.enabled !== false && c.active !== false);
            if (valid.length) return valid;
        }
    } catch {
        // Fallback to curated platform categories
    }
    return [...PLATFORM_CATEGORIES];
}

export async function fetchAllPublicProfilesMap() {
    const merged = { ...DEFAULT_PUBLIC_PROFILES };
    try {
        const snap = await get(ref(db, "publicProfiles"));
        if (snap.exists()) {
            const raw = snap.val() || {};
            for (const [uid, profile] of Object.entries(raw)) {
                if (profile && typeof profile === "object") {
                    merged[uid] = {
                        ...(merged[uid] || {}),
                        ...profile,
                        uid
                    };
                }
            }
        }
    } catch (err) {
        console.warn("Could not load publicProfiles:", err?.message || err);
    }
    return merged;
}

export async function fetchPublishedArticles({ includeUnlisted = false } = {}) {
    const merged = new Map();
    for (const art of DEFAULT_EDITORIAL_ARTICLES) {
        merged.set(art.id, {
            ...art,
            isEditorialDefault: true,
            trendingScore: computeTrendingScore(art)
        });
    }

    try {
        const snap = await get(ref(db, "publishedArticles"));
        if (snap.exists()) {
            const val = snap.val() || {};
            for (const [id, item] of Object.entries(val)) {
                if (!item || item.status !== "published") continue;
                if (item.visibility === "private") continue;
                if (!includeUnlisted && item.visibility === "unlisted") continue;
                merged.set(id, {
                    ...item,
                    id,
                    trendingScore: Number(item.trendingScore ?? computeTrendingScore(item))
                });
            }
        }
    } catch (err) {
        console.warn("Could not load publishedArticles:", err?.message || err);
    }

    return [...merged.values()].sort(
        (a, b) => Number(b.publishedAt || b.updatedAt || 0) - Number(a.publishedAt || a.updatedAt || 0)
    );
}

export async function resolveArticleBySlug(rawSlug) {
    const cleanSlug = decodeURIComponent(String(rawSlug || "")).normalize("NFC").trim().toLowerCase();
    if (!cleanSlug) return { article: null, redirectedFrom: "" };

    const all = await fetchPublishedArticles({ includeUnlisted: true });
    const direct = all.find((a) => String(a.slug || "").normalize("NFC").toLowerCase() === cleanSlug);
    if (direct) {
        return { article: direct, redirectedFrom: "" };
    }

    // Check redirect registry
    try {
        const redirSnap = await get(ref(db, `slugRedirects/${cleanSlug}`));
        if (redirSnap.exists()) {
            const redir = redirSnap.val();
            const targetId = redir?.articleId;
            const targetSlug = String(redir?.targetSlug || redir?.toSlug || "").normalize("NFC").toLowerCase();
            const target = all.find((a) => (targetId && a.id === targetId) || (targetSlug && String(a.slug || "").toLowerCase() === targetSlug));
            if (target) {
                return { article: target, redirectedFrom: cleanSlug };
            }
        }
    } catch {
        // Ignore redirect lookup error
    }

    // Also allow lookup by direct article ID
    const byId = all.find((a) => a.id === rawSlug);
    if (byId) {
        return { article: byId, redirectedFrom: "" };
    }

    return { article: null, redirectedFrom: "" };
}

export async function fetchCreatorDrafts(uid) {
    if (!uid || auth.currentUser?.uid !== uid) {
        throw new Error("Authentication required to read private drafts.");
    }
    const snap = await get(ref(db, `creatorDrafts/${uid}`));
    if (!snap.exists()) return [];
    const val = snap.val() || {};
    return Object.entries(val)
        .map(([id, item]) => ({ ...item, id }))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export async function saveCreatorDraft(uid, draftInput = {}) {
    if (!uid || auth.currentUser?.uid !== uid) {
        throw new Error("You can only save drafts in your own Creator Studio.");
    }

    const now = Date.now();
    const articleId = String(draftInput.id || `art_${now}_${Math.random().toString(36).slice(2, 8)}`).replace(/[^A-Za-z0-9_-]/g, "");
    const title = String(draftInput.title || "Untitled Draft").trim().slice(0, 180) || "Untitled Draft";
    const category = CATEGORY_MAP[draftInput.category] ? draftInput.category : "food";
    const contentMarkdown = String(draftInput.contentMarkdown || "").slice(0, 80000);
    const desiredSlug = String(draftInput.slug || "").trim();
    const slug = desiredSlug ? slugifyUnicode(desiredSlug) : slugifyUnicode(title);

    const payload = {
        id: articleId,
        authorUid: uid,
        title,
        subtitle: String(draftInput.subtitle || "").trim().slice(0, 280),
        slug,
        category,
        tags: sanitizeTags(draftInput.tags),
        coverImage: sanitizeUrl(draftInput.coverImage || "", { allowRelative: true }),
        contentMarkdown,
        seoTitle: String(draftInput.seoTitle || "").trim().slice(0, 120),
        seoDescription: String(draftInput.seoDescription || "").trim().slice(0, 220),
        language: draftInput.language === "ne" ? "ne" : (draftInput.language === "mixed" ? "mixed" : "en"),
        visibility: draftInput.visibility === "unlisted" ? "unlisted" : "public",
        status: "draft",
        readingTimeMin: calculateReadingTimeMinutes(contentMarkdown),
        createdAt: Number(draftInput.createdAt || now),
        updatedAt: now
    };

    await set(ref(db, `creatorDrafts/${uid}/${articleId}`), payload);
    return payload;
}

export async function deleteCreatorDraft(uid, articleId) {
    if (!uid || auth.currentUser?.uid !== uid) {
        throw new Error("Unauthorized draft deletion.");
    }
    await remove(ref(db, `creatorDrafts/${uid}/${articleId}`));
    return true;
}

async function fetchExistingSlugMap() {
    const map = {};
    for (const art of DEFAULT_EDITORIAL_ARTICLES) {
        map[art.slug] = { articleId: art.id, authorUid: art.authorUid };
    }
    try {
        const snap = await get(ref(db, "articleSlugs"));
        if (snap.exists()) {
            Object.assign(map, snap.val() || {});
        }
    } catch {
        // Continue with defaults
    }
    return map;
}

export async function publishCreatorArticle(uid, input = {}, authorProfile = {}) {
    if (!uid || auth.currentUser?.uid !== uid) {
        throw new Error("Authentication required to publish.");
    }

    const title = String(input.title || "").trim();
    const contentMarkdown = String(input.contentMarkdown || "").trim();
    if (title.length < 4 || title.length > 180) {
        throw new Error("Title must be between 4 and 180 characters.");
    }
    if (contentMarkdown.length < 40) {
        throw new Error("Please write at least 40 characters of content before publishing.");
    }

    const now = Date.now();
    const articleId = String(input.id || `art_${now}_${Math.random().toString(36).slice(2, 8)}`).replace(/[^A-Za-z0-9_-]/g, "");
    const existingSnap = await get(ref(db, `publishedArticles/${articleId}`)).catch(() => null);
    const existingArticle = existingSnap?.exists() ? existingSnap.val() : null;

    const existingSlugs = await fetchExistingSlugMap();
    const desiredSlug = String(input.slug || "").trim() || title;
    const uniqueSlug = ensureUniqueSlug(desiredSlug, existingSlugs, articleId);

    const oldSlug = existingArticle?.slug && existingArticle.slug !== uniqueSlug
        ? String(existingArticle.slug)
        : "";

    const category = String(input.category || "food").trim() || "food";
    const seoTitle = String(input.seoTitle || title).trim().slice(0, 120);
    const plainExcerpt = contentMarkdown.replace(/[#*_`>\[\]()!-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 165);
    const seoDescription = String(input.seoDescription || input.subtitle || plainExcerpt).trim().slice(0, 220);
    const publishedAt = Number(existingArticle?.publishedAt || now);

    const record = {
        id: articleId,
        slug: uniqueSlug,
        title: title.slice(0, 180),
        subtitle: String(input.subtitle || "").trim().slice(0, 280),
        category,
        tags: sanitizeTags(input.tags),
        authorUid: uid,
        authorUsername: String(authorProfile?.username || "creator").slice(0, 30),
        authorName: String(authorProfile?.displayName || auth.currentUser?.displayName || "Creator").slice(0, 80),
        coverImage: sanitizeUrl(input.coverImage || "", { allowRelative: true }),
        contentMarkdown: contentMarkdown.slice(0, 80000),
        seoTitle,
        seoDescription,
        language: input.language === "ne" ? "ne" : (input.language === "mixed" ? "mixed" : "en"),
        status: "published",
        visibility: input.visibility === "unlisted" ? "unlisted" : "public",
        publishedAt,
        updatedAt: now,
        readingTimeMin: calculateReadingTimeMinutes(contentMarkdown),
        likesCount: Number(existingArticle?.likesCount || 0),
        commentsCount: Number(existingArticle?.commentsCount || 0),
        repostsCount: Number(existingArticle?.repostsCount || 0),
        sharesCount: Number(existingArticle?.sharesCount || 0),
        viewsCount: Number(existingArticle?.viewsCount || 0)
    };
    record.trendingScore = computeTrendingScore(record, now);

    await set(ref(db, `publishedArticles/${articleId}`), record);
    await set(ref(db, `articleSlugs/${uniqueSlug}`), {
        articleId,
        authorUid: uid,
        updatedAt: now
    });

    if (oldSlug) {
        await set(ref(db, `slugRedirects/${oldSlug}`), {
            articleId,
            authorUid: uid,
            targetSlug: uniqueSlug,
            updatedAt: now
        }).catch(() => {});
        await remove(ref(db, `articleSlugs/${oldSlug}`)).catch(() => {});
    }

    // Remove matching private draft so draft & published stay strictly separated
    await remove(ref(db, `creatorDrafts/${uid}/${articleId}`)).catch(() => {});
    await syncAuthorPublishedCount(uid);

    return record;
}

export async function unpublishArticleToDraft(uid, articleId) {
    if (!uid || auth.currentUser?.uid !== uid) {
        throw new Error("Authentication required.");
    }
    const artSnap = await get(ref(db, `publishedArticles/${articleId}`));
    if (!artSnap.exists()) {
        throw new Error("Published article not found.");
    }
    const existing = artSnap.val();
    if (existing.authorUid !== uid) {
        throw new Error("You can only unpublish your own articles.");
    }

    const draft = {
        ...existing,
        status: "draft",
        updatedAt: Date.now()
    };
    await set(ref(db, `creatorDrafts/${uid}/${articleId}`), draft);
    await remove(ref(db, `publishedArticles/${articleId}`));
    if (existing.slug) {
        await remove(ref(db, `articleSlugs/${existing.slug}`)).catch(() => {});
    }
    await syncAuthorPublishedCount(uid);
    return draft;
}

export async function deletePublishedArticle(uid, articleId) {
    if (!uid || auth.currentUser?.uid !== uid) {
        throw new Error("Authentication required.");
    }
    const artSnap = await get(ref(db, `publishedArticles/${articleId}`));
    if (!artSnap.exists()) return true;
    const existing = artSnap.val();
    if (existing.authorUid !== uid) {
        throw new Error("You can only delete your own articles.");
    }
    await remove(ref(db, `publishedArticles/${articleId}`));
    if (existing.slug) {
        await remove(ref(db, `articleSlugs/${existing.slug}`)).catch(() => {});
    }
    await syncAuthorPublishedCount(uid);
    return true;
}

export async function syncAuthorPublishedCount(uid) {
    try {
        const [all, profileSnap] = await Promise.all([
            fetchPublishedArticles({ includeUnlisted: true }),
            get(ref(db, `publicProfiles/${uid}`))
        ]);
        if (!profileSnap.exists()) return;
        const count = all.filter((a) => a.authorUid === uid && !a.isEditorialDefault).length
            + (uid === "47SB1i4UL5hlUVPqM1tQoKJFdaM2"
                ? DEFAULT_EDITORIAL_ARTICLES.filter((d) => !all.some((live) => live.id === d.id && !live.isEditorialDefault)).length
                : 0);
        await update(ref(db, `publicProfiles/${uid}`), {
            articlesCount: count,
            updatedAt: Date.now()
        });
    } catch {
        // Non-blocking count refresh
    }
}

export function buildDiscoveryFeeds(articles = [], profilesMap = {}, {
    followedUids = new Set(),
    preferredCategories = new Set(),
    bookmarkedCategories = new Set(),
    searchQuery = "",
    categorySlug = ""
} = {}) {
    const q = String(searchQuery || "").trim().toLowerCase();
    const cat = String(categorySlug || "").trim().toLowerCase();

    const matchesFilter = (article) => {
        if (cat && cat !== "all" && String(article.category || "").toLowerCase() !== cat) {
            return false;
        }
        if (!q) return true;
        const author = profilesMap[article.authorUid];
        const haystack = [
            article.title,
            article.subtitle,
            article.category,
            article.authorName,
            author?.displayName,
            author?.username,
            ...(Array.isArray(article.tags) ? article.tags : [])
        ].join(" ").toLowerCase();
        return haystack.includes(q);
    };

    const filtered = articles.filter(matchesFilter);

    const latest = [...filtered].sort(
        (a, b) => Number(b.publishedAt || b.createdAt || 0) - Number(a.publishedAt || a.createdAt || 0)
    );

    const trending = [...filtered].sort(
        (a, b) => computeTrendingScore(b) - computeTrendingScore(a)
    );

    const following = filtered
        .filter((a) => followedUids.has(a.authorUid))
        .sort((a, b) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0));

    // Explainable recommendation scoring (transparent reason string attached to each result)
    const recommended = filtered
        .map((article) => {
            const reasons = [];
            let score = computeTrendingScore(article) * 2;
            const author = profilesMap[article.authorUid];

            if (followedUids.has(article.authorUid)) {
                score += 25;
                reasons.push(`From ${author?.displayName || article.authorName || "a creator"} you follow`);
            }
            if (preferredCategories.has(article.category) || bookmarkedCategories.has(article.category)) {
                score += 18;
                const catName = CATEGORY_MAP[article.category]?.name || article.category;
                reasons.push(`Matches your interest in ${catName}`);
            }
            if (author?.badges?.officialOrg) {
                score += 6;
                if (!reasons.length) reasons.push("Official Siranchowk Khaja Ghar publication");
            } else if (author?.badges?.expertSpecialist) {
                score += 5;
                if (!reasons.length) reasons.push(`Written by recognized specialist (${author.specialtyNote || "Topic Expert"})`);
            }
            if (!reasons.length) {
                const catName = CATEGORY_MAP[article.category]?.name || article.category || "Community";
                reasons.push(`Popular recent post in ${catName}`);
            }

            return {
                ...article,
                recommendScore: score,
                recommendReason: reasons[0]
            };
        })
        .sort((a, b) => b.recommendScore - a.recommendScore);

    return { latest, trending, following, recommended };
}

export function getRelatedArticles(targetArticle, allArticles = [], limit = 3) {
    if (!targetArticle) return [];
    const targetTags = new Set(Array.isArray(targetArticle.tags) ? targetArticle.tags : []);
    return allArticles
        .filter((a) => a.id !== targetArticle.id)
        .map((candidate) => {
            let score = 0;
            if (candidate.category === targetArticle.category) score += 10;
            if (candidate.authorUid === targetArticle.authorUid) score += 4;
            const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
            tags.forEach((t) => {
                if (targetTags.has(t)) score += 3;
            });
            score += computeTrendingScore(candidate) * 0.2;
            return { candidate, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => entry.candidate);
}
