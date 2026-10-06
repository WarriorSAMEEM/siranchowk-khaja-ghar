/**
 * Website Banner Announcements Module
 */

const AnnouncementsModule = (() => {
    return {
        async render(container) {
            const list = await DataService.getAnnouncements();
            container.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Broadcast Announcements (${list.length})</h2>
                    </div>
                    ${list.map(a => `
                        <div style="padding: 0.85rem; border-bottom: 1px solid var(--border-color)">
                            <strong>${Utils.escapeHTML(a.title)}</strong>
                            <p style="font-size: 0.825rem; color: var(--text-muted)">${Utils.escapeHTML(a.message)}</p>
                        </div>
                    `).join('')}
                </div>
            `;
        }
    };
})();