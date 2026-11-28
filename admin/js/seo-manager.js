// ============================================================================
// SIRANCHOWK KHAJA GHAR — SEO, CATEGORIES, REDIRECTS & CONTENT ANALYTICS MODULE
// ============================================================================

import { db, ref, get, set, update, remove } from "../../js/firebase.js";
import { getAdminSession, hasPermission } from "./auth.js";
import { PLATFORM_CATEGORIES, SITE_ORIGIN, slugifyUnicode } from "../../js/platform-core.js";
import { logAuditEvent } from "../../js/audit-logger.js";
import { UIModule } from "./ui.js";
import { Utils } from "./utils.js";

export const SeoManagerModule = {
    async render(container) {
        const session = getAdminSession();
        const canSeo = hasPermission("manageSeo");
        const canAnalytics = hasPermission("viewContentAnalytics");

        if (!canSeo && !canAnalytics) {
            container.innerHTML = '<section class="card"><h2 class="card-title">Access Restricted</h2><p class="card-subtitle">SEO &amp; Content Analytics permissions are required.</p></section>';
            return;
        }

        container.innerHTML = '<div class="skg-admin-loading">Loading SEO settings, categories &amp; redirects…</div>';

        const [catSnap, seoSnap, redirSnap, artSnap] = await Promise.all([
            get(ref(db, "platformCategories")).catch(() => null),
            get(ref(db, "seoSettings")).catch(() => null),
            get(ref(db, "slugRedirects")).catch(() => null),
            get(ref(db, "publishedArticles")).catch(() => null)
        ]);

        const categoryMap = {};
        PLATFORM_CATEGORIES.forEach((c) => {
            categoryMap[c.slug] = { ...c, active: true };
        });
        if (catSnap?.exists()) {
            Object.entries(catSnap.val() || {}).forEach(([slug, c]) => {
                if (c) {
                    const isActive = c.active !== false && c.enabled !== false;
                    categoryMap[slug] = { ...(categoryMap[slug] || {}), ...c, slug, active: isActive, enabled: isActive };
                }
            });
        }
        let categories = Object.values(categoryMap);

        const seoSettings = {
            siteTitle: "Siranchowk Khaja Ghar — Stories, Guides & Community",
            siteDescription: "Halal food guides, Nepali community stories, tech & education resources from Siranchowk Khaja Ghar in Khairahani-6, Parsa, Chitwan.",
            defaultOgImage: "https://i.postimg.cc/13M0GD3L/heropage.jpg",
            indexingEnabled: true,
            autoSitemap: true,
            ...(seoSnap?.exists() ? seoSnap.val() : {})
        };

        let redirects = redirSnap?.exists()
            ? Object.entries(redirSnap.val() || {}).map(([oldSlug, item]) => ({ oldSlug, ...(item || {}) }))
            : [];
        redirects.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

        const articles = artSnap?.exists()
            ? Object.entries(artSnap.val() || {}).map(([id, a]) => ({ id, ...(a || {}) }))
            : [];
        articles.sort((a, b) => Number(b.viewsCount || 0) - Number(a.viewsCount || 0));

        const state = {
            tab: canSeo ? "seo" : "analytics"
        };

        const draw = () => {
            const totalViews = articles.reduce((sum, a) => sum + Number(a.viewsCount || 0), 0);
            const totalLikes = articles.reduce((sum, a) => sum + Number(a.likesCount || 0), 0);
            const totalComments = articles.reduce((sum, a) => sum + Number(a.commentsCount || 0), 0);

            container.innerHTML = `
              <div class="analytics-page">
                <section class="card">
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">SEO, Global Categories &amp; Redirects</h2>
                      <p class="card-subtitle">Configure platform metadata defaults, bilingual topics, 301 slug redirects, sitemap/robots verification, and aggregated article performance.</p>
                    </div>
                  </div>

                  <div class="skg-tabs" role="tablist">
                    ${canSeo ? `<button type="button" class="skg-tab ${state.tab === "seo" ? "active" : ""}" data-seo-tab="seo">SEO &amp; Sitemap Policy</button>` : ""}
                    ${canSeo ? `<button type="button" class="skg-tab ${state.tab === "categories" ? "active" : ""}" data-seo-tab="categories">Global Categories (${categories.length})</button>` : ""}
                    ${canSeo ? `<button type="button" class="skg-tab ${state.tab === "redirects" ? "active" : ""}" data-seo-tab="redirects">301 Slug Redirects (${redirects.length})</button>` : ""}
                    ${canAnalytics ? `<button type="button" class="skg-tab ${state.tab === "analytics" ? "active" : ""}" data-seo-tab="analytics">Content Performance (${articles.length})</button>` : ""}
                  </div>

                  ${state.tab === "seo" && canSeo ? `
                    <div class="skg-channel-note" style="margin-bottom:14px;">
                      <strong>Indexability &amp; Google Search Console Honesty Notice:</strong>
                      Public pages (<code>/</code>, <code>/menu.html</code>, <code>/explore</code>, <code>/blog</code>, <code>/blog/:slug</code>, <code>/category/:slug</code>, <code>/user/:username</code>) output canonical URLs, OpenGraph, Twitter Cards, and Schema.org JSON-LD. Private routes (<code>/creator/studio</code>, <code>/admin/*</code>, <code>/account.html</code>) emit <code>noindex, nofollow</code>. Search Console API is not connected here, so search impressions/clicks are never fabricated.
                    </div>
                    <div class="skg-quick-actions" style="margin-bottom:16px;">
                      <a href="/sitemap.xml" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">Inspect /sitemap.xml ↗</a>
                      <a href="/robots.txt" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">Inspect /robots.txt ↗</a>
                    </div>
                    <form id="skg-seo-settings-form" class="skg-stack-form">
                      <div class="form-group">
                        <label class="form-label" for="seo-site-title">Default Platform Title</label>
                        <input class="form-control" id="seo-site-title" type="text" maxlength="120" value="${Utils.escapeHTML(seoSettings.siteTitle)}">
                      </div>
                      <div class="form-group">
                        <label class="form-label" for="seo-site-desc">Default Meta Description</label>
                        <textarea class="form-control" id="seo-site-desc" maxlength="240">${Utils.escapeHTML(seoSettings.siteDescription)}</textarea>
                      </div>
                      <div class="form-group">
                        <label class="form-label" for="seo-og-image">Default Social Share Image URL</label>
                        <input class="form-control" id="seo-og-image" type="url" value="${Utils.escapeHTML(seoSettings.defaultOgImage)}">
                      </div>
                      <label class="skg-checkbox-inline">
                        <input type="checkbox" id="seo-indexing-enabled" ${seoSettings.indexingEnabled !== false ? "checked" : ""}>
                        <span>Allow search engine indexing for public articles &amp; profiles</span>
                      </label>
                      <label class="skg-checkbox-inline">
                        <input type="checkbox" id="seo-auto-sitemap" ${seoSettings.autoSitemap !== false ? "checked" : ""}>
                        <span>Automatically include newly published public articles &amp; profiles in <code>/sitemap.xml</code></span>
                      </label>
                      <div>
                        <button type="submit" class="btn btn-primary" id="skg-save-seo-btn">Save SEO Settings</button>
                      </div>
                    </form>
                  ` : ""}

                  ${state.tab === "categories" && canSeo ? `
                    <form id="skg-add-cat-form" class="skg-stack-form" style="margin-bottom:18px;">
                      <div class="skg-modal-row">
                        <div class="form-group">
                          <label class="form-label" for="cat-name">Category Name (English) *</label>
                          <input class="form-control" id="cat-name" type="text" required placeholder="e.g., Local Agriculture">
                        </div>
                        <div class="form-group">
                          <label class="form-label" for="cat-nepali">Nepali Label</label>
                          <input class="form-control" id="cat-nepali" type="text" placeholder="e.g., स्थानीय कृषि">
                        </div>
                      </div>
                      <div class="skg-modal-row">
                        <div class="form-group">
                          <label class="form-label" for="cat-slug">Slug (auto-generated if blank)</label>
                          <input class="form-control" id="cat-slug" type="text" placeholder="local-agriculture">
                        </div>
                        <div class="form-group">
                          <label class="form-label" for="cat-desc">Description</label>
                          <input class="form-control" id="cat-desc" type="text" maxlength="200" placeholder="Short SEO topic description">
                        </div>
                      </div>
                      <div><button type="submit" class="btn btn-primary">Save Category</button></div>
                    </form>

                    <div class="table-responsive">
                      <table class="data-table">
                        <thead><tr><th>Category</th><th>Slug</th><th>Description</th><th>Status</th></tr></thead>
                        <tbody>
                          ${categories.map((c) => `
                            <tr>
                              <td><strong>${Utils.escapeHTML(c.name)}</strong><div class="form-hint">${Utils.escapeHTML(c.nepali || "")}</div></td>
                              <td><code>/category/${Utils.escapeHTML(c.slug)}</code></td>
                              <td>${Utils.escapeHTML(c.description || "—")}</td>
                              <td>
                                <button type="button" class="btn btn-sm ${c.active !== false ? "btn-primary" : "btn-secondary"}" data-toggle-cat="${Utils.escapeHTML(c.slug)}">
                                  ${c.active !== false ? "Active" : "Hidden"}
                                </button>
                              </td>
                            </tr>
                          `).join("")}
                        </tbody>
                      </table>
                    </div>
                  ` : ""}

                  ${state.tab === "redirects" && canSeo ? `
                    <form id="skg-add-redirect-form" class="skg-stack-form" style="margin-bottom:18px;">
                      <div class="skg-modal-row">
                        <div class="form-group">
                          <label class="form-label" for="redir-old">Old Slug *</label>
                          <input class="form-control" id="redir-old" type="text" required placeholder="old-article-slug">
                        </div>
                        <div class="form-group">
                          <label class="form-label" for="redir-new">Target Current Slug *</label>
                          <input class="form-control" id="redir-new" type="text" required placeholder="current-article-slug">
                        </div>
                      </div>
                      <div><button type="submit" class="btn btn-primary">Add 301 Redirect</button></div>
                    </form>

                    ${redirects.length === 0 ? `<p class="form-hint">No slug redirects configured yet. When a creator changes an article slug, an automatic 301 redirect entry is added here.</p>` : `
                      <div class="table-responsive">
                        <table class="data-table">
                          <thead><tr><th>Old Slug</th><th>Redirects To (301)</th><th>Action</th></tr></thead>
                          <tbody>
                            ${redirects.map((r) => `
                              <tr>
                                <td><code>/blog/${Utils.escapeHTML(r.oldSlug)}</code></td>
                                <td><code>/blog/${Utils.escapeHTML(r.targetSlug || r.toSlug || "")}</code></td>
                                <td><button type="button" class="btn btn-sm btn-danger" data-del-redir="${Utils.escapeHTML(r.oldSlug)}">Remove</button></td>
                              </tr>
                            `).join("")}
                          </tbody>
                        </table>
                      </div>
                    `}
                  ` : ""}

                  ${state.tab === "analytics" && canAnalytics ? `
                    <div class="skg-kpi-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;margin-bottom:1.25rem;">
                      <div class="card" style="padding:1rem;"><strong>${articles.length}</strong><div class="form-hint">Live Published Articles</div></div>
                      <div class="card" style="padding:1rem;"><strong>${totalViews}</strong><div class="form-hint">Recorded Views</div></div>
                      <div class="card" style="padding:1rem;"><strong>${totalLikes}</strong><div class="form-hint">Recorded Likes</div></div>
                      <div class="card" style="padding:1rem;"><strong>${totalComments}</strong><div class="form-hint">Recorded Comments</div></div>
                    </div>
                    <div class="table-responsive">
                      <table class="data-table">
                        <thead><tr><th>Title</th><th>Category</th><th>Author</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th></tr></thead>
                        <tbody>
                          ${articles.map((a) => `
                            <tr>
                              <td><strong>${Utils.escapeHTML(a.title)}</strong><div class="form-hint"><a href="${Utils.escapeHTML(`${SITE_ORIGIN}/blog/${encodeURIComponent(a.slug)}`)}" target="_blank" rel="noopener noreferrer">/blog/${Utils.escapeHTML(a.slug)}</a></div></td>
                              <td><code>${Utils.escapeHTML(a.category || "food")}</code></td>
                              <td>${Utils.escapeHTML(a.authorName || a.authorUsername)}</td>
                              <td>${Number(a.viewsCount || 0)}</td>
                              <td>${Number(a.likesCount || 0)}</td>
                              <td>${Number(a.commentsCount || 0)}</td>
                              <td>${Number(a.sharesCount || 0)}</td>
                            </tr>
                          `).join("")}
                        </tbody>
                      </table>
                    </div>
                  ` : ""}
                </section>
              </div>
            `;

            container.querySelectorAll("[data-seo-tab]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    state.tab = btn.dataset.seoTab;
                    draw();
                });
            });

            container.querySelector("#skg-seo-settings-form")?.addEventListener("submit", async (e) => {
                e.preventDefault();
                const btn = container.querySelector("#skg-save-seo-btn");
                if (btn) btn.disabled = true;
                const payload = {
                    siteTitle: container.querySelector("#seo-site-title")?.value.trim() || seoSettings.siteTitle,
                    siteDescription: container.querySelector("#seo-site-desc")?.value.trim() || seoSettings.siteDescription,
                    defaultOgImage: container.querySelector("#seo-og-image")?.value.trim() || seoSettings.defaultOgImage,
                    indexingEnabled: Boolean(container.querySelector("#seo-indexing-enabled")?.checked),
                    autoSitemap: Boolean(container.querySelector("#seo-auto-sitemap")?.checked),
                    updatedAt: Date.now(),
                    updatedByUid: session?.user?.uid || ""
                };
                try {
                    await update(ref(db, "seoSettings"), payload);
                    Object.assign(seoSettings, payload);
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: "seo_settings_updated",
                        target: "seoSettings"
                    });
                    UIModule.showToast("SEO settings saved.", "success");
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not save SEO settings.", "error");
                } finally {
                    if (btn) btn.disabled = false;
                }
            });

            container.querySelector("#skg-add-cat-form")?.addEventListener("submit", async (e) => {
                e.preventDefault();
                const name = container.querySelector("#cat-name")?.value.trim();
                const nepali = container.querySelector("#cat-nepali")?.value.trim() || "";
                const rawSlug = container.querySelector("#cat-slug")?.value.trim() || name;
                const description = container.querySelector("#cat-desc")?.value.trim() || "";
                const slug = slugifyUnicode(rawSlug, 48);
                if (!name || !slug) {
                    UIModule.showToast("Provide a valid category name.", "error");
                    return;
                }
                try {
                    const entry = { slug, name, nepali, description, active: true, enabled: true, updatedAt: Date.now() };
                    await set(ref(db, `platformCategories/${slug}`), entry);
                    categoryMap[slug] = entry;
                    categories = Object.values(categoryMap);
                    await logAuditEvent({
                        actorUid: session?.user?.uid,
                        actorEmail: session?.user?.email,
                        actorRole: session?.role,
                        action: "platform_category_saved",
                        target: slug
                    });
                    UIModule.showToast(`Category "${name}" saved.`, "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Failed to save category.", "error");
                }
            });

            container.querySelectorAll("[data-toggle-cat]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const slug = btn.dataset.toggleCat;
                    const cat = categoryMap[slug];
                    if (!cat) return;
                    const nextActive = cat.active === false || cat.enabled === false;
                    try {
                        await set(ref(db, `platformCategories/${slug}`), {
                            ...cat,
                            active: nextActive,
                            enabled: nextActive,
                            updatedAt: Date.now()
                        });
                        cat.active = nextActive;
                        cat.enabled = nextActive;
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Could not toggle category.", "error");
                    }
                });
            });

            container.querySelector("#skg-add-redirect-form")?.addEventListener("submit", async (e) => {
                e.preventDefault();
                const oldSlug = slugifyUnicode(container.querySelector("#redir-old")?.value.trim(), 96);
                const toSlug = slugifyUnicode(container.querySelector("#redir-new")?.value.trim(), 96);
                if (!oldSlug || !toSlug || oldSlug === toSlug) {
                    UIModule.showToast("Provide two distinct valid slugs.", "error");
                    return;
                }
                try {
                    const rec = {
                        oldSlug,
                        targetSlug: toSlug,
                        toSlug,
                        updatedAt: Date.now(),
                        authorUid: session?.user?.uid || ""
                    };
                    await set(ref(db, `slugRedirects/${oldSlug}`), rec);
                    redirects = [rec, ...redirects.filter((r) => r.oldSlug !== oldSlug)];
                    UIModule.showToast(`301 redirect /blog/${oldSlug} -> /blog/${toSlug} saved.`, "success");
                    draw();
                } catch (err) {
                    UIModule.showToast(err?.message || "Could not save redirect.", "error");
                }
            });

            container.querySelectorAll("[data-del-redir]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const oldSlug = btn.dataset.delRedir;
                    try {
                        await remove(ref(db, `slugRedirects/${oldSlug}`));
                        redirects = redirects.filter((r) => r.oldSlug !== oldSlug);
                        draw();
                    } catch (err) {
                        UIModule.showToast(err?.message || "Could not delete redirect.", "error");
                    }
                });
            });
        };

        draw();
    }
};
