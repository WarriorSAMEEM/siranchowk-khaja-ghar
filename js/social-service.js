// ============================================================================
// SIRANCHOWK KHAJA GHAR — SOCIAL, PROFILES, INTERACTIONS & ANALYTICS CLIENT
// ============================================================================
// Handles public profiles (strictly sanitized, zero PII), unique usernames,
// Follow/Unfollow (no self-follow), Likes, Reposts (with original attribution),
// Comments & Replies, Private Bookmarks, Content Reports, Email Badge Sync,
// Creator Applications, Social Notifications, and Honest DNT-Aware Analytics.
// ============================================================================

import {
    auth,
    db,
    ref,
    get,
    set,
    update,
    remove,
    query,
    orderByChild,
    limitToLast,
    runTransaction
} from "./firebase.js";
import {
    DEFAULT_PUBLIC_PROFILES,
    normalizeUsername,
    isValidUsername,
    sanitizeUrl
} from "./platform-core.js";
import { getPublicPushConfig } from "./notifications-client.js";
import { isOptedOut } from "./analytics-tracker.js";

const ANALYTICS_SESSION_KEY = "skg_platform_session_v1";

function getOrCreatePlatformSessionKey() {
    try {
        let key = sessionStorage.getItem(ANALYTICS_SESSION_KEY);
        if (!key) {
            key = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            sessionStorage.setItem(ANALYTICS_SESSION_KEY, key);
        }
        return key;
    } catch {
        return `sess_${Date.now().toString(36)}`;
    }
}

async function callWorkerOrApi(workerPayload, localApiPath = "", idToken = "") {
    if (localApiPath && typeof window !== "undefined") {
        try {
            const headers = { "Content-Type": "application/json" };
            if (idToken) headers.Authorization = `Bearer ${idToken}`;
            const localRes = await fetch(localApiPath, {
                method: "POST",
                headers,
                body: JSON.stringify(workerPayload)
            });
            if (localRes.ok) {
                return await localRes.json().catch(() => ({ ok: true }));
            }
        } catch {
            // Fall through to Cloudflare Worker
        }
    }

    try {
        const { workerUrl } = await getPublicPushConfig();
        if (!workerUrl) return null;
        const headers = { "Content-Type": "application/json" };
        if (idToken) headers.Authorization = `Bearer ${idToken}`;
        const res = await fetch(workerUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(workerPayload)
        });
        if (res.ok) {
            return await res.json().catch(() => ({ ok: true }));
        }
    } catch {
        // Non-blocking fallback
    }
    return null;
}

export function suggestUsernameFromUser(user, fallbackName = "") {
    const base = fallbackName || user?.displayName || (user?.email ? user.email.split("@")[0] : "") || "member";
    let clean = normalizeUsername(base);
    if (clean.length < 3) {
        clean = `user_${String(user?.uid || "member").slice(0, 6).toLowerCase()}`;
    }
    return clean.slice(0, 26);
}

export async function isUsernameAvailable(desiredUsername, currentUid = "") {
    const clean = normalizeUsername(desiredUsername);
    if (!isValidUsername(clean)) return { available: false, reason: "Use 3–30 lowercase letters, numbers, dots, underscores, or hyphens." };
    for (const defProfile of Object.values(DEFAULT_PUBLIC_PROFILES)) {
        if (defProfile.username === clean && defProfile.uid !== currentUid) {
            return { available: false, reason: "This username is reserved." };
        }
    }
    const snap = await get(ref(db, `usernames/${clean}`));
    if (snap.exists() && snap.val()?.uid !== currentUid) {
        return { available: false, reason: "This username is already taken." };
    }
    return { available: true, clean };
}

export async function getPublicProfileByUid(uid) {
    if (!uid) return null;
    try {
        const snap = await get(ref(db, `publicProfiles/${uid}`));
        if (snap.exists()) {
            return {
                ...(DEFAULT_PUBLIC_PROFILES[uid] || {}),
                ...snap.val(),
                uid
            };
        }
    } catch {
        // Fallback to defaults
    }
    return DEFAULT_PUBLIC_PROFILES[uid] ? { ...DEFAULT_PUBLIC_PROFILES[uid] } : null;
}

export async function resolvePublicProfileByUsername(rawUsername) {
    const clean = normalizeUsername(decodeURIComponent(String(rawUsername || "")));
    if (!clean) return null;

    try {
        const unameSnap = await get(ref(db, `usernames/${clean}`));
        if (unameSnap.exists() && unameSnap.val()?.uid) {
            return await getPublicProfileByUid(unameSnap.val().uid);
        }
    } catch {
        // Continue to profile scan / defaults
    }

    for (const def of Object.values(DEFAULT_PUBLIC_PROFILES)) {
        if (def.username === clean) return { ...def };
    }

    try {
        const allSnap = await get(ref(db, "publicProfiles"));
        if (allSnap.exists()) {
            const found = Object.entries(allSnap.val() || {}).find(([, p]) => p?.username === clean);
            if (found) return { ...found[1], uid: found[0] };
        }
    } catch {
        // Ignore
    }
    return null;
}

/**
 * Creates or returns a safe public profile containing ONLY public fields (never email, phone, or address).
 */
export async function ensurePublicProfile(user, extra = {}) {
    if (!user?.uid) return null;
    const uid = user.uid;
    const existing = await getPublicProfileByUid(uid);
    const now = Date.now();

    if (existing && existing.username) {
        if (Boolean(user.emailVerified) && existing.badges?.emailVerified !== true) {
            await update(ref(db, `publicProfiles/${uid}/badges`), { emailVerified: true }).catch(() => {});
            existing.badges = { ...(existing.badges || {}), emailVerified: true };
        }
        return existing;
    }

    let candidate = suggestUsernameFromUser(user, extra.displayName);
    const check = await isUsernameAvailable(candidate, uid);
    if (!check.available) {
        candidate = `${candidate.slice(0, 20)}-${uid.slice(0, 5).toLowerCase()}`;
    }

    const cleanProfile = {
        uid,
        username: candidate,
        displayName: String(extra.displayName || user.displayName || "Community Member").trim().slice(0, 80) || "Community Member",
        bio: String(extra.bio || "").trim().slice(0, 320),
        photoURL: sanitizeUrl(extra.photoURL || user.photoURL || "", { allowRelative: true }),
        coverURL: sanitizeUrl(extra.coverURL || "", { allowRelative: true }),
        location: String(extra.location || "").trim().slice(0, 80),
        website: sanitizeUrl(extra.website || "", { allowRelative: false }),
        visibility: "public",
        creatorStatus: uid === "47SB1i4UL5hlUVPqM1tQoKJFdaM2" ? "approved" : "none",
        joinedAt: now,
        updatedAt: now,
        followersCount: 0,
        followingCount: 0,
        articlesCount: 0,
        badges: {
            emailVerified: Boolean(user.emailVerified),
            verifiedCreator: false,
            officialOrg: false,
            expertSpecialist: false
        }
    };

    await set(ref(db, `publicProfiles/${uid}`), cleanProfile);
    await set(ref(db, `usernames/${candidate}`), {
        uid,
        username: candidate,
        updatedAt: now
    });
    return cleanProfile;
}

export async function updatePublicProfile(uid, updates = {}) {
    if (!uid || auth.currentUser?.uid !== uid) {
        throw new Error("You can only edit your own public profile.");
    }
    const current = await ensurePublicProfile(auth.currentUser);
    const now = Date.now();

    let nextUsername = current.username;
    if (typeof updates.username === "string" && updates.username.trim()) {
        const clean = normalizeUsername(updates.username);
        if (clean !== current.username) {
            const avail = await isUsernameAvailable(clean, uid);
            if (!avail.available) {
                throw new Error(avail.reason || "Username unavailable.");
            }
            await set(ref(db, `usernames/${clean}`), {
                uid,
                username: clean,
                updatedAt: now
            });
            await remove(ref(db, `usernames/${current.username}`)).catch(() => {});
            nextUsername = clean;
        }
    }

    const patch = {
        uid,
        username: nextUsername,
        displayName: String(updates.displayName ?? current.displayName ?? "Member").trim().slice(0, 80),
        bio: String(updates.bio ?? current.bio ?? "").trim().slice(0, 320),
        photoURL: sanitizeUrl(updates.photoURL ?? current.photoURL ?? "", { allowRelative: true }),
        coverURL: sanitizeUrl(updates.coverURL ?? current.coverURL ?? "", { allowRelative: true }),
        location: String(updates.location ?? current.location ?? "").trim().slice(0, 80),
        website: sanitizeUrl(updates.website ?? current.website ?? "", { allowRelative: false }),
        visibility: updates.visibility === "private" ? "private" : "public",
        updatedAt: now
    };

    if (!patch.displayName) {
        throw new Error("Display name cannot be empty.");
    }

    await update(ref(db, `publicProfiles/${uid}`), patch);
    return { ...current, ...patch };
}

export async function syncEmailVerificationBadge(user) {
    if (!user?.uid) return false;
    try {
        const token = await user.getIdToken();
        await callWorkerOrApi({ type: "platform_sync_email_badge" }, "/api/platform/sync-email-badge", token);
        return Boolean(user.emailVerified);
    } catch {
        return false;
    }
}

export async function submitCreatorApplication(uid, { displayName, username, bio, specialty, pitch }) {
    if (!uid || auth.currentUser?.uid !== uid) {
        throw new Error("Please sign in first.");
    }
    const profile = await ensurePublicProfile(auth.currentUser, { displayName, bio });
    if (profile.creatorStatus === "suspended") {
        throw new Error("This account's creator publishing access is currently suspended.");
    }
    const cleanPitch = String(pitch || "").trim().slice(0, 800);
    if (cleanPitch.length < 20) {
        throw new Error("Please write a short introduction (at least 20 characters) describing the topics you plan to publish.");
    }

    const updatedProfile = await updatePublicProfile(uid, {
        displayName: displayName || profile.displayName,
        username: username || profile.username,
        bio: bio !== undefined ? bio : profile.bio
    });

    const now = Date.now();
    const record = {
        uid,
        displayName: updatedProfile.displayName,
        username: updatedProfile.username,
        specialty: String(specialty || "").trim().slice(0, 100),
        pitch: cleanPitch,
        status: "pending",
        createdAt: now,
        updatedAt: now
    };

    await set(ref(db, `creatorApplications/${uid}`), record);
    return record;
}

export async function getMyCreatorApplication(uid) {
    if (!uid) return null;
    try {
        const snap = await get(ref(db, `creatorApplications/${uid}`));
        return snap.exists() ? snap.val() : null;
    } catch {
        return null;
    }
}

// ============================================================================
// FOLLOW / UNFOLLOW SYSTEM
// ============================================================================

export async function isFollowingUser(myUid, targetUid) {
    if (!myUid || !targetUid || myUid === targetUid) return false;
    try {
        const snap = await get(ref(db, `following/${myUid}/${targetUid}`));
        return snap.exists();
    } catch {
        return false;
    }
}

export async function getFollowingUidsSet(myUid) {
    const setIds = new Set();
    if (!myUid) return setIds;
    try {
        const snap = await get(ref(db, `following/${myUid}`));
        if (snap.exists()) {
            Object.keys(snap.val() || {}).forEach((id) => setIds.add(id));
        }
    } catch {
        // Empty set
    }
    return setIds;
}

export async function toggleFollowUser(targetUid) {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error("Please sign in to follow creators.");
    const myUid = user.uid;
    if (myUid === targetUid) throw new Error("You cannot follow your own profile.");

    const followRef = ref(db, `follows/${targetUid}/followers/${myUid}`);
    const followingRef = ref(db, `following/${myUid}/${targetUid}`);
    const existingSnap = await get(followingRef);
    const now = Date.now();

    const myProfile = await ensurePublicProfile(user);

    if (existingSnap.exists()) {
        await Promise.all([
            remove(followRef),
            remove(followingRef)
        ]);
        await runTransaction(ref(db, `publicProfiles/${targetUid}/followersCount`), (c) => Math.max(0, Number(c || 0) - 1)).catch(() => {});
        await runTransaction(ref(db, `publicProfiles/${myUid}/followingCount`), (c) => Math.max(0, Number(c || 0) - 1)).catch(() => {});
        return { following: false };
    }

    await Promise.all([
        set(followRef, { uid: myUid, createdAt: now }),
        set(followingRef, { uid: targetUid, createdAt: now })
    ]);
    await runTransaction(ref(db, `publicProfiles/${targetUid}/followersCount`), (c) => Number(c || 0) + 1).catch(() => {});
    await runTransaction(ref(db, `publicProfiles/${myUid}/followingCount`), (c) => Number(c || 0) + 1).catch(() => {});

    // Dispatch follow notification if target hasn't disabled follower notifications
    await pushSocialNotification(targetUid, {
        type: "follow",
        prefKey: "notifyFollowers",
        actorUid: myUid,
        title: `${myProfile.displayName} started following you`,
        body: `@${myProfile.username} followed your profile.`,
        link: `/user/${encodeURIComponent(myProfile.username)}`
    }).catch(() => {});

    return { following: true };
}

export async function fetchFollowList(uid, mode = "followers", limit = 25) {
    if (!uid) return [];
    const path = mode === "following" ? `following/${uid}` : `follows/${uid}/followers`;
    try {
        const snap = await get(query(ref(db, path), orderByChild("createdAt"), limitToLast(limit)));
        if (!snap.exists()) return [];
        const entries = Object.values(snap.val() || {}).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        const resolved = await Promise.all(entries.map((e) => getPublicProfileByUid(e.uid)));
        return resolved.filter(Boolean);
    } catch {
        return [];
    }
}

// ============================================================================
// LIKES, REPOSTS, BOOKMARKS, COMMENTS & REPLIES
// ============================================================================

export async function getUserArticleState(articleId, uid) {
    if (!uid || !articleId) return { liked: false, bookmarked: false };
    const [likeSnap, bmSnap] = await Promise.all([
        get(ref(db, `articleLikes/${articleId}/${uid}`)).catch(() => null),
        get(ref(db, `userBookmarks/${uid}/${articleId}`)).catch(() => null)
    ]);
    return {
        liked: Boolean(likeSnap?.exists()),
        bookmarked: Boolean(bmSnap?.exists())
    };
}

export async function toggleArticleLike(article) {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error("Please sign in to like articles.");
    const uid = user.uid;
    const likeRef = ref(db, `articleLikes/${article.id}/${uid}`);
    const existing = await get(likeRef);

    if (existing.exists()) {
        await remove(likeRef);
        await runTransaction(ref(db, `publishedArticles/${article.id}/likesCount`), (c) => Math.max(0, Number(c || 0) - 1)).catch(() => {});
        return { liked: false };
    }

    await set(likeRef, { uid, createdAt: Date.now() });
    await runTransaction(ref(db, `publishedArticles/${article.id}/likesCount`), (c) => Number(c || 0) + 1).catch(() => {});

    if (article.authorUid && article.authorUid !== uid) {
        const actor = await ensurePublicProfile(user);
        await pushSocialNotification(article.authorUid, {
            type: "like",
            prefKey: "notifyLikesComments",
            actorUid: uid,
            title: `${actor.displayName} liked your article`,
            body: article.title,
            link: `/blog/${encodeURIComponent(article.slug)}`
        }).catch(() => {});
    }
    return { liked: true };
}

export async function toggleArticleBookmark(article) {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error("Please sign in to save bookmarks.");
    const uid = user.uid;
    const bmRef = ref(db, `userBookmarks/${uid}/${article.id}`);
    const existing = await get(bmRef);

    if (existing.exists()) {
        await remove(bmRef);
        return { bookmarked: false };
    }

    await set(bmRef, {
        articleId: article.id,
        slug: article.slug,
        title: String(article.title || "").slice(0, 180),
        category: String(article.category || "food"),
        authorName: String(article.authorName || ""),
        savedAt: Date.now()
    });
    return { bookmarked: true };
}

export async function fetchUserBookmarks(uid) {
    if (!uid || auth.currentUser?.uid !== uid) return [];
    try {
        const snap = await get(ref(db, `userBookmarks/${uid}`));
        if (!snap.exists()) return [];
        return Object.values(snap.val() || {}).sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
    } catch {
        return [];
    }
}

export async function createRepost(article, note = "") {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error("Please sign in to repost.");
    const actor = await ensurePublicProfile(user);
    const now = Date.now();
    const repostId = `rp_${article.id}_${user.uid}`;
    const existing = await get(ref(db, `articleReposts/${repostId}`)).catch(() => null);
    if (existing?.exists()) {
        return { alreadyReposted: true, repost: existing.val() };
    }

    const payload = {
        id: repostId,
        originalArticleId: article.id,
        originalSlug: article.slug,
        originalTitle: String(article.title || "").slice(0, 180),
        originalAuthorUid: article.authorUid,
        originalAuthorUsername: article.authorUsername || "",
        originalAuthorName: article.authorName || "",
        repostedByUid: user.uid,
        repostedByUsername: actor.username,
        repostedByName: actor.displayName,
        note: String(note || "").trim().slice(0, 240),
        repostedAt: now
    };

    await set(ref(db, `articleReposts/${repostId}`), payload);
    await runTransaction(ref(db, `publishedArticles/${article.id}/repostsCount`), (c) => Number(c || 0) + 1).catch(() => {});

    if (article.authorUid && article.authorUid !== user.uid) {
        await pushSocialNotification(article.authorUid, {
            type: "repost",
            prefKey: "notifyReposts",
            actorUid: user.uid,
            title: `${actor.displayName} reposted your article`,
            body: article.title,
            link: `/blog/${encodeURIComponent(article.slug)}`
        }).catch(() => {});
    }

    return { alreadyReposted: false, repost: payload };
}

export async function fetchUserReposts(uid, publishedArticlesMap = new Map()) {
    if (!uid) return [];
    try {
        const snap = await get(ref(db, "articleReposts"));
        if (!snap.exists()) return [];
        return Object.values(snap.val() || {})
            .filter((r) => r && r.repostedByUid === uid)
            // Gracefully omit reposts whose original article was removed/moderated
            .filter((r) => publishedArticlesMap.has(r.originalArticleId))
            .map((r) => ({ ...r, originalArticle: publishedArticlesMap.get(r.originalArticleId) }))
            .sort((a, b) => Number(b.repostedAt || 0) - Number(a.repostedAt || 0));
    } catch {
        return [];
    }
}

export async function fetchArticleComments(articleId, limit = 50) {
    if (!articleId) return [];
    try {
        const snap = await get(query(ref(db, `articleComments/${articleId}`), orderByChild("createdAt"), limitToLast(limit)));
        if (!snap.exists()) return [];
        return Object.entries(snap.val() || {})
            .map(([id, c]) => ({ ...c, id }))
            .filter((c) => c.status !== "hidden")
            .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    } catch {
        return [];
    }
}

export async function postArticleComment(article, bodyText, parentId = "") {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error("Please sign in to comment.");
    const cleanBody = String(bodyText || "").trim();
    if (cleanBody.length < 1 || cleanBody.length > 1500) {
        throw new Error("Comment must be between 1 and 1500 characters.");
    }

    const actor = await ensurePublicProfile(user);
    const now = Date.now();
    const commentId = `cmt_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const payload = {
        id: commentId,
        articleId: article.id,
        parentId: String(parentId || "").slice(0, 128),
        authorUid: user.uid,
        authorUsername: actor.username,
        authorName: actor.displayName,
        authorBadges: actor.badges || {},
        body: cleanBody,
        status: "active",
        edited: false,
        createdAt: now,
        updatedAt: now
    };

    await set(ref(db, `articleComments/${article.id}/${commentId}`), payload);
    await runTransaction(ref(db, `publishedArticles/${article.id}/commentsCount`), (c) => Number(c || 0) + 1).catch(() => {});

    if (article.authorUid && article.authorUid !== user.uid) {
        await pushSocialNotification(article.authorUid, {
            type: "comment",
            prefKey: "notifyLikesComments",
            actorUid: user.uid,
            title: `${actor.displayName} commented on "${String(article.title).slice(0, 50)}"`,
            body: cleanBody.slice(0, 140),
            link: `/blog/${encodeURIComponent(article.slug)}`
        }).catch(() => {});
    }

    return payload;
}

export async function editArticleComment(articleId, commentId, newBody) {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error("Sign in required.");
    const cleanBody = String(newBody || "").trim();
    if (cleanBody.length < 1 || cleanBody.length > 1500) {
        throw new Error("Comment must be between 1 and 1500 characters.");
    }
    await update(ref(db, `articleComments/${articleId}/${commentId}`), {
        body: cleanBody,
        edited: true,
        updatedAt: Date.now()
    });
    return true;
}

export async function deleteArticleComment(articleId, commentId) {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error("Sign in required.");
    await remove(ref(db, `articleComments/${articleId}/${commentId}`));
    await runTransaction(ref(db, `publishedArticles/${articleId}/commentsCount`), (c) => Math.max(0, Number(c || 0) - 1)).catch(() => {});
    return true;
}

export async function submitContentReport({ targetType, targetId, parentId = "", reason, details = "" }) {
    const user = auth.currentUser;
    if (!user?.uid) throw new Error("Please sign in to submit a report.");
    const cleanReason = String(reason || "").trim().slice(0, 500);
    if (cleanReason.length < 4) {
        throw new Error("Please describe why you are reporting this item.");
    }

    const now = Date.now();
    const reportId = `rep_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
        id: reportId,
        targetType: String(targetType || "article").slice(0, 32),
        targetId: String(targetId || "").slice(0, 128),
        parentId: String(parentId || "").slice(0, 128),
        reporterUid: user.uid,
        reason: cleanReason,
        details: String(details || "").trim().slice(0, 400),
        status: "open",
        createdAt: now
    };
    await set(ref(db, `contentReports/${reportId}`), payload);
    return payload;
}

// ============================================================================
// USER SOCIAL NOTIFICATIONS & PREFERENCES
// ============================================================================

export async function pushSocialNotification(targetUid, { type, prefKey = "", actorUid, title, body = "", link = "" }) {
    if (!targetUid || !actorUid || targetUid === actorUid) return null;
    if (prefKey) {
        try {
            const prefSnap = await get(ref(db, `users/${targetUid}/profile/notificationPreferences/${prefKey}`));
            if (prefSnap.exists() && prefSnap.val() === false) {
                return null;
            }
        } catch {
            // Default opted-in unless explicitly disabled
        }
    }

    const now = Date.now();
    const id = `sn_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
        id,
        type: String(type || "activity").slice(0, 32),
        actorUid,
        title: String(title || "New activity").slice(0, 160),
        body: String(body || "").slice(0, 260),
        link: sanitizeUrl(link, { allowRelative: true }),
        read: false,
        createdAt: now
    };
    await set(ref(db, `userSocialNotifications/${targetUid}/${id}`), payload);
    return payload;
}

export async function fetchMySocialNotifications(uid, limit = 30) {
    if (!uid || auth.currentUser?.uid !== uid) return [];
    try {
        const snap = await get(query(ref(db, `userSocialNotifications/${uid}`), orderByChild("createdAt"), limitToLast(limit)));
        if (!snap.exists()) return [];
        return Object.values(snap.val() || {}).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    } catch {
        return [];
    }
}

export async function markSocialNotificationRead(uid, notifId) {
    if (!uid || auth.currentUser?.uid !== uid || !notifId) return;
    await update(ref(db, `userSocialNotifications/${uid}/${notifId}`), { read: true });
}

// ============================================================================
// HONEST DNT-RESPECTING ANALYTICS TRACKING
// ============================================================================

export async function trackArticleEvent(articleId, eventType = "view") {
    if (!articleId || isOptedOut()) return { ok: false, optedOut: true };
    const sessionKey = getOrCreatePlatformSessionKey();
    const referrer = typeof document !== "undefined" ? document.referrer || "" : "";
    return await callWorkerOrApi(
        {
            type: "platform_track_event",
            articleId,
            eventType,
            sessionKey,
            referrer
        },
        "/api/platform/track-event"
    );
}

export async function fetchCreatorAnalytics(uid) {
    if (!uid || !auth.currentUser) return null;
    try {
        const snap = await get(ref(db, `creatorAnalytics/${uid}`));
        if (snap.exists()) return snap.val();
    } catch {
        // Fallback to local server dev store if available
    }

    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/api/platform/analytics/${encodeURIComponent(uid)}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
            return await res.json();
        }
    } catch {
        // Return null
    }
    return null;
}
