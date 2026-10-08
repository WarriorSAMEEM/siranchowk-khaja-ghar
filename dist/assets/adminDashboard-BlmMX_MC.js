import{d as e,l as t,n,t as r}from"./firebase-Cqo9gZKS.js";import"./analytics-tracker-CgUk-Y-P.js";import{r as i,t as a}from"./auth-D3oEsBym.js";var o=(()=>{function r(e){return String(e??``).replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#039;`)}function i(e){return Number(e||0).toLocaleString()}function a(e){let t=new Date(e);return Number.isNaN(t.getTime())?null:t}function o(e){let t=a(e);if(!t)return!1;let n=new Date;return t.getFullYear()===n.getFullYear()&&t.getMonth()===n.getMonth()&&t.getDate()===n.getDate()}function s(e,t){let n=a(e);if(!n)return!1;let r=Date.now()-n.getTime();return r>=0&&r<=t*24*60*60*1e3}function c(e){let t=a(e);return t?t.toLocaleString(void 0,{dateStyle:`medium`,timeStyle:`short`}):`Unknown`}async function l(){let r=e(n,`analytics/events`),i=await t(r);if(!i.exists())return[];let a=i.val();return Object.entries(a).map(([e,t])=>({id:e,...t||{}}))}function u(e){let t=e.filter(e=>e.eventType===`page_view`),n=new Set;t.forEach(e=>{e.sessionId&&n.add(e.sessionId)});let r=t.filter(e=>o(e.timestamp)),i=t.filter(e=>s(e.timestamp,7)),a=t.filter(e=>s(e.timestamp,30)),c=t.filter(e=>e.page===`/menu.html`||e.page===`/menu`),l=e.filter(e=>e.eventType===`whatsapp_click`||e.eventType===`whatsapp`);return{totalViews:t.length,uniqueVisitors:n.size,today:r.length,last7Days:i.length,last30Days:a.length,menuViews:c.length,whatsappClicks:l.length}}function d(e){let t={};return e.filter(e=>e.eventType===`page_view`).forEach(e=>{let n=e.page||`/`;t[n]=(t[n]||0)+1}),Object.entries(t).sort((e,t)=>t[1]-e[1]).slice(0,8)}function f(e){let t={};return e.filter(e=>e.eventType===`page_view`).forEach(e=>{let n=e.device||`Unknown`;t[n]=(t[n]||0)+1}),Object.entries(t).sort((e,t)=>t[1]-e[1])}function p(e){let t={};return e.filter(e=>e.eventType===`page_view`).forEach(e=>{let n=e.browser||`Unknown`;t[n]=(t[n]||0)+1}),Object.entries(t).sort((e,t)=>t[1]-e[1])}function m(e){return[...e].sort((e,t)=>{let n=a(e.timestamp);return(a(t.timestamp)?.getTime()||0)-(n?.getTime()||0)}).slice(0,10)}function h(){return`

            <div class="card">

                <div class="card-header">

                    <div>

                        <h2 class="card-title">
                            Visitor Analytics
                        </h2>

                        <p class="card-subtitle">
                            Real visitor activity from Firebase
                        </p>

                    </div>

                    <span class="badge badge-info">
                        Live Data
                    </span>

                </div>


                <div class="empty-state">

                    <div class="empty-state-icon">
                        📊
                    </div>

                    <h3 class="empty-state-title">
                        No Visitor Data Yet
                    </h3>

                    <p class="empty-state-desc">
                        Visitor analytics will appear here
                        automatically when people visit your
                        website.
                    </p>

                </div>

            </div>

        `}function g(e,t,n,a){return`

            <div class="metric-card">

                <div class="metric-info">

                    <span class="metric-label">
                        ${r(e)}
                    </span>

                    <span class="metric-value">
                        ${i(t)}
                    </span>

                    <span class="metric-subtext">
                        ${r(n)}
                    </span>

                </div>

                <div class="metric-icon-box">
                    ${a}
                </div>

            </div>

        `}function _(e,t){return e.length?e.map(([e,t])=>`

                    <div class="analytics-list-row">

                        <span class="analytics-list-name">
                            ${r(e)}
                        </span>

                        <strong class="analytics-list-value">
                            ${i(t)}
                        </strong>

                    </div>

                `).join(``):`

                <div class="analytics-empty-small">
                    ${r(t)}
                </div>

            `}async function v(e){if(e){e.innerHTML=`

            <div class="card">

                <div class="card-header">

                    <div>

                        <h2 class="card-title">
                            Visitor Analytics
                        </h2>

                        <p class="card-subtitle">
                            Loading real visitor data...
                        </p>

                    </div>

                    <span class="badge badge-info">
                        Loading
                    </span>

                </div>


                <div class="analytics-loading">

                    <div class="skeleton skeleton-title"></div>

                    <div class="skeleton skeleton-text"></div>

                    <div class="skeleton skeleton-text"></div>

                </div>

            </div>

        `;try{let t=await l();if(!t.length){e.innerHTML=h();return}let n=u(t),a=d(t),o=f(t),s=p(t),y=m(t);e.innerHTML=`

                <div class="analytics-page">


                    <!-- HEADER -->

                    <div class="card analytics-header-card">

                        <div class="card-header">

                            <div>

                                <h2 class="card-title">
                                    Visitor Analytics
                                </h2>

                                <p class="card-subtitle">
                                    Real-time website activity
                                    collected from Firebase
                                </p>

                            </div>

                            <button
                                type="button"
                                class="btn btn-secondary"
                                id="analytics-refresh"
                            >
                                ↻ Refresh
                            </button>

                        </div>

                    </div>


                    <!-- METRICS -->

                    <div class="metrics-grid">

                        ${g(`Unique Visitors`,n.uniqueVisitors,`Unique sessions`,`👥`)}

                        ${g(`Page Views`,n.totalViews,`All tracked views`,`📊`)}

                        ${g(`Today`,n.today,`Views today`,`📅`)}

                        ${g(`Last 7 Days`,n.last7Days,`Recent page views`,`📈`)}

                        ${g(`Menu Views`,n.menuViews,`Menu page views`,`📖`)}

                        ${g(`WhatsApp Clicks`,n.whatsappClicks,`Tracked interactions`,`💬`)}

                    </div>


                    <!-- OVERVIEW -->

                    <div class="analytics-grid">


                        <!-- TOP PAGES -->

                        <div class="card">

                            <div class="card-header">

                                <div>

                                    <h3 class="card-title">
                                        Top Pages
                                    </h3>

                                    <p class="card-subtitle">
                                        Most viewed pages
                                    </p>

                                </div>

                            </div>


                            <div class="analytics-list">

                                ${_(a,`No page views recorded yet.`)}

                            </div>

                        </div>


                        <!-- DEVICES -->

                        <div class="card">

                            <div class="card-header">

                                <div>

                                    <h3 class="card-title">
                                        Devices
                                    </h3>

                                    <p class="card-subtitle">
                                        Visitor device types
                                    </p>

                                </div>

                            </div>


                            <div class="analytics-list">

                                ${_(o,`No device data available.`)}

                            </div>

                        </div>


                        <!-- BROWSERS -->

                        <div class="card">

                            <div class="card-header">

                                <div>

                                    <h3 class="card-title">
                                        Browsers
                                    </h3>

                                    <p class="card-subtitle">
                                        Visitor browsers
                                    </p>

                                </div>

                            </div>


                            <div class="analytics-list">

                                ${_(s,`No browser data available.`)}

                            </div>

                        </div>


                        <!-- PERIOD -->

                        <div class="card">

                            <div class="card-header">

                                <div>

                                    <h3 class="card-title">
                                        Traffic Summary
                                    </h3>

                                    <p class="card-subtitle">
                                        Visitor activity periods
                                    </p>

                                </div>

                            </div>


                            <div class="analytics-summary">

                                <div class="analytics-summary-row">

                                    <span>
                                        Today
                                    </span>

                                    <strong>
                                        ${i(n.today)}
                                    </strong>

                                </div>


                                <div class="analytics-summary-row">

                                    <span>
                                        Last 7 Days
                                    </span>

                                    <strong>
                                        ${i(n.last7Days)}
                                    </strong>

                                </div>


                                <div class="analytics-summary-row">

                                    <span>
                                        Last 30 Days
                                    </span>

                                    <strong>
                                        ${i(n.last30Days)}
                                    </strong>

                                </div>

                            </div>

                        </div>

                    </div>


                    <!-- RECENT ACTIVITY -->

                    <div class="card">

                        <div class="card-header">

                            <div>

                                <h3 class="card-title">
                                    Recent Activity
                                </h3>

                                <p class="card-subtitle">
                                    Latest visitor events
                                </p>

                            </div>

                        </div>


                        <div class="analytics-activity-list">

                            ${y.map(e=>`

                                            <div
                                                class="analytics-activity-row"
                                            >

                                                <div>

                                                    <strong>
                                                        ${r(e.eventType||`event`)}
                                                    </strong>

                                                    <span>
                                                        ${r(e.page||`Unknown page`)}
                                                    </span>

                                                </div>

                                                <time>
                                                    ${r(c(e.timestamp))}
                                                </time>

                                            </div>

                                        `).join(``)}

                        </div>

                    </div>


                </div>

            `,document.getElementById(`analytics-refresh`)?.addEventListener(`click`,()=>{v(e)})}catch(t){console.error(`Analytics loading failed:`,t),e.innerHTML=`

                <div class="card">

                    <div class="card-header">

                        <div>

                            <h2 class="card-title">
                                Visitor Analytics
                            </h2>

                            <p class="card-subtitle">
                                Unable to load Firebase analytics.
                            </p>

                        </div>

                        <span class="badge badge-error">
                            Error
                        </span>

                    </div>


                    <div class="empty-state">

                        <div class="empty-state-icon">
                            ⚠️
                        </div>

                        <h3 class="empty-state-title">
                            Analytics Could Not Be Loaded
                        </h3>

                        <p class="empty-state-desc">
                            Check Firebase Realtime Database
                            permissions and try again.
                        </p>

                        <button
                            type="button"
                            class="btn btn-secondary"
                            id="analytics-retry"
                        >
                            Try Again
                        </button>

                    </div>

                </div>

            `,document.getElementById(`analytics-retry`)?.addEventListener(`click`,()=>{v(e)})}}}return{render:v}})();window.AnalyticsModule=o,document.addEventListener(`DOMContentLoaded`,async()=>{console.log(`======================================`),console.log(`SIRANCHOWK ADMIN DASHBOARD`),console.log(`Initializing...`),console.log(`======================================`);let e=null;try{if(console.log(`Checking Firebase authentication...`),!await a()){console.warn(`Admin is not authenticated.`);return}if(e=r.currentUser,!e){console.error(`Authentication was valid, but Firebase user is unavailable.`);return}console.log(`Admin authentication verified:`,e.email)}catch(e){console.error(`Admin authentication check failed:`,e);return}if(typeof window.revealAdminApplication==`function`&&window.revealAdminApplication(),typeof UIModule<`u`&&typeof UIModule.init==`function`)try{UIModule.init(),console.log(`UI module initialized.`)}catch(e){console.error(`UI initialization failed:`,e)}let t=document.getElementById(`user-display-name`),n=document.getElementById(`user-role-label`),s=document.getElementById(`user-avatar-initials`),c=e.email||`Administrator`,l=e.displayName||c.split(`@`)[0]||`Admin Manager`;t&&(t.textContent=l),n&&(n.textContent=`Siranchowk Admin`),s&&(s.textContent=l.split(/\s+/).filter(Boolean).slice(0,2).map(function(e){return e.charAt(0).toUpperCase()}).join(``)||`AD`);let u={dashboard:typeof DashboardModule<`u`?DashboardModule:null,menu:typeof MenuModule<`u`?MenuModule:null,orders:typeof OrdersModule<`u`?OrdersModule:null,offers:typeof OffersModule<`u`?OffersModule:null,gallery:typeof GalleryModule<`u`?GalleryModule:null,reviews:typeof ReviewsModule<`u`?ReviewsModule:null,customers:typeof CustomersModule<`u`?CustomersModule:null,announcements:typeof AnnouncementsModule<`u`?AnnouncementsModule:null,content:typeof ContentModule<`u`?ContentModule:null,seo:typeof SEOModule<`u`?SEOModule:null,analytics:o,settings:typeof SettingsModule<`u`?SettingsModule:null};console.log(`Admin modules:`,{DashboardModule:typeof DashboardModule<`u`,AnalyticsModule:o!==void 0,MenuModule:typeof MenuModule<`u`,OrdersModule:typeof OrdersModule<`u`,OffersModule:typeof OffersModule<`u`,GalleryModule:typeof GalleryModule<`u`,ReviewsModule:typeof ReviewsModule<`u`,CustomersModule:typeof CustomersModule<`u`,AnnouncementsModule:typeof AnnouncementsModule<`u`,ContentModule:typeof ContentModule<`u`,SEOModule:typeof SEOModule<`u`,SettingsModule:typeof SettingsModule<`u`});let d=document.getElementById(`main-content`),f=document.getElementById(`page-title-heading`),p=document.querySelectorAll(`.nav-item`);if(!d){console.error(`Admin dashboard: #main-content not found.`);return}async function m(e){let t=String(e||``).trim().toLowerCase(),n=u[t]?t:`dashboard`,r=u[n];if(p.forEach(function(e){let t=e.dataset.view===n;e.classList.toggle(`active`,t)}),f){let e=n.charAt(0).toUpperCase()+n.slice(1);f.textContent=e}if(typeof UIModule<`u`&&typeof UIModule.closeDrawer==`function`)try{UIModule.closeDrawer()}catch(e){console.warn(`Unable to close navigation drawer:`,e)}if(r&&typeof r.render==`function`){d.innerHTML=`<div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div>`;try{await r.render(d),console.log(`Admin view loaded:`,n)}catch(e){console.error(`Failed to render view:`,n,e),d.innerHTML=`<div class="admin-view-error"><h3>Unable to load this section</h3><p>Something went wrong while loading this dashboard view.</p><button type="button" id="retry-view-btn">Try Again</button></div>`;let t=document.getElementById(`retry-view-btn`);t&&t.addEventListener(`click`,function(){m(n)})}return}console.warn(`Admin module "`+n+`" is not available.`),d.innerHTML=`<div class="admin-view-error"><h3>Section unavailable</h3><p>The "`+n+`" module is not available.</p><button type="button" id="retry-module-btn">Retry</button></div>`;let i=document.getElementById(`retry-module-btn`);i&&i.addEventListener(`click`,function(){m(n)})}window.addEventListener(`hashchange`,function(){m(window.location.hash.replace(`#`,``).trim().toLowerCase()||`dashboard`)}),p.forEach(function(e){e.addEventListener(`click`,function(t){let n=e.dataset.view;if(!n)return;t.preventDefault();let r=`#`+n;window.location.hash===r?m(n):window.location.hash=r})});let h=document.getElementById(`quick-refresh-btn`);h&&h.addEventListener(`click`,async function(){let e=window.location.hash.replace(`#`,``).trim().toLowerCase()||`dashboard`;try{await m(e),typeof UIModule<`u`&&typeof UIModule.showToast==`function`&&UIModule.showToast(`View refreshed`,`info`)}catch(e){console.error(`View refresh failed:`,e)}});let g=document.getElementById(`logout-btn`);g&&g.addEventListener(`click`,async function(){if(window.confirm(`Sign out of Siranchowk Khaja Ghar Admin?`))try{console.log(`Signing out admin...`),await i(),console.log(`Admin logout successful.`)}catch(e){console.error(`Admin logout failed:`,e),typeof UIModule<`u`&&typeof UIModule.showToast==`function`&&UIModule.showToast(`Unable to sign out. Please try again.`,`error`)}}),await m(window.location.hash.replace(`#`,``).trim().toLowerCase()||`dashboard`);try{d.focus({preventScroll:!0})}catch{try{d.focus()}catch{}}console.log(`======================================`),console.log(`ADMIN DASHBOARD READY`),console.log(`Logged in as:`,e.email),console.log(`======================================`)});