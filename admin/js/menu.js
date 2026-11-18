// ============================================================================
// SIRANCHOWK KHAJA GHAR — PRODUCTS / MENU MANAGEMENT MODULE (LIVE FIREBASE)
// ============================================================================

import { db, ref, get, push, set, update, remove } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

const DEFAULT_CATEGORIES = [
    { id: "momo", name: "Momo" },
    { id: "chowmein", name: "Chowmein" },
    { id: "roti", name: "Roti / Paratha" },
    { id: "tea", name: "Tea & Drinks" },
    { id: "special", name: "House Specials" },
    { id: "snacks", name: "Everyday Snacks" }
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

async function fetchProducts() {
    const snap = await get(ref(db, "menu_items"));
    if (!snap.exists()) return [];
    return Object.entries(snap.val() || {})
        .map(([id, val]) => ({ id, ...(val || {}) }))
        .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
}

export const MenuModule = {
    async render(container) {
        const session = getAdminSession();
        const canManage = hasPermission("manageProducts");
        const canEditPrice = hasPermission("editPrices");

        container.innerHTML = '<div class="skg-admin-loading">Loading products…</div>';

        let [items, categories] = await Promise.all([fetchProducts(), fetchCategories()]);
        let searchQuery = "";
        let categoryFilter = "all";

        const draw = () => {
            const filtered = items.filter((item) => {
                const catOk = categoryFilter === "all" || (item.category || "").toLowerCase() === categoryFilter.toLowerCase();
                const hay = `${item.name || ""} ${item.category || ""} ${item.description || ""}`.toLowerCase();
                return catOk && hay.includes(searchQuery.trim().toLowerCase());
            });

            container.innerHTML = `
              <section class="card">
                <div class="card-header">
                  <div>
                    <h2 class="card-title">Products & Menu Catalog (${items.length})</h2>
                    <p class="card-subtitle">Manage kitchen dishes, category assignment, availability, and optional pricing in Firebase.</p>
                  </div>
                  ${canManage ? '<button type="button" class="btn btn-primary" id="skg-add-product-btn">+ Add Product</button>' : ""}
                </div>

                <div class="skg-admin-order-toolbar">
                  <input type="search" id="skg-prod-search" placeholder="Search dishes by name or description" value="${Utils.escapeHTML(searchQuery)}">
                  <select id="skg-prod-cat-filter">
                    <option value="all">All categories</option>
                    ${categories.map((c) => `<option value="${Utils.escapeHTML(c.id)}" ${categoryFilter === c.id ? "selected" : ""}>${Utils.escapeHTML(c.name)}</option>`).join("")}
                  </select>
                </div>

                ${filtered.length === 0 ? `
                  <div class="empty-state">
                    <div class="empty-state-icon">🍽️</div>
                    <h3 class="empty-state-title">${items.length ? "No matching dishes" : "No catalog items saved in database yet"}</h3>
                    <p class="empty-state-desc">Add menu items here to manage live pricing and availability without changing static page code.</p>
                  </div>
                ` : `
                  <div class="table-responsive">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Dish / Product</th>
                          <th>Category</th>
                          <th>Price</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${filtered.map((item) => `
                          <tr>
                            <td>
                              <strong>${Utils.escapeHTML(item.name || "Untitled Dish")}</strong>
                              <div class="form-hint">${Utils.escapeHTML(item.description || "No description")}</div>
                            </td>
                            <td><span class="badge badge-info">${Utils.escapeHTML(item.category || "general")}</span></td>
                            <td><strong>${Utils.escapeHTML(item.price > 0 ? Utils.formatCurrency(item.price) : "Confirm on order")}</strong></td>
                            <td>
                              <span class="badge ${item.available !== false ? "badge-success" : "badge-danger"}">
                                ${item.available !== false ? "Available" : "Unavailable"}
                              </span>
                            </td>
                            <td>
                              ${canManage ? `
                                <div class="skg-table-actions">
                                  <button type="button" class="btn btn-sm btn-secondary" data-edit-product="${Utils.escapeHTML(item.id)}">Edit</button>
                                  <button type="button" class="btn btn-sm btn-secondary" data-toggle-product="${Utils.escapeHTML(item.id)}">
                                    ${item.available !== false ? "Mark Out" : "Mark Available"}
                                  </button>
                                  <button type="button" class="btn btn-sm btn-danger" data-delete-product="${Utils.escapeHTML(item.id)}">Delete</button>
                                </div>
                              ` : '<span class="form-hint">View only</span>'}
                            </td>
                          </tr>
                        `).join("")}
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
                    btn.disabled = true;
                    try {
                        await update(ref(db, `menu_items/${item.id}`), {
                            available: nextAvailable,
                            updatedAt: Date.now()
                        });
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "product_availability_toggled",
                            target: item.id,
                            metadata: { name: item.name, available: nextAvailable }
                        });
                        item.available = nextAvailable;
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
                        title: "Delete Product?",
                        message: `Remove "${item.name}" permanently from the product catalog?`,
                        confirmText: "Delete Product",
                        dangerous: true
                    });
                    if (!ok) return;
                    btn.disabled = true;
                    try {
                        await remove(ref(db, `menu_items/${item.id}`));
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "product_deleted",
                            target: item.id,
                            metadata: { name: item.name }
                        });
                        items = items.filter((p) => p.id !== item.id);
                        UIModule.showToast(`Removed ${item.name}.`, "success");
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Could not delete product.", "error");
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
                  <input class="form-control" id="prod-name" type="text" required value="${Utils.escapeHTML(existing?.name || "")}" placeholder="e.g., Chicken Buff Momo or Masala Tea">
                </div>
                <div class="skg-modal-row">
                  <div class="form-group">
                    <label class="form-label" for="prod-cat">Category *</label>
                    <select class="form-control" id="prod-cat">${catOptions}</select>
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="prod-price">Price (NPR) ${canEditPrice ? "" : "(Locked by Role)"}</label>
                    <input class="form-control" id="prod-price" type="number" min="0" step="1" value="${Utils.escapeHTML(existing?.price ?? "")}" placeholder="Leave blank if confirmed per order" ${canEditPrice ? "" : "disabled"}>
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label" for="prod-desc">Short Description</label>
                  <textarea class="form-control" id="prod-desc" placeholder="Preparation style, serving details...">${Utils.escapeHTML(existing?.description || "")}</textarea>
                </div>
                <div class="form-group">
                  <label class="form-label" for="prod-image">Optional Image URL</label>
                  <input class="form-control" id="prod-image" type="url" value="${Utils.escapeHTML(existing?.imageUrl || "")}" placeholder="https://...">
                </div>
                <label class="skg-checkbox-inline">
                  <input type="checkbox" id="prod-available" ${existing?.available !== false ? "checked" : ""}>
                  <span>Available for customer ordering</span>
                </label>
              </form>
            `;
            const footerHTML = `
              <button type="button" class="btn btn-secondary" id="prod-cancel">Cancel</button>
              <button type="button" class="btn btn-primary" id="prod-save">${isEdit ? "Save Changes" : "Add Product"}</button>
            `;

            UIModule.openModal(isEdit ? "Edit Product" : "Add New Product", bodyHTML, footerHTML);
            document.getElementById("prod-cancel")?.addEventListener("click", () => UIModule.closeModal());
            document.getElementById("prod-save")?.addEventListener("click", async () => {
                const name = document.getElementById("prod-name")?.value.trim();
                const category = document.getElementById("prod-cat")?.value || "special";
                const rawPrice = document.getElementById("prod-price")?.value.trim();
                const description = document.getElementById("prod-desc")?.value.trim() || "";
                const imageUrl = document.getElementById("prod-image")?.value.trim() || "";
                const available = document.getElementById("prod-available")?.checked ?? true;

                if (!name) {
                    UIModule.showToast("Product name is required.", "error");
                    return;
                }

                const priceValue = canEditPrice
                    ? (rawPrice ? Math.max(0, Number(rawPrice)) : null)
                    : (existing?.price ?? null);

                const now = Date.now();
                const saveBtn = document.getElementById("prod-save");
                if (saveBtn) saveBtn.disabled = true;

                try {
                    if (isEdit) {
                        const patch = { name, category, price: priceValue, description, imageUrl, available, updatedAt: now };
                        await update(ref(db, `menu_items/${existing.id}`), patch);
                        Object.assign(existing, patch);
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "product_updated",
                            target: existing.id,
                            metadata: { name, category }
                        });
                    } else {
                        const newRef = push(ref(db, "menu_items"));
                        const record = {
                            id: newRef.key,
                            name,
                            category,
                            price: priceValue,
                            description,
                            imageUrl,
                            available,
                            createdAt: now,
                            updatedAt: now
                        };
                        await set(newRef, record);
                        items.unshift(record);
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "product_created",
                            target: newRef.key,
                            metadata: { name, category }
                        });
                    }
                    UIModule.closeModal();
                    UIModule.showToast(isEdit ? "Product updated." : "Product added to catalog.", "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not save product.", "error");
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