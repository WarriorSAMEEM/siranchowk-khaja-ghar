/**
 * SEO & Meta Tags Settings Module
 */

const SEOModule = (() => {
    return {
        async render(container) {
            const seo = await DataService.getSEO();
            container.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">SEO & Metadata Configuration</h2>
                        <button class="btn btn-primary btn-sm" id="save-seo-btn">Save Meta Tags</button>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Meta Title</label>
                        <input type="text" class="form-control" id="seo-title" value="${Utils.escapeHTML(seo.metaTitle)}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Meta Description</label>
                        <textarea class="form-control" id="seo-desc">${Utils.escapeHTML(seo.metaDesc)}</textarea>
                    </div>
                </div>
            `;

            container.querySelector('#save-seo-btn')?.addEventListener('click', async () => {
                await DataService.saveSEO({
                    metaTitle: document.getElementById('seo-title').value,
                    metaDesc: document.getElementById('seo-desc').value
                });
                UIModule.showToast("SEO settings updated", "success");
            });
        }
    };
})();