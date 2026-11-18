// ============================================================================
// SIRANCHOWK KHAJA GHAR — STAFF & ROLE ASSIGNMENT MODULE
// ============================================================================

import {
    db,
    ref,
    get,
    set,
    update,
    remove,
    getStaffProvisionerAuth,
    createUserWithEmailAndPassword,
    updateProfile,
    signOut
} from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import {
    PRIMARY_OWNER_UID,
    ROLE_METADATA,
    PERMISSION_CATALOG,
    DEFAULT_ROLE_PERMISSIONS,
    canManageTargetStaff,
    getAllowedAssignableRoles,
    normalizeRole
} from "../../js/rbac.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { logSecurityEvent } from "../../js/activity-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

export const StaffModule = {
    async render(container) {
        const session = getAdminSession();
        if (!hasPermission("manageStaff")) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">Only Owner and authorized Admin roles can manage staff accounts.</p></section>';
            return;
        }

        container.innerHTML = '<div class="skg-admin-loading">Loading staff directory…</div>';

        const snap = await get(ref(db, "staff"));
        let staffList = snap.exists()
            ? Object.entries(snap.val() || {}).map(([uid, s]) => ({ uid, ...(s || {}) }))
            : [];
        staffList.sort((a, b) => (ROLE_METADATA[normalizeRole(b.role)]?.rank || 0) - (ROLE_METADATA[normalizeRole(a.role)]?.rank || 0));

        const assignableRoles = getAllowedAssignableRoles(session?.role);
        const isOwner = session?.role === "owner" || session?.user?.uid === PRIMARY_OWNER_UID;

        const draw = () => {
            container.innerHTML = `
              <section class="card">
                <div class="card-header">
                  <div>
                    <h2 class="card-title">Staff Directory (${staffList.length})</h2>
                    <p class="card-subtitle">Create staff credentials, assign operational roles, or customize per-staff permissions. The Business Owner account is locked and protected.</p>
                  </div>
                  ${assignableRoles.length ? '<button type="button" class="btn btn-primary" id="skg-add-staff-btn">+ Add Staff Account</button>' : ""}
                </div>

                <div class="table-responsive">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Staff Member</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Overrides</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${staffList.map((member) => {
                          const roleKey = member.uid === PRIMARY_OWNER_UID ? "owner" : normalizeRole(member.role);
                          const roleLabel = ROLE_METADATA[roleKey]?.label || roleKey;
                          const canManageRow = canManageTargetStaff(session?.role, roleKey, member.uid);
                          const overrideCount = Object.keys(member.customPermissions || {}).length;
                          const isOwnerRow = member.uid === PRIMARY_OWNER_UID || roleKey === "owner";

                          return `
                            <tr>
                              <td>
                                <strong>${Utils.escapeHTML(member.name || "Staff")}</strong>
                                <div class="form-hint">${Utils.escapeHTML(member.email || member.uid)}</div>
                              </td>
                              <td><span class="badge ${isOwnerRow ? "badge-success" : "badge-info"}">${Utils.escapeHTML(roleLabel)}</span></td>
                              <td>
                                <span class="badge ${member.active !== false ? "badge-success" : "badge-danger"}">
                                  ${member.active !== false ? "Active" : "Disabled"}
                                </span>
                              </td>
                              <td>${isOwnerRow ? "Full Owner Authority" : overrideCount ? `${overrideCount} custom` : "Role default"}</td>
                              <td>
                                ${isOwnerRow ? '<span class="form-hint">Protected Owner</span>' : canManageRow ? `
                                  <div class="skg-table-actions">
                                    <button type="button" class="btn btn-sm btn-secondary" data-edit-staff="${Utils.escapeHTML(member.uid)}">Role</button>
                                    ${isOwner ? `<button type="button" class="btn btn-sm btn-secondary" data-perm-staff="${Utils.escapeHTML(member.uid)}">Permissions</button>` : ""}
                                    <button type="button" class="btn btn-sm btn-secondary" data-toggle-staff="${Utils.escapeHTML(member.uid)}">
                                      ${member.active !== false ? "Disable" : "Activate"}
                                    </button>
                                    <button type="button" class="btn btn-sm btn-danger" data-delete-staff="${Utils.escapeHTML(member.uid)}">Remove</button>
                                  </div>
                                ` : '<span class="form-hint">Higher or equal tier</span>'}
                              </td>
                            </tr>
                          `;
                      }).join("")}
                    </tbody>
                  </table>
                </div>
              </section>
            `;

            container.querySelector("#skg-add-staff-btn")?.addEventListener("click", () => openAddStaffModal());
            container.querySelectorAll("[data-edit-staff]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const member = staffList.find((m) => m.uid === btn.dataset.editStaff);
                    if (member) openEditRoleModal(member);
                });
            });
            container.querySelectorAll("[data-perm-staff]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const member = staffList.find((m) => m.uid === btn.dataset.permStaff);
                    if (member) openCustomPermissionsModal(member);
                });
            });
            container.querySelectorAll("[data-toggle-staff]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const member = staffList.find((m) => m.uid === btn.dataset.toggleStaff);
                    if (!member || !canManageTargetStaff(session?.role, member.role, member.uid)) return;
                    const nextActive = member.active === false;
                    btn.disabled = true;
                    try {
                        await update(ref(db, `staff/${member.uid}`), { active: nextActive, updatedAt: Date.now() });
                        member.active = nextActive;
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorName: session?.staff?.name,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: nextActive ? "staff_activated" : "staff_disabled",
                            target: member.uid,
                            metadata: { email: member.email }
                        });
                        await logSecurityEvent({
                            eventType: nextActive ? "staff_activated" : "staff_disabled",
                            severity: nextActive ? "info" : "warning",
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            target: member.uid,
                            details: { email: member.email }
                        });
                        UIModule.showToast(`${member.name} ${nextActive ? "activated" : "disabled"}.`, "success");
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Could not update staff status.", "error");
                        btn.disabled = false;
                    }
                });
            });
            container.querySelectorAll("[data-delete-staff]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const member = staffList.find((m) => m.uid === btn.dataset.deleteStaff);
                    if (!member || !canManageTargetStaff(session?.role, member.role, member.uid)) return;
                    const ok = await UIModule.confirm({
                        title: "Remove Staff Access?",
                        message: `Revoke admin access for ${member.name} (${member.email})? They will no longer be able to access the Admin Panel.`,
                        confirmText: "Remove Staff",
                        dangerous: true
                    });
                    if (!ok) return;
                    btn.disabled = true;
                    try {
                        await remove(ref(db, `staff/${member.uid}`));
                        staffList = staffList.filter((m) => m.uid !== member.uid);
                        await logAuditEvent({
                            actorUid: session?.user?.uid,
                            actorName: session?.staff?.name,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            action: "staff_removed",
                            target: member.uid,
                            metadata: { email: member.email }
                        });
                        await logSecurityEvent({
                            eventType: "staff_removed",
                            severity: "warning",
                            actorUid: session?.user?.uid,
                            actorEmail: session?.user?.email,
                            actorRole: session?.role,
                            target: member.uid,
                            details: { email: member.email }
                        });
                        UIModule.showToast("Staff member removed.", "success");
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Could not remove staff member.", "error");
                        btn.disabled = false;
                    }
                });
            });
        };

        const openAddStaffModal = () => {
            const roleOpts = assignableRoles
                .map((r) => `<option value="${r}">${ROLE_METADATA[r]?.label || r} — ${ROLE_METADATA[r]?.description || ""}</option>`)
                .join("");

            UIModule.openModal(
                "Add New Staff Account",
                `
                  <form id="skg-add-staff-form">
                    <div class="form-group">
                      <label class="form-label" for="staff-name">Full Name *</label>
                      <input class="form-control" id="staff-name" type="text" required placeholder="e.g., Sita Gurung">
                    </div>
                    <div class="form-group">
                      <label class="form-label" for="staff-email">Email Address *</label>
                      <input class="form-control" id="staff-email" type="email" required placeholder="staff@example.com">
                    </div>
                    <div class="form-group">
                      <label class="form-label" for="staff-pass">Temporary Password * (min 6 chars)</label>
                      <input class="form-control" id="staff-pass" type="password" minlength="6" required placeholder="Enter initial password">
                    </div>
                    <div class="form-group">
                      <label class="form-label" for="staff-role">Assign Role *</label>
                      <select class="form-control" id="staff-role">${roleOpts}</select>
                    </div>
                    <p class="form-hint">Account creation uses an isolated Firebase Auth instance so your current session remains signed in.</p>
                  </form>
                `,
                `
                  <button type="button" class="btn btn-secondary" id="staff-cancel">Cancel</button>
                  <button type="button" class="btn btn-primary" id="staff-create">Create Staff Account</button>
                `
            );

            document.getElementById("staff-cancel")?.addEventListener("click", () => UIModule.closeModal());
            document.getElementById("staff-create")?.addEventListener("click", async () => {
                const name = document.getElementById("staff-name")?.value.trim();
                const email = document.getElementById("staff-email")?.value.trim();
                const password = document.getElementById("staff-pass")?.value || "";
                const role = document.getElementById("staff-role")?.value || "helper";

                if (!name || !email || password.length < 6) {
                    UIModule.showToast("Provide name, valid email, and a password of at least 6 characters.", "error");
                    return;
                }
                if (!assignableRoles.includes(role)) {
                    UIModule.showToast("You cannot assign that role.", "error");
                    return;
                }

                const btn = document.getElementById("staff-create");
                if (btn) btn.disabled = true;

                try {
                    const secondaryAuth = getStaffProvisionerAuth();
                    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
                    await updateProfile(cred.user, { displayName: name });
                    const newUid = cred.user.uid;
                    await signOut(secondaryAuth);

                    const now = Date.now();
                    const record = {
                        uid: newUid,
                        name,
                        email,
                        role,
                        active: true,
                        createdAt: now,
                        updatedAt: now,
                        createdBy: session?.user?.uid || ""
                    };
                    await set(ref(db, `staff/${newUid}`), record);
                    staffList.push(record);
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorName: session?.staff?.name,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: "staff_created",
                        target: newUid,
                        metadata: { email, role }
                    });
                    await logSecurityEvent({
                        eventType: "staff_created",
                        severity: "info",
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        target: newUid,
                        details: { email, role }
                    });
                    UIModule.closeModal();
                    UIModule.showToast(`Staff account created for ${name}.`, "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not create staff account.", "error");
                    if (btn) btn.disabled = false;
                }
            });
        };

        const openEditRoleModal = (member) => {
            const roleOpts = assignableRoles
                .map((r) => `<option value="${r}" ${normalizeRole(member.role) === r ? "selected" : ""}>${ROLE_METADATA[r]?.label || r}</option>`)
                .join("");

            UIModule.openModal(
                `Edit Role: ${member.name}`,
                `
                  <div class="form-group">
                    <label class="form-label" for="edit-staff-role">Role</label>
                    <select class="form-control" id="edit-staff-role">${roleOpts}</select>
                  </div>
                `,
                `
                  <button type="button" class="btn btn-secondary" id="role-cancel">Cancel</button>
                  <button type="button" class="btn btn-primary" id="role-save">Update Role</button>
                `
            );

            document.getElementById("role-cancel")?.addEventListener("click", () => UIModule.closeModal());
            const roleSaveBtn = document.getElementById("role-save");
            roleSaveBtn?.addEventListener("click", async () => {
                const nextRole = document.getElementById("edit-staff-role")?.value;
                if (!assignableRoles.includes(nextRole)) return;
                roleSaveBtn.disabled = true;
                try {
                    await update(ref(db, `staff/${member.uid}`), { role: nextRole, updatedAt: Date.now() });
                    const prev = member.role;
                    member.role = nextRole;
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorName: session?.staff?.name,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: "staff_role_changed",
                        target: member.uid,
                        metadata: { previousRole: prev, nextRole }
                    });
                    await logSecurityEvent({
                        eventType: "staff_role_changed",
                        severity: "warning",
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        target: member.uid,
                        details: { previousRole: prev, nextRole }
                    });
                    UIModule.closeModal();
                    UIModule.showToast(`Role updated to ${ROLE_METADATA[nextRole]?.label}.`, "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not update staff role.", "error");
                    roleSaveBtn.disabled = false;
                }
            });
        };

        const openCustomPermissionsModal = (member) => {
            const roleDefaults = DEFAULT_ROLE_PERMISSIONS[normalizeRole(member.role)] || {};
            const overrides = member.customPermissions || {};

            UIModule.openModal(
                `Custom Permissions: ${member.name}`,
                `
                  <p class="form-hint" style="margin-bottom:12px;">
                    Override individual capabilities for this staff member. Unset permissions follow their <strong>${Utils.escapeHTML(ROLE_METADATA[normalizeRole(member.role)]?.label)}</strong> role matrix.
                  </p>
                  <div class="skg-perm-override-list">
                    ${PERMISSION_CATALOG.map((p) => {
                        const mode = overrides[p.key] === true ? "allow" : overrides[p.key] === false ? "deny" : "inherit";
                        return `
                          <div class="skg-perm-override-row">
                            <div>
                              <strong>${Utils.escapeHTML(p.label)}</strong>
                              <span class="form-hint">Default: ${roleDefaults[p.key] ? "Allowed" : "Restricted"}</span>
                            </div>
                            <select class="form-control" data-perm-select="${Utils.escapeHTML(p.key)}">
                              <option value="inherit" ${mode === "inherit" ? "selected" : ""}>Inherit Role</option>
                              <option value="allow" ${mode === "allow" ? "selected" : ""}>Force Allow</option>
                              <option value="deny" ${mode === "deny" ? "selected" : ""}>Force Deny</option>
                            </select>
                          </div>
                        `;
                    }).join("")}
                  </div>
                `,
                `
                  <button type="button" class="btn btn-secondary" id="perm-cancel">Cancel</button>
                  <button type="button" class="btn btn-primary" id="perm-save">Save Overrides</button>
                `
            );

            document.getElementById("perm-cancel")?.addEventListener("click", () => UIModule.closeModal());
            const permSaveBtn = document.getElementById("perm-save");
            permSaveBtn?.addEventListener("click", async () => {
                const nextOverrides = {};
                document.querySelectorAll("[data-perm-select]").forEach((sel) => {
                    if (sel.value === "allow") nextOverrides[sel.dataset.permSelect] = true;
                    if (sel.value === "deny") nextOverrides[sel.dataset.permSelect] = false;
                });
                permSaveBtn.disabled = true;
                try {
                    await update(ref(db, `staff/${member.uid}`), {
                        customPermissions: Object.keys(nextOverrides).length ? nextOverrides : null,
                        updatedAt: Date.now()
                    });
                    member.customPermissions = Object.keys(nextOverrides).length ? nextOverrides : null;
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorName: session?.staff?.name,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: "staff_custom_permissions_updated",
                        target: member.uid,
                        metadata: { overridesCount: Object.keys(nextOverrides).length }
                    });
                    await logSecurityEvent({
                        eventType: "staff_custom_permissions_updated",
                        severity: "warning",
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        target: member.uid,
                        details: { overridesCount: Object.keys(nextOverrides).length }
                    });
                    UIModule.closeModal();
                    UIModule.showToast("Custom staff permissions updated.", "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not save custom permissions.", "error");
                    permSaveBtn.disabled = false;
                }
            });
        };

        draw();
    }
};
