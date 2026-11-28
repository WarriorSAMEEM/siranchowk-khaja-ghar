// ============================================================================
// Global Content, Creator, Social, Badges, Worker & SSR Platform Tests
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { generateKeyPairSync, createPublicKey, createSign } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    slugifyUnicode,
    ensureUniqueSlug,
    normalizeUsername,
    isValidUsername,
    calculateReadingTimeMinutes,
    extractHeadingsFromMarkdown,
    renderSafeMarkdownToHtml,
    computeTrendingScore
} from "../js/platform-core.js";
import {
    BADGE_DEFINITIONS,
    renderAuthorTicksHtml,
    renderProfileBadgesHtml
} from "../js/badges.js";
import worker from "../cloudflare-worker/worker.js";
import { createPlatformApiRouter, registerPlatformSsrRoutes } from "../server-platform.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const PROJECT_ID = "plasma-bounty-474104-m6";
const OWNER_UID = "47SB1i4UL5hlUVPqM1tQoKJFdaM2";
const ADMIN_UID = "adminUser0000000000000001";
const MOD_UID = "modUser000000000000000001";
const OFFICER_UID = "officer000000000000000001";
const USER_UID = "userCreator00000000000001";
const DATABASE_URL = "https://unit-test-default-rtdb.asia-southeast1.firebasedatabase.app";
const ORIGIN = "https://siranchowk-khaja-ghar.pages.dev";

const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});
const jwk = { ...createPublicKey(keys.publicKey).export({ format: "jwk" }), kid: "kid-social", alg: "RS256", use: "sig" };

function serviceAccountJson(projectId = PROJECT_ID) {
    const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" }
    });
    return JSON.stringify({
        type: "service_account",
        project_id: projectId,
        client_email: `worker@${projectId}.iam.gserviceaccount.com`,
        private_key: privateKey
    });
}

function makeIdToken(uid, extraClaims = {}) {
    const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: "RS256", typ: "JWT", kid: "kid-social" });
    const payload = b64({
        aud: PROJECT_ID,
        iss: `https://securetoken.google.com/${PROJECT_ID}`,
        sub: uid,
        iat: now,
        exp: now + 3600,
        email: `${uid}@example.com`,
        email_verified: false,
        ...extraClaims
    });
    const signer = createSign("RSA-SHA256");
    signer.update(`${head}.${payload}`);
    return `${head}.${payload}.${signer.sign(keys.privateKey).toString("base64url")}`;
}

const makeEnv = () => ({
    FIREBASE_PROJECT_ID: PROJECT_ID,
    FIREBASE_DATABASE_URL: DATABASE_URL,
    PRIMARY_OWNER_UID: OWNER_UID,
    ALLOWED_ORIGINS: ORIGIN,
    FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccountJson()
});

let reqCounter = 0;
const workerReq = (body, { token } = {}) =>
    new Request("https://worker.test/", {
        method: "POST",
        headers: {
            "CF-Connecting-IP": `198.51.100.${(reqCounter++ % 240) + 1}`,
            Origin: ORIGIN,
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
    });

function installMockFetch({ db = {}, recorded = [] } = {}) {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        recorded.push({ url, method: init.method || "GET", body: init.body ? String(init.body) : "" });
        if (url.hostname === "www.googleapis.com") return Response.json({ keys: [jwk] });
        if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "tok-social", expires_in: 3600 });
        if (url.hostname.endsWith("firebasedatabase.app")) {
            const key = url.pathname;
            return Response.json(Object.hasOwn(db, key) ? db[key] : null);
        }
        return new Response("not mocked", { status: 404 });
    };
    return () => { globalThis.fetch = original; };
}

// ============================================================================
// 1. platform-core.js unit tests (Unicode/Nepali slugs, Markdown XSS, TOC)
// ============================================================================
test("platform-core: Unicode & Nepali/Devanagari slugs, reserved slugs, and collision suffixes", () => {
    assert.equal(slugifyUnicode("Halal Momo Guide in Chitwan!"), "halal-momo-guide-in-chitwan");
    assert.equal(
        slugifyUnicode("सिराने म:म र ताजा अचार विधि"),
        "सिराने-म-म-र-ताजा-अचार-विधि"
    );
    assert.equal(slugifyUnicode("admin"), "admin-post");
    assert.equal(slugifyUnicode("explore"), "explore-post");

    const map = { "nepali-khaja": { articleId: "a1" }, "nepali-khaja-2": { articleId: "a2" } };
    assert.equal(ensureUniqueSlug("nepali-khaja", map, null), "nepali-khaja-3");
    assert.equal(ensureUniqueSlug("nepali-khaja", map, "a1"), "nepali-khaja");

    assert.equal(normalizeUsername("  Sameem.Khairahani! "), "sameem.khairahani");
    assert.equal(isValidUsername("admin"), false);
    assert.equal(isValidUsername("sameem_chitwan"), true);
    assert.equal(isValidUsername("ab"), false);
});

test("platform-core: Markdown renderer blocks XSS, extracts heading TOC, and computes trending score", () => {
    const md = [
        "## First Section",
        "Check [bad link](javascript:alert(1)) and <script>alert(1)</script> **bold text**.",
        "### Nepali खण्ड",
        "- Item one",
        "![Alt](https://i.postimg.cc/13M0GD3L/heropage.jpg)"
    ].join("\n");

    const html = renderSafeMarkdownToHtml(md);
    assert.ok(!html.includes("<script>"), "raw script tag must be escaped");
    assert.ok(!html.includes("javascript:alert"), "javascript: links must be stripped");
    assert.ok(html.includes("<strong>bold text</strong>"));
    assert.ok(html.includes("<h2 id=\"first-section\">First Section</h2>"));
    assert.ok(html.includes("<h3 id=\"nepali-खण्ड\">Nepali खण्ड</h3>"));

    const toc = extractHeadingsFromMarkdown(md);
    assert.equal(toc.length, 2);
    assert.equal(toc[0].id, "first-section");
    assert.equal(toc[1].id, "nepali-खण्ड");

    assert.equal(calculateReadingTimeMinutes("word ".repeat(450)), 3);
    assert.ok(
        computeTrendingScore({ viewsCount: 100, likesCount: 10, commentsCount: 5, publishedAt: Date.now() - 3600000 }) >
        computeTrendingScore({ viewsCount: 10, likesCount: 1, publishedAt: Date.now() - 86400000 })
    );
});

// ============================================================================
// 2. badges.js unit tests (4 distinct badges & inline tick discipline)
// ============================================================================
test("badges: defines 4 distinct badge types and keeps emailVerified out of inline ticks", () => {
    assert.deepEqual(
        Object.keys(BADGE_DEFINITIONS).sort(),
        ["emailVerified", "expertSpecialist", "officialOrg", "verifiedCreator"]
    );
    assert.equal(BADGE_DEFINITIONS.emailVerified.grantMode, "automatic_auth");
    assert.equal(BADGE_DEFINITIONS.verifiedCreator.grantMode, "manual_admin");

    const emailOnlyHtml = renderAuthorTicksHtml({ emailVerified: true });
    assert.equal(emailOnlyHtml, "", "emailVerified alone must NOT display a creator tick");

    const allTicksHtml = renderAuthorTicksHtml(
        { emailVerified: true, verifiedCreator: true, officialOrg: true, expertSpecialist: true },
        "Food Science"
    );
    assert.ok(allTicksHtml.includes("skg-svg-blue"));
    assert.ok(allTicksHtml.includes("skg-svg-official"));
    assert.ok(allTicksHtml.includes("skg-svg-specialist"));
    assert.ok(!allTicksHtml.includes("skg-svg-email"));

    const profileStrip = renderProfileBadgesHtml(
        { emailVerified: true, expertSpecialist: true },
        { includeEmailVerified: true, specialtyNote: "Chitwan Food History" }
    );
    assert.ok(profileStrip.includes("Email Verified"));
    assert.ok(profileStrip.includes("Domain Specialist — Chitwan Food History"));
});

// ============================================================================
// 3. Cloudflare Worker platform route tests
// ============================================================================
test("worker: platform_track_event deduplicates repeat views and writes creatorAnalytics", async () => {
    const recorded = [];
    const restore = installMockFetch({
        recorded,
        db: {
            "/publishedArticles/art1.json": {
                id: "art1",
                slug: "chitwan-guide",
                title: "Chitwan Guide",
                authorUid: USER_UID,
                status: "published",
                viewsCount: 2,
                sharesCount: 0,
                publishedAt: Date.now() - 10000
            }
        }
    });

    try {
        const env = makeEnv();
        const r1 = await worker.fetch(workerReq({
            type: "platform_track_event",
            articleId: "art1",
            eventType: "view",
            sessionKey: "sess_abc_1",
            referrer: "https://www.google.com/search?q=chitwan+momo"
        }), env);
        assert.equal(r1.status, 200);
        const j1 = await r1.json();
        assert.equal(j1.recorded, true);
        assert.ok(recorded.some((r) => r.method === "PUT" && r.url.pathname.includes(`/creatorAnalytics/${USER_UID}/summary`)));

        // Repeat view with same IP + sessionKey should deduplicate cleanly
        const r2 = await worker.fetch(new Request("https://worker.test/", {
            method: "POST",
            headers: {
                "CF-Connecting-IP": "198.51.100.250",
                Origin: ORIGIN,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ type: "platform_track_event", articleId: "art1", eventType: "view", sessionKey: "sess_dup" })
        }), env);
        assert.equal(r2.status, 200);
        const r3 = await worker.fetch(new Request("https://worker.test/", {
            method: "POST",
            headers: {
                "CF-Connecting-IP": "198.51.100.250",
                Origin: ORIGIN,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ type: "platform_track_event", articleId: "art1", eventType: "view", sessionKey: "sess_dup" })
        }), env);
        const j3 = await r3.json();
        assert.equal(j3.deduplicated, true);
    } finally {
        restore();
    }
});

test("worker: platform_sync_email_badge reflects verified ID token claim", async () => {
    const recorded = [];
    const restore = installMockFetch({
        recorded,
        db: {
            [`/publicProfiles/${USER_UID}.json`]: { uid: USER_UID, username: "creator_u", displayName: "Creator U" }
        }
    });
    try {
        const env = makeEnv();
        const res = await worker.fetch(
            workerReq({ type: "platform_sync_email_badge" }, { token: makeIdToken(USER_UID, { email_verified: true }) }),
            env
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.emailVerified, true);
        assert.equal(json.synced, true);
        assert.ok(recorded.some((r) => r.url.pathname.includes(`/badgeRegistry/${USER_UID}/emailVerified`)));
    } finally {
        restore();
    }
});

test("worker: creator decisions, badges, and moderation enforce RBAC", async () => {
    const recorded = [];
    const restore = installMockFetch({
        recorded,
        db: {
            [`/staff/${ADMIN_UID}.json`]: { role: "admin", active: true },
            [`/staff/${MOD_UID}.json`]: { role: "moderator", active: true },
            [`/staff/${OFFICER_UID}.json`]: { role: "officer", active: true },
            [`/creatorApplications/${USER_UID}.json`]: { uid: USER_UID, status: "pending" },
            [`/publicProfiles/${USER_UID}.json`]: { uid: USER_UID, username: "creator_u", displayName: "Creator U", badges: {} },
            "/publishedArticles/art_bad.json": { id: "art_bad", title: "Bad", authorUid: USER_UID, status: "published" }
        }
    });

    try {
        const env = makeEnv();
        // Officer cannot approve creators or grant badges or moderate content
        const deniedCreator = await worker.fetch(
            workerReq({ type: "platform_creator_decision", targetUid: USER_UID, decision: "approved" }, { token: makeIdToken(OFFICER_UID) }),
            env
        );
        assert.equal(deniedCreator.status, 403);

        const deniedBadge = await worker.fetch(
            workerReq({ type: "platform_manage_badge", targetUid: USER_UID, badgeType: "verifiedCreator", action: "grant" }, { token: makeIdToken(MOD_UID) }),
            env
        );
        assert.equal(deniedBadge.status, 403);

        // Admin approves creator & grants Verified Creator badge
        const okCreator = await worker.fetch(
            workerReq({ type: "platform_creator_decision", targetUid: USER_UID, decision: "approved", reason: "Good portfolio" }, { token: makeIdToken(ADMIN_UID) }),
            env
        );
        assert.equal(okCreator.status, 200);
        assert.equal((await okCreator.json()).creatorStatus, "approved");

        const okBadge = await worker.fetch(
            workerReq({
                type: "platform_manage_badge",
                targetUid: USER_UID,
                badgeType: "expertSpecialist",
                action: "grant",
                specialtyNote: "Chitwan Culinary History",
                note: "Verified credentials"
            }, { token: makeIdToken(ADMIN_UID) }),
            env
        );
        assert.equal(okBadge.status, 200);
        assert.ok(recorded.some((r) => r.url.pathname.includes("/badgeAuditLogs/")));

        // Moderator hides reported article
        const okMod = await worker.fetch(
            workerReq({ type: "platform_moderate_content", action: "hide_article", targetId: "art_bad", reason: "Spam" }, { token: makeIdToken(MOD_UID) }),
            env
        );
        assert.equal(okMod.status, 200);
        assert.ok(recorded.some((r) => r.method === "PUT" && r.url.pathname === "/moderatedArticles/art_bad.json"));
        assert.ok(recorded.some((r) => r.method === "DELETE" && r.url.pathname === "/publishedArticles/art_bad.json"));
    } finally {
        restore();
    }
});

// ============================================================================
// 4. Express SSR & Platform API integration tests
// ============================================================================
test("server-platform: SSR pages, Nepali slug, 301 redirects, noindex, sitemap.xml, robots.txt", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.startsWith("http://127.0.0.1")) {
            return originalFetch(input, init);
        }
        if (url.includes("/slugRedirects.json")) {
            return Response.json({
                "old-momo-slug": {
                    targetSlug: "halal-khaja-and-fresh-momo-guide-khairahani-parsa-chitwan",
                    articleId: "editorial-halal-khaja-khairahani-parsa"
                }
            });
        }
        return Response.json(null);
    };

    const app = express();
    app.use("/api/platform", createPlatformApiRouter());
    registerPlatformSsrRoutes(app, {
        rootDir: ROOT_DIR,
        distDir: path.join(ROOT_DIR, "dist"),
        useProdStatic: false,
        getViteServer: async () => null
    });

    const server = await new Promise((resolve) => {
        const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
    });

    try {
        const addr = server.address();
        const base = `http://127.0.0.1:${addr.port}`;

        // 1. Explore SSR + JSON-LD
        const exploreRes = await fetch(`${base}/explore`);
        assert.equal(exploreRes.status, 200);
        const exploreHtml = await exploreRes.text();
        assert.ok(exploreHtml.includes('"@type":"CollectionPage"'));
        assert.ok(exploreHtml.includes("Halal Khaja &amp; Fresh Momo Guide"));

        // 2. Blog SSR
        const blogRes = await fetch(`${base}/blog`);
        assert.equal(blogRes.status, 200);

        // 3. Category SSR
        const catRes = await fetch(`${base}/category/chitwan`);
        assert.equal(catRes.status, 200);
        const catHtml = await catRes.text();
        assert.ok(catHtml.includes("Chitwan &amp; Khairahani"));

        // 4. English + Nepali Article SSR + BlogPosting JSON-LD
        const enArtRes = await fetch(`${base}/blog/halal-khaja-and-fresh-momo-guide-khairahani-parsa-chitwan`);
        assert.equal(enArtRes.status, 200);
        const enArtHtml = await enArtRes.text();
        assert.ok(enArtHtml.includes('"@type":"BlogPosting"'));
        assert.ok(enArtHtml.includes('"@type":"BreadcrumbList"'));

        const neSlug = encodeURIComponent("सिराने-मम-र-ताजा-टमाटर-अचार-बनाउने-परम्परागत-विधि");
        const neArtRes = await fetch(`${base}/blog/${neSlug}`);
        assert.equal(neArtRes.status, 200);
        const neArtHtml = await neArtRes.text();
        assert.ok(neArtHtml.includes("ताजा म:म र तिल-टमाटर अचार"));

        // 5. 301 Redirect rule
        const redirRes = await fetch(`${base}/blog/old-momo-slug`, { redirect: "manual" });
        assert.equal(redirRes.status, 301);
        assert.equal(redirRes.headers.get("location"), "/blog/halal-khaja-and-fresh-momo-guide-khairahani-parsa-chitwan");

        // 6. Strict 404 + noindex for unknown slug
        const notFoundRes = await fetch(`${base}/blog/non-existent-story-xyz`);
        assert.equal(notFoundRes.status, 404);
        assert.equal(notFoundRes.headers.get("x-robots-tag"), "noindex, nofollow");

        // 7. Profile SSR + Person JSON-LD
        const profRes = await fetch(`${base}/user/siranchowk`);
        assert.equal(profRes.status, 200);
        const profHtml = await profRes.text();
        assert.ok(profHtml.includes('"@type":"Person"'));
        assert.ok(profHtml.includes("Official Organization"));

        // 8. Private Creator Studio enforces noindex, nofollow
        const studioRes = await fetch(`${base}/creator/studio`);
        assert.equal(studioRes.status, 200);
        assert.equal(studioRes.headers.get("x-robots-tag"), "noindex, nofollow");

        // 9. Dynamic sitemap.xml & robots.txt
        const sitemapRes = await fetch(`${base}/sitemap.xml`);
        assert.equal(sitemapRes.status, 200);
        const sitemapXml = await sitemapRes.text();
        assert.ok(sitemapXml.includes("/blog/halal-khaja-and-fresh-momo-guide-khairahani-parsa-chitwan"));
        assert.ok(!sitemapXml.includes("/creator/studio"));
        assert.ok(!sitemapXml.includes("/admin/"));

        const robotsRes = await fetch(`${base}/robots.txt`);
        assert.equal(robotsRes.status, 200);
        const robotsTxt = await robotsRes.text();
        assert.ok(robotsTxt.includes("Disallow: /creator/"));
        assert.ok(robotsTxt.includes("Disallow: /admin/"));

        // 10. Platform REST API + Analytics auth guard
        const apiExplore = await fetch(`${base}/api/platform/explore?category=food`);
        assert.equal(apiExplore.status, 200);
        const apiJson = await apiExplore.json();
        assert.ok(apiJson.articles.length >= 1);

        const apiAnalyticsUnauth = await fetch(`${base}/api/platform/analytics/${OWNER_UID}`);
        assert.equal(apiAnalyticsUnauth.status, 401);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        globalThis.fetch = originalFetch;
    }
});
