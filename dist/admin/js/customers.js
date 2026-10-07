/**
 * Customer Directory Module
 */

const CustomersModule = (() => {
    return {
        async render(container) {
            const customers = await DataService.getCustomers();
            container.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Registered Customers (${customers.length})</h2>
                    </div>
                    ${customers.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-state-icon">👥</div>
                            <h3 class="empty-state-title">No Customers Registered</h3>
                            <p class="empty-state-desc">Customer profiles will automatically build as WhatsApp/Website orders are placed.</p>
                        </div>
                    ` : ``}
                </div>
            `;
        }
    };
})();