/**
 * Public Website CMS Module
 */

const ContentModule = (() => {
    return {
        async render(container) {
            const content = await DataService.getContent();
            container.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Website Content Editor</h2>
                        <button class="btn btn-primary btn-sm" id="save-content-btn">Save Changes</button>
                    </div>
                    <form id="content-form">
                        <div class="form-group">
                            <label class="form-label">Hero Banner Headline</label>
                            <input type="text" class="form-control" id="c-hero-title" value="${Utils.escapeHTML(content.heroTitle)}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Hero Subtitle</label>
                            <textarea class="form-control" id="c-hero-sub">${Utils.escapeHTML(content.heroSub)}</textarea>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Business Story / About Text</label>
                            <textarea class="form-control" id="c-about">${Utils.escapeHTML(content.aboutText)}</textarea>
                        </div>
                    </form>
                </div>
            `;

            container.querySelector('#save-content-btn')?.addEventListener('click', async () => {
                await DataService.saveContent({
                    heroTitle: document.getElementById('c-hero-title').value,
                    heroSub: document.getElementById('c-hero-sub').value,
                    aboutText: document.getElementById('c-about').value
                });
                UIModule.showToast("Website content updated successfully", "success");
            });
        }
    };
})();