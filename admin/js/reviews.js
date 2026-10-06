/**
 * Reviews & Customer Feedback Moderation Module
 */

const ReviewsModule = (() => {
    return {
        async render(container) {
            const reviews = await DataService.getReviews();
            container.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Customer Reviews (${reviews.length})</h2>
                    </div>
                    ${reviews.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-state-icon">⭐</div>
                            <h3 class="empty-state-title">No Reviews Recorded</h3>
                            <p class="empty-state-desc">Public reviews submitted on the site will appear here for admin moderation.</p>
                        </div>
                    ` : ``}
                </div>
            `;
        }
    };
})();