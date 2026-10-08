const DashboardModule = {
    async render(container) {
        container.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Dashboard Overview</h2>
                        <p class="card-subtitle">
                            Siranchowk Khaja Ghar website overview
                        </p>
                    </div>

                    <span class="badge badge-success">
                        Store Open
                    </span>
                </div>

                <div class="metrics-grid">

                    <div class="metric-card">
                        <div class="metric-info">
                            <span class="metric-label">
                                Website Visitors
                            </span>

                            <span class="metric-value">
                                —
                            </span>

                            <span class="metric-subtext">
                                Open Analytics for detailed data
                            </span>
                        </div>

                        <div class="metric-icon-box">
                            👥
                        </div>
                    </div>


                    <div class="metric-card">
                        <div class="metric-info">
                            <span class="metric-label">
                                Menu Views
                            </span>

                            <span class="metric-value">
                                —
                            </span>

                            <span class="metric-subtext">
                                Real-time tracking
                            </span>
                        </div>

                        <div class="metric-icon-box">
                            📖
                        </div>
                    </div>


                    <div class="metric-card">
                        <div class="metric-info">
                            <span class="metric-label">
                                WhatsApp Clicks
                            </span>

                            <span class="metric-value">
                                —
                            </span>

                            <span class="metric-subtext">
                                Customer interactions
                            </span>
                        </div>

                        <div class="metric-icon-box">
                            💬
                        </div>
                    </div>

                </div>


                <div class="card" style="margin-top: 24px;">

                    <div class="card-header">
                        <div>
                            <h3 class="card-title">
                                Quick Overview
                            </h3>

                            <p class="card-subtitle">
                                Manage your Siranchowk Khaja Ghar website
                            </p>
                        </div>
                    </div>


                    <div class="empty-state">

                        <div class="empty-state-icon">
                            📊
                        </div>

                        <h3 class="empty-state-title">
                            Admin Dashboard Ready
                        </h3>

                        <p class="empty-state-desc">
                            Your Firebase-powered admin system is running.
                            Use the Analytics section to view real visitor,
                            page-view and interaction data.
                        </p>

                    </div>

                </div>

            </div>
        `;
    }
};

window.DashboardModule = DashboardModule;