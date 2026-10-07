/**
 * Gallery Management Module
 * Architecture ready for Firebase Storage uploads.
 */

const GalleryModule = (() => {
    return {
        async render(container) {
            const items = await DataService.getGallery();
            container.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Photo Gallery (${items.length})</h2>
                        <button class="btn btn-primary btn-sm" id="upload-gallery-btn">Upload Image</button>
                    </div>
                    ${items.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-state-icon">🖼️</div>
                            <h3 class="empty-state-title">No Gallery Photos</h3>
                            <p class="empty-state-desc">Upload photos of your prepared khaja sets, restaurant ambiance, and kitchen.</p>
                        </div>
                    ` : ``}
                </div>
            `;
        }
    };
})();