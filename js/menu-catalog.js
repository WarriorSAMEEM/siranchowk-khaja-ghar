// ============================================================================
// SIRANCHOWK KHAJA GHAR — AUTHORITATIVE MENU CATALOG, PRICING & BILLING ENGINE
// ============================================================================
// Single source of truth shared across customer UI, cart/checkout, admin menu
// manager, Cloudflare Worker order verification, and automated tests.
// ============================================================================

export function slugifyDishKey(name) {
    return String(name || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");
}

export function normalizeValidPrice(value) {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.round(num);
}

export const CANONICAL_MENU_ITEMS = Object.freeze([
    {
        id: "momo-chicken",
        aliases: ["chicken-momo", "momo-chicken"],
        category: "momo",
        categoryLabel: "Momo",
        name: "Chicken Momo",
        nepaliName: "चिकेन म:म",
        description: "Steamed dumplings filled with spiced minced chicken, fresh herbs, and served with signature chutney.",
        price: 130,
        available: true,
        featured: true,
        badge: "Popular",
        availabilityNote: "Prepared fresh daily",
        image: "https://i.postimg.cc/B67vSQNg/chicken-momo.jpg",
        alt: "Steamed Nepali Chicken Momo served with spicy chutney"
    },
    {
        id: "momo-buff",
        aliases: ["buff-momo", "momo-buff"],
        category: "momo",
        categoryLabel: "Momo",
        name: "Buff Momo",
        nepaliName: "बफ म:म",
        description: "Traditional Nepali buff dumplings steamed hot and served with fresh tomato-sesame chutney.",
        price: 140,
        available: true,
        featured: true,
        badge: "Favorite",
        availabilityNote: "Prepared fresh daily",
        image: "https://i.postimg.cc/3ryGkPpY/buff-momo.jpg",
        alt: "Steamed Nepali Buff Momo with spicy sauce"
    },
    {
        id: "chowmein-veg",
        aliases: ["veg-chowmein", "chowmein-veg"],
        category: "chowmein",
        categoryLabel: "Chowmein",
        name: "Veg Chowmein",
        nepaliName: "भेज चाउमिन",
        description: "Stir-fried Nepali-style noodles tossed with crisp cabbage, carrots, onion, and savory spices.",
        price: 100,
        available: true,
        featured: false,
        badge: "",
        availabilityNote: "Prepared fresh daily",
        image: "https://i.postimg.cc/5yGj3NCL/veg-choumin.jpg",
        alt: "Nepali Vegetable Chowmein noodles"
    },
    {
        id: "chowmein-chicken",
        aliases: ["chicken-chowmein", "chowmein-chicken"],
        category: "chowmein",
        categoryLabel: "Chowmein",
        name: "Chicken Chowmein",
        nepaliName: "चिकेन चाउमिन",
        description: "Fresh wok-fried noodles tossed with spiced chicken strips, mixed vegetables, and local seasonings.",
        price: 150,
        available: true,
        featured: true,
        badge: "",
        availabilityNote: "Prepared fresh daily",
        image: "https://i.postimg.cc/MTHWFJxD/chicken-choumin.jpg",
        alt: "Nepali Chicken Chowmein noodles"
    },
    {
        id: "roti-plain",
        aliases: ["roti", "roti-plain", "plain-roti"],
        category: "roti",
        categoryLabel: "Bread / Roti",
        name: "Roti",
        nepaliName: "रोटी",
        description: "Soft whole wheat flatbread made warm on the griddle upon request.",
        price: null, // Intentionally UNSET until authorized admin enters a positive price
        available: true,
        featured: false,
        badge: "",
        availabilityNote: "Available all day",
        image: "https://i.postimg.cc/qqYgLM3x/roti.jpg",
        alt: "Fresh hot whole wheat Nepali Roti"
    },
    {
        id: "roti-paratha",
        aliases: ["paratha", "fresh-paratha", "roti-paratha"],
        category: "roti",
        categoryLabel: "Bread / Roti",
        name: "Paratha",
        nepaliName: "पराठा",
        description: "Warm, layered flatbread fried lightly with ghee/oil. Ideal with morning tea or curry.",
        price: 30,
        available: true,
        featured: true,
        badge: "",
        availabilityNote: "Available all day",
        image: "https://i.postimg.cc/6617wz1b/parathaa.jpg",
        alt: "Golden crispy Nepali Paratha"
    },
    {
        id: "tea-milk",
        aliases: ["milk-tea", "tea-milk", "chiya"],
        category: "tea",
        categoryLabel: "Tea",
        name: "Milk Tea",
        nepaliName: "चिया (दुध)",
        description: "Traditional Nepali milk tea brewed hot with quality CTC tea leaves and fresh milk.",
        price: 25,
        available: true,
        featured: true,
        badge: "",
        availabilityNote: "Freshly brewed",
        image: "https://i.postimg.cc/sx1v7Z1t/milk-tea.jpg",
        alt: "Hot Nepali milk tea in a glass cup"
    },
    {
        id: "tea-black",
        aliases: ["black-tea", "tea-black"],
        category: "tea",
        categoryLabel: "Tea",
        name: "Black Tea",
        nepaliName: "कालो चिया",
        description: "Aromatic black tea brewed hot with optional ginger or lemon touch.",
        price: 19,
        available: true,
        featured: false,
        badge: "",
        availabilityNote: "Freshly brewed",
        image: "https://i.postimg.cc/FFfSY2cL/black-tea.jpg",
        alt: "Fresh hot black tea in a glass"
    },
    {
        id: "special-biryani",
        aliases: ["biryani", "special-biryani", "chicken-biryani"],
        category: "special",
        categoryLabel: "Rice & Special",
        name: "Biryani",
        nepaliName: "बिरयानी",
        description: "Fragrant rice dish cooked with herbs, rich spices, and marinated chicken.",
        price: 350,
        available: true,
        featured: true,
        badge: "Friday & Special Days",
        availabilityNote: "Friday & Special Days Only",
        image: "https://i.postimg.cc/wMs9951T/biryani.jpg",
        alt: "Special Chicken Biryani rice dish"
    },
    {
        id: "snack-chana",
        aliases: ["chana", "snack-chana"],
        category: "snacks",
        categoryLabel: "Snacks / Other",
        name: "Chana",
        nepaliName: "चना",
        description: "Spiced chickpeas sauteed with onions, green chilies, and Nepali masalas.",
        price: 30,
        available: true,
        featured: false,
        badge: "",
        availabilityNote: "Great with hot tea",
        image: "https://i.postimg.cc/Dmkn0WGQ/chana.jpg",
        alt: "Spiced Nepali Chana snack"
    },
    {
        id: "snack-keema",
        aliases: ["keema", "snack-keema"],
        category: "snacks",
        categoryLabel: "Snacks / Other",
        name: "Keema",
        nepaliName: "कीमा",
        description: "Minced meat cooked with garlic, onions, and spicy gravy.",
        price: 120,
        available: true,
        featured: false,
        badge: "",
        availabilityNote: "Prepared fresh",
        image: "https://i.postimg.cc/CxbdG0LF/keema.jpg",
        alt: "Spiced Keema fry"
    },
    {
        id: "snack-sukuti",
        aliases: ["sukuti", "snack-sukuti"],
        category: "snacks",
        categoryLabel: "Snacks / Other",
        name: "Sukuti",
        nepaliName: "सुकुटी",
        description: "Traditional seasoned local fried dish enjoyed with tea or snacks.",
        price: 120,
        available: true,
        featured: false,
        badge: "",
        availabilityNote: "Local favorite",
        image: "https://i.postimg.cc/YCg6PT8C/sukuti.jpg",
        alt: "Nepali local snack dish"
    },
    {
        id: "snack-boiled-egg",
        aliases: ["boiled-egg", "snack-boiled-egg", "egg"],
        category: "snacks",
        categoryLabel: "Snacks / Other",
        name: "Boiled Egg",
        nepaliName: "उसिनेको अण्डा",
        description: "Fresh boiled eggs served with salt and chili pepper seasoning.",
        price: 30,
        available: true,
        featured: false,
        badge: "",
        availabilityNote: "Quick healthy option",
        image: "https://i.postimg.cc/hjZGDPMz/egg.jpg",
        alt: "Fresh Boiled Eggs with salt and pepper"
    },
    {
        id: "snack-fried-chicken",
        aliases: ["fried-chicken", "snack-fried-chicken"],
        category: "snacks",
        categoryLabel: "Snacks / Other",
        name: "Fried Chicken",
        nepaliName: "फ्राइड चिकेन",
        description: "Crispy seasoned chicken pieces fried to golden perfection.",
        price: 200,
        available: true,
        featured: false,
        badge: "",
        availabilityNote: "Crispy and fresh",
        image: "https://i.postimg.cc/d1V1cTR8/fried-chicken.jpg",
        alt: "Golden crispy fried chicken"
    }
]);

export function isItemPriceValid(item) {
    return typeof item?.price === "number" && Number.isFinite(item.price) && item.price > 0;
}

export function isItemOrderableOnline(item) {
    return Boolean(item && item.available !== false && isItemPriceValid(item));
}

export function formatPriceLabel(item) {
    if (isItemPriceValid(item)) {
        return `Rs. ${Math.round(item.price)}`;
    }
    return "Price not set — Counter / WhatsApp only";
}

function buildCanonicalAliasLookup() {
    const map = new Map();
    CANONICAL_MENU_ITEMS.forEach((item) => {
        map.set(item.id.toLowerCase(), item.id);
        map.set(slugifyDishKey(item.name), item.id);
        (item.aliases || []).forEach((alias) => {
            map.set(slugifyDishKey(alias), item.id);
        });
    });
    return map;
}

const ALIAS_LOOKUP = buildCanonicalAliasLookup();

export function resolveCanonicalId(idOrName) {
    const key = slugifyDishKey(idOrName);
    if (!key) return null;
    return ALIAS_LOOKUP.get(key) || null;
}

/**
 * Merges live Firebase RTDB `menu_items` and `inventory/stockAvailability`
 * with the authoritative baseline catalog.
 *
 * Rules:
 * - Preserves all 14 canonical dishes even if RTDB only stores partial items.
 * - Live RTDB valid prices override baseline defaults.
 * - Roti (`roti-plain`) starts with `price: null` and NEVER receives a fabricated price.
 * - If an admin explicitly clears a price (`priceUnset: true` or `price === null` with `name`),
 *   it remains `null` and blocked from online cart/checkout until a valid positive price is set.
 * - Additional admin-created items outside the 14 baseline dishes are appended cleanly.
 */
export function mergeMenuWithDefaults(rtdbMenuMap = {}, stockAvailabilityMap = {}) {
    const remoteEntries = Object.entries(rtdbMenuMap || {})
        .filter(([, val]) => val && typeof val === "object")
        .map(([key, val]) => ({ key, ...val }));

    const remoteByCanonicalId = new Map();
    const extraEntries = [];

    remoteEntries.forEach((entry) => {
        const canonicalId =
            resolveCanonicalId(entry.id) ||
            resolveCanonicalId(entry.key) ||
            resolveCanonicalId(entry.name);

        if (canonicalId) {
            const existing = remoteByCanonicalId.get(canonicalId);
            // Prefer canonical key exact match or newest updatedAt if multiple exist
            if (!existing || entry.key === canonicalId || Number(entry.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
                remoteByCanonicalId.set(canonicalId, entry);
            }
        } else if (entry.name) {
            extraEntries.push(entry);
        }
    });

    const isStockUnavailable = (item) => {
        const nameKey = slugifyDishKey(item.name);
        const idKey = slugifyDishKey(item.id);
        const byName = nameKey && stockAvailabilityMap?.[nameKey];
        const byId = idKey && stockAvailabilityMap?.[idKey];
        return (byName && byName.available === false) || (byId && byId.available === false);
    };

    const mergedCanonical = CANONICAL_MENU_ITEMS.map((base) => {
        const remote = remoteByCanonicalId.get(base.id);
        let resolvedPrice = base.price;

        if (remote) {
            const parsed = normalizeValidPrice(remote.price);
            if (parsed !== null) {
                resolvedPrice = parsed;
            } else if (remote.priceUnset === true || remote.price === null || remote.price === 0 || remote.price === "") {
                // Only keep baseline if remote is merely an inventory partial patch without `name` & without explicit price field
                const isPartialAvailabilityPatch = !Object.prototype.hasOwnProperty.call(remote, "price") && !remote.name;
                resolvedPrice = isPartialAvailabilityPatch ? base.price : null;
            }
        }

        const mergedItem = {
            ...base,
            id: base.id,
            remoteKey: remote?.key || base.id,
            inDatabase: Boolean(remote && remote.name),
            name: remote?.name ? String(remote.name).trim() : base.name,
            nepaliName: remote?.nepaliName !== undefined ? String(remote.nepaliName) : base.nepaliName,
            category: remote?.category ? String(remote.category).toLowerCase() : base.category,
            categoryLabel: remote?.categoryLabel || base.categoryLabel,
            description: remote?.description !== undefined && remote.description !== "" ? String(remote.description) : base.description,
            price: resolvedPrice,
            priceUnset: resolvedPrice === null,
            available: remote ? remote.available !== false : base.available,
            availabilityNote: remote?.availabilityNote || base.availabilityNote,
            image: remote?.imageUrl || remote?.image || base.image,
            alt: remote?.alt || base.alt,
            updatedAt: Number(remote?.updatedAt || 0)
        };

        if (isStockUnavailable(mergedItem)) {
            mergedItem.available = false;
            mergedItem.stockOut = true;
        }
        mergedItem.priceNote = formatPriceLabel(mergedItem);
        mergedItem.orderableOnline = isItemOrderableOnline(mergedItem);
        return mergedItem;
    });

    const mergedExtra = extraEntries
        .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
        .map((remote) => {
            const parsedPrice = normalizeValidPrice(remote.price);
            const item = {
                id: String(remote.id || remote.key),
                remoteKey: remote.key,
                inDatabase: true,
                aliases: [slugifyDishKey(remote.name)],
                category: String(remote.category || "snacks").toLowerCase(),
                categoryLabel: remote.categoryLabel || remote.category || "Menu",
                name: String(remote.name || "").trim(),
                nepaliName: String(remote.nepaliName || ""),
                description: String(remote.description || ""),
                price: parsedPrice,
                priceUnset: parsedPrice === null,
                available: remote.available !== false,
                featured: Boolean(remote.featured),
                badge: String(remote.badge || ""),
                availabilityNote: String(remote.availabilityNote || ""),
                image: remote.imageUrl || remote.image || "",
                alt: remote.alt || remote.name || "Menu item",
                updatedAt: Number(remote.updatedAt || 0)
            };
            if (isStockUnavailable(item)) {
                item.available = false;
                item.stockOut = true;
            }
            item.priceNote = formatPriceLabel(item);
            item.orderableOnline = isItemOrderableOnline(item);
            return item;
        });

    return [...mergedCanonical, ...mergedExtra];
}

export function findMenuItem(menuItems = [], idOrName) {
    const raw = String(idOrName || "").trim();
    if (!raw) return null;
    const canonicalId = resolveCanonicalId(raw);
    const slug = slugifyDishKey(raw);
    return (
        menuItems.find((m) =>
            m.id === raw ||
            m.remoteKey === raw ||
            (canonicalId && m.id === canonicalId) ||
            slugifyDishKey(m.name) === slug
        ) || null
    );
}

export function computeCouponDiscount(offer, subtotalNpr, nowMs = Date.now()) {
    const subtotal = Math.max(0, Math.round(Number(subtotalNpr) || 0));
    if (!offer || typeof offer !== "object") {
        return { valid: false, reason: "Invalid coupon.", discountAmount: 0, totalAmount: subtotal };
    }
    if (offer.active === false) {
        return { valid: false, reason: "This coupon is no longer active.", discountAmount: 0, totalAmount: subtotal };
    }
    if (offer.expiresAt && Number(offer.expiresAt) <= nowMs) {
        return { valid: false, reason: "This coupon has expired.", discountAmount: 0, totalAmount: subtotal };
    }
    const minOrder = Math.max(0, Math.round(Number(offer.minOrderNpr || offer.minOrder || 0)));
    if (minOrder > 0 && subtotal < minOrder) {
        return {
            valid: false,
            reason: `Minimum order of Rs. ${minOrder} is required for coupon ${offer.code || ""}.`,
            discountAmount: 0,
            totalAmount: subtotal
        };
    }

    const rawVal = Number(offer.discountValue || 0);
    let discountAmount = 0;
    if (offer.discountType === "percent") {
        const pct = Math.min(100, Math.max(0, rawVal));
        discountAmount = Math.round((subtotal * pct) / 100);
    } else {
        discountAmount = Math.round(Math.max(0, rawVal));
    }
    discountAmount = Math.min(subtotal, Math.max(0, discountAmount));

    return {
        valid: true,
        reason: "",
        discountAmount,
        totalAmount: Math.max(0, subtotal - discountAmount)
    };
}

/**
 * Computes an authoritative itemized bill strictly from merged menu items.
 * Never reads prices from client item payloads.
 */
export function calculateOrderBill(requestedItems = [], menuItems = [], coupon = null, nowMs = Date.now()) {
    const errors = [];
    const billedItems = [];
    let subtotalAmount = 0;

    if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
        return { ok: false, errors: ["Cart is empty."], items: [], subtotalAmount: 0, discountAmount: 0, totalAmount: 0 };
    }

    for (const reqItem of requestedItems) {
        const qty = Number(reqItem?.quantity || 0);
        if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
            errors.push(`Invalid quantity for ${reqItem?.name || reqItem?.id || "item"}.`);
            continue;
        }
        const resolved = findMenuItem(menuItems, reqItem?.id || reqItem?.name);
        if (!resolved) {
            errors.push(`Menu item "${reqItem?.name || reqItem?.id || "Unknown"}" is not available on the live menu.`);
            continue;
        }
        if (resolved.available === false) {
            errors.push(`${resolved.name} is currently out of stock / unavailable.`);
            continue;
        }
        if (!isItemPriceValid(resolved)) {
            errors.push(`${resolved.name} does not have an online price set yet and cannot be ordered online. Please inquire at the counter or on WhatsApp.`);
            continue;
        }

        const unitPrice = Math.round(resolved.price);
        const lineTotal = unitPrice * qty;
        subtotalAmount += lineTotal;
        billedItems.push({
            id: resolved.id,
            name: resolved.name,
            quantity: qty,
            unitPrice,
            lineTotal
        });
    }

    let discountAmount = 0;
    let totalAmount = subtotalAmount;
    let couponInfo = null;

    if (coupon && subtotalAmount > 0 && errors.length === 0) {
        const res = computeCouponDiscount(coupon, subtotalAmount, nowMs);
        if (!res.valid) {
            errors.push(res.reason);
        } else {
            discountAmount = res.discountAmount;
            totalAmount = res.totalAmount;
            couponInfo = {
                id: coupon.id || "",
                code: String(coupon.code || "").trim().toUpperCase(),
                title: coupon.title || coupon.code || "Offer",
                discountType: coupon.discountType || "flat",
                discountValue: Number(coupon.discountValue || 0)
            };
        }
    }

    return {
        ok: errors.length === 0 && billedItems.length > 0,
        errors,
        items: billedItems,
        subtotalAmount,
        discountAmount,
        totalAmount,
        currency: "NPR",
        coupon: couponInfo
    };
}
