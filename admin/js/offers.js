// ============================================================================
// SIRANCHOWK KHAJA GHAR — OFFERS & COUPONS MANAGEMENT MODULE
// ============================================================================

import { db, ref, get, push, set, update, remove } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

export const OffersModule = {
    async render(container) {
        const session = getAdminSession();
        const canManage = hasPermission("manageCoupons");

        container.innerHTML = '<div class="skg-admin-loading">Loading offers & coupons…</div>';
        const snap = await get(ref(db, "offers"));
        let offers = snap.exists()
            ? Object.entries(snap.val() || {})
                .map(([id, val]) => ({ id, ...(val || {}) }))
                .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
            : [];

        const draw = () => {
            container.innerHTML = `
              <section class="card">
                <div class="card-header">
                  <div>
                    <h2 class="card-title">Offers & Coupons (${offers.length})</h2>
                    <p class="card-subtitle">Active offers appear automatically on the public Home, Menu, and Customer My Account dashboards.</p>
                  </div>
                  ${canManage ? '<button type="button" class="btn btn-primary" id="skg-add-offer-btn">+ Create Coupon / Offer</button>' : ""}
                </div>

                ${offers.length === 0 ? `
                  <div class="empty-state">
                    <div class="empty-state-icon">🏷️</div>
                    <h3 class="empty-state-title">No offers or coupons published yet</h3>
                    <p class="empty-state-desc">Create an authentic offer or promo code when ready for customers in Khairahani.</p>
                  </div>
                ` : `
                  <div class="table-responsive">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Title</th>
                          <th>Code</th>
                          <th>Benefit</th>
                          <th>Expiry</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${offers.map((offer) => {
                            const expired = offer.expiresAt && Number(offer.expiresAt) < Date.now();
                            const benefitLabel =
                                offer.discountType === "percent"
                                    ? `${offer.discountValue || 0}% Off`
                                    : offer.discountType === "fixed"
                                        ? `Rs. ${offer.discountValue || 0} Off`
                                        : offer.benefitText || "Special Offer";
                            return `
                              <tr>
                                <td>
                                  <strong>${Utils.escapeHTML(offer.title || "Offer")}</strong>
                                  <div class="form-hint">${Utils.escapeHTML(offer.description || "")}</div>
                                </td>
                                <td><code>${Utils.escapeHTML(offer.code || "NO CODE")}</code></td>
                                <td><strong>${Utils.escapeHTML(benefitLabel)}</strong></td>
                                <td>${offer.expiresAt ? Utils.escapeHTML(Utils.formatShortDate(offer.expiresAt)) : "No expiry"}</td>
                                <td>
                                  <span class="badge ${offer.active !== false && !expired ? "badge-success" : "badge-danger"}">
                                    ${expired ? "Expired" : offer.active !== false ? "Active" : "Paused"}
                                  </span>
                                </td>
                                <td>
                                  ${canManage ? `
                                    <div class="skg-table-actions">
                                      <button type="button" class="btn btn-sm btn-secondary" data-edit-offer="${Utils.escapeHTML(offer.id)}">Edit</button>
                                      <button type="button" class="btn btn-sm btn-secondary" data-toggle-offer="${Utils.escapeHTML(offer.id)}">
                                        ${offer.active !== false ? "Pause" : "Activate"}
                                      </button>
                                      <button type="button" class="btn btn-sm btn-danger" data-delete-offer="${Utils.escapeHTML(offer.id)}">Delete</button>
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

            container.querySelector("#skg-add-offer-btn")?.addEventListener("click", () => openOfferModal(null));
            container.querySelectorAll("[data-edit-offer]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const offer = offers.find((o) => o.id === btn.dataset.editOffer);
                    if (offer) openOfferModal(offer);
                });
            });
            container.querySelectorAll("[data-toggle-offer]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const offer = offers.find((o) => o.id === btn.dataset.toggleOffer);
                    if (!offer) return;
                    const nextActive = offer.active === false;
                    btn.disabled = true;
                    try {
                        await update(ref(db, `offers/${offer.id}`), { active: nextActive, updatedAt: Date.now() });
                        offer.active = nextActive;
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "offer_status_toggled",
                            target: offer.id,
                            metadata: { code: offer.code, active: nextActive }
                        });
                        UIModule.showToast(`Offer ${nextActive ? "activated" : "paused"}.`, "success");
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Could not update offer status.", "error");
                        btn.disabled = false;
                    }
                });
            });
            container.querySelectorAll("[data-delete-offer]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const offer = offers.find((o) => o.id === btn.dataset.deleteOffer);
                    if (!offer) return;
                    const ok = await UIModule.confirm({
                        title: "Delete Offer / Coupon?",
                        message: `Delete "${offer.title}" (${offer.code || "offer"}) permanently?`,
                        confirmText: "Delete",
                        dangerous: true
                    });
                    if (!ok) return;
                    btn.disabled = true;
                    try {
                        await remove(ref(db, `offers/${offer.id}`));
                        offers = offers.filter((o) => o.id !== offer.id);
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "offer_deleted",
                            target: offer.id,
                            metadata: { title: offer.title }
                        });
                        UIModule.showToast("Offer deleted.", "success");
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Could not delete offer.", "error");
                        btn.disabled = false;
                    }
                });
            });
        };

        const openOfferModal = (existing) => {
            const isEdit = Boolean(existing);
            const expiryVal = existing?.expiresAt ? new Date(existing.expiresAt).toISOString().slice(0, 10) : "";

            UIModule.openModal(
                isEdit ? "Edit Offer / Coupon" : "Create Offer / Coupon",
                `
                  <form id="skg-offer-form">
                    <div class="form-group">
                      <label class="form-label" for="offer-title">Offer Title *</label>
                      <input class="form-control" id="offer-title" type="text" required value="${Utils.escapeHTML(existing?.title || "")}" placeholder="e.g., Welcome Momo Deal">
                    </div>
                    <div class="skg-modal-row">
                      <div class="form-group">
                        <label class="form-label" for="offer-code">Coupon Code</label>
                        <input class="form-control" id="offer-code" type="text" style="text-transform:uppercase" value="${Utils.escapeHTML(existing?.code || "")}" placeholder="e.g., KHAJA10">
                      </div>
                      <div class="form-group">
                        <label class="form-label" for="offer-type">Offer Type</label>
                        <select class="form-control" id="offer-type">
                          <option value="percent" ${existing?.discountType === "percent" ? "selected" : ""}>Percentage Off (%)</option>
                          <option value="fixed" ${existing?.discountType === "fixed" ? "selected" : ""}>Fixed Discount (Rs.)</option>
                          <option value="note" ${!existing?.discountType || existing?.discountType === "note" ? "selected" : ""}>Special Note / Freebie</option>
                        </select>
                      </div>
                    </div>
                    <div class="skg-modal-row">
                      <div class="form-group">
                        <label class="form-label" for="offer-value">Discount Value (number)</label>
                        <input class="form-control" id="offer-value" type="number" min="0" value="${Utils.escapeHTML(existing?.discountValue ?? "")}" placeholder="e.g., 10 or 50">
                      </div>
                      <div class="form-group">
                        <label class="form-label" for="offer-expiry">Expiry Date (optional)</label>
                        <input class="form-control" id="offer-expiry" type="date" value="${Utils.escapeHTML(expiryVal)}">
                      </div>
                    </div>
                    <div class="form-group">
                      <label class="form-label" for="offer-desc">Description / Terms *</label>
                      <textarea class="form-control" id="offer-desc" required placeholder="Conditions, minimum order, or eligible dishes">${Utils.escapeHTML(existing?.description || "")}</textarea>
                    </div>
                    <label class="skg-checkbox-inline">
                      <input type="checkbox" id="offer-active" ${existing?.active !== false ? "checked" : ""}>
                      <span>Publish and allow customers to apply</span>
                    </label>
                  </form>
                `,
                `
                  <button type="button" class="btn btn-secondary" id="offer-cancel">Cancel</button>
                  <button type="button" class="btn btn-primary" id="offer-save">${isEdit ? "Save Changes" : "Publish Offer"}</button>
                `
            );

            document.getElementById("offer-cancel")?.addEventListener("click", () => UIModule.closeModal());
            const offerSaveBtn = document.getElementById("offer-save");
            offerSaveBtn?.addEventListener("click", async () => {
                const title = document.getElementById("offer-title")?.value.trim();
                const code = (document.getElementById("offer-code")?.value.trim() || "").toUpperCase();
                const discountType = document.getElementById("offer-type")?.value || "note";
                const discountValue = Number(document.getElementById("offer-value")?.value || 0);
                const expiryStr = document.getElementById("offer-expiry")?.value;
                const description = document.getElementById("offer-desc")?.value.trim() || "";
                const active = document.getElementById("offer-active")?.checked ?? true;

                if (!title || !description) {
                    UIModule.showToast("Title and description are required.", "error");
                    return;
                }

                offerSaveBtn.disabled = true;
                try {
                    const expiresAt = expiryStr ? new Date(`${expiryStr}T23:59:59`).getTime() : null;
                    const now = Date.now();

                    if (isEdit) {
                        const patch = { title, code, discountType, discountValue, expiresAt, description, active, updatedAt: now };
                        await update(ref(db, `offers/${existing.id}`), patch);
                        Object.assign(existing, patch);
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "offer_updated",
                            target: existing.id,
                            metadata: { title, code }
                        });
                    } else {
                        const newRef = push(ref(db, "offers"));
                        const record = {
                            id: newRef.key,
                            title,
                            code,
                            discountType,
                            discountValue,
                            expiresAt,
                            description,
                            active,
                            createdAt: now,
                            updatedAt: now
                        };
                        await set(newRef, record);
                        offers.unshift(record);
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "offer_created",
                            target: newRef.key,
                            metadata: { title, code }
                        });
                    }

                    UIModule.closeModal();
                    UIModule.showToast("Offer saved.", "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not save offer.", "error");
                    offerSaveBtn.disabled = false;
                }
            });
        };

        draw();
    }
};

if (typeof window !== "undefined") {
    window.OffersModule = OffersModule;
}