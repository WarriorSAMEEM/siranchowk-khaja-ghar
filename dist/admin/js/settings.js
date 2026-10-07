/**
 * Business Information Settings & System Audit Logs
 */

const SettingsModule = (() => {
    return {
        async render(container) {
            const settings = await DataService.getSettings();
            const logs = await DataService.getAuditLogs();

            container.innerHTML = `
                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header">
                        <h2 class="card-title">Business Information</h2>
                        <button class="btn btn-primary btn-sm" id="save-settings-btn">Save Settings</button>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Business Location</label>
                        <input type="text" class="form-control" id="set-location" value="${Utils.escapeHTML(settings.location)}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Landmark</label>
                        <input type="text" class="form-control" id="set-landmark" value="${Utils.escapeHTML(settings.landmark)}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Phone / WhatsApp</label>
                        <input type="text" class="form-control" id="set-phone" value="${Utils.escapeHTML(settings.phone)}">
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">System Audit Logs</h2>
                    </div>
                    <div class="table-responsive">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Event</th>
                                    <th>User</th>
                                    <th>Timestamp</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${logs.map(l => `
                                    <tr>
                                        <td>${Utils.escapeHTML(l.event)}</td>
                                        <td>${Utils.escapeHTML(l.user)}</td>
                                        <td>${Utils.formatDate(l.timestamp)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            container.querySelector('#save-settings-btn')?.addEventListener('click', async () => {
                await DataService.saveSettings({
                    location: document.getElementById('set-location').value,
                    landmark: document.getElementById('set-landmark').value,
                    phone: document.getElementById('set-phone').value
                });
                await DataService.logEvent("Updated Business Settings");
                UIModule.showToast("Settings saved", "success");
                this.render(container);
            });
        }
    };
})();