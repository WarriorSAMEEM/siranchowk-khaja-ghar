/**
 * Analytics View Module
 * Clean zero/empty statistical analytics display without fake data.
 */

const AnalyticsModule = (() => {
    return {
        async render(container) {
            container.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Analytics & Metrics Overview</h2>
                        <span class="badge badge-info">Real Data Mode</span>
                    </div>
                    <div class="metrics-grid">
                        <div class="metric-card">
                            <div class="metric-info">
                                <span class="metric-label">Total Site Visitors</span>
                                <span class="metric-value">0</span>
                                <span class="metric-subtext">No tracking active</span>
                            </div>
                            <div class="metric-icon-box">📊</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-info">
                                <span class="metric-label">WhatsApp Clicks</span>
                                <span class="metric-value">0</span>
                                <span class="metric-subtext">Direct conversions</span>
                            </div>
                            <div class="metric-icon-box">💬</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-info">
                                <span class="metric-label">Menu Views</span>
                                <span class="metric-value">0</span>
                                <span class="metric-subtext">Page loads</span>
                            </div>
                            <div class="metric-icon-box">📖</div>
                        </div>
                    </div>
                    <div class="empty-state">
                        <div class="empty-state-icon">📈</div>
                        <h3 class="empty-state-title">Analytics Data Unavailable</h3>
                        <p class="empty-state-desc">Firebase Analytics will log live visitors, page views, and WhatsApp interactions once production traffic starts.</p>
                    </div>
                </div>
            `;
        }
    };
})();