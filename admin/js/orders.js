/**
 * Orders Management Module
 * Order processing state transitions. Displays authentic state without fabricated metrics.
 */

const OrdersModule = (() => {
    return {
        async render(container) {
            const orders = await DataService.getOrders();
            container.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Customer Orders (${orders.length})</h2>
                    </div>
                    ${orders.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-state-icon">🛒</div>
                            <h3 class="empty-state-title">No Orders Yet</h3>
                            <p class="empty-state-desc">Incoming orders placed via website or WhatsApp will appear here in real-time.</p>
                        </div>
                    ` : `
                        <div class="table-responsive">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Order ID</th>
                                        <th>Customer</th>
                                        <th>Items</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${orders.map(o => `
                                        <tr>
                                            <td>${o.id}</td>
                                            <td>${Utils.escapeHTML(o.customerName)}</td>
                                            <td>${Utils.escapeHTML(o.summary)}</td>
                                            <td><span class="badge badge-info">${o.status}</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `}
                </div>
            `;
        }
    };
})();