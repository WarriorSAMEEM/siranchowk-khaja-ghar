import express from "express";
import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  SITE_ORIGIN,
  BRAND_NAME,
  BRAND_NEPALI,
  PLATFORM_CATEGORIES,
  CATEGORY_MAP,
  DEFAULT_EDITORIAL_ARTICLES,
  DEFAULT_PUBLIC_PROFILES,
  escapeHTML,
  sanitizeUrl,
  renderSafeMarkdownToHtml,
  computeTrendingScore,
  buildArticleUrl,
  buildProfileUrl,
  buildCategoryUrl,
  normalizeUsername
} from "./js/platform-core.js";
import { renderProfileBadgesHtml, renderAuthorTicksHtml } from "./js/badges.js";

const DEFAULT_RTDB_URL =
  process.env.VITE_FIREBASE_DATABASE_URL ||
  "https://plasma-bounty-474104-m6-default-rtdb.asia-southeast1.firebasedatabase.app";
const FIREBASE_PROJECT_ID =
  process.env.VITE_FIREBASE_PROJECT_ID || "plasma-bounty-474104-m6";
const PRIMARY_OWNER_UID = "47SB1i4UL5hlUVPqM1tQoKJFdaM2";

export interface PlatformArticle {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  category: string;
  tags?: string[];
  authorUid: string;
  authorUsername?: string;
  authorName?: string;
  coverImage?: string;
  seoTitle?: string;
  seoDescription?: string;
  status: string;
  visibility?: string;
  language?: string;
  publishedAt: number;
  updatedAt?: number;
  readingTimeMin?: number;
  likesCount?: number;
  commentsCount?: number;
  repostsCount?: number;
  sharesCount?: number;
  viewsCount?: number;
  contentMarkdown: string;
  trendingScore?: number;
}

export interface PlatformProfile {
  uid: string;
  username: string;
  displayName: string;
  bio?: string;
  photoURL?: string;
  coverURL?: string;
  location?: string;
  website?: string;
  visibility?: string;
  creatorStatus?: string;
  joinedAt?: number;
  followersCount?: number;
  followingCount?: number;
  articlesCount?: number;
  badges?: Record<string, boolean>;
  specialtyNote?: string;
}

interface JwkCacheState {
  keys: Array<Record<string, unknown>> | null;
  expiresAt: number;
}

const JWK_CACHE: JwkCacheState = { keys: null, expiresAt: 0 };
const DEV_ANALYTICS_STORE: Record<
  string,
  {
    summary: { totalViews: number; readCompletes: number; totalShares: number; updatedAt: number };
    daily: Record<string, { date: string; views: number; readCompletes: number; shares: number }>;
    articles: Record<string, { articleId: string; slug: string; title: string; views: number; readCompletes: number; shares: number; updatedAt: number }>;
    referrers: Record<string, { bucket: string; count: number; lastHost: string; updatedAt: number }>;
  }
> = {};
const TRACK_RATE_MAP = new Map<string, number>();

function base64UrlToBuffer(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

async function fetchFirebaseJwks(forceRefresh = false): Promise<Array<Record<string, unknown>>> {
  const now = Date.now();
  if (!forceRefresh && JWK_CACHE.keys && JWK_CACHE.expiresAt > now) {
    return JWK_CACHE.keys;
  }
  const res = await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  );
  if (!res.ok) throw new Error("Unable to fetch Firebase public keys");
  const json = (await res.json()) as { keys?: Array<Record<string, unknown>> };
  JWK_CACHE.keys = json.keys || [];
  JWK_CACHE.expiresAt = now + 3600 * 1000;
  return JWK_CACHE.keys;
}

export async function verifyNodeFirebaseIdToken(idToken: string): Promise<Record<string, unknown>> {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Invalid Bearer token format");
  const [rawHeader, rawPayload, rawSig] = parts;
  const header = JSON.parse(base64UrlToBuffer(rawHeader).toString("utf8")) as { alg?: string; kid?: string };
  const payload = JSON.parse(base64UrlToBuffer(rawPayload).toString("utf8")) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
  };
  const nowSec = Math.floor(Date.now() / 1000);
  if (header.alg !== "RS256") throw new Error("Unsupported algorithm");
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error("Token audience mismatch");
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
    throw new Error("Token issuer mismatch");
  }
  if (
    typeof payload.sub !== "string" ||
    !payload.sub.trim() ||
    !Number.isFinite(payload.exp) ||
    Number(payload.exp) <= nowSec ||
    !Number.isFinite(payload.iat) ||
    Number(payload.iat) > nowSec + 300
  ) {
    throw new Error("Expired or invalid token claims");
  }

  let keys = await fetchFirebaseJwks(false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await fetchFirebaseJwks(true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("Signing key not found");

  const keyObject = crypto.createPublicKey({
    key: jwk as unknown as crypto.JsonWebKey,
    format: "jwk"
  });
  const ok = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${rawHeader}.${rawPayload}`),
    keyObject,
    base64UrlToBuffer(rawSig)
  );
  if (!ok) throw new Error("Invalid token signature");
  return payload as Record<string, unknown>;
}

async function fetchPublicRtdbJson<T>(rtdbPath: string): Promise<T | null> {
  const base = DEFAULT_RTDB_URL.replace(/\/$/, "");
  const encoded = rtdbPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1600);
  try {
    const res = await fetch(`${base}/${encoded}.json`, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T | null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadPublicPlatformSnapshot(): Promise<{
  articles: PlatformArticle[];
  profiles: Record<string, PlatformProfile>;
  redirects: Record<string, { targetSlug?: string; articleId?: string }>;
  categories: Array<{ slug: string; name: string; nepali?: string; description?: string; enabled?: boolean }>;
  seoSettings: Record<string, unknown>;
}> {
  const [rawArticles, rawProfiles, rawRedirects, rawCategories, rawSeo] = await Promise.all([
    fetchPublicRtdbJson<Record<string, PlatformArticle>>("publishedArticles"),
    fetchPublicRtdbJson<Record<string, PlatformProfile>>("publicProfiles"),
    fetchPublicRtdbJson<Record<string, { targetSlug?: string; articleId?: string }>>("slugRedirects"),
    fetchPublicRtdbJson<Record<string, { slug: string; name: string; nepali?: string; description?: string; enabled?: boolean }>>("platformCategories"),
    fetchPublicRtdbJson<Record<string, unknown>>("seoSettings")
  ]);

  const articleMap = new Map<string, PlatformArticle>();
  for (const art of DEFAULT_EDITORIAL_ARTICLES) {
    articleMap.set(art.id, { ...(art as PlatformArticle) });
  }
  if (rawArticles && typeof rawArticles === "object") {
    for (const [id, item] of Object.entries(rawArticles)) {
      if (!item || item.status !== "published" || item.visibility === "private") continue;
      articleMap.set(id, { ...item, id });
    }
  }

  const profiles: Record<string, PlatformProfile> = {};
  for (const [uid, def] of Object.entries(DEFAULT_PUBLIC_PROFILES)) {
    profiles[uid] = { ...(def as PlatformProfile) };
  }
  if (rawProfiles && typeof rawProfiles === "object") {
    for (const [uid, prof] of Object.entries(rawProfiles)) {
      if (!prof || typeof prof !== "object") continue;
      profiles[uid] = {
        ...(profiles[uid] || {}),
        ...prof,
        uid
      };
    }
  }

  const categories =
    rawCategories && Object.values(rawCategories).length
      ? Object.values(rawCategories).filter((c) => c && c.slug && c.name && c.enabled !== false && c.active !== false)
      : [...PLATFORM_CATEGORIES];

  const articles = [...articleMap.values()].map((a) => ({
    ...a,
    trendingScore: computeTrendingScore(a)
  }));
  articles.sort((a, b) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0));

  return {
    articles,
    profiles,
    redirects: rawRedirects || {},
    categories,
    seoSettings: rawSeo || {}
  };
}

function classifyReferrer(rawReferrer: string): { bucket: string; host: string } {
  const refStr = String(rawReferrer || "").trim().slice(0, 320).toLowerCase();
  if (!refStr) return { bucket: "direct", host: "Direct" };
  try {
    const parsed = new URL(refStr);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host.includes("siranchowk-khaja-ghar.pages.dev") || host === "localhost" || host === "127.0.0.1") {
      return { bucket: "internal", host };
    }
    if (/^(google|bing|duckduckgo|search\.yahoo|yandex|ecosia|baidu)\./i.test(host) || host.includes("google.")) {
      return { bucket: "search_organic", host };
    }
    if (/(facebook|fb\.com|l\.facebook|instagram|t\.co|twitter|x\.com|linkedin|whatsapp|wa\.me|reddit|youtube|tiktok)/i.test(host)) {
      return { bucket: "social", host };
    }
    return { bucket: "external", host };
  } catch {
    return { bucket: "direct", host: "Direct" };
  }
}

export function createPlatformApiRouter(): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: "64kb" }));

  router.get("/explore", async (req: Request, res: Response) => {
    const snapshot = await loadPublicPlatformSnapshot();
    const category = String(req.query.category || "").trim().toLowerCase();
    const q = String(req.query.q || "").trim().toLowerCase();
    const publicOnly = snapshot.articles.filter((a) => a.visibility !== "unlisted");
    const filtered = publicOnly.filter((a) => {
      if (category && category !== "all" && a.category.toLowerCase() !== category) return false;
      if (!q) return true;
      return `${a.title} ${a.subtitle || ""} ${a.authorName || ""} ${(a.tags || []).join(" ")}`.toLowerCase().includes(q);
    });
    res.json({
      articles: filtered,
      categories: snapshot.categories,
      profiles: snapshot.profiles
    });
  });

  router.get("/articles/:slug", async (req: Request, res: Response) => {
    const snapshot = await loadPublicPlatformSnapshot();
    const rawSlug = decodeURIComponent(String(req.params.slug || "")).normalize("NFC").trim().toLowerCase();
    const match = snapshot.articles.find(
      (a) => String(a.slug || "").normalize("NFC").toLowerCase() === rawSlug || a.id === req.params.slug
    );
    if (!match) {
      const redir = snapshot.redirects[rawSlug];
      const resolvedTarget = redir?.targetSlug || redir?.toSlug;
      if (resolvedTarget) {
        res.json({ redirectTo: buildArticleUrl(resolvedTarget) });
        return;
      }
      res.status(404).json({ error: "Article not found" });
      return;
    }
    res.json({
      article: match,
      author: snapshot.profiles[match.authorUid] || null
    });
  });

  router.get("/profiles/:username", async (req: Request, res: Response) => {
    const snapshot = await loadPublicPlatformSnapshot();
    const clean = normalizeUsername(decodeURIComponent(String(req.params.username || "")));
    const profile = Object.values(snapshot.profiles).find((p) => p.username === clean);
    if (!profile || profile.visibility === "private") {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    const articles = snapshot.articles.filter(
      (a) => a.authorUid === profile.uid && a.visibility !== "unlisted"
    );
    res.json({ profile, articles });
  });

  router.post("/track-event", async (req: Request, res: Response) => {
    const body = req.body as { articleId?: unknown; eventType?: unknown; sessionKey?: unknown; referrer?: unknown };
    const eventType = String(body?.eventType || "").trim();
    const articleId = String(body?.articleId || "").trim();
    if (!["view", "read_complete", "share"].includes(eventType) || !articleId) {
      res.status(400).json({ error: "Valid articleId and eventType required" });
      return;
    }

    const sessionKey = String(body?.sessionKey || "anon").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "anon";
    const ip = String(req.ip || "local");
    const dedupKey = eventType === "view" ? `view:${articleId}:${sessionKey}:${ip}` : `evt:${eventType}:${articleId}:${sessionKey}`;
    const now = Date.now();
    const last = TRACK_RATE_MAP.get(dedupKey) || 0;
    const windowMs = eventType === "view" ? 30 * 60 * 1000 : 15 * 1000;
    if (now - last < windowMs) {
      res.json({ ok: true, deduplicated: true });
      return;
    }
    TRACK_RATE_MAP.set(dedupKey, now);

    const snapshot = await loadPublicPlatformSnapshot();
    const article = snapshot.articles.find((a) => a.id === articleId);
    if (!article) {
      res.json({ ok: true, skipped: true });
      return;
    }

    const uid = article.authorUid;
    if (!DEV_ANALYTICS_STORE[uid]) {
      DEV_ANALYTICS_STORE[uid] = {
        summary: { totalViews: 0, readCompletes: 0, totalShares: 0, updatedAt: now },
        daily: {},
        articles: {},
        referrers: {}
      };
    }
    const bucketStore = DEV_ANALYTICS_STORE[uid];
    const dayKey = new Date(now).toISOString().slice(0, 10);
    if (!bucketStore.daily[dayKey]) {
      bucketStore.daily[dayKey] = { date: dayKey, views: 0, readCompletes: 0, shares: 0 };
    }
    if (!bucketStore.articles[articleId]) {
      bucketStore.articles[articleId] = {
        articleId,
        slug: article.slug,
        title: article.title,
        views: 0,
        readCompletes: 0,
        shares: 0,
        updatedAt: now
      };
    }

    if (eventType === "view") {
      bucketStore.summary.totalViews += 1;
      bucketStore.daily[dayKey].views += 1;
      bucketStore.articles[articleId].views += 1;
    } else if (eventType === "read_complete") {
      bucketStore.summary.readCompletes += 1;
      bucketStore.daily[dayKey].readCompletes += 1;
      bucketStore.articles[articleId].readCompletes += 1;
    } else if (eventType === "share") {
      bucketStore.summary.totalShares += 1;
      bucketStore.daily[dayKey].shares += 1;
      bucketStore.articles[articleId].shares += 1;
    }
    bucketStore.summary.updatedAt = now;
    bucketStore.articles[articleId].updatedAt = now;

    const { bucket, host } = classifyReferrer(String(body?.referrer || ""));
    if (!bucketStore.referrers[bucket]) {
      bucketStore.referrers[bucket] = { bucket, count: 0, lastHost: host, updatedAt: now };
    }
    bucketStore.referrers[bucket].count += 1;
    bucketStore.referrers[bucket].lastHost = host;
    bucketStore.referrers[bucket].updatedAt = now;

    res.json({ ok: true, recorded: true, eventType, sourceBucket: bucket });
  });

  router.get("/analytics/:uid", async (req: Request, res: Response) => {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      res.status(401).json({ error: "Authorization token required" });
      return;
    }
    try {
      const decoded = await verifyNodeFirebaseIdToken(token);
      const callerUid = String(decoded.sub || "");
      const targetUid = String(req.params.uid || "");
      if (callerUid !== targetUid && callerUid !== PRIMARY_OWNER_UID) {
        const staffRec = await fetchPublicRtdbJson<{ active?: boolean; role?: string }>(`staff/${callerUid}`);
        const isAllowedAdmin = staffRec?.active === true && (staffRec.role === "owner" || staffRec.role === "admin");
        if (!isAllowedAdmin) {
          res.status(403).json({ error: "Creator or admin permission required" });
          return;
        }
      }
      const data = DEV_ANALYTICS_STORE[targetUid] || {
        summary: { totalViews: 0, readCompletes: 0, totalShares: 0, updatedAt: 0 },
        daily: {},
        articles: {},
        referrers: {}
      };
      res.json(data);
    } catch {
      res.status(401).json({ error: "Invalid Firebase ID token" });
    }
  });

  router.post("/sync-email-badge", async (req: Request, res: Response) => {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      res.status(401).json({ error: "Authorization token required" });
      return;
    }
    try {
      const decoded = await verifyNodeFirebaseIdToken(token);
      res.json({ ok: true, emailVerified: decoded.email_verified === true });
    } catch {
      res.status(401).json({ error: "Invalid Firebase ID token" });
    }
  });

  return router;
}

function replaceMetaTags(
  html: string,
  {
    title,
    description,
    canonical,
    ogType = "website",
    ogImage = "https://i.postimg.cc/13M0GD3L/heropage.jpg",
    robots = "index, follow, max-image-preview:large, max-snippet:-1",
    jsonLdObjects = [],
    ssrState = null
  }: {
    title: string;
    description: string;
    canonical: string;
    ogType?: string;
    ogImage?: string;
    robots?: string;
    jsonLdObjects?: Array<Record<string, unknown>>;
    ssrState?: Record<string, unknown> | null;
  }
): string {
  const safeTitle = escapeHTML(title);
  const safeDesc = escapeHTML(description);
  const safeCanonical = escapeHTML(canonical);
  const safeImg = escapeHTML(sanitizeUrl(ogImage, { allowRelative: false }) || "https://i.postimg.cc/13M0GD3L/heropage.jpg");
  const safeRobots = escapeHTML(robots);

  const headInject = `
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}">
  <meta name="robots" content="${safeRobots}">
  <link rel="canonical" href="${safeCanonical}">
  <meta property="og:type" content="${escapeHTML(ogType)}">
  <meta property="og:site_name" content="${escapeHTML(BRAND_NAME)}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:url" content="${safeCanonical}">
  <meta property="og:image" content="${safeImg}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDesc}">
  <meta name="twitter:image" content="${safeImg}">
  ${jsonLdObjects
    .map((obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`)
    .join("\n  ")}
  ${ssrState ? `<script id="skg-ssr-state" type="application/json">${JSON.stringify(ssrState).replace(/</g, "\\u003c")}</script>` : ""}`;

  let updated = html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+name=["']description["'][^>]*>/gi, "")
    .replace(/<meta\s+name=["']robots["'][^>]*>/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "")
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "")
    .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "");

  updated = updated.replace(/<\/head>/i, `${headInject}\n</head>`);
  return updated;
}

function injectMainContent(html: string, mainId: string, innerHtml: string): string {
  const pattern = new RegExp(`(<main[^>]*id=["']${mainId}["'][^>]*>)[\\s\\S]*?(</main>)`, "i");
  if (pattern.test(html)) {
    return html.replace(pattern, `$1\n${innerHtml}\n$2`);
  }
  return html;
}

function formatIsoDate(ms: number): string {
  try {
    return new Date(Number(ms) || Date.now()).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function formatReadableDate(ms: number): string {
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

function renderSsrArticleCardsHtml(
  articles: PlatformArticle[],
  profiles: Record<string, PlatformProfile>,
  heading = "Published Stories"
): string {
  if (!articles.length) {
    return `<div class="skg-empty-card"><h2>${escapeHTML(heading)}</h2><p>No published articles match this filter yet.</p></div>`;
  }
  return `<div class="skg-ssr-feed-grid">${articles
    .map((art) => {
      const author = profiles[art.authorUid];
      const cat = CATEGORY_MAP[art.category]?.name || art.category;
      const authorUrl = author?.username ? buildProfileUrl(author.username) : "/explore";
      const ticks = renderAuthorTicksHtml(author?.badges || {}, author?.specialtyNote || "");
      return `<article class="skg-story-card">
        <div class="skg-story-meta">
          <a href="${escapeHTML(buildCategoryUrl(art.category))}">${escapeHTML(cat)}</a>
          <span>·</span>
          <time datetime="${escapeHTML(formatIsoDate(art.publishedAt))}">${escapeHTML(formatReadableDate(art.publishedAt))}</time>
          <span>·</span>
          <span>${Number(art.readingTimeMin || 3)} min read</span>
        </div>
        <h2 class="skg-story-title"><a href="${escapeHTML(buildArticleUrl(art.slug))}">${escapeHTML(art.title)}</a></h2>
        ${art.subtitle ? `<p class="skg-story-excerpt">${escapeHTML(art.subtitle)}</p>` : ""}
        <div class="skg-story-footer">
          <a href="${escapeHTML(authorUrl)}" class="skg-author-inline">${escapeHTML(author?.displayName || art.authorName || BRAND_NAME)} ${ticks}</a>
          <span class="skg-story-stats">${Number(art.likesCount || 0)} likes · ${Number(art.commentsCount || 0)} comments</span>
        </div>
      </article>`;
    })
    .join("\n")}</div>`;
}

export function registerPlatformSsrRoutes(
  app: express.Express,
  {
    rootDir,
    distDir,
    useProdStatic,
    getViteServer
  }: {
    rootDir: string;
    distDir: string;
    useProdStatic: boolean;
    getViteServer: () => Promise<{ transformIndexHtml: (url: string, html: string) => Promise<string> } | null>;
  }
): void {
  async function loadTemplateHtml(reqUrl: string, fileName: string): Promise<string> {
    const baseDir = useProdStatic ? distDir : rootDir;
    const filePath = path.join(baseDir, fileName);
    const raw = fs.readFileSync(filePath, "utf8");
    if (useProdStatic) return raw;
    const vite = await getViteServer();
    if (vite) {
      return await vite.transformIndexHtml(reqUrl, raw);
    }
    return raw;
  }

  // Dynamic robots.txt
  app.get("/robots.txt", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /admin/",
        "Disallow: /creator/",
        "Disallow: /creator-studio.html",
        "Disallow: /account.html",
        "Disallow: /api/",
        "",
        `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
        ""
      ].join("\n")
    );
  });

  // Dynamic XML Sitemap (excludes drafts, private/moderated posts, admin, creator studio, account)
  app.get("/sitemap.xml", async (_req: Request, res: Response) => {
    const snapshot = await loadPublicPlatformSnapshot();
    const xmlEscape = (v: string) =>
      String(v || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    const urls: Array<{ loc: string; lastmod: string; changefreq: string; priority: string }> = [
      { loc: `${SITE_ORIGIN}/`, lastmod: "2026-11-25", changefreq: "daily", priority: "1.0" },
      { loc: `${SITE_ORIGIN}/menu.html`, lastmod: "2026-11-25", changefreq: "daily", priority: "0.9" },
      { loc: `${SITE_ORIGIN}/explore`, lastmod: "2026-11-25", changefreq: "hourly", priority: "0.9" },
      { loc: `${SITE_ORIGIN}/blog`, lastmod: "2026-11-25", changefreq: "hourly", priority: "0.9" },
      { loc: `${SITE_ORIGIN}/about.html`, lastmod: "2026-11-25", changefreq: "monthly", priority: "0.7" },
      { loc: `${SITE_ORIGIN}/contact.html`, lastmod: "2026-11-25", changefreq: "monthly", priority: "0.8" }
    ];

    for (const cat of snapshot.categories) {
      urls.push({
        loc: `${SITE_ORIGIN}${buildCategoryUrl(cat.slug)}`,
        lastmod: "2026-11-25",
        changefreq: "daily",
        priority: "0.75"
      });
    }

    for (const art of snapshot.articles) {
      if (art.visibility === "unlisted" || art.visibility === "private" || art.status !== "published") continue;
      urls.push({
        loc: `${SITE_ORIGIN}${buildArticleUrl(art.slug)}`,
        lastmod: formatIsoDate(art.updatedAt || art.publishedAt).slice(0, 10),
        changefreq: "weekly",
        priority: "0.85"
      });
    }

    for (const prof of Object.values(snapshot.profiles)) {
      if (!prof.username || prof.visibility === "private") continue;
      urls.push({
        loc: `${SITE_ORIGIN}${buildProfileUrl(prof.username)}`,
        lastmod: "2026-11-25",
        changefreq: "weekly",
        priority: "0.7"
      });
    }

    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map(
        (u) =>
          `  <url>\n    <loc>${xmlEscape(u.loc)}</loc>\n    <lastmod>${xmlEscape(u.lastmod)}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      )
      .join("\n")}\n</urlset>\n`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.send(body);
  });

  // Private Creator Studio (noindex enforced)
  app.get(["/creator/studio", "/creator/studio/{*subpath}", "/creator-studio.html"], async (req: Request, res: Response) => {
    const html = await loadTemplateHtml(req.originalUrl, "creator-studio.html");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  // Account private page header
  app.get("/account.html", async (req: Request, res: Response, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  // Explore & Blog Index SSR
  app.get(["/explore", "/explore.html", "/blog", "/blog.html"], async (req: Request, res: Response) => {
    const isBlog = req.path.startsWith("/blog");
    const templateFile = isBlog ? "blog.html" : "explore.html";
    const snapshot = await loadPublicPlatformSnapshot();
    const publicArticles = snapshot.articles.filter((a) => a.visibility !== "unlisted");
    const canonicalPath = isBlog ? "/blog" : "/explore";
    const title = isBlog
      ? `Editorial Blog & Community Stories | ${BRAND_NAME}`
      : `Explore Global Knowledge, Stories & Creators | ${BRAND_NAME}`;
    const description = isBlog
      ? `Read articles on Nepali halal food, Chitwan local guides, technology, education, and community perspectives on ${BRAND_NAME}.`
      : `Discover trending posts, verified creators, and curated topics across Food, Nepal, Chitwan, Tech, AI, Education, and Lifestyle.`;

    const collectionLd = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      description,
      url: `${SITE_ORIGIN}${canonicalPath}`,
      inLanguage: ["en", "ne"]
    };
    const breadcrumbLd = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: isBlog ? "Blog" : "Explore", item: `${SITE_ORIGIN}${canonicalPath}` }
      ]
    };

    let html = await loadTemplateHtml(req.originalUrl, templateFile);
    html = replaceMetaTags(html, {
      title,
      description,
      canonical: `${SITE_ORIGIN}${canonicalPath}`,
      jsonLdObjects: [collectionLd, breadcrumbLd],
      ssrState: { view: isBlog ? "blog" : "explore", articles: publicArticles, profiles: snapshot.profiles, categories: snapshot.categories }
    });
    const listHtml = renderSsrArticleCardsHtml(publicArticles, snapshot.profiles, isBlog ? "Latest Editorial & Creator Articles" : "Discover Stories");
    html = injectMainContent(html, "discovery-feed-ssr-slot", listHtml);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  // Category SSR
  app.get("/category/:slug", async (req: Request, res: Response) => {
    const snapshot = await loadPublicPlatformSnapshot();
    const catSlug = String(req.params.slug || "").trim().toLowerCase();
    const cat = snapshot.categories.find((c) => c.slug.toLowerCase() === catSlug);
    if (!cat) {
      let html = await loadTemplateHtml(req.originalUrl, "explore.html");
      html = replaceMetaTags(html, {
        title: `Category Not Found | ${BRAND_NAME}`,
        description: "The requested topic category could not be found.",
        canonical: `${SITE_ORIGIN}/explore`,
        robots: "noindex, nofollow"
      });
      res.status(404).setHeader("X-Robots-Tag", "noindex, nofollow").setHeader("Content-Type", "text/html; charset=utf-8").send(html);
      return;
    }

    const catArticles = snapshot.articles.filter((a) => a.visibility !== "unlisted" && a.category.toLowerCase() === catSlug);
    const title = `${cat.name} Articles & Guides | ${BRAND_NAME}`;
    const description = cat.description || `Explore ${cat.name} articles published on ${BRAND_NAME}.`;
    const canonical = `${SITE_ORIGIN}${buildCategoryUrl(cat.slug)}`;

    const collectionLd = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: cat.name,
      description,
      url: canonical
    };
    const breadcrumbLd = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Explore", item: `${SITE_ORIGIN}/explore` },
        { "@type": "ListItem", position: 3, name: cat.name, item: canonical }
      ]
    };

    let html = await loadTemplateHtml(req.originalUrl, "explore.html");
    html = replaceMetaTags(html, {
      title,
      description,
      canonical,
      jsonLdObjects: [collectionLd, breadcrumbLd],
      ssrState: { view: "category", categorySlug: cat.slug, articles: catArticles, profiles: snapshot.profiles, categories: snapshot.categories }
    });
    const listHtml = `<header class="skg-ssr-category-head"><h1>${escapeHTML(cat.name)}</h1><p>${escapeHTML(description)}</p></header>${renderSsrArticleCardsHtml(catArticles, snapshot.profiles, cat.name)}`;
    html = injectMainContent(html, "discovery-feed-ssr-slot", listHtml);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  // Article SSR (/blog/:slug) with 301 redirect map & strict 404
  app.get("/blog/:slug", async (req: Request, res: Response) => {
    const snapshot = await loadPublicPlatformSnapshot();
    const rawSlug = decodeURIComponent(String(req.params.slug || "")).normalize("NFC").trim().toLowerCase();
    const article = snapshot.articles.find(
      (a) => String(a.slug || "").normalize("NFC").toLowerCase() === rawSlug || a.id === req.params.slug
    );

    if (!article) {
      const redir = snapshot.redirects[rawSlug];
      const resolvedTarget = redir?.targetSlug || redir?.toSlug;
      if (resolvedTarget) {
        res.redirect(301, buildArticleUrl(resolvedTarget));
        return;
      }
      let html404 = await loadTemplateHtml(req.originalUrl, "article.html");
      html404 = replaceMetaTags(html404, {
        title: `Article Not Found | ${BRAND_NAME}`,
        description: "This article does not exist or is no longer publicly available.",
        canonical: `${SITE_ORIGIN}/blog`,
        robots: "noindex, nofollow"
      });
      html404 = injectMainContent(
        html404,
        "article-root",
        `<section class="skg-article-notfound"><h1>Article Not Found</h1><p>This story may have been moved, unpublished, or removed.</p><p><a href="/explore" class="btn btn-primary">Explore Published Stories</a></p></section>`
      );
      res.status(404).setHeader("X-Robots-Tag", "noindex, nofollow").setHeader("Content-Type", "text/html; charset=utf-8").send(html404);
      return;
    }

    const author = snapshot.profiles[article.authorUid] || {
      uid: article.authorUid,
      username: article.authorUsername || "creator",
      displayName: article.authorName || BRAND_NAME,
      badges: {}
    };
    const canonical = `${SITE_ORIGIN}${buildArticleUrl(article.slug)}`;
    const seoTitle = `${article.seoTitle || article.title} | ${BRAND_NAME}`;
    const seoDescription = article.seoDescription || article.subtitle || `${article.title} — published on ${BRAND_NAME}.`;
    const renderedBodyHtml = renderSafeMarkdownToHtml(article.contentMarkdown || "");
    const cat = CATEGORY_MAP[article.category];

    const blogPostingLd = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: article.title,
      description: seoDescription,
      url: canonical,
      mainEntityOfPage: canonical,
      datePublished: formatIsoDate(article.publishedAt),
      dateModified: formatIsoDate(article.updatedAt || article.publishedAt),
      inLanguage: article.language === "ne" ? "ne" : "en",
      image: [sanitizeUrl(article.coverImage || "", { allowRelative: false }) || "https://i.postimg.cc/13M0GD3L/heropage.jpg"],
      author: {
        "@type": "Person",
        name: author.displayName,
        url: `${SITE_ORIGIN}${buildProfileUrl(author.username)}`
      },
      publisher: {
        "@type": "Organization",
        name: BRAND_NAME,
        alternateName: BRAND_NEPALI,
        logo: {
          "@type": "ImageObject",
          url: "https://i.postimg.cc/HnL4h5rL/siranchowkpng-logo.png"
        }
      }
    };

    const breadcrumbLd = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_ORIGIN}/blog` },
        { "@type": "ListItem", position: 3, name: cat?.name || article.category, item: `${SITE_ORIGIN}${buildCategoryUrl(article.category)}` },
        { "@type": "ListItem", position: 4, name: article.title, item: canonical }
      ]
    };

    const ssrArticleMarkup = `
      <article class="skg-article-ssr" itemscope itemtype="https://schema.org/BlogPosting">
        <nav class="skg-breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Home</a> <span>/</span>
          <a href="/blog">Blog</a> <span>/</span>
          <a href="${escapeHTML(buildCategoryUrl(article.category))}">${escapeHTML(cat?.name || article.category)}</a>
        </nav>
        <header class="skg-article-header">
          <h1 itemprop="headline">${escapeHTML(article.title)}</h1>
          ${article.subtitle ? `<p class="skg-article-subtitle">${escapeHTML(article.subtitle)}</p>` : ""}
          <div class="skg-article-byline">
            <a href="${escapeHTML(buildProfileUrl(author.username))}" rel="author">${escapeHTML(author.displayName)}</a>
            ${renderAuthorTicksHtml(author.badges || {}, author.specialtyNote || "")}
            <span>·</span>
            <time datetime="${escapeHTML(formatIsoDate(article.publishedAt))}">${escapeHTML(formatReadableDate(article.publishedAt))}</time>
            <span>·</span>
            <span>${Number(article.readingTimeMin || 3)} min read</span>
          </div>
        </header>
        <div class="skg-article-prose" itemprop="articleBody">${renderedBodyHtml}</div>
      </article>
    `;

    let html = await loadTemplateHtml(req.originalUrl, "article.html");
    html = replaceMetaTags(html, {
      title: seoTitle,
      description: seoDescription,
      canonical,
      ogType: "article",
      ogImage: article.coverImage || "https://i.postimg.cc/13M0GD3L/heropage.jpg",
      robots: article.visibility === "unlisted" ? "noindex, follow" : "index, follow, max-image-preview:large, max-snippet:-1",
      jsonLdObjects: [blogPostingLd, breadcrumbLd],
      ssrState: { article, author }
    });
    html = injectMainContent(html, "article-root", ssrArticleMarkup);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  // Public Profile SSR (/user/:username)
  app.get("/user/:username", async (req: Request, res: Response) => {
    const snapshot = await loadPublicPlatformSnapshot();
    const clean = normalizeUsername(decodeURIComponent(String(req.params.username || "")));
    const profile = Object.values(snapshot.profiles).find((p) => p.username === clean);

    if (!profile || profile.visibility === "private") {
      let html404 = await loadTemplateHtml(req.originalUrl, "profile.html");
      html404 = replaceMetaTags(html404, {
        title: `Profile Not Found | ${BRAND_NAME}`,
        description: "This public profile is unavailable or private.",
        canonical: `${SITE_ORIGIN}/explore`,
        robots: "noindex, nofollow"
      });
      html404 = injectMainContent(
        html404,
        "profile-root",
        `<section class="skg-profile-notfound"><h1>Profile Not Found</h1><p>No public creator profile exists at @${escapeHTML(clean)}.</p><p><a href="/explore" class="btn btn-primary">Browse Creators</a></p></section>`
      );
      res.status(404).setHeader("X-Robots-Tag", "noindex, nofollow").setHeader("Content-Type", "text/html; charset=utf-8").send(html404);
      return;
    }

    const userArticles = snapshot.articles.filter(
      (a) => a.authorUid === profile.uid && a.visibility !== "unlisted"
    );
    const canonical = `${SITE_ORIGIN}${buildProfileUrl(profile.username)}`;
    const title = `${profile.displayName} (@${profile.username}) | ${BRAND_NAME}`;
    const description = profile.bio || `Articles and community updates by ${profile.displayName} on ${BRAND_NAME}.`;

    const personLd = {
      "@context": "https://schema.org",
      "@type": "Person",
      name: profile.displayName,
      alternateName: `@${profile.username}`,
      description,
      url: canonical,
      image: sanitizeUrl(profile.photoURL || "", { allowRelative: false }) || "https://i.postimg.cc/HnL4h5rL/siranchowkpng-logo.png"
    };
    const breadcrumbLd = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Creators", item: `${SITE_ORIGIN}/explore` },
        { "@type": "ListItem", position: 3, name: profile.displayName, item: canonical }
      ]
    };

    const ssrProfileHtml = `
      <section class="skg-profile-ssr">
        <h1>${escapeHTML(profile.displayName)}</h1>
        <p class="skg-profile-handle">@${escapeHTML(profile.username)}</p>
        ${renderProfileBadgesHtml(profile.badges || {}, { includeEmailVerified: true, specialtyNote: profile.specialtyNote || "" })}
        ${profile.bio ? `<p class="skg-profile-bio">${escapeHTML(profile.bio)}</p>` : ""}
        ${renderSsrArticleCardsHtml(userArticles, snapshot.profiles, `Articles by ${profile.displayName}`)}
      </section>
    `;

    let html = await loadTemplateHtml(req.originalUrl, "profile.html");
    html = replaceMetaTags(html, {
      title,
      description,
      canonical,
      ogType: "profile",
      ogImage: profile.photoURL || "https://i.postimg.cc/HnL4h5rL/siranchowkpng-logo.png",
      jsonLdObjects: [personLd, breadcrumbLd],
      ssrState: { profile, articles: userArticles }
    });
    html = injectMainContent(html, "profile-root", ssrProfileHtml);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });
}
