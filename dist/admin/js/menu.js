/**
 * Menu Items Management Module
 * Create, Edit, Delete, Filter, and Toggle availability for menu offerings.
 */

const MenuModule = (() => {
    return {
        async render(container) {
            const items = await DataService.getMenuItems();
            container.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Menu Items (${items.length})</h2>
                        <button class="btn btn-primary btn-sm" id="add-menu-btn">+ Add Menu Item</button>
                    </div>
                    ${items.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-state-icon">🍲</div>
                            <h3 class="empty-state-title">No Menu Items Found</h3>
                            <p class="empty-state-desc">Add authentic items to your restaurant menu to display them on the website.</p>
                        </div>
                    ` : `
                        <div class="table-responsive">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Item Name</th>
                                        <th>Category</th>
                                        <th>Price</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${items.map(item => `
                                        <tr>
                                            <td><strong>${Utils.escapeHTML(item.name)}</strong></td>
                                            <td>${Utils.escapeHTML(item.category)}</td>
                                            <td>${Utils.formatCurrency(item.price)}</td>
                                            <td><span class="badge ${item.available ? 'badge-success' : 'badge-danger'}">${item.available ? 'Available' : 'Sold Out'}</span></td>
                                            <td>
                                                <button class="btn btn-secondary btn-sm edit-menu-btn" data-id="${item.id}">Edit</button>
                                                <button class="btn btn-danger btn-sm delete-menu-btn" data-id="${item.id}">Delete</button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `}
                </div>
            `;

            this.bindEvents(container);
        },

        bindEvents(container) {
            container.querySelector('#add-menu-btn')?.addEventListener('click', () => this.openFormModal());
            
            container.querySelectorAll('.edit-menu-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.target.dataset.id;
                    const items = await DataService.getMenuItems();
                    const item = items.find(i => i.id === id);
                    if (item) this.openFormModal(item);
                });
            });

            container.querySelectorAll('.delete-menu-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.target.dataset.id;
                    if (confirm("Delete this menu item?")) {
                        await DataService.deleteMenuItem(id);
                        UIModule.showToast("Menu item deleted", "info");
                        this.render(container);
                    }
                });
            });
        },

        openFormModal(item = null) {
            const isEdit = !!item;
            const formHTML = `
                <form id="menu-form">
                    <div class="form-group">
                        <label class="form-label">Item Name</label>
                        <input type="text" class="form-control" id="m-name" value="${item ? Utils.escapeHTML(item.name) : ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Category</label>
                        <input type="text" class="form-control" id="m-cat" value="${item ? Utils.escapeHTML(item.category) : 'Khaja Sets'}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Price (NPR)</label>
                        <input type="number" class="form-control" id="m-price" value="${item ? item.price : ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Description</label>
                        <textarea class="form-control" id="m-desc">${item ? Utils.escapeHTML(item.description) : ''}</textarea>
                    </div>
                </form>
            `;

            const footerHTML = `
                <button class="btn btn-secondary btn-sm" id="cancel-modal">Cancel</button>
                <button class="btn btn-primary btn-sm" id="save-menu-btn">${isEdit ? 'Update Item' : 'Create Item'}</button>
            `;

            UIModule.openModal(isEdit ? "Edit Menu Item" : "Add New Menu Item", formHTML, footerHTML);

            document.getElementById('cancel-modal').onclick = () => UIModule.closeModal();
            document.getElementById('save-menu-btn').onclick = async () => {
                const name = document.getElementById('m-name').value;
                const category = document.getElementById('m-cat').value;
                const price = document.getElementById('m-price').value;
                const description = document.getElementById('m-desc').value;

                if (!name || !price) {
                    UIModule.showToast("Name and Price are required", "error");
                    return;
                }

                await DataService.saveMenuItem({
                    id: item ? item.id : null,
                    name,
                    category,
                    price: parseFloat(price),
                    description,
                    available: true
                });

                UIModule.showToast(`Menu item ${isEdit ? 'updated' : 'created'} successfully`, "success");
                UIModule.closeModal();
                this.render(document.getElementById('main-content'));
            };
        }
    };
})();