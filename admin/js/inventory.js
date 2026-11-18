// ============================================================================
// SIRANCHOWK KHAJA GHAR — INVENTORY & INGREDIENT STOCK CONTROL MODULE
// ============================================================================

import { db, ref, get, push, set, update, remove, onValue, runTransaction } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import {
    STANDARD_MENU_DISHES,
    slugifyDishKey,
    roundStock,
    getStockHealth,
    recordStockMovement,
    triggerLowStockAdminAlert,
    syncLinkedProductAvailability
} from "../../js/inventory-sync.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

const INVENTORY_CATEGORIES = [
    { id: "ingredient", label: "Kitchen Ingredient" },
    { id: "prepared", label: "Prepared / Portion Item" },
    { id: "beverage", label: "Tea / Beverage" },
    { id: "packaging", label: "Packaging & Supplies" }
];

const STOCK_UNITS = ["kg", "g", "litre", "ml", "pcs", "plate", "pack", "dozen"];

const MOVEMENT_LABELS = {
    restock: "Restock (+)",
    adjustment: "Adjustment",
    order_deduction: "Order Deduction (−)",
    waste: "Spoilage / Waste (−)"
};

export const InventoryModule = {
    async render(container) {
        const session = getAdminSession();
        const canView = hasPermission("viewInventory") || hasPermission("manageProducts");
        const canManage = hasPermission("manageInventory") || hasPermission("manageProducts");

        if (!canView) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">Your role does not permit viewing inventory & stock records.</p></section>';
            return;
        }

        container.innerHTML = '<div class="skg-admin-loading">Loading live inventory & restock logs…</div>';

        let items = [];
        let movements = [];
        let menuCatalog = [];
        let activeTab = "stock";
        let searchQuery = "";
        let statusFilter = "all";
        let movementTypeFilter = "all";

        // Load menu_items once for dish linking choices
        const menuSnap = await get(ref(db, "menu_items")).catch(() => null);
        if (menuSnap && menuSnap.exists()) {
            menuCatalog = Object.entries(menuSnap.val() || {})
                .map(([id, m]) => ({ id, name: m?.name || "" }))
                .filter((m) => m.name);
        }
        // Merge standard website menu dishes cleanly without duplicates
        const knownKeys = new Set(menuCatalog.map((m) => slugifyDishKey(m.name)));
        STANDARD_MENU_DISHES.forEach((dishName) => {
            const key = slugifyDishKey(dishName);
            if (!knownKeys.has(key)) {
                knownKeys.add(key);
                menuCatalog.push({ id: key, name: dishName });
            }
        });
        menuCatalog.sort((a, b) => a.name.localeCompare(b.name));

        const draw = () => {
            const outCount = items.filter((i) => Number(i.currentStock || 0) <= 0).length;
            const lowCount = items.filter((i) => {
                const s = Number(i.currentStock || 0);
                return s > 0 && s <= Number(i.minThreshold || 0);
            }).length;
            const healthyCount = items.length - outCount - lowCount;
            const alertItems = items
                .filter((i) => Number(i.currentStock || 0) <= Number(i.minThreshold || 0))
                .sort((a, b) => Number(a.currentStock || 0) - Number(b.currentStock || 0));

            const badgeEl = document.getElementById("low-stock-count");
            if (badgeEl) {
                badgeEl.textContent = String(alertItems.length);
                badgeEl.classList.toggle("hidden", alertItems.length === 0);
            }

            const filteredItems = items.filter((item) => {
                const health = getStockHealth(item);
                const statusOk =
                    statusFilter === "all" ||
                    (statusFilter === "alerts" && (health.code === "low" || health.code === "out")) ||
                    statusFilter === health.code;
                const hay = `${item.name || ""} ${item.category || ""} ${item.supplierName || ""} ${item.sku || ""}`.toLowerCase();
                return statusOk && hay.includes(searchQuery.trim().toLowerCase());
            });

            const filteredMovements = movements.filter((m) => {
                const typeOk = movementTypeFilter === "all" || m.type === movementTypeFilter;
                const hay = `${m.itemName || ""} ${m.note || ""} ${m.actorEmail || ""}`.toLowerCase();
                return typeOk && hay.includes(searchQuery.trim().toLowerCase());
            });

            container.innerHTML = `
              <section class="card">
                <div class="card-header">
                  <div>
                    <h2 class="card-title">Inventory &amp; Ingredient Stock Control</h2>
                    <p class="card-subtitle">Track ingredient counts, restock logs, and automatic menu availability when items run out.</p>
                  </div>
                  ${canManage ? '<button type="button" class="btn btn-primary" id="skg-inv-add-btn">+ Add Stock Item</button>' : ""}
                </div>

                <div class="metrics-grid">
                  <div class="metric-card"><div class="metric-info"><span class="metric-label">Tracked Items</span><span class="metric-value">${items.length}</span><span class="metric-subtext">Ingredients &amp; stock</span></div><div class="metric-icon-box">📦</div></div>
                  <div class="metric-card"><div class="metric-info"><span class="metric-label">Healthy Stock</span><span class="metric-value">${healthyCount}</span><span class="metric-subtext">Above threshold</span></div><div class="metric-icon-box">✅</div></div>
                  <div class="metric-card"><div class="metric-info"><span class="metric-label">Low Stock Alerts</span><span class="metric-value">${lowCount}</span><span class="metric-subtext">Needs restock soon</span></div><div class="metric-icon-box">⚠️</div></div>
                  <div class="metric-card"><div class="metric-info"><span class="metric-label">Out of Stock</span><span class="metric-value">${outCount}</span><span class="metric-subtext">Auto-disabled dishes</span></div><div class="metric-icon-box">⛔</div></div>
                </div>

                <div class="skg-tabs" role="tablist">
                  <button type="button" class="skg-tab ${activeTab === "stock" ? "active" : ""}" data-inv-tab="stock">📦 Stock Items (${items.length})</button>
                  <button type="button" class="skg-tab ${activeTab === "alerts" ? "active" : ""}" data-inv-tab="alerts">⚠️ Low-Stock Alerts (${alertItems.length})</button>
                  <button type="button" class="skg-tab ${activeTab === "logs" ? "active" : ""}" data-inv-tab="logs">📋 Restock &amp; Movement Log (${movements.length})</button>
                  <button type="button" class="skg-tab ${activeTab === "report" ? "active" : ""}" data-inv-tab="report">📊 Stock Summary &amp; Export</button>
                </div>

                ${activeTab === "stock" ? renderStockTab(filteredItems, canManage, searchQuery, statusFilter) : ""}
                ${activeTab === "alerts" ? renderAlertsTab(alertItems, canManage) : ""}
                ${activeTab === "logs" ? renderLogsTab(filteredMovements, searchQuery, movementTypeFilter) : ""}
                ${activeTab === "report" ? renderReportTab(items, movements) : ""}
              </section>
            `;

            // Bind tab switching
            container.querySelectorAll("[data-inv-tab]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    activeTab = btn.dataset.invTab;
                    draw();
                });
            });

            // Bind search & filters
            container.querySelector("#skg-inv-search")?.addEventListener("input", (e) => {
                searchQuery = e.target.value;
                draw();
            });
            container.querySelector("#skg-inv-status-filter")?.addEventListener("change", (e) => {
                statusFilter = e.target.value;
                draw();
            });
            container.querySelector("#skg-mov-type-filter")?.addEventListener("change", (e) => {
                movementTypeFilter = e.target.value;
                draw();
            });

            // Add / Edit item modals
            container.querySelector("#skg-inv-add-btn")?.addEventListener("click", () => openItemModal(null));
            container.querySelectorAll("[data-inv-edit]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const target = items.find((i) => i.id === btn.dataset.invEdit);
                    if (target) openItemModal(target);
                });
            });

            // Restock / Adjust modal
            container.querySelectorAll("[data-inv-adjust]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const target = items.find((i) => i.id === btn.dataset.invAdjust);
                    if (target) openAdjustmentModal(target, btn.dataset.mode || "restock");
                });
            });

            // Delete stock item
            container.querySelectorAll("[data-inv-delete]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const target = items.find((i) => i.id === btn.dataset.invDelete);
                    if (!target) return;
                    const ok = await UIModule.confirm({
                        title: "Delete Stock Item?",
                        message: `Remove "${target.name}" from inventory tracking? Historical movement logs remain intact.`,
                        confirmText: "Delete Item",
                        dangerous: true
                    });
                    if (!ok) return;
                    btn.disabled = true;
                    try {
                        await remove(ref(db, `inventory/items/${target.id}`));
                        await syncLinkedProductAvailability(items.filter((x) => x.id !== target.id));
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "inventory_item_deleted",
                            target: target.id,
                            metadata: { name: target.name }
                        });
                        UIModule.showToast(`Removed ${target.name} from inventory.`, "success");
                    } catch (err) {
                        UIModule.showToast(err?.message || "Could not delete inventory item.", "error");
                        btn.disabled = false;
                    }
                });
            });

            // Export CSV
            container.querySelector("#skg-inv-export-csv")?.addEventListener("click", () => {
                exportStockCsv(items, movements);
            });
        };

        const openItemModal = (existing) => {
            const isEdit = Boolean(existing);
            const links = existing?.linkedProducts || {};

            UIModule.openModal(
                isEdit ? `Edit Stock Item: ${existing.name}` : "Add Ingredient / Stock Item",
                `
                  <form id="skg-inv-item-form">
                    <div class="skg-modal-row">
                      <div class="form-group">
                        <label class="form-label" for="inv-name">Item / Ingredient Name *</label>
                        <input class="form-control" id="inv-name" type="text" required value="${Utils.escapeHTML(existing?.name || "")}" placeholder="e.g., Chicken Meat, Momo Flour, Milk">
                      </div>
                      <div class="form-group">
                        <label class="form-label" for="inv-cat">Category</label>
                        <select class="form-control" id="inv-cat">
                          ${INVENTORY_CATEGORIES.map((c) => `<option value="${c.id}" ${(existing?.category || "ingredient") === c.id ? "selected" : ""}>${c.label}</option>`).join("")}
                        </select>
                      </div>
                    </div>

                    <div class="skg-modal-row">
                      <div class="form-group">
                        <label class="form-label" for="inv-unit">Unit *</label>
                        <select class="form-control" id="inv-unit">
                          ${STOCK_UNITS.map((u) => `<option value="${u}" ${(existing?.unit || "kg") === u ? "selected" : ""}>${u}</option>`).join("")}
                        </select>
                      </div>
                      <div class="form-group">
                        <label class="form-label" for="inv-min">Low-Stock Alert Threshold *</label>
                        <input class="form-control" id="inv-min" type="number" min="0" step="0.01" required value="${Utils.escapeHTML(existing?.minThreshold ?? 5)}">
                      </div>
                    </div>

                    ${!isEdit ? `
                      <div class="form-group">
                        <label class="form-label" for="inv-initial">Opening Stock Count *</label>
                        <input class="form-control" id="inv-initial" type="number" min="0" step="0.01" required value="0">
                        <span class="form-hint">Future changes are logged via Restock / Adjustment for an accurate audit trail.</span>
                      </div>
                    ` : ""}

                    <div class="skg-modal-row">
                      <div class="form-group">
                        <label class="form-label" for="inv-sup-name">Supplier Name (optional)</label>
                        <input class="form-control" id="inv-sup-name" type="text" value="${Utils.escapeHTML(existing?.supplierName || "")}" placeholder="e.g., Parsa Fresh Mart">
                      </div>
                      <div class="form-group">
                        <label class="form-label" for="inv-sup-phone">Supplier Phone (optional)</label>
                        <input class="form-control" id="inv-sup-phone" type="tel" value="${Utils.escapeHTML(existing?.supplierPhone || "")}" placeholder="98XXXXXXXX">
                      </div>
                    </div>

                    <label class="skg-checkbox-inline" style="margin-bottom:12px;">
                      <input type="checkbox" id="inv-auto-disable" ${existing?.autoDisableProducts !== false ? "checked" : ""}>
                      <span>Auto-mark linked menu dishes unavailable when stock reaches 0 (and restore when restocked)</span>
                    </label>

                    <div class="form-group">
                      <label class="form-label">Linked Menu Dishes &amp; Deduction Per Portion Ordered</label>
                      <div class="skg-linked-dishes-box">
                        ${menuCatalog.map((dish) => {
                            const key = slugifyDishKey(dish.name);
                            const existingLink = links[dish.id] || links[key] || null;
                            return `
                              <div class="skg-linked-dish-row">
                                <label class="skg-checkbox-inline">
                                  <input type="checkbox" class="inv-dish-check" data-dish-id="${Utils.escapeHTML(dish.id)}" data-dish-name="${Utils.escapeHTML(dish.name)}" ${existingLink ? "checked" : ""}>
                                  <span>${Utils.escapeHTML(dish.name)}</span>
                                </label>
                                <div class="skg-linked-qty">
                                  <input type="number" min="0.001" step="0.01" class="form-control inv-dish-qty" data-qty-for="${Utils.escapeHTML(dish.id)}" value="${Utils.escapeHTML(existingLink?.deductPerUnit ?? 1)}" ${existingLink ? "" : "disabled"} aria-label="Amount deducted per ${Utils.escapeHTML(dish.name)}">
                                  <small>per order</small>
                                </div>
                              </div>
                            `;
                        }).join("")}
                      </div>
                    </div>
                  </form>
                `,
                `
                  <button type="button" class="btn btn-secondary" id="inv-cancel-btn">Cancel</button>
                  <button type="button" class="btn btn-primary" id="inv-save-btn">${isEdit ? "Save Changes" : "Create Stock Item"}</button>
                `
            );

            document.querySelectorAll(".inv-dish-check").forEach((chk) => {
                chk.addEventListener("change", () => {
                    const qtyInput = document.querySelector(`[data-qty-for="${CSS.escape(chk.dataset.dishId)}"]`);
                    if (qtyInput) qtyInput.disabled = !chk.checked;
                });
            });

            document.getElementById("inv-cancel-btn")?.addEventListener("click", () => UIModule.closeModal());
            document.getElementById("inv-save-btn")?.addEventListener("click", async () => {
                const name = document.getElementById("inv-name")?.value.trim();
                const category = document.getElementById("inv-cat")?.value || "ingredient";
                const unit = document.getElementById("inv-unit")?.value || "kg";
                const minThreshold = Math.max(0, Number(document.getElementById("inv-min")?.value || 0));
                const supplierName = document.getElementById("inv-sup-name")?.value.trim() || "";
                const supplierPhone = document.getElementById("inv-sup-phone")?.value.trim() || "";
                const autoDisableProducts = document.getElementById("inv-auto-disable")?.checked ?? true;

                if (!name) {
                    UIModule.showToast("Item name is required.", "error");
                    return;
                }

                const linkedProducts = {};
                document.querySelectorAll(".inv-dish-check:checked").forEach((chk) => {
                    const dishId = chk.dataset.dishId;
                    const dishName = chk.dataset.dishName;
                    const qtyEl = document.querySelector(`[data-qty-for="${CSS.escape(dishId)}"]`);
                    const deductPerUnit = Math.max(0.001, Number(qtyEl?.value || 1));
                    linkedProducts[dishId] = { productId: dishId, productName: dishName, deductPerUnit };
                });

                const now = Date.now();
                const saveBtn = document.getElementById("inv-save-btn");
                if (saveBtn) saveBtn.disabled = true;

                try {
                    if (isEdit) {
                        const patch = {
                            name,
                            category,
                            unit,
                            minThreshold,
                            supplierName,
                            supplierPhone,
                            autoDisableProducts,
                            linkedProducts: Object.keys(linkedProducts).length ? linkedProducts : null,
                            updatedAt: now
                        };
                        await update(ref(db, `inventory/items/${existing.id}`), patch);
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "inventory_item_updated",
                            target: existing.id,
                            metadata: { name, linkedCount: Object.keys(linkedProducts).length }
                        });
                    } else {
                        const openingStock = roundStock(document.getElementById("inv-initial")?.value || 0);
                        const itemRef = push(ref(db, "inventory/items"));
                        const record = {
                            id: itemRef.key,
                            name,
                            category,
                            unit,
                            currentStock: openingStock,
                            minThreshold,
                            supplierName,
                            supplierPhone,
                            autoDisableProducts,
                            linkedProducts: Object.keys(linkedProducts).length ? linkedProducts : null,
                            lastRestockedAt: openingStock > 0 ? now : null,
                            createdAt: now,
                            updatedAt: now
                        };
                        await set(itemRef, record);
                        if (openingStock > 0) {
                            await recordStockMovement({
                                itemId: itemRef.key,
                                itemName: name,
                                type: "restock",
                                delta: openingStock,
                                previousStock: 0,
                                newStock: openingStock,
                                unit,
                                note: "Initial opening stock",
                                session
                            });
                        }
                        if (openingStock <= minThreshold) {
                            await triggerLowStockAdminAlert(record, session);
                        }
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "inventory_item_created",
                            target: itemRef.key,
                            metadata: { name, openingStock, unit }
                        });
                    }

                    await syncLinkedProductAvailability();
                    UIModule.closeModal();
                    UIModule.showToast(isEdit ? "Stock item updated." : "Stock item created.", "success");
                } catch (err) {
                    UIModule.showToast(err?.message || "Failed to save inventory item.", "error");
                    if (saveBtn) saveBtn.disabled = false;
                }
            });
        };

        const openAdjustmentModal = (item, mode = "restock") => {
            const isRestock = mode === "restock";
            UIModule.openModal(
                `${isRestock ? "Restock" : "Adjust Stock"}: ${item.name}`,
                `
                  <p class="form-hint" style="margin-bottom:12px;">
                    Current count: <strong>${Utils.escapeHTML(roundStock(item.currentStock))} ${Utils.escapeHTML(item.unit)}</strong>
                    (Threshold: ${Utils.escapeHTML(item.minThreshold)} ${Utils.escapeHTML(item.unit)})
                  </p>
                  <form id="skg-inv-adj-form">
                    <div class="skg-modal-row">
                      <div class="form-group">
                        <label class="form-label" for="adj-type">Movement Type</label>
                        <select class="form-control" id="adj-type">
                          <option value="restock" ${isRestock ? "selected" : ""}>Restock / Purchase (+)</option>
                          <option value="adjustment" ${mode === "adjustment" ? "selected" : ""}>Manual Count Correction (±)</option>
                          <option value="waste" ${mode === "waste" ? "selected" : ""}>Spoilage / Kitchen Waste (−)</option>
                        </select>
                      </div>
                      <div class="form-group">
                        <label class="form-label" for="adj-qty">Quantity (${Utils.escapeHTML(item.unit)}) *</label>
                        <input class="form-control" id="adj-qty" type="number" step="0.01" required placeholder="${isRestock ? "Amount added" : "e.g., 2 or -1.5"}">
                      </div>
                    </div>
                    <div class="skg-modal-row">
                      <div class="form-group">
                        <label class="form-label" for="adj-cost">Purchase Cost (NPR, optional)</label>
                        <input class="form-control" id="adj-cost" type="number" min="0" step="1" placeholder="Optional bill total / unit cost">
                      </div>
                      <div class="form-group">
                        <label class="form-label" for="adj-note">Reason / Supplier Invoice Note *</label>
                        <input class="form-control" id="adj-note" type="text" required maxlength="180" placeholder="e.g., Bought from Parsa market / evening count">
                      </div>
                    </div>
                  </form>
                `,
                `
                  <button type="button" class="btn btn-secondary" id="adj-cancel-btn">Cancel</button>
                  <button type="button" class="btn btn-primary" id="adj-save-btn">Record Movement</button>
                `
            );

            document.getElementById("adj-cancel-btn")?.addEventListener("click", () => UIModule.closeModal());
            document.getElementById("adj-save-btn")?.addEventListener("click", async () => {
                const type = document.getElementById("adj-type")?.value || "restock";
                const rawQty = Number(document.getElementById("adj-qty")?.value);
                const costVal = document.getElementById("adj-cost")?.value.trim();
                const note = document.getElementById("adj-note")?.value.trim();

                if (!Number.isFinite(rawQty) || rawQty === 0 || !note) {
                    UIModule.showToast("Enter a non-zero quantity and reason note.", "error");
                    return;
                }
                if ((type === "restock" || type === "waste") && rawQty < 0) {
                    UIModule.showToast("Enter a positive quantity for restock or waste.", "error");
                    return;
                }

                const delta = type === "waste" ? -Math.abs(rawQty) : rawQty;
                const btn = document.getElementById("adj-save-btn");
                if (btn) btn.disabled = true;

                try {
                    let prevStock = Number(item.currentStock || 0);
                    let nextStock = prevStock;

                    const tx = await runTransaction(ref(db, `inventory/items/${item.id}/currentStock`), (cur) => {
                        prevStock = Number(cur || 0);
                        nextStock = roundStock(prevStock + delta);
                        return nextStock;
                    });

                    if (!tx.committed) {
                        throw new Error("Stock update could not be committed. Try again.");
                    }

                    const finalStock = roundStock(tx.snapshot.val());
                    const patch = { updatedAt: Date.now() };
                    if (type === "restock") {
                        patch.lastRestockedAt = Date.now();
                        if (finalStock > Number(item.minThreshold || 0)) {
                            patch.lowStockAlertSentAt = null;
                        }
                    }
                    await update(ref(db, `inventory/items/${item.id}`), patch);

                    await recordStockMovement({
                        itemId: item.id,
                        itemName: item.name,
                        type,
                        delta,
                        previousStock: prevStock,
                        newStock: finalStock,
                        unit: item.unit,
                        note,
                        unitCostNpr: costVal ? Number(costVal) : null,
                        session
                    });

                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: `inventory_${type}`,
                        target: item.id,
                        metadata: { name: item.name, delta, newStock: finalStock }
                    });

                    if (finalStock <= Number(item.minThreshold || 0)) {
                        await triggerLowStockAdminAlert({ ...item, currentStock: finalStock }, session);
                    }

                    const disabledDishes = await syncLinkedProductAvailability();
                    UIModule.closeModal();
                    UIModule.showToast(
                        `${item.name} updated to ${finalStock} ${item.unit}.${disabledDishes.length ? ` (${disabledDishes.length} dish auto-marked unavailable)` : ""}`,
                        finalStock <= Number(item.minThreshold || 0) ? "info" : "success"
                    );
                } catch (err) {
                    UIModule.showToast(err?.message || "Failed to update stock.", "error");
                    if (btn) btn.disabled = false;
                }
            });
        };

        // Live Firebase subscriptions for items and movements
        const unsubItems = onValue(
            ref(db, "inventory/items"),
            (snap) => {
                items = snap.exists()
                    ? Object.entries(snap.val() || {})
                        .map(([id, val]) => ({ id, ...(val || {}) }))
                        .sort((a, b) => Number(a.currentStock || 0) - Number(b.currentStock || 0))
                    : [];
                draw();
            },
            (err) => {
                container.innerHTML = `<section class="card"><p class="skg-dashboard-error">Unable to load inventory: ${Utils.escapeHTML(err.message)}</p></section>`;
            }
        );

        const unsubMovements = onValue(
            ref(db, "inventory/movements"),
            (snap) => {
                movements = snap.exists()
                    ? Object.values(snap.val() || {}).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
                    : [];
                draw();
            },
            () => {}
        );

        container._skgViewUnsubscribe = () => {
            unsubItems();
            unsubMovements();
        };
    }
};

function renderStockTab(filteredItems, canManage, searchQuery, statusFilter) {
    return `
      <div class="skg-admin-order-toolbar">
        <input type="search" id="skg-inv-search" placeholder="Search ingredient, category, or supplier..." value="${Utils.escapeHTML(searchQuery)}">
        <select id="skg-inv-status-filter">
          <option value="all" ${statusFilter === "all" ? "selected" : ""}>All stock levels</option>
          <option value="alerts" ${statusFilter === "alerts" ? "selected" : ""}>Low &amp; Out of Stock</option>
          <option value="ok" ${statusFilter === "ok" ? "selected" : ""}>Healthy Stock</option>
          <option value="low" ${statusFilter === "low" ? "selected" : ""}>Low Stock Only</option>
          <option value="out" ${statusFilter === "out" ? "selected" : ""}>Out of Stock Only</option>
        </select>
      </div>

      ${filteredItems.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <h3 class="empty-state-title">No inventory items yet</h3>
          <p class="empty-state-desc">Add kitchen ingredients or packaged items, link them to menu dishes, and enable automatic stock deductions when orders are confirmed.</p>
        </div>
      ` : `
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Current Stock</th>
                <th>Threshold</th>
                <th>Linked Dishes</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filteredItems.map((item) => {
                  const health = getStockHealth(item);
                  const badgeCls = health.code === "out" ? "badge-danger" : health.code === "low" ? "badge-warning" : "badge-success";
                  const links = item.linkedProducts ? Object.values(item.linkedProducts) : [];
                  const pct = item.minThreshold > 0
                      ? Math.min(100, Math.round((Number(item.currentStock || 0) / (Number(item.minThreshold) * 2)) * 100))
                      : (Number(item.currentStock || 0) > 0 ? 100 : 0);

                  return `
                    <tr>
                      <td>
                        <strong>${Utils.escapeHTML(item.name)}</strong>
                        <div class="form-hint">
                          ${Utils.escapeHTML(item.category || "ingredient")}
                          ${item.supplierName ? ` • Supplier: ${Utils.escapeHTML(item.supplierName)}` : ""}
                        </div>
                      </td>
                      <td>
                        <strong>${Utils.escapeHTML(roundStock(item.currentStock))} ${Utils.escapeHTML(item.unit)}</strong>
                        <div class="skg-stock-meter"><span class="${health.code}" style="width:${pct}%"></span></div>
                      </td>
                      <td>${Utils.escapeHTML(item.minThreshold ?? 0)} ${Utils.escapeHTML(item.unit)}</td>
                      <td>
                        ${links.length
                            ? `<div class="form-hint">${links.map((l) => `${Utils.escapeHTML(l.productName)} (−${l.deductPerUnit})`).join(", ")}</div>`
                            : '<span class="form-hint">Not linked</span>'}
                        ${item.autoDisableProducts !== false && links.length ? '<div class="form-hint">Auto-availability ON</div>' : ""}
                      </td>
                      <td><span class="badge ${badgeCls}">${Utils.escapeHTML(health.label)}</span></td>
                      <td>
                        ${canManage ? `
                          <div class="skg-table-actions">
                            <button type="button" class="btn btn-sm btn-primary" data-inv-adjust="${Utils.escapeHTML(item.id)}" data-mode="restock">+ Restock</button>
                            <button type="button" class="btn btn-sm btn-secondary" data-inv-adjust="${Utils.escapeHTML(item.id)}" data-mode="adjustment">Adjust</button>
                            <button type="button" class="btn btn-sm btn-secondary" data-inv-edit="${Utils.escapeHTML(item.id)}">Edit</button>
                            <button type="button" class="btn btn-sm btn-danger" data-inv-delete="${Utils.escapeHTML(item.id)}">Delete</button>
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
    `;
}

function renderAlertsTab(alertItems, canManage) {
    if (!alertItems.length) {
        return `
          <div class="empty-state">
            <div class="empty-state-icon">✅</div>
            <h3 class="empty-state-title">All stock levels are healthy</h3>
            <p class="empty-state-desc">No tracked ingredients are at or below their minimum threshold right now.</p>
          </div>
        `;
    }

    return `
      <div class="skg-device-grid">
        ${alertItems.map((item) => {
            const health = getStockHealth(item);
            const links = item.linkedProducts ? Object.values(item.linkedProducts) : [];
            return `
              <article class="skg-device-card">
                <div class="skg-device-card-head">
                  <div>
                    <h3>${Utils.escapeHTML(item.name)} <span class="badge ${health.code === "out" ? "badge-danger" : "badge-warning"}">${Utils.escapeHTML(health.label)}</span></h3>
                    <p class="form-hint">
                      Remaining: <strong>${Utils.escapeHTML(roundStock(item.currentStock))} ${Utils.escapeHTML(item.unit)}</strong>
                      (Min threshold: ${Utils.escapeHTML(item.minThreshold)} ${Utils.escapeHTML(item.unit)})
                    </p>
                  </div>
                  <div class="skg-quick-actions">
                    ${item.supplierPhone ? `<a class="btn btn-sm btn-secondary" href="tel:${Utils.escapeHTML(item.supplierPhone)}">Call ${Utils.escapeHTML(item.supplierName || "Supplier")}</a>` : ""}
                    ${canManage ? `<button type="button" class="btn btn-sm btn-primary" data-inv-adjust="${Utils.escapeHTML(item.id)}" data-mode="restock">+ Restock Now</button>` : ""}
                  </div>
                </div>
                ${links.length ? `
                  <p class="form-hint" style="margin-top:8px;">
                    Linked dishes: ${links.map((l) => Utils.escapeHTML(l.productName)).join(", ")}
                    ${health.code === "out" && item.autoDisableProducts !== false ? " — <strong>Auto-marked Unavailable on Menu</strong>" : ""}
                  </p>
                ` : ""}
              </article>
            `;
        }).join("")}
      </div>
    `;
}

function renderLogsTab(filteredMovements, searchQuery, movementTypeFilter) {
    return `
      <div class="skg-admin-order-toolbar">
        <input type="search" id="skg-inv-search" placeholder="Search item, order note, or staff email..." value="${Utils.escapeHTML(searchQuery)}">
        <select id="skg-mov-type-filter">
          <option value="all" ${movementTypeFilter === "all" ? "selected" : ""}>All movement types</option>
          <option value="restock" ${movementTypeFilter === "restock" ? "selected" : ""}>Restocks (+)</option>
          <option value="order_deduction" ${movementTypeFilter === "order_deduction" ? "selected" : ""}>Order Deductions (−)</option>
          <option value="adjustment" ${movementTypeFilter === "adjustment" ? "selected" : ""}>Manual Adjustments</option>
          <option value="waste" ${movementTypeFilter === "waste" ? "selected" : ""}>Spoilage / Waste (−)</option>
        </select>
      </div>

      ${filteredMovements.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <h3 class="empty-state-title">No stock movements recorded yet</h3>
          <p class="empty-state-desc">Restocks, adjustments, and confirmed order deductions appear here automatically.</p>
        </div>
      ` : `
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Time (NPT)</th>
                <th>Item</th>
                <th>Type</th>
                <th>Change</th>
                <th>Stock After</th>
                <th>Note / Cost</th>
              </tr>
            </thead>
            <tbody>
              ${filteredMovements.slice(0, 150).map((m) => `
                <tr>
                  <td style="white-space:nowrap;">${Utils.escapeHTML(Utils.formatDate(m.timestamp))}</td>
                  <td><strong>${Utils.escapeHTML(m.itemName)}</strong></td>
                  <td><span class="badge ${m.delta >= 0 ? "badge-success" : "badge-info"}">${Utils.escapeHTML(MOVEMENT_LABELS[m.type] || m.type)}</span></td>
                  <td><strong>${m.delta > 0 ? `+${m.delta}` : m.delta} ${Utils.escapeHTML(m.unit)}</strong></td>
                  <td>${Utils.escapeHTML(m.newStock)} ${Utils.escapeHTML(m.unit)}</td>
                  <td>
                    <div>${Utils.escapeHTML(m.note || "—")}</div>
                    <div class="form-hint">
                      ${m.unitCostNpr ? `Cost: Rs. ${m.unitCostNpr} • ` : ""}${Utils.escapeHTML(m.actorEmail || m.actorUid || "system")}
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `}
    `;
}

function renderReportTab(items, movements) {
    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    const recentMovements = movements.filter((m) => Number(m.timestamp || 0) >= last24h);
    const restocked24h = recentMovements.filter((m) => m.type === "restock");
    const deducted24h = recentMovements.filter((m) => m.type === "order_deduction");
    const totalSpend24h = restocked24h.reduce((sum, m) => sum + (Number(m.unitCostNpr) || 0), 0);

    return `
      <div class="skg-channel-note">
        <strong>24-Hour Inventory Summary (Real Database Figures):</strong>
        ${restocked24h.length} restock entries (Recorded spend: Rs. ${totalSpend24h.toLocaleString("en-IN")}) •
        ${deducted24h.length} automatic order deductions •
        ${items.filter((i) => Number(i.currentStock || 0) <= Number(i.minThreshold || 0)).length} items currently requiring attention.
      </div>
      <div class="skg-quick-actions" style="margin-bottom:14px;">
        <button type="button" class="btn btn-primary" id="skg-inv-export-csv">⬇ Download Stock &amp; Movements CSV</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Current Balance</th>
              <th>Min Threshold</th>
              <th>Last Restocked</th>
              <th>Supplier</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((i) => `
              <tr>
                <td><strong>${Utils.escapeHTML(i.name)}</strong></td>
                <td>${Utils.escapeHTML(roundStock(i.currentStock))} ${Utils.escapeHTML(i.unit)}</td>
                <td>${Utils.escapeHTML(i.minThreshold ?? 0)} ${Utils.escapeHTML(i.unit)}</td>
                <td>${i.lastRestockedAt ? Utils.escapeHTML(Utils.formatDate(i.lastRestockedAt)) : "Never"}</td>
                <td>${Utils.escapeHTML(i.supplierName || "—")} ${i.supplierPhone ? `(${Utils.escapeHTML(i.supplierPhone)})` : ""}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
}

function exportStockCsv(items, movements) {
    const csvEsc = (v) => {
        let str = String(v ?? "");
        if (/^[=+\-@\t\r]/.test(str)) {
            str = `'${str}`;
        }
        return `"${str.replace(/"/g, '""')}"`;
    };
    const rows = [
        ["SECTION", "ID", "ITEM", "CATEGORY_OR_TYPE", "QUANTITY_OR_BALANCE", "UNIT", "THRESHOLD_OR_AFTER", "NOTE_OR_SUPPLIER", "TIMESTAMP"]
    ];
    items.forEach((i) => {
        rows.push([
            "CURRENT_STOCK",
            i.id,
            i.name,
            i.category,
            roundStock(i.currentStock),
            i.unit,
            i.minThreshold,
            i.supplierName || "",
            i.updatedAt ? new Date(i.updatedAt).toISOString() : ""
        ]);
    });
    movements.slice(0, 500).forEach((m) => {
        rows.push([
            "MOVEMENT",
            m.id,
            m.itemName,
            m.type,
            m.delta,
            m.unit,
            m.newStock,
            m.note || "",
            m.timestamp ? new Date(m.timestamp).toISOString() : ""
        ]);
    });

    const csv = rows.map((r) => r.map(csvEsc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `siranchowk-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
