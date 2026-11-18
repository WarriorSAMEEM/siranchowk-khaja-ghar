// ============================================================================
// SIRANCHOWK KHAJA GHAR — CATEGORIES MANAGEMENT MODULE
// ============================================================================

import { db, ref, get, set, update, remove } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

const DEFAULT_CATEGORY_SEED = [
    { id: "momo", name: "Momo", description: "Fresh steamed halal momo prepared daily", sortOrder: 1, active: true },
    { id: "chowmein", name: "Chowmein", description: "Freshly tossed noodles and khaja chowmein", sortOrder: 2, active: true },
    { id: "roti", name: "Roti & Paratha", description: "Hot roti, paratha, and everyday curry sets", sortOrder: 3, active: true },
    { id: "tea", name: "Tea & Drinks", description: "Fresh milk tea, black tea, and chilled drinks", sortOrder: 4, active: true },
    { id: "special", name: "Biryani & Specials", description: "Halal biryani and signature kitchen specials", sortOrder: 5, active: true },
    { id: "snacks", name: "Local Snacks", description: "Warm evening khaja and crisp local snacks", sortOrder: 6, active: true }
];

export const CategoriesModule = {
    async render(container) {
        const session = getAdminSession();
        const canManage = hasPermission("manageProducts");

        container.innerHTML = '<div class="skg-admin-loading">Loading categories…</div>';

        const snap = await get(ref(db, "categories"));
        let categories = snap.exists()
            ? Object.entries(snap.val() || {})
                .map(([id, val]) => ({ id, ...(val || {}) }))
                .sort((a, b) => Number(a.sortOrder || 99) - Number(b.sortOrder || 99))
            : [];

        const draw = () => {
            container.innerHTML = `
              <section class="card">
                <div class="card-header">
                  <div>
                    <h2 class="card-title">Menu Categories (${categories.length})</h2>
                    <p class="card-subtitle">Organize website product categories cleanly in Firebase Realtime Database.</p>
                  </div>
                  ${canManage ? `
                    <div class="skg-quick-actions">
                      ${categories.length === 0 ? '<button type="button" class="btn btn-secondary" id="skg-seed-cats-btn">Initialize Standard Categories</button>' : ""}
                      <button type="button" class="btn btn-primary" id="skg-add-cat-btn">+ Add Category</button>
                    </div>
                  ` : ""}
                </div>

                ${categories.length === 0 ? `
                  <div class="empty-state">
                    <div class="empty-state-icon">🗂️</div>
                    <h3 class="empty-state-title">No custom categories saved yet</h3>
                    <p class="empty-state-desc">Click "Initialize Standard Categories" to save Siranchowk Khaja Ghar's existing menu categories, or add a new category.</p>
                  </div>
                ` : `
                  <div class="table-responsive">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Order</th>
                          <th>Category Name</th>
                          <th>Slug / Key</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${categories.map((cat) => `
                          <tr>
                            <td>#${Utils.escapeHTML(cat.sortOrder ?? 1)}</td>
                            <td>
                              <strong>${Utils.escapeHTML(cat.name)}</strong>
                              <div class="form-hint">${Utils.escapeHTML(cat.description || "")}</div>
                            </td>
                            <td><code>${Utils.escapeHTML(cat.id)}</code></td>
                            <td><span class="badge ${cat.active !== false ? "badge-success" : "badge-danger"}">${cat.active !== false ? "Active" : "Hidden"}</span></td>
                            <td>
                              ${canManage ? `
                                <div class="skg-table-actions">
                                  <button type="button" class="btn btn-sm btn-secondary" data-edit-cat="${Utils.escapeHTML(cat.id)}">Edit</button>
                                  <button type="button" class="btn btn-sm btn-secondary" data-toggle-cat="${Utils.escapeHTML(cat.id)}">${cat.active !== false ? "Hide" : "Show"}</button>
                                  <button type="button" class="btn btn-sm btn-danger" data-delete-cat="${Utils.escapeHTML(cat.id)}">Delete</button>
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

            const seedBtn = container.querySelector("#skg-seed-cats-btn");
            seedBtn?.addEventListener("click", async () => {
                seedBtn.disabled = true;
                try {
                    const updates = {};
                    const now = Date.now();
                    DEFAULT_CATEGORY_SEED.forEach((cat) => {
                        updates[cat.id] = { ...cat, updatedAt: now };
                    });
                    await update(ref(db, "categories"), updates);
                    categories = DEFAULT_CATEGORY_SEED.map((c) => ({ ...c, updatedAt: now }));
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: "categories_initialized",
                        target: "categories"
                    });
                    UIModule.showToast("Standard categories saved to Firebase.", "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not initialize categories.", "error");
                    seedBtn.disabled = false;
                }
            });

            container.querySelector("#skg-add-cat-btn")?.addEventListener("click", () => openCatModal(null));
            container.querySelectorAll("[data-edit-cat]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const cat = categories.find((c) => c.id === btn.dataset.editCat);
                    if (cat) openCatModal(cat);
                });
            });
            container.querySelectorAll("[data-toggle-cat]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const cat = categories.find((c) => c.id === btn.dataset.toggleCat);
                    if (!cat) return;
                    const nextActive = cat.active === false;
                    btn.disabled = true;
                    try {
                        await update(ref(db, `categories/${cat.id}`), { active: nextActive, updatedAt: Date.now() });
                        cat.active = nextActive;
                        UIModule.showToast(`Category "${cat.name}" is now ${nextActive ? "visible" : "hidden"}.`, "success");
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Could not update category.", "error");
                        btn.disabled = false;
                    }
                });
            });
            container.querySelectorAll("[data-delete-cat]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const cat = categories.find((c) => c.id === btn.dataset.deleteCat);
                    if (!cat) return;
                    const ok = await UIModule.confirm({
                        title: "Delete Category?",
                        message: `Delete category "${cat.name}" (${cat.id})? Existing products using this key will keep working until reassigned.`,
                        confirmText: "Delete Category",
                        dangerous: true
                    });
                    if (!ok) return;
                    btn.disabled = true;
                    try {
                        await remove(ref(db, `categories/${cat.id}`));
                        categories = categories.filter((c) => c.id !== cat.id);
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "category_deleted",
                            target: cat.id,
                            metadata: { name: cat.name }
                        });
                        UIModule.showToast("Category deleted.", "success");
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Could not delete category.", "error");
                        btn.disabled = false;
                    }
                });
            });
        };

        const openCatModal = (existing) => {
            const isEdit = Boolean(existing);
            UIModule.openModal(
                isEdit ? "Edit Category" : "Add Menu Category",
                `
                  <form id="skg-cat-form">
                    <div class="form-group">
                      <label class="form-label" for="cat-name">Category Name *</label>
                      <input class="form-control" id="cat-name" type="text" required value="${Utils.escapeHTML(existing?.name || "")}" placeholder="e.g., Biryani & Rice">
                    </div>
                    <div class="skg-modal-row">
                      <div class="form-group">
                        <label class="form-label" for="cat-slug">Key / Slug *</label>
                        <input class="form-control" id="cat-slug" type="text" ${isEdit ? "disabled" : ""} value="${Utils.escapeHTML(existing?.id || "")}" placeholder="e.g., biryani">
                      </div>
                      <div class="form-group">
                        <label class="form-label" for="cat-order">Display Order</label>
                        <input class="form-control" id="cat-order" type="number" min="1" value="${Utils.escapeHTML(existing?.sortOrder ?? categories.length + 1)}">
                      </div>
                    </div>
                    <div class="form-group">
                      <label class="form-label" for="cat-desc">Description</label>
                      <input class="form-control" id="cat-desc" type="text" value="${Utils.escapeHTML(existing?.description || "")}">
                    </div>
                  </form>
                `,
                `
                  <button type="button" class="btn btn-secondary" id="cat-cancel">Cancel</button>
                  <button type="button" class="btn btn-primary" id="cat-save">${isEdit ? "Save Changes" : "Create Category"}</button>
                `
            );

            document.getElementById("cat-cancel")?.addEventListener("click", () => UIModule.closeModal());
            const catSaveBtn = document.getElementById("cat-save");
            catSaveBtn?.addEventListener("click", async () => {
                const name = document.getElementById("cat-name")?.value.trim();
                const rawSlug = document.getElementById("cat-slug")?.value.trim();
                const slug = isEdit ? existing.id : Utils.slugify(rawSlug || name);
                const sortOrder = Number(document.getElementById("cat-order")?.value || 1);
                const description = document.getElementById("cat-desc")?.value.trim() || "";

                if (!name || !slug) {
                    UIModule.showToast("Category name and valid key are required.", "error");
                    return;
                }

                catSaveBtn.disabled = true;
                try {
                    const now = Date.now();
                    const payload = {
                        id: slug,
                        name,
                        description,
                        sortOrder,
                        active: existing ? existing.active !== false : true,
                        updatedAt: now
                    };
                    await set(ref(db, `categories/${slug}`), payload);
                    if (isEdit) {
                        Object.assign(existing, payload);
                    } else {
                        categories.push(payload);
                    }
                    categories.sort((a, b) => Number(a.sortOrder || 99) - Number(b.sortOrder || 99));
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: isEdit ? "category_updated" : "category_created",
                        target: slug,
                        metadata: { name }
                    });
                    UIModule.closeModal();
                    UIModule.showToast("Category saved.", "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not save category.", "error");
                    catSaveBtn.disabled = false;
                }
            });
        };

        draw();
    }
};
