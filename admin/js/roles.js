// ============================================================================
// SIRANCHOWK KHAJA GHAR — ROLES & RBAC PERMISSIONS MATRIX MODULE
// ============================================================================

import { db, ref, get, set } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import {
    PRIMARY_OWNER_UID,
    ROLE_IDS,
    ROLE_METADATA,
    PERMISSION_CATALOG,
    DEFAULT_ROLE_PERMISSIONS
} from "../../js/rbac.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { logSecurityEvent } from "../../js/activity-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

export const RolesModule = {
    async render(container) {
        const session = getAdminSession();
        const isOwner = session?.role === "owner" || session?.user?.uid === PRIMARY_OWNER_UID;
        const canEdit = isOwner && hasPermission("manageRoles");

        container.innerHTML = '<div class="skg-admin-loading">Loading roles & permission matrix…</div>';

        const snap = await get(ref(db, "rbac/roles")).catch(() => null);
        const saved = snap && snap.exists() ? snap.val() : {};

        const matrix = {};
        ROLE_IDS.forEach((roleId) => {
            matrix[roleId] = {
                ...DEFAULT_ROLE_PERMISSIONS[roleId],
                ...(roleId === "owner" ? {} : (saved[roleId] || {}))
            };
        });

        const draw = () => {
            container.innerHTML = `
              <section class="card">
                <div class="card-header">
                  <div>
                    <h2 class="card-title">Roles &amp; Permissions Matrix</h2>
                    <p class="card-subtitle">
                      ${canEdit
                        ? "Customize capabilities for Admin, Moderator, Officer, and Helper tiers. Owner retains full authority permanently."
                        : "Read-only permission overview. Only the Business Owner can modify role permissions."}
                    </p>
                  </div>
                  ${canEdit ? `
                    <div class="skg-quick-actions">
                      <button type="button" class="btn btn-secondary" id="skg-reset-roles-btn">Reset to Defaults</button>
                      <button type="button" class="btn btn-primary" id="skg-save-roles-btn">Save Role Matrix</button>
                    </div>
                  ` : ""}
                </div>

                <div class="skg-role-summary-grid">
                  ${ROLE_IDS.map((roleId) => `
                    <div class="skg-role-summary-card">
                      <strong>${Utils.escapeHTML(ROLE_METADATA[roleId].label)}</strong>
                      <p class="form-hint">${Utils.escapeHTML(ROLE_METADATA[roleId].description)}</p>
                    </div>
                  `).join("")}
                </div>

                <div class="table-responsive" style="margin-top:16px;">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Permission</th>
                        ${ROLE_IDS.map((r) => `<th>${Utils.escapeHTML(ROLE_METADATA[r].label)}</th>`).join("")}
                      </tr>
                    </thead>
                    <tbody>
                      ${PERMISSION_CATALOG.map((perm) => `
                        <tr>
                          <td>
                            <strong>${Utils.escapeHTML(perm.label)}</strong>
                            <div class="form-hint">${Utils.escapeHTML(perm.description)}</div>
                          </td>
                          ${ROLE_IDS.map((roleId) => {
                              const checked = Boolean(matrix[roleId][perm.key]);
                              const disabled = roleId === "owner" || !canEdit;
                              return `
                                <td>
                                  <input
                                    type="checkbox"
                                    class="skg-matrix-check"
                                    data-role="${Utils.escapeHTML(roleId)}"
                                    data-perm="${Utils.escapeHTML(perm.key)}"
                                    ${checked ? "checked" : ""}
                                    ${disabled ? "disabled" : ""}
                                    aria-label="${Utils.escapeHTML(ROLE_METADATA[roleId].label)} ${Utils.escapeHTML(perm.label)}"
                                  >
                                </td>
                              `;
                          }).join("")}
                        </tr>
                      `).join("")}
                    </tbody>
                  </table>
                </div>
              </section>
            `;

            container.querySelectorAll(".skg-matrix-check").forEach((checkbox) => {
                checkbox.addEventListener("change", () => {
                    const { role, perm } = checkbox.dataset;
                    if (role && role !== "owner" && matrix[role]) {
                        matrix[role][perm] = checkbox.checked;
                    }
                });
            });

            const saveBtn = container.querySelector("#skg-save-roles-btn");
            saveBtn?.addEventListener("click", async () => {
                if (!canEdit) return;
                saveBtn.disabled = true;
                try {
                    const payload = {
                        admin: matrix.admin,
                        moderator: matrix.moderator,
                        officer: matrix.officer,
                        helper: matrix.helper
                    };
                    await set(ref(db, "rbac/roles"), payload);
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorName: session?.staff?.name,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: "rbac_matrix_updated",
                        target: "rbac/roles"
                    });
                    await logSecurityEvent({
                        eventType: "rbac_matrix_updated",
                        severity: "warning",
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        target: "rbac/roles"
                    });
                    UIModule.showToast("Role permission matrix saved.", "success");
                } catch (err) {
                    UIModule.showToast(err?.message || "Failed to save role permissions.", "error");
                } finally {
                    saveBtn.disabled = false;
                }
            });

            const resetBtn = container.querySelector("#skg-reset-roles-btn");
            resetBtn?.addEventListener("click", async () => {
                if (!canEdit) return;
                const ok = await UIModule.confirm({
                    title: "Reset Role Permissions?",
                    message: "Restore Admin, Moderator, Officer, and Helper permissions to recommended defaults?",
                    confirmText: "Reset Defaults",
                    dangerous: true
                });
                if (!ok) return;
                resetBtn.disabled = true;
                try {
                    ROLE_IDS.forEach((r) => {
                        matrix[r] = { ...DEFAULT_ROLE_PERMISSIONS[r] };
                    });
                    await set(ref(db, "rbac/roles"), {
                        admin: matrix.admin,
                        moderator: matrix.moderator,
                        officer: matrix.officer,
                        helper: matrix.helper
                    });
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorName: session?.staff?.name,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: "rbac_matrix_reset",
                        target: "rbac/roles"
                    });
                    await logSecurityEvent({
                        eventType: "rbac_matrix_reset",
                        severity: "warning",
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        target: "rbac/roles"
                    });
                    UIModule.showToast("Permissions restored to defaults.", "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Failed to reset role permissions.", "error");
                } finally {
                    resetBtn.disabled = false;
                }
            });
        };

        draw();
    }
};
