/**
 * Offers & Promotions Management Module
 */

const OffersModule = (() => {
    return {
        async render(container) {
            const offers = await DataService.getOffers();
            container.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Offers & Promotions (${offers.length})</h2>
                        <button class="btn btn-primary btn-sm" id="add-offer-btn">+ Create Offer</button>
                    </div>
                    ${offers.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-state-icon">🏷️</div>
                            <h3 class="empty-state-title">No Active Offers</h3>
                            <p class="empty-state-desc">Create special discounts or daily combos for your customers.</p>
                        </div>
                    ` : `
                        <div class="table-responsive">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Title</th>
                                        <th>Promo Code</th>
                                        <th>Description</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${offers.map(off => `
                                        <tr>
                                            <td><strong>${Utils.escapeHTML(off.title)}</strong></td>
                                            <td><code>${Utils.escapeHTML(off.code)}</code></td>
                                            <td>${Utils.escapeHTML(off.description)}</td>
                                            <td>
                                                <button class="btn btn-danger btn-sm delete-offer-btn" data-id="${off.id}">Delete</button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `}
                </div>
            `;

            container.querySelector('#add-offer-btn')?.addEventListener('click', () => {
                UIModule.showToast("Offer creation form ready", "info");
            });

            container.querySelectorAll('.delete-offer-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    await DataService.deleteOffer(e.target.dataset.id);
                    UIModule.showToast("Offer removed", "info");
                    this.render(container);
                });
            });
        }
    };
})();