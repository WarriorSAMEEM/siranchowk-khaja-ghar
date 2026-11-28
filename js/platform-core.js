// ============================================================================
// SIRANCHOWK KHAJA GHAR — GLOBAL PLATFORM CORE UTILITIES
// Pure shared helpers usable in Browser ES Modules, Node SSR, and Tests.
// ============================================================================

export const SITE_ORIGIN = "https://siranchowk-khaja-ghar.pages.dev";
export const BRAND_NAME = "Siranchowk Khaja Ghar";
export const BRAND_NEPALI = "सिरानचोक खाजा घर";

export const PLATFORM_CATEGORIES = Object.freeze([
    { slug: "food", name: "Food & Recipes", nepali: "खाना र परिकार", description: "Halal culinary traditions, momo craft, biryani, and everyday Nepali khaja." },
    { slug: "nepal", name: "Nepal", nepali: "नेपाल", description: "Stories, society, civic life, and perspectives from across Nepal." },
    { slug: "chitwan", name: "Chitwan & Khairahani", nepali: "चितवन र खैरहनी", description: "Local guides, neighborhoods, Parsa markets, and Chitwan life." },
    { slug: "travel", name: "Travel & Places", nepali: "यात्रा र गन्तव्य", description: "Destinations, routes, hospitality, and regional travel guides." },
    { slug: "technology", name: "Technology", nepali: "प्रविधि", description: "Web engineering, digital tools, cloud infrastructure, and software." },
    { slug: "ai", name: "Artificial Intelligence", nepali: "एआई र भविष्य", description: "Practical AI workflows, responsible automation, and digital literacy." },
    { slug: "education", name: "Education", nepali: "शिक्षा", description: "Learning methods, academic guides, and skill development." },
    { slug: "science", name: "Science", nepali: "विज्ञान", description: "Evidence-based explainers, food science, and natural phenomena." },
    { slug: "student-resources", name: "Student Resources", nepali: "विद्यार्थी स्रोत", description: "Study notes, career readiness, scholarships, and exam tips." },
    { slug: "health", name: "Health & Nutrition", nepali: "स्वास्थ्य र पोषण", description: "Hygiene, balanced daily eating, and wellness basics." },
    { slug: "lifestyle", name: "Lifestyle", nepali: "जीवनशैली", description: "Daily routines, tea culture, and community living." },
    { slug: "business", name: "Business & Local Commerce", nepali: "व्यापार र उद्यम", description: "Small hospitality operations, digital ordering, and local entrepreneurship." },
    { slug: "culture", name: "Culture & Heritage", nepali: "संस्कृति र सम्पदा", description: "Festivals, culinary heritage, languages, and community stories." },
    { slug: "general-knowledge", name: "General Knowledge", nepali: "सामान्य ज्ञान", description: "Curated reference guides, facts, and everyday explainers." },
    { slug: "announcements", name: "Official Announcements", nepali: "आधिकारिक सूचना", description: "Official updates, seasonal specials, and platform notices." }
]);

export const CATEGORY_MAP = Object.freeze(
    Object.fromEntries(PLATFORM_CATEGORIES.map((c) => [c.slug, c]))
);

export const RESERVED_SLUGS = new Set([
    "admin", "api", "account", "about", "contact", "menu", "blog", "explore",
    "category", "categories", "user", "users", "creator", "creators", "studio",
    "login", "signup", "logout", "settings", "sitemap", "robots", "assets",
    "public", "dist", "functions", "search", "trending", "latest", "following",
    "recommended", "bookmarks", "notifications", "privacy", "terms", "help", "support"
]);

export function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

export function sanitizeUrl(rawUrl, { allowRelative = true } = {}) {
    const trimmed = String(rawUrl || "").trim();
    if (!trimmed) return "";
    if (allowRelative && trimmed.startsWith("/") && !trimmed.startsWith("//")) {
        return trimmed;
    }
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            return parsed.toString();
        }
    } catch {
        return "";
    }
    return "";
}

/**
 * Generates a clean Unicode-friendly slug supporting English & Nepali/Devanagari.
 * Preserves Unicode letters and combining marks (`\p{L}\p{M}\p{N}`) while normalizing punctuation.
 */
export function slugifyUnicode(input, maxLength = 88) {
    const normalized = String(input || "")
        .normalize("NFC")
        .trim()
        .toLowerCase();

    if (!normalized) return "";

    let slug = normalized
        .replace(/[\s_./\\|+,;:!?'"`~@#$%^&*()[\]{}<>=]+/g, "-")
        .replace(/[^\p{L}\p{M}\p{N}-]+/gu, "")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");

    if (slug.length > maxLength) {
        slug = slug.slice(0, maxLength).replace(/-+$/g, "");
    }

    if (!slug || RESERVED_SLUGS.has(slug)) {
        return slug ? `${slug}-post` : "";
    }

    return slug;
}

export function normalizeUsername(input) {
    const cleaned = String(input || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, "")
        .replace(/^[._-]+|[._-]+$/g, "")
        .slice(0, 30);

    return cleaned;
}

export function isValidUsername(username) {
    const normalized = normalizeUsername(username);
    if (!normalized || normalized !== String(username || "").trim().toLowerCase()) return false;
    if (normalized.length < 3 || normalized.length > 30) return false;
    if (RESERVED_SLUGS.has(normalized)) return false;
    return /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])$/.test(normalized);
}

export function ensureUniqueSlug(desiredSlug, existingSlugMap = {}, currentArticleId = null) {
    const base = slugifyUnicode(desiredSlug) || `article-${Date.now().toString(36)}`;
    const existing = existingSlugMap[base];
    if (!existing || existing.articleId === currentArticleId) {
        return base;
    }

    let counter = 2;
    while (counter < 500) {
        const candidate = `${base}-${counter}`;
        const entry = existingSlugMap[candidate];
        if (!entry || entry.articleId === currentArticleId) {
            return candidate;
        }
        counter += 1;
    }

    return `${base}-${Date.now().toString(36)}`;
}

export function calculateReadingTimeMinutes(text = "") {
    const plain = String(text || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/[#*_`>\[\]()!-]+/g, " ")
        .trim();
    if (!plain) return 1;
    const words = plain.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
}

export function extractHeadingsFromMarkdown(markdown = "") {
    const headings = [];
    const lines = String(markdown || "").split(/\r?\n/);
    const usedIds = new Set();

    for (const line of lines) {
        const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
        if (!match) continue;
        const level = match[1].length;
        const text = match[2].replace(/[*_`~]/g, "").trim();
        if (!text) continue;

        let id = slugifyUnicode(text, 64) || `section-${headings.length + 1}`;
        let suffix = 2;
        while (usedIds.has(id)) {
            id = `${id}-${suffix++}`;
        }
        usedIds.add(id);
        headings.push({ level, text, id });
    }

    return headings;
}

function renderInlineMarkdown(escapedLine) {
    return escapedLine
        // Links: [text](url)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
            const safeHref = sanitizeUrl(url, { allowRelative: true });
            if (!safeHref) return label;
            const external = /^https?:\/\//i.test(safeHref);
            return `<a href="${escapeHTML(safeHref)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
        })
        // Inline code
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        // Bold
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        // Italic
        .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
}

/**
 * Safely renders Markdown into XSS-free HTML with anchor IDs on headings for TOC navigation.
 */
export function renderSafeMarkdownToHtml(markdown = "") {
    const lines = String(markdown || "").split(/\r?\n/);
    const out = [];
    const usedIds = new Set();
    let inUl = false;
    let inOl = false;
    let inCodeBlock = false;
    let codeBuffer = [];

    const closeLists = () => {
        if (inUl) { out.push("</ul>"); inUl = false; }
        if (inOl) { out.push("</ol>"); inOl = false; }
    };

    for (let i = 0; i < lines.length; i += 1) {
        const rawLine = lines[i];

        if (/^```/.test(rawLine.trim())) {
            closeLists();
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeBuffer = [];
            } else {
                out.push(`<pre><code>${escapeHTML(codeBuffer.join("\n"))}</code></pre>`);
                inCodeBlock = false;
                codeBuffer = [];
            }
            continue;
        }

        if (inCodeBlock) {
            codeBuffer.push(rawLine);
            continue;
        }

        const trimmed = rawLine.trim();
        if (!trimmed) {
            closeLists();
            continue;
        }

        // Image block: ![alt](url)
        const imgMatch = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(trimmed);
        if (imgMatch) {
            closeLists();
            const safeSrc = sanitizeUrl(imgMatch[2], { allowRelative: true });
            if (safeSrc) {
                const altText = escapeHTML(imgMatch[1] || "Article illustration");
                out.push(
                    `<figure class="skg-article-figure"><img src="${escapeHTML(safeSrc)}" alt="${altText}" loading="lazy" referrerpolicy="no-referrer">${imgMatch[1] ? `<figcaption>${altText}</figcaption>` : ""}</figure>`
                );
            }
            continue;
        }

        // Headings
        const hMatch = /^(#{1,3})\s+(.+?)\s*$/.exec(trimmed);
        if (hMatch) {
            closeLists();
            const level = Math.min(3, Math.max(2, hMatch[1].length === 1 ? 2 : hMatch[1].length));
            const rawHeading = hMatch[2].replace(/[*_`~]/g, "").trim();
            let id = slugifyUnicode(rawHeading, 64) || `section-${out.length + 1}`;
            let suffix = 2;
            while (usedIds.has(id)) {
                id = `${id}-${suffix++}`;
            }
            usedIds.add(id);
            out.push(`<h${level} id="${escapeHTML(id)}">${renderInlineMarkdown(escapeHTML(hMatch[2]))}</h${level}>`);
            continue;
        }

        // Blockquote
        if (trimmed.startsWith("> ")) {
            closeLists();
            out.push(`<blockquote><p>${renderInlineMarkdown(escapeHTML(trimmed.slice(2)))}</p></blockquote>`);
            continue;
        }

        // Unordered list
        const ulMatch = /^[-*]\s+(.+)$/.exec(trimmed);
        if (ulMatch) {
            if (inOl) { out.push("</ol>"); inOl = false; }
            if (!inUl) { out.push("<ul>"); inUl = true; }
            out.push(`<li>${renderInlineMarkdown(escapeHTML(ulMatch[1]))}</li>`);
            continue;
        }

        // Ordered list
        const olMatch = /^\d+\.\s+(.+)$/.exec(trimmed);
        if (olMatch) {
            if (inUl) { out.push("</ul>"); inUl = false; }
            if (!inOl) { out.push("<ol>"); inOl = true; }
            out.push(`<li>${renderInlineMarkdown(escapeHTML(olMatch[1]))}</li>`);
            continue;
        }

        // Horizontal rule
        if (/^---+$/.test(trimmed)) {
            closeLists();
            out.push("<hr>");
            continue;
        }

        closeLists();
        out.push(`<p>${renderInlineMarkdown(escapeHTML(trimmed))}</p>`);
    }

    if (inCodeBlock && codeBuffer.length) {
        out.push(`<pre><code>${escapeHTML(codeBuffer.join("\n"))}</code></pre>`);
    }
    closeLists();

    return out.join("\n");
}

/**
 * Computes transparent, explainable trending score using real recorded engagement & age decay.
 */
export function computeTrendingScore(article, nowMs = Date.now()) {
    const views = Number(article?.viewsCount || 0);
    const likes = Number(article?.likesCount || 0);
    const comments = Number(article?.commentsCount || 0);
    const reposts = Number(article?.repostsCount || 0);
    const shares = Number(article?.sharesCount || 0);
    const publishedAt = Number(article?.publishedAt || article?.createdAt || nowMs);
    const ageHours = Math.max(1, (nowMs - publishedAt) / 3600000);
    const engagement = views * 0.25 + likes * 3 + comments * 5 + reposts * 4 + shares * 2;
    return Number((engagement / Math.pow(ageHours + 2, 1.25)).toFixed(4));
}

export function buildArticleUrl(slug) {
    return `/blog/${encodeURIComponent(String(slug || ""))}`;
}

export function buildProfileUrl(username) {
    return `/user/${encodeURIComponent(String(username || ""))}`;
}

export function buildCategoryUrl(slug) {
    return `/category/${encodeURIComponent(String(slug || ""))}`;
}

// Authentic baseline editorial stories by Siranchowk Khaja Ghar (marked clearly as Official Editorial).
// Engagement counters start from zero and reflect only real recorded activity in RTDB.
export const DEFAULT_PUBLIC_PROFILES = Object.freeze({
    "47SB1i4UL5hlUVPqM1tQoKJFdaM2": {
        uid: "47SB1i4UL5hlUVPqM1tQoKJFdaM2",
        username: "siranchowk",
        displayName: "Siranchowk Khaja Ghar",
        bio: "100% Halal kitchen & community table in Khairahani-6, Parsa, Chitwan (behind Chaudhary Medical). Sharing Nepali food craft, local Parsa guides, and community stories.",
        photoURL: "https://i.postimg.cc/HnL4h5rL/siranchowkpng-logo.png",
        coverURL: "https://i.postimg.cc/13M0GD3L/heropage.jpg",
        location: "Khairahani-6, Parsa, Chitwan, Nepal",
        website: SITE_ORIGIN,
        visibility: "public",
        creatorStatus: "approved",
        joinedAt: 1758844800000,
        followersCount: 0,
        followingCount: 0,
        articlesCount: 4,
        badges: {
            emailVerified: true,
            verifiedCreator: true,
            officialOrg: true,
            expertSpecialist: true
        },
        specialtyNote: "Nepali Halal Hospitality & Local Chitwan Cuisine"
    }
});

export const DEFAULT_EDITORIAL_ARTICLES = Object.freeze([
    {
        id: "editorial-halal-khaja-khairahani-parsa",
        slug: "halal-khaja-and-fresh-momo-guide-khairahani-parsa-chitwan",
        title: "Halal Khaja & Fresh Momo Guide in Khairahani-6, Parsa, Chitwan",
        subtitle: "Behind Chaudhary Medical: how daily fresh dough, halal kitchen sourcing, and sesame-tomato achar come together every morning at 6:30 AM.",
        category: "chitwan",
        tags: ["chitwan", "khairahani", "halal-food", "momo", "parsa"],
        authorUid: "47SB1i4UL5hlUVPqM1tQoKJFdaM2",
        authorUsername: "siranchowk",
        authorName: "Siranchowk Khaja Ghar",
        coverImage: "https://i.postimg.cc/13M0GD3L/heropage.jpg",
        seoTitle: "Halal Khaja & Fresh Momo Guide in Khairahani-6, Parsa, Chitwan",
        seoDescription: "Discover fresh 100% halal momo, chowmein, paratha, and hot milk tea behind Chaudhary Medical in Khairahani-6, Parsa, Chitwan.",
        status: "published",
        visibility: "public",
        language: "en",
        publishedAt: 1790553600000,
        updatedAt: 1790553600000,
        readingTimeMin: 4,
        likesCount: 0,
        commentsCount: 0,
        repostsCount: 0,
        sharesCount: 0,
        viewsCount: 0,
        contentMarkdown: `## Welcome to Khairahani-6, Parsa

Just steps away from the Mahendra Highway junction at Parsa Chowk—tucked cleanly behind Chaudhary Medical—Siranchowk Khaja Ghar (सिरानचोक खाजा घर) prepares everyday Nepali khaja from 6:30 AM to 9:00 PM daily.

### What Makes Local Khaja Memorable

A dependable neighborhood kitchen depends on rhythm rather than shortcuts:

- **Morning Tea & Paratha**: Dough rolled fresh for morning commuters, students, and local shopkeepers.
- **Steamed Chicken & Buff Momo**: Hand-pleated batches paired with roasted tomato, sesame, and Timur-spiced achar.
- **100% Halal Kitchen Standards**: Verified ingredient sourcing and clean preparation zones throughout the day.

### Getting Here from Parsa Chowk

From the East-West Highway at Parsa Chowk, walk two minutes south-west toward Chaudhary Medical and turn into the lane directly behind the medical hall. You can also open our live [Contact & Interactive Map](/contact.html) page for turn-by-turn directions.

### Friday Chicken Biryani Tradition

Every Friday and selected festive days, our kitchen prepares fragrant Chicken Biryani in limited batches alongside regular chowmein, roti, sukuti, and masala tea.`
    },
    {
        id: "editorial-nepali-momo-chutney-craft",
        slug: "सिराने-मम-र-ताजा-टमाटर-अचार-बनाउने-परम्परागत-विधि",
        title: "ताजा म:म र तिल-टमाटर अचार: स्वाद र स्वच्छताको सन्तुलन",
        subtitle: "खैरहनी र चितवनको दैनिक खाजा संस्कृतिमा ताजा म:म, सन्तुलित मसला र भान्साको सरसफाइ किन महत्वपूर्ण छ।",
        category: "food",
        tags: ["momo", "nepali-food", "achar", "hygiene", "chitwan"],
        authorUid: "47SB1i4UL5hlUVPqM1tQoKJFdaM2",
        authorUsername: "siranchowk",
        authorName: "Siranchowk Khaja Ghar",
        coverImage: "https://i.postimg.cc/13M0GD3L/heropage.jpg",
        seoTitle: "ताजा म:म र तिल-टमाटर अचार | सिरानचोक खाजा घर चितवन",
        seoDescription: "चितवनको खैरहनी-६ पर्सामा ताजा म:म, तिल-टमाटर अचार र स्वच्छ भान्सा संस्कृतिको नेपाली मार्गदर्शन।",
        status: "published",
        visibility: "public",
        language: "ne",
        publishedAt: 1790640000000,
        updatedAt: 1790640000000,
        readingTimeMin: 3,
        likesCount: 0,
        commentsCount: 0,
        repostsCount: 0,
        sharesCount: 0,
        viewsCount: 0,
        contentMarkdown: `## म:मको स्वाद पातलो आवरण र ताजा किमामा टिकेको हुन्छ

नेपाली खाजा संस्कृतिमा म:म केवल परिकार मात्र होइन, साथीभाइ र परिवारसँग भेटघाट गर्ने बहाना पनि हो।

### अचारको तीन मुख्य आधार

1. **भुटेको सेतो तिल**: अचारमा प्राकृतिक बास्ना र गाढापन ल्याउँछ।
2. **पोलेको वा उसिनेको पाकेको टमाटर**: हल्का अमिलो र सन्तुलित बनावट दिन्छ।
3. **अदुवा, लसुन र टिमुर**: पाचन र सुगन्ध दुवैका लागि उपयोगी हुन्छ।

### स्वच्छता नै पहिलो प्राथमिकता

सिरानचोक खाजा घरमा हामी हरेक दिन १००% हलाल सामग्री र ताजा तरकारी प्रयोग गरेर म:म, चाउमिन, पराठा र चिया तयार गर्छौं।`
    },
    {
        id: "editorial-student-study-breaks-chitwan",
        slug: "balanced-affordable-meals-for-students-and-travelers-in-chitwan",
        title: "Balanced, Affordable Daily Meals for Students & Travelers in East Chitwan",
        subtitle: "Practical nutrition tips for college students, commuters, and families around Parsa, Ratnanagar, and Khairahani.",
        category: "student-resources",
        tags: ["students", "nutrition", "chitwan", "budget-meals", "education"],
        authorUid: "47SB1i4UL5hlUVPqM1tQoKJFdaM2",
        authorUsername: "siranchowk",
        authorName: "Siranchowk Khaja Ghar",
        coverImage: "https://i.postimg.cc/13M0GD3L/heropage.jpg",
        seoTitle: "Balanced Daily Meals for Students & Travelers in East Chitwan",
        seoDescription: "A practical food and hydration guide for students and travelers in Khairahani, Parsa, and East Chitwan.",
        status: "published",
        visibility: "public",
        language: "en",
        publishedAt: 1790726400000,
        updatedAt: 1790726400000,
        readingTimeMin: 4,
        likesCount: 0,
        commentsCount: 0,
        repostsCount: 0,
        sharesCount: 0,
        viewsCount: 0,
        contentMarkdown: `## Eating Well on a Daily Schedule

Whether you are heading to morning classes in East Chitwan or catching a bus along Mahendra Highway, steady energy starts with simple whole ingredients rather than ultra-processed packaged snacks.

### Smart Everyday Pairings

- **Morning**: Fresh wheat paratha or roti paired with spiced chana and boiled egg provides slow-release complex carbohydrates and protein.
- **Afternoon**: Steamed momo or vegetable chowmein cooked fresh to order keeps fat moderate while delivering warmth and satiety.
- **Hydration**: Alternate sweet milk tea with plain water or light black tea throughout warm Terai afternoons.

### Explore Our Menu

Browse daily items anytime on our [Digital Menu](/menu.html) or place a pre-order pickup request before your break.`
    },
    {
        id: "editorial-local-hospitality-digital-ordering",
        slug: "how-local-nepali-eateries-use-open-web-ordering-and-maps",
        title: "How Local Nepali Eateries Use Open Web Ordering & Interactive Maps",
        subtitle: "Behind our web architecture: transparent order confirmations, live kitchen stock sync, and privacy-respecting local discovery.",
        category: "technology",
        tags: ["technology", "nepal-tech", "hospitality", "maps", "web"],
        authorUid: "47SB1i4UL5hlUVPqM1tQoKJFdaM2",
        authorUsername: "siranchowk",
        authorName: "Siranchowk Khaja Ghar",
        coverImage: "https://i.postimg.cc/13M0GD3L/heropage.jpg",
        seoTitle: "How Local Nepali Eateries Use Open Web Ordering & Maps",
        seoDescription: "Engineering notes on real-time stock synchronization, accessible neighborhood maps, and honest order workflows in Nepal.",
        status: "published",
        visibility: "public",
        language: "en",
        publishedAt: 1790812800000,
        updatedAt: 1790812800000,
        readingTimeMin: 5,
        likesCount: 0,
        commentsCount: 0,
        repostsCount: 0,
        sharesCount: 0,
        viewsCount: 0,
        contentMarkdown: `## Designing Technology Around Real Kitchen Workflows

Local restaurants in towns like Khairahani do not need bloated third-party commissions or opaque pricing. They need fast web pages, clear landmark directions, and honest communication.

### Core Principles of Our Platform

1. **Clear Confirmation Boundaries**: Website order requests notify the kitchen counter without misleading guests into thinking an unconfirmed request is already cooking.
2. **Real-Time Stock Sync**: When ingredients run low during evening rush hours, counter updates automatically reflect menu availability.
3. **Community Publishing**: Local writers, food historians, students, and Chitwan residents can share trusted knowledge cleanly.`
    }
]);
