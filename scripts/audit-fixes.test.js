// ============================================================================
// Audit & Bug-Fix Regression Tests (NPT Timezone, Redirect Security, Worker & SSR)
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { generateKeyPairSync, createPublicKey, createSign } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    NPT_OFFSET_MS,
    nptStartOfDayMs,
    getDateRangeFromPreset,
    dayKeyFromMs,
    monthKeyFromMs,
    enumerateDayKeys
} from "../admin/js/analytics-utils.js";
import { getSafeRedirectTarget } from "../js/customer-auth.js";
import worker from "../cloudflare-worker/worker.js";
import { createPlatformApiRouter, registerPlatformSsrRoutes } from "../server-platform.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const PROJECT_ID = "plasma-bounty-474104-m6";
const OWNER_UID = "47SB1i4UL5hlUVPqM1tQoKJFdaM2";
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
const jwk = { ...createPublicKey(keys.publicKey).export({ format: "jwk" }), kid: "kid-audit", alg: "RS256", use: "sig" };

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

function makeIdToken(uid) {
    const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: "RS256", typ: "JWT", kid: "kid-audit" });
    const payload = b64({
        aud: PROJECT_ID,
        iss: `https://securetoken.google.com/${PROJECT_ID}`,
        sub: uid,
        iat: now,
        exp: now + 3600,
        email: `${uid}@example.com`,
        email_verified: true
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

function installMockFetch({ db = {}, recorded = [] } = {}) {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        recorded.push({ url, method: init.method || "GET", body: init.body ? String(init.body) : "" });
        if (url.hostname === "www.googleapis.com") return Response.json({ keys: [jwk] });
        if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "tok-audit", expires_in: 3600 });
        if (url.hostname.endsWith("firebasedatabase.app")) {
            const key = url.pathname;
            return Response.json(Object.hasOwn(db, key) ? db[key] : null);
        }
        return new Response("not mocked", { status: 404 });
    };
    return () => { globalThis.fetch = original; };
}

test("analytics-utils: enforces fixed Nepal Time (+05:45) across UTC day and month boundaries", () => {
    assert.equal(NPT_OFFSET_MS, 345 * 60 * 1000);
    // 2026-11-26T18:30:00.000Z === 2026-11-27T00:15:00+05:45 (already Nov 27 in Nepal!)
    const nptMorningMs = Date.parse("2026-11-26T18:30:00.000Z");
    assert.equal(dayKeyFromMs(nptMorningMs), "2026-11-27");
    assert.equal(monthKeyFromMs(nptMorningMs), "2026-11");

    const expectedMidnightNpt = Date.parse("2026-11-27T00:00:00+05:45");
    assert.equal(nptStartOfDayMs(nptMorningMs), expectedMidnightNpt);

    const todayRange = getDateRangeFromPreset("today", "", "", nptMorningMs);
    assert.equal(todayRange.startMs, expectedMidnightNpt);
    assert.equal(todayRange.endMs, nptMorningMs);

    const customRange = getDateRangeFromPreset("custom", "2026-11-01", "2026-11-03", nptMorningMs);
    assert.equal(customRange.startMs, Date.parse("2026-11-01T00:00:00+05:45"));
    assert.deepEqual(enumerateDayKeys(customRange.startMs, customRange.endMs), [
        "2026-11-01",
        "2026-11-02",
        "2026-11-03"
    ]);
});

test("customer-auth: getSafeRedirectTarget allows safe SSR/query routes and rejects open redirects", () => {
    // Allowed routes
    assert.equal(getSafeRedirectTarget("?redirect=menu.html%23checkout"), "menu.html#checkout");
    assert.equal(getSafeRedirectTarget("?redirect=article.html%3Fslug%3Dmomo-guide"), "article.html?slug=momo-guide");
    assert.equal(getSafeRedirectTarget("?redirect=%2Fblog%2Fhalal-khaja-guide"), "/blog/halal-khaja-guide");
    assert.equal(getSafeRedirectTarget("?redirect=%2Fuser%2Fsiranchowk"), "/user/siranchowk");
    assert.equal(getSafeRedirectTarget("?redirect=%2Fcategory%2Fchitwan"), "/category/chitwan");
    assert.equal(getSafeRedirectTarget("?redirect=creator-studio.html"), "creator-studio.html");

    // Rejected routes
    assert.equal(getSafeRedirectTarget("?redirect=//evil.example.com"), "");
    assert.equal(getSafeRedirectTarget("?redirect=https://evil.example.com/phish"), "");
    assert.equal(getSafeRedirectTarget("?redirect=javascript:alert(1)"), "");
    assert.equal(getSafeRedirectTarget("?redirect=../admin/admin.html"), "");
    assert.equal(getSafeRedirectTarget("?redirect=/admin/admin.html"), "");
    assert.equal(getSafeRedirectTarget("?redirect=user@evil.example.com"), "");
});

test("worker: edit_article updates subtitle/contentMarkdown, permanent_delete removes articleSlugs, low_stock allows order staff", async () => {
    const recorded = [];
    const restore = installMockFetch({
        recorded,
        db: {
            [`/staff/${MOD_UID}.json`]: { role: "moderator", active: true },
            [`/staff/${OFFICER_UID}.json`]: { role: "officer", active: true },
            "/rbac/roles.json": {
                officer: { updateOrders: true, sendNotifications: false, manageInventory: false }
            },
            "/publishedArticles/art_edit_1.json": {
                id: "art_edit_1",
                slug: "edit-me-slug",
                title: "Original Title",
                subtitle: "Old subtitle",
                contentMarkdown: "Original body content",
                authorUid: USER_UID,
                status: "published"
            },
            "/moderatedArticles/art_del_1.json": {
                id: "art_del_1",
                slug: "deleted-story-slug",
                title: "Removed Story",
                authorUid: USER_UID,
                status: "removed"
            },
            "/adminDevices.json": {}
        }
    });

    try {
        const env = makeEnv();

        // 1. Moderator edit_article writes subtitle & contentMarkdown
        const editRes = await worker.fetch(new Request("https://worker.test/", {
            method: "POST",
            headers: {
                "CF-Connecting-IP": "198.51.100.11",
                Origin: ORIGIN,
                "Content-Type": "application/json",
                Authorization: `Bearer ${makeIdToken(MOD_UID)}`
            },
            body: JSON.stringify({
                type: "platform_moderate_content",
                action: "edit_article",
                targetId: "art_edit_1",
                title: "Updated Title",
                subtitle: "Updated Subtitle",
                contentMarkdown: "## Updated Heading\n\nClean updated body."
            })
        }), env);
        assert.equal(editRes.status, 200);
        const patchReq = recorded.find((r) => r.method === "PATCH" && r.url.pathname === "/publishedArticles/art_edit_1.json");
        assert.ok(patchReq, "Expected PATCH to publishedArticles/art_edit_1.json");
        const patchBody = JSON.parse(patchReq.body);
        assert.equal(patchBody.subtitle, "Updated Subtitle");
        assert.equal(patchBody.contentMarkdown, "## Updated Heading\n\nClean updated body.");

        // 2. permanent_delete_article removes articleSlugs/<slug>
        const delRes = await worker.fetch(new Request("https://worker.test/", {
            method: "POST",
            headers: {
                "CF-Connecting-IP": "198.51.100.12",
                Origin: ORIGIN,
                "Content-Type": "application/json",
                Authorization: `Bearer ${makeIdToken(MOD_UID)}`
            },
            body: JSON.stringify({
                type: "platform_moderate_content",
                action: "permanent_delete_article",
                targetId: "art_del_1"
            })
        }), env);
        assert.equal(delRes.status, 200);
        assert.ok(recorded.some((r) => r.method === "DELETE" && r.url.pathname === "/articleSlugs/deleted-story-slug.json"));

        // 3. Order officer can trigger low_stock admin_alert, but cannot send arbitrary admin_alert
        const lowStockRes = await worker.fetch(new Request("https://worker.test/", {
            method: "POST",
            headers: {
                "CF-Connecting-IP": "198.51.100.13",
                Origin: ORIGIN,
                "Content-Type": "application/json",
                Authorization: `Bearer ${makeIdToken(OFFICER_UID)}`
            },
            body: JSON.stringify({
                type: "admin_alert",
                category: "low_stock",
                title: "Low Stock Alert: Chicken",
                body: "Chicken stock is down to 1 kg.",
                targetType: "all"
            })
        }), env);
        assert.equal(lowStockRes.status, 200);

        const arbitraryAlertRes = await worker.fetch(new Request("https://worker.test/", {
            method: "POST",
            headers: {
                "CF-Connecting-IP": "198.51.100.14",
                Origin: ORIGIN,
                "Content-Type": "application/json",
                Authorization: `Bearer ${makeIdToken(OFFICER_UID)}`
            },
            body: JSON.stringify({
                type: "admin_alert",
                category: "staffAnnouncements",
                title: "Unauthorized Broadcast",
                body: "Should be blocked",
                targetType: "all"
            })
        }), env);
        assert.equal(arbitraryAlertRes.status, 403);
    } finally {
        restore();
    }
});

test("server-platform: respects platformCategories active=false and supports both targetSlug and toSlug in slugRedirects", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.startsWith("http://127.0.0.1")) {
            return originalFetch(input, init);
        }
        if (url.includes("/slugRedirects.json")) {
            return Response.json({
                "admin-to-slug": {
                    oldSlug: "admin-to-slug",
                    toSlug: "halal-khaja-and-fresh-momo-guide-khairahani-parsa-chitwan"
                }
            });
        }
        if (url.includes("/platformCategories.json")) {
            return Response.json({
                food: { slug: "food", name: "Food & Culture", active: true },
                hidden_topic: { slug: "hidden_topic", name: "Hidden Topic", active: false }
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

        const redirRes = await fetch(`${base}/blog/admin-to-slug`, { redirect: "manual" });
        assert.equal(redirRes.status, 301);
        assert.equal(redirRes.headers.get("location"), "/blog/halal-khaja-and-fresh-momo-guide-khairahani-parsa-chitwan");

        const apiExplore = await fetch(`${base}/api/platform/explore`);
        assert.equal(apiExplore.status, 200);
        const exploreData = await apiExplore.json();
        const slugs = (exploreData.categories || []).map((c) => c.slug);
        assert.ok(slugs.includes("food"));
        assert.ok(!slugs.includes("hidden_topic"));
    } finally {
        await new Promise((resolve) => server.close(resolve));
        globalThis.fetch = originalFetch;
    }
});
