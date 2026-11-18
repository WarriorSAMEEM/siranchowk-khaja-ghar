// ============================================================================
// SIRANCHOWK KHAJA GHAR — INVENTORY ENGINE, AUTO-DEDUCTION & AVAILABILITY SYNC
// ============================================================================

import { db, ref, get, push, set, update, runTransaction } from "./firebase.js";
import { logAuditEvent } from "./audit-logger.js";
import { getPublicPushConfig, dispatchWorkerPush } from "./notifications-client.js";

export const STANDARD_MENU_DISHES = Object.freeze([
    "Chicken Momo",
    "Buff Momo",
    "Veg Chowmein",
    "Chicken Chowmein",
    "Roti",
    "Paratha",
    "Milk Tea",
    "Black Tea",
    "Biryani",
    "Chana",
    "Keema",
    "Sukuti",
    "Boiled Egg",
    "Fried Chicken"
]);

export function slugifyDishKey(name) {
    return String(name || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");
}

export function roundStock(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.round(num * 1000) / 1000);
}

export function getStockHealth(item) {
    const stock = Number(item?.currentStock || 0);
    const min = Number(item?.minThreshold || 0);
    if (stock <= 0) return { code: "out", label: "Out of Stock" };
    if (stock <= min) return { code: "low", label: "Low Stock" };
    return { code: "ok", label: "In Stock" };
}

export async function recordStockMovement({
    itemId,
    itemName,
    type,
    delta,
    previousStock,
    newStock,
    unit,
    note = "",
    unitCostNpr = null,
    session = null
}) {
    const movRef = push(ref(db, "inventory/movements"));
    const record = {
        id: movRef.key,
        itemId: String(itemId || ""),
        itemName: String(itemName || ""),
        type: String(type || "adjustment"),
        delta: Math.round((Number(delta) || 0) * 1000) / 1000,
        previousStock: roundStock(previousStock),
        newStock: roundStock(newStock),
        unit: String(unit || "pcs"),
        note: String(note || "").slice(0, 240),
        unitCostNpr: Number.isFinite(Number(unitCostNpr)) && Number(unitCostNpr) > 0 ? Number(unitCostNpr) : null,
        actorUid: session?.user?.uid || "system",
        actorEmail: session?.user?.email || "",
        timestamp: Date.now()
    };
    await set(movRef, record);
    return record;
}

export async function triggerLowStockAdminAlert(item, session = null) {
    const stock = Number(item?.currentStock || 0);
    const min = Number(item?.minThreshold || 0);
    if (stock > min) return false;

    const now = Date.now();
    // Prevent repeated alerts within 30 minutes for the same item unless stock hits 0 from >0
    const lastAlert = Number(item?.lowStockAlertSentAt || 0);
    if (stock > 0 && now - lastAlert < 30 * 60 * 1000) return false;

    const health = getStockHealth(item);
    const title = health.code === "out"
        ? `Out of Stock: ${item.name}`
        : `Low Stock Alert: ${item.name}`;
    const body = health.code === "out"
        ? `${item.name} has reached 0 ${item.unit || "units"}. Linked menu items have been auto-marked unavailable.`
        : `${item.name} is down to ${roundStock(stock)} ${item.unit || "units"} (threshold: ${min}). Consider restocking soon.`;

    try {
        const notifRef = push(ref(db, "adminNotifications"));
        await set(notifRef, {
            id: notifRef.key,
            title,
            body,
            targetType: "all",
            targetDeviceIds: [],
            senderUid: session?.user?.uid || "system",
            senderEmail: session?.user?.email || "inventory-monitor",
            category: "low_stock",
            createdAt: now
        });

        await update(ref(db, `inventory/items/${item.id}`), {
            lowStockAlertSentAt: now
        }).catch(() => {});

        const { workerUrl } = await getPublicPushConfig();
        const authToken = session?.user ? await session.user.getIdToken() : "";
        if (workerUrl && authToken) {
            await dispatchWorkerPush({
                workerUrl,
                authToken,
                payload: {
                    type: "admin_alert",
                    title,
                    body,
                    targetType: "all"
                }
            }).catch(() => {});
        }
        return true;
    } catch (err) {
        console.warn("Low-stock admin alert dispatch skipped:", err);
        return false;
    }
}

/**
 * Recomputes public dish availability and RTDB menu_items availability
 * across all inventory items so a dish stays unavailable if ANY linked
 * auto-disable ingredient has 0 stock.
 */
export async function syncLinkedProductAvailability(allInventoryItems = null) {
    try {
        let items = allInventoryItems;
        if (!items) {
            const snap = await get(ref(db, "inventory/items"));
            items = snap.exists() ? Object.values(snap.val() || {}) : [];
        }

        const menuSnap = await get(ref(db, "menu_items")).catch(() => null);
        const menuMap = menuSnap && menuSnap.exists() ? menuSnap.val() : {};

        // Map dishKey -> { name, productIds: Set, shouldBeOutOfStock: boolean, managedByAutoInventory: boolean }
        const dishStates = new Map();

        items.forEach((inv) => {
            if (!inv || inv.autoDisableProducts === false) return;
            const links = inv.linkedProducts ? Object.values(inv.linkedProducts) : [];
            const isOut = Number(inv.currentStock || 0) <= 0;

            links.forEach((link) => {
                const dishName = link?.productName || "";
                const key = slugifyDishKey(dishName || link?.productId);
                if (!key) return;
                const entry = dishStates.get(key) || {
                    key,
                    name: dishName,
                    productIds: new Set(),
                    shouldBeOutOfStock: false,
                    managedByAutoInventory: true
                };
                if (link?.productId && menuMap[link.productId]) {
                    entry.productIds.add(link.productId);
                }
                // Also match any menu_items with same name
                Object.entries(menuMap).forEach(([pid, p]) => {
                    if (slugifyDishKey(p?.name) === key) {
                        entry.productIds.add(pid);
                    }
                });
                if (isOut) entry.shouldBeOutOfStock = true;
                dishStates.set(key, entry);
            });
        });

        const now = Date.now();
        const updates = {};

        dishStates.forEach((state) => {
            const available = !state.shouldBeOutOfStock;
            updates[`inventory/stockAvailability/${state.key}`] = {
                key: state.key,
                name: state.name,
                available,
                updatedAt: now
            };
            state.productIds.forEach((pid) => {
                updates[`menu_items/${pid}/available`] = available;
                updates[`menu_items/${pid}/updatedAt`] = now;
            });
        });

        if (Object.keys(updates).length > 0) {
            await update(ref(db), updates);
        }

        return [...dishStates.values()].filter((s) => s.shouldBeOutOfStock);
    } catch (err) {
        console.warn("Product availability sync warning:", err);
        return [];
    }
}

/**
 * Automatically deducts linked ingredients/stock when an order is confirmed/processed.
 * Idempotent per order via `orders/{orderId}/inventoryDeducted`.
 */
export async function deductInventoryForOrder(orderId, order, session = null) {
    if (!orderId || !order || order.inventoryDeducted === true) {
        return { deductedCount: 0, alertsTriggered: [], disabledDishes: [] };
    }

    const orderItems = Array.isArray(order.items) ? order.items : Object.values(order.items || {});
    if (!orderItems.length) {
        return { deductedCount: 0, alertsTriggered: [], disabledDishes: [] };
    }

    const invSnap = await get(ref(db, "inventory/items")).catch(() => null);
    if (!invSnap || !invSnap.exists()) {
        await update(ref(db, `orders/${orderId}`), { inventoryDeducted: true }).catch(() => {});
        return { deductedCount: 0, alertsTriggered: [], disabledDishes: [] };
    }

    const allInventory = Object.values(invSnap.val() || {});
    const neededByInvId = new Map();

    orderItems.forEach((ordered) => {
        const qty = Number(ordered?.quantity || 0);
        const orderedKey = slugifyDishKey(ordered?.name);
        if (!orderedKey || qty <= 0) return;

        allInventory.forEach((inv) => {
            const links = inv?.linkedProducts ? Object.values(inv.linkedProducts) : [];
            links.forEach((link) => {
                const linkKey = slugifyDishKey(link?.productName || link?.productId);
                if (linkKey && linkKey === orderedKey) {
                    const perUnit = Number(link?.deductPerUnit || 1);
                    const totalDeduct = Math.round(qty * perUnit * 1000) / 1000;
                    if (totalDeduct > 0) {
                        neededByInvId.set(inv.id, (neededByInvId.get(inv.id) || 0) + totalDeduct);
                    }
                }
            });
        });
    });

    if (neededByInvId.size === 0) {
        return { deductedCount: 0, alertsTriggered: [], disabledDishes: [] };
    }

    const alertsTriggered = [];
    let deductedCount = 0;

    for (const [invId, deductQty] of neededByInvId.entries()) {
        const item = allInventory.find((x) => x.id === invId);
        if (!item) continue;

        let prevStock = Number(item.currentStock || 0);
        let nextStock = prevStock;

        const tx = await runTransaction(ref(db, `inventory/items/${invId}/currentStock`), (current) => {
            const cur = Number(current || 0);
            prevStock = cur;
            nextStock = roundStock(cur - deductQty);
            return nextStock;
        });

        if (tx.committed) {
            deductedCount += 1;
            const actualNew = roundStock(tx.snapshot.val());
            item.currentStock = actualNew;
            await set(ref(db, `inventory/items/${invId}/updatedAt`), Date.now()).catch(() => {});

            await recordStockMovement({
                itemId: invId,
                itemName: item.name,
                type: "order_deduction",
                delta: -Math.min(prevStock, deductQty),
                previousStock: prevStock,
                newStock: actualNew,
                unit: item.unit || "pcs",
                note: `Order #${orderId.slice(-8).toUpperCase()} (${order.customerName || "Customer"})`,
                session
            });

            if (actualNew <= Number(item.minThreshold || 0)) {
                alertsTriggered.push({ ...item, currentStock: actualNew });
                await triggerLowStockAdminAlert({ ...item, currentStock: actualNew }, session);
            }
        }
    }

    await update(ref(db, `orders/${orderId}`), {
        inventoryDeducted: true,
        inventoryDeductedAt: Date.now()
    }).catch(() => {});

    const disabledDishes = await syncLinkedProductAvailability(allInventory);

    await logAuditEvent({
        actorUid: session?.user?.uid || "system",
        actorEmail: session?.user?.email || "",
        actorRole: session?.role || "staff",
        action: "inventory_auto_deducted",
        target: orderId,
        metadata: {
            itemsAffected: deductedCount,
            lowStockCount: alertsTriggered.length,
            disabledDishes: disabledDishes.map((d) => d.name).join(", ")
        }
    });

    return { deductedCount, alertsTriggered, disabledDishes };
}

/**
 * Restores deducted inventory if an already-confirmed order is later cancelled.
 */
export async function restoreInventoryForOrder(orderId, order, session = null) {
    if (!orderId || !order || order.inventoryDeducted !== true) {
        return { restoredCount: 0 };
    }

    const orderItems = Array.isArray(order.items) ? order.items : Object.values(order.items || {});
    const invSnap = await get(ref(db, "inventory/items")).catch(() => null);
    if (!invSnap || !invSnap.exists()) return { restoredCount: 0 };

    const allInventory = Object.values(invSnap.val() || {});
    const restoreByInvId = new Map();

    orderItems.forEach((ordered) => {
        const qty = Number(ordered?.quantity || 0);
        const orderedKey = slugifyDishKey(ordered?.name);
        if (!orderedKey || qty <= 0) return;

        allInventory.forEach((inv) => {
            const links = inv?.linkedProducts ? Object.values(inv.linkedProducts) : [];
            links.forEach((link) => {
                const linkKey = slugifyDishKey(link?.productName || link?.productId);
                if (linkKey && linkKey === orderedKey) {
                    const perUnit = Number(link?.deductPerUnit || 1);
                    const totalRestore = Math.round(qty * perUnit * 1000) / 1000;
                    if (totalRestore > 0) {
                        restoreByInvId.set(inv.id, (restoreByInvId.get(inv.id) || 0) + totalRestore);
                    }
                }
            });
        });
    });

    let restoredCount = 0;
    for (const [invId, restoreQty] of restoreByInvId.entries()) {
        const item = allInventory.find((x) => x.id === invId);
        if (!item) continue;

        let prevStock = Number(item.currentStock || 0);
        const tx = await runTransaction(ref(db, `inventory/items/${invId}/currentStock`), (current) => {
            const cur = Number(current || 0);
            prevStock = cur;
            return roundStock(cur + restoreQty);
        });
        if (tx.committed) {
            restoredCount += 1;
            const actualNew = roundStock(tx.snapshot.val());
            item.currentStock = actualNew;
            await set(ref(db, `inventory/items/${invId}/updatedAt`), Date.now()).catch(() => {});

            await recordStockMovement({
                itemId: invId,
                itemName: item.name,
                type: "adjustment",
                delta: restoreQty,
                previousStock: prevStock,
                newStock: actualNew,
                unit: item.unit || "pcs",
                note: `Restored from cancelled Order #${orderId.slice(-8).toUpperCase()}`,
                session
            });
        }
    }

    await update(ref(db, `orders/${orderId}`), {
        inventoryDeducted: false,
        inventoryRestoredAt: Date.now()
    }).catch(() => {});

    await syncLinkedProductAvailability(allInventory);
    return { restoredCount };
}
