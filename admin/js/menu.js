// ============================================================================
// SIRANCHOWK KHAJA GHAR — PRODUCTS / MENU MANAGEMENT MODULE (AUTHORITATIVE)
// ============================================================================

import { db, ref, get, set, update, remove } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import {
    CANONICAL_MENU_ITEMS,
    mergeMenuWithDefaults,
    normalizeValidPrice,
    isItemPriceValid,
    resolveCanonicalId,
    slugifyDishKey
} from "../../js/menu-catalog.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

const DEFAULT_CATEGORIES = [
    { id: "momo", name: "Momo" },
    { id: "chowmein", name: "Chowmein" },
    { id: "roti", name: "Bread / Roti" },
    { id: "tea", name: "Tea & Drinks" },
    { id: "special", name: "Rice & Special" },
    { id: "snacks", name: "Snacks & Everyday" }
];

async function fetchCategories() {
    try {
        const snap = await get(ref(db, "categories"));
        if (!snap.exists()) return DEFAULT_CATEGORIES;
        const rows = Object.entries(snap.val() || {})
            .map(([id, val]) => ({ id, ...(val || {}) }))
            .filter((c) => c.active !== false);
        return rows.length ? rows : DEFAULT_CATEGORIES;
    } catch {
        return DEFAULT_CATEGORIES;
    }
}

async function fetchMenuState() {
    const [menuSnap, stockSnap] = await Promise.all([
        get(ref(db, "menu_items")),
        get(ref(db, "inventory/stockAvailability")).catch(() => null)
    ]);
    const rawMenu = menuSnap.exists() ? (menuSnap.val() || {}) : {};
    const stockMap = stockSnap?.exists() ? (stockSnap.val() || {}) : {};
    const merged = mergeMenuWithDefaults(rawMenu, stockMap);
    return { rawMenu, stockMap, items: merged };
}

export const MenuModule = {
    async render(container) {
        const session = getAdminSession();
        const canManage = hasPermission("manageProducts");
        const canEditPrice = hasPermission("editPrices");

        container.innerHTML = '<div class="skg-admin-loading">Loading authoritative menu catalog…</div>';

        const [{ rawMenu, items: initialItems }, categories] = await Promise.all([
            fetchMenuState(),
            fetchCategories()
        ]);

        let rawMenuMap = { ...rawMenu };
        let items = [...initialItems];
        let searchQuery = "";
        let categoryFilter = "all";

        const refreshFromDb = async () => {
            const state = await fetchMenuState();
            rawMenuMap = state.rawMenu;
            items = state.items;
        };

        const draw = () => {
            const filtered = items.filter((item) => {
                const catOk = categoryFilter === "all" || (item.category || "").toLowerCase() === categoryFilter.toLowerCase();
                const hay = `${item.name || ""} ${item.nepaliName || ""} ${item.category || ""} ${item.description || ""}`.toLowerCase();
                return catOk && hay.includes(searchQuery.trim().toLowerCase());
            });

            const missingDefaults = CANONICAL_MENU_ITEMS.filter((base) => {
                const match = items.find((m) => m.id === base.id);
                return !match || !match.inDatabase;
            });

            const unsetCount = items.filter((item) => !isItemPriceValid(item)).length;
            const outCount = items.filter((item) => item.available === false).length;

            container.innerHTML = `
              <section class="card">
                <div class="card-header">
                  <div>
                    <h2 class="card-title">Menu &amp; Pricing Catalog (${items.length})</h2>
                    <p class="card-subtitle">Single authoritative menu source powering homepage, menu page, cart, checkout, and verified bills. ${unsetCount ? `${unsetCount} item(s) have UNSET price (blocked online).` : ""} ${outCount ? `${outCount} unavailable.` : ""}</p>
                  </div>
                  <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    ${canManage && missingDefaults.length > 0 ? `<button type="button" class="btn btn-secondary" id="skg-sync-defaults-btn">Sync ${missingDefaults.length} Missing Standard Items</button>` : ""}
                    ${canManage ? '<button type="button" class="btn btn-primary" id="skg-add-product-btn">+ Add Dish</button>' : ""}
                  </div>
                </div>

                <div class="skg-admin-order-toolbar">
                  <input type="search" id="skg-prod-search" placeholder="Search dishes by name, Nepali label, or description" value="${Utils.escapeHTML(searchQuery)}">
                  <select id="skg-prod-cat-filter">
                    <option value="all">All categories</option>
                    ${categories.map((c) => `<option value="${Utils.escapeHTML(c.id)}" ${categoryFilter === c.id ? "selected" : ""}>${Utils.escapeHTML(c.name)}</option>`).join("")}
                  </select>
                </div>

                ${filtered.length === 0 ? `
                  <div class="empty-state">
                    <div class="empty-state-icon">🍽️</div>
                    <h3 class="empty-state-title">No matching dishes</h3>
                    <p class="empty-state-desc">Try clearing the search query or add a new dish to the live catalog.</p>
                  </div>
                ` : `
                  <div class="table-responsive">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Dish / Product</th>
                          <th>Category</th>
                          <th>Online Price (NPR)</th>
                          <th>Availability</th>
                          <th>Source</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${filtered.map((item) => {
                            const hasPrice = isItemPriceValid(item);
                            const isCanonical = CANONICAL_MENU_ITEMS.some((c) => c.id === item.id);
                            return `
                              <tr>
                                <td>
                                  <strong>${Utils.escapeHTML(item.name || "Untitled Dish")}</strong>
                                  ${item.nepaliName ? ` <span class="form-hint">(${Utils.escapeHTML(item.nepaliName)})</span>` : ""}
                                  <div class="form-hint">${Utils.escapeHTML(item.description || "No description")}</div>
                                </td>
                                <td><span class="badge badge-info">${Utils.escapeHTML(item.categoryLabel || item.category || "menu")}</span></td>
                                <td>
                                  ${hasPrice
                                      ? `<strong>${Utils.escapeHTML(Utils.formatCurrency(item.price))}</strong>`
                                      : `<span class="badge badge-warning">UNSET — Blocked Online</span>`
                                  }
                                </td>
                                <td>
                                  <span class="badge ${item.available !== false ? "badge-success" : "badge-danger"}">
                                    ${item.available !== false ? "Available" : (item.stockOut ? "Stock Out" : "Unavailable")}
                                  </span>
                                </td>
                                <td>
                                  <span class="badge ${item.inDatabase ? "badge-success" : "badge-neutral"}">
                                    ${item.inDatabase ? "Live DB" : "Standard Baseline"}
                                  </span>
                                </td>
                                <td>
                                  ${canManage ? `
                                    <div class="skg-table-actions">
                                      <button type="button" class="btn btn-sm btn-secondary" data-edit-product="${Utils.escapeHTML(item.id)}">Edit</button>
                                      <button type="button" class="btn btn-sm btn-secondary" data-toggle-product="${Utils.escapeHTML(item.id)}">
                                        ${item.available !== false ? "Mark Out" : "Mark Available"}
                                      </button>
                                      ${!isCanonical ? `<button type="button" class="btn btn-sm btn-danger" data-delete-product="${Utils.escapeHTML(item.id)}">Delete</button>` : ""}
                                    </div>
                                  ` : '<span class="form-hint">View only</span>'}
                                </td>
                              </tr>
                            `;
                        }).join("")}
                      </tbody>
                    </table>
                  </div>
                `}
              </section>
            `;

            container.querySelector("#skg-prod-search")?.addEventListener("input", (e) => {
                searchQuery = e.target.value;
                draw();
            });
            container.querySelector("#skg-prod-cat-filter")?.addEventListener("change", (e) => {
                categoryFilter = e.target.value;
                draw();
            });
            container.querySelector("#skg-add-product-btn")?.addEventListener("click", () => openProductModal(null));

            container.querySelector("#skg-sync-defaults-btn")?.addEventListener("click", async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                    const now = Date.now();
                    let synced = 0;
                    for (const base of missingDefaults) {
                        const existingExact = rawMenuMap[base.id];
                        if (existingExact && existingExact.name) continue;
                        const record = {
                            id: base.id,
                            name: base.name,
                            nepaliName: base.nepaliName || "",
                            category: base.category,
                            categoryLabel: base.categoryLabel || "",
                            description: base.description || "",
                            price: base.id === "roti-plain" ? null : base.price,
                            priceUnset: base.id === "roti-plain" ? true : base.price === null,
                            available: base.available !== false,
                            featured: Boolean(base.featured),
                            badge: base.badge || "",
                            availabilityNote: base.availabilityNote || "",
                            imageUrl: base.image || "",
                            image: base.image || "",
                            alt: base.alt || base.name,
                            createdAt: now,
                            updatedAt: now
                        };
                        await set(ref(db, `menu_items/${base.id}`), record);
                        synced++;
                    }
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: "catalog_missing_defaults_synced",
                        target: "menu_items",
                        metadata: { syncedCount: synced }
                    });
                    await refreshFromDb();
                    UIModule.showToast(`Synced ${synced} missing standard dish(es). Existing DB prices untouched; Roti remains UNSET.`, "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not sync standard dishes.", "error");
                    btn.disabled = false;
                }
            });

            container.querySelectorAll("[data-edit-product]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const item = items.find((p) => p.id === btn.dataset.editProduct);
                    if (item) openProductModal(item);
                });
            });

            container.querySelectorAll("[data-toggle-product]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const item = items.find((p) => p.id === btn.dataset.toggleProduct);
                    if (!item) return;
                    const nextAvailable = item.available === false;
                    const now = Date.now();
                    btn.disabled = true;
                    try {
                        const targetKey = item.remoteKey || item.id;
                        if (item.inDatabase) {
                            await update(ref(db, `menu_items/${targetKey}`), {
                                available: nextAvailable,
                                updatedAt: now
                            });
                        } else {
                            // Materialize full canonical record instead of a partial orphan node
                            await set(ref(db, `menu_items/${item.id}`), {
                                id: item.id,
                                name: item.name,
                                nepaliName: item.nepaliName || "",
                                category: item.category,
                                categoryLabel: item.categoryLabel || "",
                                description: item.description || "",
                                price: item.price,
                                priceUnset: item.price === null,
                                available: nextAvailable,
                                featured: Boolean(item.featured),
                                badge: item.badge || "",
                                availabilityNote: item.availabilityNote || "",
                                imageUrl: item.image || "",
                                image: item.image || "",
                                alt: item.alt || item.name,
                                createdAt: now,
                                updatedAt: now
                            });
                        }
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "product_availability_toggled",
                            target: targetKey,
                            metadata: { name: item.name, available: nextAvailable }
                        });
                        await refreshFromDb();
                        UIModule.showToast(`${item.name} marked as ${nextAvailable ? "Available" : "Unavailable"}.`, "success");
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Could not update product availability.", "error");
                        btn.disabled = false;
                    }
                });
            });

            container.querySelectorAll("[data-delete-product]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const item = items.find((p) => p.id === btn.dataset.deleteProduct);
                    if (!item) return;
                    const ok = await UIModule.confirm({
                        title: "Delete Custom Dish?",
                        message: `Remove "${item.name}" permanently from the product catalog?`,
                        confirmText: "Delete Dish",
                        dangerous: true
                    });
                    if (!ok) return;
                    btn.disabled = true;
                    try {
                        const targetKey = item.remoteKey || item.id;
                        await remove(ref(db, `menu_items/${targetKey}`));
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "product_deleted",
                            target: targetKey,
                            metadata: { name: item.name }
                        });
                        await refreshFromDb();
                        UIModule.showToast(`Removed ${item.name}.`, "success");
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Could not delete dish.", "error");
                        btn.disabled = false;
                    }
                });
            });
        };

        const openProductModal = (existing) => {
            const isEdit = Boolean(existing);
            const catOptions = categories.map((c) => `
                <option value="${Utils.escapeHTML(c.id)}" ${(existing?.category || categories[0]?.id) === c.id ? "selected" : ""}>
                    ${Utils.escapeHTML(c.name)}
                </option>
            `).join("");

            const bodyHTML = `
              <form id="skg-product-form">
                <div class="form-group">
                  <label class="form-label" for="prod-name">Dish / Product Name *</label>
                  <input class="form-control" id="prod-name" type="text" required value="${Utils.escapeHTML(existing?.name || "")}" placeholder="e.g., Chicken Momo or Masala Tea">
                </div>
                <div class="skg-modal-row">
                  <div class="form-group">
                    <label class="form-label" for="prod-cat">Category *</label>
                    <select class="form-control" id="prod-cat">${catOptions}</select>
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="prod-price">Price (NPR) ${canEditPrice ? "" : "(Locked by Role)"}</label>
                    <div style="display:flex;gap:8px;align-items:center;">
                      <input class="form-control" id="prod-price" type="number" min="1" step="1" value="${Utils.escapeHTML(isItemPriceValid(existing) ? existing.price : "")}" placeholder="Leave empty for UNSET" ${canEditPrice ? "" : "disabled"}>
                      ${canEditPrice ? `<button type="button" class="btn btn-sm btn-secondary" id="prod-unset-price" title="Leave price unset so online checkout stays disabled">Unset</button>` : ""}
                    </div>
                    <p class="form-hint">Items without a positive price remain blocked from online cart &amp; checkout.</p>
                  </div>
                </div>
                <div class="skg-modal-row">
                  <div class="form-group">
                    <label class="form-label" for="prod-nepali">Nepali Name (Optional)</label>
                    <input class="form-control" id="prod-nepali" type="text" value="${Utils.escapeHTML(existing?.nepaliName || "")}" placeholder="e.g., रोटी">
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="prod-note">Availability Note</label>
                    <input class="form-control" id="prod-note" type="text" value="${Utils.escapeHTML(existing?.availabilityNote || "")}" placeholder="e.g., Prepared fresh daily">
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label" for="prod-desc">Short Description</label>
                  <textarea class="form-control" id="prod-desc" placeholder="Preparation style, serving details...">${Utils.escapeHTML(existing?.description || "")}</textarea>
                </div>
                <div class="form-group">
                  <label class="form-label" for="prod-image">Optional Image URL</label>
                  <input class="form-control" id="prod-image" type="url" value="${Utils.escapeHTML(existing?.imageUrl || existing?.image || "")}" placeholder="https://...">
                </div>
                <label class="skg-checkbox-inline">
                  <input type="checkbox" id="prod-available" ${existing?.available !== false ? "checked" : ""}>
                  <span>Available for customer ordering</span>
                </label>
              </form>
            `;
            const footerHTML = `
              <button type="button" class="btn btn-secondary" id="prod-cancel">Cancel</button>
              <button type="button" class="btn btn-primary" id="prod-save">${isEdit ? "Save Changes" : "Save Dish"}</button>
            `;

            UIModule.openModal(isEdit ? `Edit ${existing.name}` : "Add New Dish", bodyHTML, footerHTML);
            document.getElementById("prod-cancel")?.addEventListener("click", () => UIModule.closeModal());
            document.getElementById("prod-unset-price")?.addEventListener("click", () => {
                const input = document.getElementById("prod-price");
                if (input) input.value = "";
            });

            document.getElementById("prod-save")?.addEventListener("click", async () => {
                const name = document.getElementById("prod-name")?.value.trim();
                const category = document.getElementById("prod-cat")?.value || "special";
                const rawPrice = document.getElementById("prod-price")?.value.trim() || "";
                const nepaliName = document.getElementById("prod-nepali")?.value.trim() || "";
                const availabilityNote = document.getElementById("prod-note")?.value.trim() || "";
                const description = document.getElementById("prod-desc")?.value.trim() || "";
                const imageUrl = document.getElementById("prod-image")?.value.trim() || "";
                const available = document.getElementById("prod-available")?.checked ?? true;

                if (!name) {
                    UIModule.showToast("Dish name is required.", "error");
                    return;
                }

                let priceValue = existing?.price ?? null;
                if (canEditPrice) {
                    if (rawPrice === "") {
                        priceValue = null;
                    } else {
                        const normalized = normalizeValidPrice(rawPrice);
                        if (normalized === null) {
                            UIModule.showToast("Price must be a whole NPR amount greater than 0, or left blank (UNSET).", "error");
                            return;
                        }
                        priceValue = normalized;
                    }
                }

                const now = Date.now();
                const saveBtn = document.getElementById("prod-save");
                if (saveBtn) saveBtn.disabled = true;

                try {
                    const matchedCat = categories.find((c) => c.id === category);
                    const canonicalMatch = resolveCanonicalId(existing?.id || name);
                    let targetId = existing?.id || canonicalMatch || slugifyDishKey(name);
                    if (!targetId) targetId = `dish-${now}`;
                    if (!existing && rawMenuMap[targetId] && !canonicalMatch) {
                        targetId = `${targetId}-${Math.random().toString(36).slice(2, 6)}`;
                    }

                    const record = {
                        id: targetId,
                        name,
                        nepaliName,
                        category,
                        categoryLabel: matchedCat?.name || existing?.categoryLabel || category,
                        description,
                        price: priceValue,
                        priceUnset: priceValue === null,
                        available,
                        featured: Boolean(existing?.featured),
                        badge: existing?.badge || "",
                        availabilityNote,
                        imageUrl,
                        image: imageUrl,
                        alt: existing?.alt || name,
                        createdAt: existing?.createdAt || now,
                        updatedAt: now
                    };

                    await set(ref(db, `menu_items/${targetId}`), record);

                    // Clean up legacy push key if this canonical dish was previously saved under a non-canonical key
                    if (existing?.remoteKey && existing.remoteKey !== targetId && rawMenuMap[existing.remoteKey]) {
                        await remove(ref(db, `menu_items/${existing.remoteKey}`)).catch(() => {});
                    }

                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: priceValue === null && existing?.price ? "product_price_unset" : (isEdit ? "product_updated" : "product_created"),
                        target: targetId,
                        metadata: { name, category, price: priceValue }
                    });

                    await refreshFromDb();
                    UIModule.closeModal();
                    UIModule.showToast(isEdit ? "Dish updated across live menu & checkout." : "Dish saved to live catalog.", "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not save dish.", "error");
                    if (saveBtn) saveBtn.disabled = false;
                }
            });
        };

        draw();
    }
};

if (typeof window !== "undefined") {
    window.MenuModule = MenuModule;
}