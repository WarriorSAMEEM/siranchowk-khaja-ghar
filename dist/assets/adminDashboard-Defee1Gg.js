import{t as e}from"./firebase-Cqo9gZKS.js";import{r as t,t as n}from"./auth-D3oEsBym.js";document.addEventListener(`DOMContentLoaded`,async()=>{console.log(`======================================`),console.log(`SIRANCHOWK ADMIN DASHBOARD`),console.log(`Initializing...`),console.log(`======================================`);let r=null;try{if(console.log(`Checking Firebase authentication...`),!await n()){console.warn(`Admin is not authenticated.`);return}if(r=e.currentUser,!r){console.error(`Authentication was reported as valid, but Firebase user is unavailable.`);return}console.log(`Admin authentication verified:`,r.email)}catch(e){console.error(`Admin authentication check failed:`,e);return}if(typeof window.revealAdminApplication==`function`?window.revealAdminApplication():console.warn(`revealAdminApplication() is not available.`),typeof UIModule<`u`&&typeof UIModule.init==`function`)try{UIModule.init(),console.log(`UI module initialized.`)}catch(e){console.error(`UI initialization failed:`,e)}let i=document.getElementById(`user-display-name`),a=document.getElementById(`user-role-label`),o=document.getElementById(`user-avatar-initials`),s=r.email||`Administrator`,c=r.displayName||s.split(`@`)[0]||`Admin Manager`;i&&(i.textContent=c),a&&(a.textContent=`Siranchowk Admin`),o&&(o.textContent=c.split(/\s+/).filter(Boolean).slice(0,2).map(e=>e.charAt(0).toUpperCase()).join(``)||`AD`);let l={dashboard:typeof AnalyticsModule<`u`?AnalyticsModule:null,menu:typeof MenuModule<`u`?MenuModule:null,orders:typeof OrdersModule<`u`?OrdersModule:null,offers:typeof OffersModule<`u`?OffersModule:null,gallery:typeof GalleryModule<`u`?GalleryModule:null,reviews:typeof ReviewsModule<`u`?ReviewsModule:null,customers:typeof CustomersModule<`u`?CustomersModule:null,announcements:typeof AnnouncementsModule<`u`?AnnouncementsModule:null,content:typeof ContentModule<`u`?ContentModule:null,seo:typeof SEOModule<`u`?SEOModule:null,analytics:typeof AnalyticsModule<`u`?AnalyticsModule:null,settings:typeof SettingsModule<`u`?SettingsModule:null},u=document.getElementById(`main-content`),d=document.getElementById(`page-title-heading`),f=document.querySelectorAll(`.nav-item`);if(!u){console.error(`Admin dashboard: #main-content not found.`);return}async function p(e){let t=l[e]?e:`dashboard`,n=l[t];if(f.forEach(e=>{let n=e.dataset.view===t;e.classList.toggle(`active`,n)}),d){let e=t.charAt(0).toUpperCase()+t.slice(1);d.textContent=e}if(typeof UIModule<`u`&&typeof UIModule.closeDrawer==`function`)try{UIModule.closeDrawer()}catch(e){console.warn(`Unable to close navigation drawer:`,e)}if(n&&typeof n.render==`function`){u.innerHTML=`
                <div class="skeleton skeleton-title"></div>
                <div class="skeleton skeleton-text"></div>
            `;try{await n.render(u),console.log(`Admin view loaded: ${t}`)}catch(e){console.error(`Failed to render "${t}" view:`,e),u.innerHTML=`
                    <div class="admin-view-error">

                        <h3>
                            Unable to load this section
                        </h3>

                        <p>
                            Something went wrong while
                            loading this dashboard view.
                        </p>

                        <button
                            type="button"
                            id="retry-view-btn"
                        >
                            Try Again
                        </button>

                    </div>
                `,document.getElementById(`retry-view-btn`)?.addEventListener(`click`,()=>p(t))}return}console.warn(`Admin module "${t}" is not available.`),u.innerHTML=`
            <div class="admin-view-error">

                <h3>
                    Section unavailable
                </h3>

                <p>
                    The "${t}" module is not available.
                </p>

            </div>
        `}if(window.addEventListener(`hashchange`,()=>{p(window.location.hash.replace(`#`,``).trim()||`dashboard`)}),f.forEach(e=>{e.addEventListener(`click`,t=>{let n=e.dataset.view;if(!n)return;t.preventDefault();let r=`#${n}`;window.location.hash===r?p(n):window.location.hash=r})}),document.getElementById(`quick-refresh-btn`)?.addEventListener(`click`,async()=>{let e=window.location.hash.replace(`#`,``).trim()||`dashboard`;try{await p(e),typeof UIModule<`u`&&typeof UIModule.showToast==`function`&&UIModule.showToast(`View refreshed`,`info`)}catch(e){console.error(`View refresh failed:`,e)}}),document.getElementById(`logout-btn`)?.addEventListener(`click`,async()=>{if(window.confirm(`Sign out of Siranchowk Khaja Ghar Admin?`))try{console.log(`Signing out admin...`),await t(),console.log(`Admin logout successful.`)}catch(e){console.error(`Admin logout failed:`,e),typeof UIModule<`u`&&typeof UIModule.showToast==`function`&&UIModule.showToast(`Unable to sign out. Please try again.`,`error`)}}),await p(window.location.hash.replace(`#`,``).trim()||`dashboard`),u)try{u.focus({preventScroll:!0})}catch{try{u.focus()}catch{}}console.log(`======================================`),console.log(`ADMIN DASHBOARD READY`),console.log(`Logged in as:`,r.email),console.log(`======================================`)});