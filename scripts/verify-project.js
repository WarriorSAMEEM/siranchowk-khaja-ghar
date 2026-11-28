import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const passed = [];

function ok(message) { passed.push(message); }
function fail(message) { failures.push(message); }

function readJson(relativePath) {
    try {
        return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
    } catch (error) {
        fail(`${relativePath}: ${error.message}`);
        return null;
    }
}

function walk(directory, predicate = () => true) {
    const found = [];
    if (!fs.existsSync(directory)) return found;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (["node_modules", ".git", "dist", "security-backups"].includes(entry.name)) continue;
            found.push(...walk(full, predicate));
        } else if (entry.isFile() && predicate(full)) {
            found.push(full);
        }
    }
    return found;
}

function checkJs(file, source = null, module = false) {
    const args = ["--check"];
    if (module) args.push("--input-type=module");
    if (source === null) args.push(file);
    const result = spawnSync(process.execPath, args, {
        cwd: root,
        encoding: "utf8",
        input: source === null ? undefined : source
    });
    if (result.status !== 0) {
        fail(`${path.relative(root, file)}: ${(result.stderr || result.stdout || "JavaScript syntax error").trim()}`);
    }
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const firebase = readJson("firebase.json");
const database = readJson("database.rules.json");
const firestoreBlueprint = readJson("firebase-blueprint.json");
const appMetadata = readJson("metadata.json");

if (pkg && lock) {
    if (pkg.name !== lock.packages?.[""]?.name) fail("package-lock.json root package name does not match package.json");
    if (pkg.version !== lock.packages?.[""]?.version) fail("package-lock.json root package version does not match package.json");
    if (!pkg.engines?.node || !pkg.engines.node.includes("22.12")) fail("package.json must declare the supported Node.js engine (>=22.12.0)");
    if (!pkg.scripts?.build || !pkg.scripts?.preview) fail("Required build/preview scripts are missing");
    else ok("package metadata and lockfile");
}

if (firebase?.database?.rules !== "database.rules.json") fail("firebase.json must point to database.rules.json");
else ok("Firebase configuration");

if (database?.rules?.[".read"] !== false || database?.rules?.[".write"] !== false) {
    fail("Realtime Database root must deny global reads and writes");
} else {
    ok("Realtime Database root is default-deny");
}

if (database?.rules?.orders?.["$orderId"]?.[".write"]?.includes("newData.exists()")) {
    ok("order update rule explicitly blocks staff deletion paths");
} else {
    fail("order update rule is missing the newData.exists() deletion guard");
}
if (database?.rules?.menu_items?.["$itemId"]?.available?.[".write"] &&
    database?.rules?.inventory?.items?.["$itemId"]?.currentStock?.[".write"]) {
    ok("order-driven stock availability has scoped write rules");
} else {
    fail("scoped stock/availability write rules are missing");
}

const requiredFiles = [
    "index.html", "menu.html", "about.html", "contact.html", "account.html",
    "explore.html", "blog.html", "article.html", "profile.html", "creator-studio.html",
    "admin/login.html", "admin/admin.html", "admin/css/brand-system.css", "css/brand-system.css", "js/firebase.js",
    "js/order-system.js", "js/inventory-sync.js", "public/firebase-messaging-sw.js",
    "public/_redirects", "public/_headers", "cloudflare-worker/worker.js", "cloudflare-worker/wrangler.toml"
];
for (const relative of requiredFiles) {
    if (!fs.existsSync(path.join(root, relative))) fail(`Required file missing: ${relative}`);
}
if (requiredFiles.every((f) => fs.existsSync(path.join(root, f)))) ok("required customer/admin/worker files");

const jsFiles = walk(root, (f) => f.endsWith(".js"));
for (const file of jsFiles) checkJs(file);
if (jsFiles.length) ok(`JavaScript syntax (${jsFiles.length} files)`);

const tsFiles = walk(root, (f) => f.endsWith(".ts"));
for (const file of tsFiles) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", file], {
        cwd: root, encoding: "utf8"
    });
    if (result.status !== 0) fail(`${path.relative(root, file)}: ${(result.stderr || result.stdout || "TypeScript syntax error").trim()}`);
}
if (tsFiles.length) ok(`TypeScript syntax (${tsFiles.length} files)`);

// Customer orders must be authenticated and written only through the trusted Worker.
const orderClient = fs.readFileSync(path.join(root, "js/order-system.js"), "utf8");
const orderWriteRule = database?.rules?.orders?.["$orderId"]?.[".write"] || "";
const trackingWriteRule = database?.rules?.orderTracking?.["$token"]?.[".write"] || "";
if (orderWriteRule.includes("!data.exists()") || trackingWriteRule.includes("!data.exists()")) {
    fail("Customer-side direct order/tracking creation must remain disabled");
} else {
    ok("direct customer order and tracking writes are disabled");
}
const workerSource = fs.readFileSync(path.join(root, "cloudflare-worker/worker.js"), "utf8");
if (!workerSource.includes('type === "create_order"') || !orderClient.includes('type: "create_order"') || orderClient.includes("await set(orderRef, finalOrder)")) {
    fail("Order checkout must use the authenticated server-side create_order endpoint");
} else {
    ok("authenticated server-side order creation flow");
}
if (!orderClient.includes("customerLoginRedirect") || !orderClient.includes("restorePendingCartIntent") ||
    !orderClient.includes("function scopedStorageKey") || !orderClient.includes("scopedStorageKey(TRACKING_KEY)") ||
    !orderClient.includes("getPendingOrderReference") || !workerSource.includes("idempotent: true")) {
    fail("Add-to-cart login gate, pending cart restoration or per-customer storage isolation is missing");
} else {
    ok("customer login gate, pending cart restoration and per-customer storage isolation");
}
const brandedPages = ["index.html", "menu.html", "about.html", "contact.html", "account.html", "explore.html", "blog.html", "article.html", "profile.html", "creator-studio.html"];
if (brandedPages.some((page) => !fs.readFileSync(path.join(root, page), "utf8").includes("brand-system.css")) ||
    !fs.readFileSync(path.join(root, "admin/admin.html"), "utf8").includes("brand-system.css") ||
    !fs.readFileSync(path.join(root, "admin/login.html"), "utf8").includes("SKG premium warm login overrides")) {
    fail("Unified brand design system must be loaded on public and admin pages");
} else {
    ok("unified public/admin design system references");
}
if (!firestoreBlueprint || !appMetadata || /concierge/i.test(appMetadata.description || "") ||
    fs.existsSync(path.join(root, "js/chatbot-widget.js")) ||
    fs.readFileSync(path.join(root, "server.ts"), "utf8").includes('router.post("/chat"') ||
    fs.readFileSync(path.join(root, "server.ts"), "utf8").includes("SYSTEM_INSTRUCTION") ||
    fs.readFileSync(path.join(root, "css/style.css"), "utf8").includes("skg-concierge") ||
    (firestoreBlueprint.firestore && Object.keys(firestoreBlueprint.firestore).some((key) => key.startsWith("/chatSessions")))) {
    fail("Removed dining concierge code/schema must not be reintroduced in the package");
} else {
    ok("removed concierge widget, chat API and Firestore schema stay absent");
}

const notificationsClient = fs.readFileSync(path.join(root, "js/notifications-client.js"), "utf8");
if (!notificationsClient.includes("envWorker || val.workerUrl || DEFAULT_PUSH_WORKER_URL")) {
    fail("Pages Worker URL environment variable must override stale RTDB Worker URL");
} else {
    ok("Cloudflare Pages Worker URL precedence");
}
const mapsClient = fs.readFileSync(path.join(root, "js/maps-locator.js"), "utf8");
if (!workerSource.includes('type === "maps_grounding"') || !mapsClient.includes('type: "maps_grounding"')) {
    fail("Static Pages map grounding must use the Cloudflare Worker endpoint");
} else {
    ok("Cloudflare Worker-backed Maps grounding route");
}
const firestoreRules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
if (firestoreRules.includes("minecraftboot411@gmail.com") || !firestoreRules.includes("function isPrimaryOwner()") || !firestoreRules.includes("allow create: if isPrimaryOwner()")) {
    fail("Firestore admin authority must be based on the primary owner UID, not an email address");
} else {
    ok("Firestore admin authority is UID-based and owner-controlled");
}

const headerPolicy = fs.readFileSync(path.join(root, "public/_headers"), "utf8");
if (!headerPolicy.includes("geolocation=(self)") || !headerPolicy.includes("X-Frame-Options: DENY")) {
    fail("Public security headers must permit same-origin geolocation and block framing");
} else {
    ok("public security headers and same-origin geolocation policy");
}
const viteConfig = fs.readFileSync(path.join(root, "vite.config.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.ts"), "utf8");
if (viteConfig.includes("allowedHosts: true") || !viteConfig.includes('host: "127.0.0.1"') ||
    !pkg?.scripts?.preview?.includes("--host 127.0.0.1") || !serverSource.includes('process.env.HOST || "127.0.0.1"')) {
    fail("Vite/Node development and preview servers must default to localhost and restrict allowed hosts");
} else {
    ok("local development and preview host restrictions");
}

// Validate relative imports so a missing module is caught before Vite build.
const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
for (const file of jsFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
        const target = path.resolve(path.dirname(file), match[1]);
        if (!fs.existsSync(target)) fail(`${path.relative(root, file)} imports missing file ${match[1]}`);
    }
}
ok("relative JavaScript imports");

// Check local references in source HTML (root-relative paths resolve from the project root).
const htmlFiles = walk(root, (f) => f.endsWith(".html"));
const attrPattern = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
for (const file of htmlFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(attrPattern)) {
        const value = match[1].trim();
        if (!value || /^(?:https?:|\/\/|data:|mailto:|tel:|javascript:|#)/i.test(value)) continue;
        const clean = value.split(/[?#]/, 1)[0];
        if (!clean) continue;
        const candidates = clean.startsWith("/")
            ? [path.join(root, clean.slice(1)), path.join(root, "public", clean.slice(1))]
            : [path.resolve(path.dirname(file), clean)];
        if (!candidates.some((candidate) => fs.existsSync(candidate))) {
            fail(`${path.relative(root, file)} references missing local asset ${value}`);
        }
    }
}
ok(`local HTML asset references (${htmlFiles.length} pages)`);

// Parse inline scripts too; JSON-LD blocks are data, not JavaScript.
for (const file of htmlFiles) {
    const source = fs.readFileSync(file, "utf8");
    const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let index = 0;
    for (const match of source.matchAll(scriptPattern)) {
        const attrs = match[1] || "";
        const code = (match[2] || "").trim();
        if (!code || /type\s*=\s*["']application\/(?:ld\+)?json["']/i.test(attrs)) continue;
        checkJs(`${path.relative(root, file)} inline script ${index}`, code, true);
        index += 1;
    }
}
ok("inline HTML JavaScript syntax");

// Client-delivered files must never contain service-account JSON or a private-key block.
const secretPatterns = [
    /"type"\s*:\s*"service_account"/i,
    /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/i,
    /-----BEGIN PRIVATE KEY-----[\s\S]{80,}?-----END PRIVATE KEY-----/
];
for (const publicDir of ["public", "dist"]) {
    const files = walk(path.join(root, publicDir), () => true);
    for (const file of files) {
        const base = path.basename(file).toLowerCase();
        if (/service-account|firebase-adminsdk|credential.*\.json/.test(base)) {
            fail(`Credential-like file in ${publicDir}: ${path.relative(root, file)}`);
            continue;
        }
        if (fs.statSync(file).size > 5 * 1024 * 1024) continue;
        const content = fs.readFileSync(file, "utf8");
        if (secretPatterns.some((pattern) => pattern.test(content))) {
            fail(`Service-account/private-key material detected in ${path.relative(root, file)}`);
        }
    }
}
ok("public/dist credential scan");

// Worker and Wrangler must use one consistent secret name.
const worker = fs.readFileSync(path.join(root, "cloudflare-worker/worker.js"), "utf8");
const wrangler = fs.readFileSync(path.join(root, "cloudflare-worker/wrangler.toml"), "utf8");
if (!worker.includes("env.FIREBASE_SERVICE_ACCOUNT_JSON")) fail("Worker does not read FIREBASE_SERVICE_ACCOUNT_JSON");
if (!wrangler.includes('name = "siranchowk-notifications"')) fail("Wrangler Worker name is incorrect");
if (/^\s*\[secrets\]/m.test(wrangler)) fail("wrangler.toml must not define unsupported [secrets] table");
if (/GOOGLE_SERVICE_ACCOUNT_EMAIL|GOOGLE_PRIVATE_KEY/.test(worker + wrangler)) fail("Obsolete split Worker secret references remain");
if (worker.includes("env.FIREBASE_SERVICE_ACCOUNT_JSON") && wrangler.includes('name = "siranchowk-notifications"') && !/^\s*\[secrets\]/m.test(wrangler)) {
    ok("Cloudflare Worker secret/config consistency");
}

// The old nested archive contained a service-account JSON file in public assets.
if (fs.existsSync(path.join(root, "Siranchowk-Khaja-Ghar-Final-Production-Version.zip"))) {
    fail("Remove the nested legacy ZIP; it contains an exposed service-account JSON copy");
} else {
    ok("no nested legacy credential archive");
}

if (failures.length) {
    console.error("\nPROJECT CHECK FAILED");
    for (const item of failures) console.error(` - ${item}`);
    console.error(`\n${passed.length} checks passed; ${failures.length} failed.`);
    process.exit(1);
}

console.log("\nPROJECT CHECK PASSED");
for (const item of passed) console.log(` ✓ ${item}`);
