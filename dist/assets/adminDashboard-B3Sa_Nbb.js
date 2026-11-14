import{f as e,m as t,n,t as r,u as i}from"./firebase-hDDeNwgu.js";import{r as a,t as o}from"./auth-UFB-DEeW.js";window.ADMIN_CONFIG=Object.freeze({business:{name:`Siranchowk Khaja Ghar`,location:`Khairahani-6, Parsa, Chitwan, Nepal`,landmark:`Behind Chaudhary Medical`,roadDirection:`Road toward Mal Potke`,phone:`9821233154`,whatsapp:`9779821233154`,currency:`NPR`,currencySymbol:`Rs.`,timezone:`Asia/Kathmandu`}}),window.Utils={escapeHTML(e){return e?String(e).replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#039;`):``},formatCurrency(e){let t=parseFloat(e)||0;return`${window.ADMIN_CONFIG.business.currencySymbol} ${t.toLocaleString(`en-IN`)}`},formatDate(e){if(!e)return`N/A`;let t=new Date(e);return isNaN(t.getTime())?e:t.toLocaleDateString(`en-US`,{year:`numeric`,month:`short`,day:`numeric`,hour:`2-digit`,minute:`2-digit`})},generateId(e=`id`){return`${e}_${Date.now()}_${Math.random().toString(36).substr(2,5)}`},debounce(e,t=250){let n;return(...r)=>{clearTimeout(n),n=setTimeout(()=>e.apply(this,r),t)}}};var s=(()=>{let e=document.getElementById(`app-modal`),t=document.getElementById(`toast-container`);return{init(){this.bindEvents(),this.startLiveClock()},bindEvents(){document.getElementById(`modal-close-btn`)?.addEventListener(`click`,()=>this.closeModal()),document.getElementById(`open-drawer-btn`)?.addEventListener(`click`,()=>this.openDrawer()),document.getElementById(`close-drawer-btn`)?.addEventListener(`click`,()=>this.closeDrawer()),document.getElementById(`drawer-backdrop`)?.addEventListener(`click`,()=>this.closeDrawer())},openDrawer(){document.getElementById(`sidebar`)?.classList.add(`drawer-open`),document.getElementById(`drawer-backdrop`)?.classList.add(`active`)},closeDrawer(){document.getElementById(`sidebar`)?.classList.remove(`drawer-open`),document.getElementById(`drawer-backdrop`)?.classList.remove(`active`)},openModal(t,n,r=``){document.getElementById(`modal-title`).textContent=t,document.getElementById(`modal-body`).innerHTML=n,document.getElementById(`modal-footer`).innerHTML=r,e.classList.add(`active`),e.setAttribute(`aria-hidden`,`false`)},closeModal(){e.classList.remove(`active`),e.setAttribute(`aria-hidden`,`true`)},showToast(e,n=`info`){let r=document.createElement(`div`);r.className=`toast toast-${n}`,r.innerHTML=`<span>${window.Utils.escapeHTML(e)}</span>`,t.appendChild(r),setTimeout(()=>r.remove(),3500)},startLiveClock(){let e=document.getElementById(`clock-time`),t=document.getElementById(`clock-date`);function n(){let n=new Date;e&&(e.textContent=n.toLocaleTimeString(`en-US`,{hour12:!1})),t&&(t.textContent=n.toLocaleDateString(`en-US`,{month:`short`,day:`numeric`}))}n(),setInterval(n,1e3)}}})();window.UIModule=s;var c=[`pending`,`accepted`,`preparing`,`ready`,`dispatched`,`delivered`,`cancelled`],l={pending:`New`,accepted:`Accepted`,preparing:`Preparing`,ready:`Ready`,dispatched:`Out for delivery`,delivered:`Completed`,cancelled:`Cancelled`},u={},d=!1,f=null,p=!0,m=new Set,h=e=>String(e??``).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#39;`})[e]);function g(e,t){let n=document.createElement(`div`);if(n.className=`skg-admin-toast`,n.setAttribute(`role`,`status`),n.innerHTML=`
        <strong>${h(e)}</strong>
        <span>${h(t)}</span>
    `,document.body.appendChild(n),window.setTimeout(()=>n.remove(),6500),`Notification`in window&&Notification.permission===`granted`)try{new Notification(e,{body:t,icon:`/assets/icons/favicon.svg`})}catch(e){console.warn(`Browser notification failed:`,e)}}function _(){if(document.getElementById(`skg-admin-order-styles`))return;let e=document.createElement(`style`);e.id=`skg-admin-order-styles`,e.textContent=`
        .skg-admin-order-toolbar {
            display:flex;
            flex-wrap:wrap;
            gap:10px;
            align-items:center;
            margin:16px 0;
        }

        .skg-admin-order-toolbar input,
        .skg-admin-order-toolbar select {
            min-height:42px;
            padding:9px 12px;
            border:1px solid var(--border-color,#dce5e3);
            border-radius:10px;
            background:#fff;
            color:#173c38;
            font:inherit;
        }

        .skg-admin-order-toolbar input {
            flex:1 1 220px;
        }

        .skg-live-dot {
            display:inline-block;
            width:8px;
            height:8px;
            border-radius:50%;
            background:#16a36d;
            margin-right:7px;
        }

        .skg-order-list {
            display:grid;
            gap:12px;
            margin-top:12px;
        }

        .skg-order-card {
            padding:17px;
            border:1px solid #e2ebe8;
            border-radius:16px;
            background:#fff;
            box-shadow:0 3px 12px #153c3710;
        }

        .skg-order-card-head {
            display:flex;
            justify-content:space-between;
            align-items:flex-start;
            gap:12px;
        }

        .skg-order-ref {
            font-size:12px;
            color:#6a817d;
            font-weight:700;
        }

        .skg-order-name {
            margin:4px 0;
            font-size:17px;
            font-weight:800;
            color:#183b37;
        }

        .skg-order-meta {
            display:flex;
            flex-wrap:wrap;
            gap:8px 14px;
            color:#6b807c;
            font-size:12px;
        }

        .skg-order-items {
            margin:14px 0;
            padding:12px 14px;
            border-radius:11px;
            background:#f6faf9;
            color:#294d47;
            font-size:14px;
            line-height:1.6;
        }

        .skg-order-items ul {
            margin:0;
            padding-left:18px;
        }

        .skg-order-details {
            display:grid;
            grid-template-columns:repeat(2,minmax(0,1fr));
            gap:10px;
            margin:10px 0;
            color:#49635e;
            font-size:13px;
        }

        .skg-order-details strong {
            display:block;
            margin-bottom:3px;
            color:#274640;
        }

        .skg-order-actions {
            display:flex;
            flex-wrap:wrap;
            align-items:center;
            gap:8px;
            margin-top:13px;
            padding-top:13px;
            border-top:1px solid #edf1ef;
        }

        .skg-order-actions select {
            min-height:38px;
            min-width:145px;
            padding:7px 10px;
            border:1px solid #d5e1de;
            border-radius:9px;
            background:#fff;
            color:#173c38;
        }

        .skg-order-actions button,
        .skg-order-actions a {
            display:inline-flex;
            align-items:center;
            justify-content:center;
            min-height:38px;
            padding:8px 12px;
            border:0;
            border-radius:9px;
            background:#087f78;
            color:#fff;
            font-size:13px;
            font-weight:800;
            text-decoration:none;
            cursor:pointer;
        }

        .skg-order-actions a {
            background:#e9f7ef;
            color:#176b3b;
        }

        .skg-order-actions button:disabled {
            opacity:.6;
            cursor:wait;
        }

        .skg-status {
            display:inline-flex;
            padding:5px 10px;
            border-radius:999px;
            background:#fff5dd;
            color:#8a5a09;
            font-size:11px;
            font-weight:900;
            text-transform:uppercase;
        }

        .skg-status.accepted,
        .skg-status.preparing {
            background:#eaf2ff;
            color:#285c9a;
        }

        .skg-status.ready,
        .skg-status.delivered {
            background:#e8f7ef;
            color:#176b3b;
        }

        .skg-status.cancelled {
            background:#fff0ef;
            color:#a43b34;
        }

        .skg-order-empty,
        .skg-order-error {
            padding:28px;
            border:1px dashed #d6e3df;
            border-radius:14px;
            text-align:center;
            color:#6b817c;
            background:#fbfdfc;
        }

        .skg-admin-toast {
            position:fixed;
            z-index:99999;
            right:22px;
            top:22px;
            display:grid;
            gap:4px;
            width:min(360px,calc(100vw - 32px));
            padding:15px 17px;
            border:1px solid #b8ddd2;
            border-radius:14px;
            background:#f2fbf7;
            color:#1d5144;
            box-shadow:0 14px 42px #102f2d28;
            animation:skgToastIn .25s ease;
        }

        .skg-admin-toast span {
            font-size:13px;
            line-height:1.45;
        }

        @keyframes skgToastIn {
            from { opacity:0; transform:translateY(-8px); }
            to { opacity:1; transform:translateY(0); }
        }

        @media(max-width:600px) {
            .skg-order-details {
                grid-template-columns:1fr;
            }

            .skg-order-card-head {
                flex-direction:column;
            }

            .skg-order-actions select {
                flex:1;
            }
        }

        @media(prefers-reduced-motion:reduce) {
            .skg-admin-toast { animation:none; }
        }
    `,document.head.appendChild(e)}function v(e){return Number.isFinite(Number(e))?new Intl.DateTimeFormat(`en-NP`,{dateStyle:`medium`,timeStyle:`short`,timeZone:`Asia/Kathmandu`}).format(new Date(Number(e))):`Time not available`}function y(e){return m.add(e),e(u,null),()=>m.delete(e)}function b(){return d?f:(d=!0,p=!0,f=i(e(n,`orders`),e=>{let t=e.val()||{};p||Object.entries(t).forEach(([e,t])=>{let n=u[e];n?n.status!==t.status&&g(`Order status updated`,`${t.customerName||`Customer`} • ${l[t.status]||t.status}`):g(`New website order`,`${t.customerName||`Customer`} • ${t.summary||e}`)}),u=t,p=!1;let n=Object.values(u).filter(e=>e?.status===`pending`).length,r=document.getElementById(`pending-orders-count`);r&&(r.textContent=String(n),r.classList.toggle(`hidden`,n===0)),m.forEach(e=>{e(u,null)})},e=>{console.error(`Admin live order monitor failed:`,e),d=!1,f=null,m.forEach(t=>{t(u,e)}),g(`Order connection problem`,`Live orders could not be loaded. Check Firebase rules and connection.`)}),f)}async function x(e){if(!(`Notification`in window)){alert(`This browser does not support desktop notifications. In-panel notifications will still work.`);return}try{await Notification.requestPermission()===`granted`?(e.textContent=`✓ Browser alerts enabled`,e.disabled=!0,g(`Notifications enabled`,`New orders and status changes will appear here.`)):(e.textContent=`Notifications blocked`,alert(`Browser notifications were not allowed. In-panel alerts will continue while the admin panel is open.`))}catch(e){console.error(`Notification permission error:`,e),alert(`Could not enable browser notifications.`)}}function S(e,t){let n=h(e),r=(Array.isArray(t.items)?t.items:Object.values(t.items||{})).map(e=>`
        <li>
            ${h(e.quantity)} × ${h(e.name)}
        </li>
    `).join(``),i=c.includes(t.status)?t.status:`pending`,a=String(t.customerPhone||``).replace(/\D/g,``),o=a.length===10?`977${a}`:a,s=encodeURIComponent(`Namaste ${t.customerName||``}, this is Siranchowk Khaja Ghar regarding your website order ${e}.`),u=c.map(e=>`
        <option value="${e}" ${i===e?`selected`:``}>
            ${l[e]}
        </option>
    `).join(``);return`
        <article class="skg-order-card" data-order-card="${n}">
            <div class="skg-order-card-head">
                <div>
                    <div class="skg-order-ref">
                        ORDER #${h(e.slice(-8).toUpperCase())}
                    </div>

                    <h3 class="skg-order-name">
                        ${h(t.customerName||`Customer`)}
                    </h3>

                    <div class="skg-order-meta">
                        <span>${h(v(t.createdAt))}</span>
                        <span>${h(t.orderType||`Order`)}</span>
                    </div>
                </div>

                <span class="skg-status ${h(i)}">
                    ${h(l[i])}
                </span>
            </div>

            <div class="skg-order-items">
                <strong>Items</strong>
                <ul>
                    ${r||`<li>Item details unavailable</li>`}
                </ul>
            </div>

            <div class="skg-order-details">
                <div>
                    <strong>Customer phone</strong>
                    ${h(t.customerPhone||`Not provided`)}
                </div>

                <div>
                    <strong>Delivery address</strong>
                    ${h(t.deliveryAddress||`Not applicable`)}
                </div>

                <div>
                    <strong>Special instructions</strong>
                    ${h(t.notes||`None`)}
                </div>

                <div>
                    <strong>Price</strong>
                    Confirm with customer — no online price is configured
                </div>
            </div>

            <div class="skg-order-actions">
                <label class="sr-only" for="status-${n}">
                    Order status
                </label>

                <select
                    id="status-${n}"
                    data-status-select="${n}"
                >
                    ${u}
                </select>

                <button type="button" data-save-order="${n}">
                    Save status
                </button>

                ${a?`
                    <a href="tel:${h(a)}">
                        Call customer
                    </a>
                `:``}

                ${o?`
                    <a
                        href="https://wa.me/${h(o)}?text=${s}"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        WhatsApp customer
                    </a>
                `:``}
            </div>
        </article>
    `}var C={async render(r){_(),r.innerHTML=`
            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Customer orders</h2>
                        <p class="card-subtitle">
                            Live website orders. WhatsApp conversations remain in WhatsApp.
                        </p>
                    </div>

                    <button
                        type="button"
                        class="btn btn-primary"
                        id="skg-enable-admin-notifications"
                    >
                        🔔 Enable browser alerts
                    </button>
                </div>

                <div class="skg-live-status" id="skg-orders-connection">
                    <span class="skg-live-dot"></span>
                    Connecting to live orders…
                </div>

                <div class="skg-admin-order-toolbar">
                    <input
                        type="search"
                        id="skg-order-search"
                        placeholder="Search customer, phone or order ID"
                        aria-label="Search orders"
                    >

                    <select id="skg-order-filter" aria-label="Filter orders">
                        <option value="all">All orders</option>

                        ${c.map(e=>`
                            <option value="${e}">
                                ${l[e]}
                            </option>
                        `).join(``)}
                    </select>
                </div>

                <div class="skg-order-list" id="skg-order-list">
                    <div class="skg-order-empty">Loading orders…</div>
                </div>
            </section>

            <p class="form-hint" style="margin-top:12px">
                Website order requests are not confirmed until the restaurant accepts them.
                Final prices and delivery availability must be confirmed with the customer.
            </p>
        `;let i=r.querySelector(`#skg-enable-admin-notifications`);i.addEventListener(`click`,()=>{x(i)});let a=r.querySelector(`#skg-order-list`),o=r.querySelector(`#skg-order-search`),s=r.querySelector(`#skg-order-filter`),d=r.querySelector(`#skg-orders-connection`),f=u,p=()=>{let r=o.value.trim().toLowerCase(),i=s.value,u=Object.entries(f).sort((e,t)=>Number(t[1].createdAt||0)-Number(e[1].createdAt||0)).filter(([e,t])=>{let n=i===`all`||t.status===i,a=[e,t.customerName,t.customerPhone,t.summary].join(` `).toLowerCase();return n&&a.includes(r)});if(!u.length){a.innerHTML=`
                    <div class="skg-order-empty">
                        No orders match this view yet.
                    </div>
                `;return}a.innerHTML=u.map(([e,t])=>S(e,t)).join(``),a.querySelectorAll(`[data-save-order]`).forEach(r=>{r.addEventListener(`click`,async()=>{let i=r.dataset.saveOrder,o=f[i],s=a.querySelector(`[data-status-select="${CSS.escape(i)}"]`)?.value;if(!o||!c.includes(s))return;if(s===o.status){g(`No change`,`This order already has that status.`);return}r.disabled=!0,r.textContent=`Saving…`;let u=Date.now(),d=`Your order is now ${l[s]||s}.`;try{if(await t(e(n,`orders/${i}`),{status:s,updatedAt:u}),r.textContent=`Saved`,g(`Order updated`,`${o.customerName||`Customer`} • ${l[s]}`),o.customerTrackingToken)try{await t(e(n,`orderTracking/${o.customerTrackingToken}`),{status:s,updatedAt:u,customerMessage:d})}catch(e){console.error(`Order saved, but tracking update failed:`,e),g(`Tracking update warning`,`Order status was saved, but customer tracking could not be updated.`)}}catch(e){console.error(`Order status update failed:`,e),alert(`Could not update this order: ${e.message}`),r.disabled=!1,r.textContent=`Save status`}})})};o.addEventListener(`input`,p),s.addEventListener(`change`,p),r._skgOrderUnsubscribe&&r._skgOrderUnsubscribe(),r._skgOrderUnsubscribe=y((e,t)=>{if(f=e||{},t){d.textContent=`Unable to load orders: ${t.message}`,a.innerHTML=`
                        <div class="skg-order-error">
                            Could not connect to Firebase. Check the database rules and internet connection.
                        </div>
                    `;return}d.innerHTML=`
                    <span class="skg-live-dot"></span>
                    Live connection • ${Object.keys(f).length} order(s)
                `,p()})}},w={async render(e){e.innerHTML=`
          <section class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Good to see you</h2>
                <p class="card-subtitle">Your restaurant order desk at a glance.</p>
              </div>
              <span class="badge badge-success">Admin session active</span>
            </div>
            <div class="metrics-grid" id="skg-dashboard-metrics">
              <div class="metric-card"><div class="metric-info"><span class="metric-label">Total orders</span><span class="metric-value">—</span><span class="metric-subtext">All website orders</span></div><div class="metric-icon-box">🧾</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">New requests</span><span class="metric-value">—</span><span class="metric-subtext">Waiting for review</span></div><div class="metric-icon-box">🔔</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">In progress</span><span class="metric-value">—</span><span class="metric-subtext">Accepted or preparing</span></div><div class="metric-icon-box">🍳</div></div>
              <div class="metric-card"><div class="metric-info"><span class="metric-label">Ready / completed</span><span class="metric-value">—</span><span class="metric-subtext">Ready, dispatched or delivered</span></div><div class="metric-icon-box">✓</div></div>
            </div>
            <div class="skg-dashboard-bottom">
              <div>
                <h3>Order desk</h3>
                <p>Website requests appear here in real time while this admin panel is open. Review each request, contact the customer and update its status.</p>
              </div>
              <a href="#orders" class="btn btn-primary" id="skg-open-orders">Open orders →</a>
            </div>
          </section>
          <section class="card" style="margin-top:18px">
            <div class="card-header"><div><h2 class="card-title">Recent website orders</h2><p class="card-subtitle">Latest customer requests</p></div></div>
            <div id="skg-recent-orders" class="skg-recent-orders"><p class="form-hint">Loading recent orders…</p></div>
          </section>
          <p class="form-hint" style="margin-top:14px">Reminder: a website order is a request, not a confirmed booking. Accept it only after checking availability and confirming the price with the customer.</p>`;let t=e.querySelector(`#skg-dashboard-metrics`),n=e.querySelector(`#skg-recent-orders`),r=(e,r)=>{if(r){n.innerHTML=`<p class="skg-dashboard-error">Unable to load live orders: ${String(r.message||`Connection error`)}</p>`;return}let o=Object.entries(e||{}).sort((e,t)=>Number(t[1].createdAt||0)-Number(e[1].createdAt||0)),s=e=>o.filter(([,t])=>e.includes(t.status)).length,c=[o.length,s([`pending`]),s([`accepted`,`preparing`]),s([`ready`,`dispatched`,`delivered`])];if(t.querySelectorAll(`.metric-value`).forEach((e,t)=>{e.textContent=String(c[t])}),!o.length){n.innerHTML=`<div class="skg-recent-empty">No website orders yet. New requests will appear here.</div>`;return}n.innerHTML=o.slice(0,5).map(([e,t])=>`
              <div class="skg-recent-row">
                <div><strong>${i(t.customerName||`Customer`)}</strong><span>${i(t.summary||`Order details unavailable`)}</span></div>
                <div><b>${i(String(t.status||`pending`).replaceAll(`_`,` `))}</b><small>${i(a(t.createdAt))}</small></div>
              </div>`).join(``)},i=e=>String(e??``).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#39;`})[e]),a=e=>Number.isFinite(Number(e))?new Intl.DateTimeFormat(`en-NP`,{dateStyle:`medium`,timeStyle:`short`,timeZone:`Asia/Kathmandu`}).format(new Date(Number(e))):``;e._skgDashboardUnsubscribe&&e._skgDashboardUnsubscribe(),e._skgDashboardUnsubscribe=y(r)}};document.addEventListener(`DOMContentLoaded`,async()=>{let e=null;try{if(!await o()||(e=r.currentUser,!e))return}catch(e){console.error(`Admin authentication check failed:`,e);return}if(typeof window.revealAdminApplication==`function`&&window.revealAdminApplication(),window.UIModule!==void 0&&typeof window.UIModule.init==`function`)try{window.UIModule.init()}catch(e){console.warn(`Admin UI initialization warning:`,e)}let t=document.getElementById(`user-display-name`),n=document.getElementById(`user-role-label`),i=document.getElementById(`user-avatar-initials`),s=e.email||`Administrator`,c=e.displayName||s.split(`@`)[0]||`Admin`;t&&(t.textContent=c),n&&(n.textContent=`Siranchowk Admin`),i&&(i.textContent=c.split(/\s+/).filter(Boolean).slice(0,2).map(e=>e.charAt(0).toUpperCase()).join(``)||`AD`),b();let l={dashboard:w,orders:C},u={dashboard:`Dashboard`,orders:`Customer Orders`},d=document.getElementById(`main-content`),f=document.getElementById(`page-title-heading`),p=[...document.querySelectorAll(`.nav-item[data-view]`)];if(!d){console.error(`Admin main content container is missing.`);return}async function m(e){let t=Object.prototype.hasOwnProperty.call(l,e)?e:`dashboard`;p.forEach(e=>{let n=e.dataset.view===t;e.classList.toggle(`active`,n),n?e.setAttribute(`aria-current`,`page`):e.removeAttribute(`aria-current`)}),f&&(f.textContent=u[t]),window.UIModule!==void 0&&typeof window.UIModule.closeDrawer==`function`&&window.UIModule.closeDrawer(),typeof d._skgOrderUnsubscribe==`function`&&(d._skgOrderUnsubscribe(),d._skgOrderUnsubscribe=null),typeof d._skgDashboardUnsubscribe==`function`&&(d._skgDashboardUnsubscribe(),d._skgDashboardUnsubscribe=null),d.innerHTML=`<div class="skg-admin-loading" role="status">Loading…</div>`;try{await l[t].render(d)}catch(e){console.error(`Could not render admin view "${t}":`,e),d.innerHTML=`
              <section class="card">
                <h2 class="card-title">This section could not be loaded</h2>
                <p class="card-subtitle">Check your connection and Firebase database permissions, then try again.</p>
                <button type="button" class="btn btn-primary" id="skg-retry-view">Try again</button>
              </section>`,d.querySelector(`#skg-retry-view`)?.addEventListener(`click`,()=>m(t))}}window.addEventListener(`hashchange`,()=>{m(window.location.hash.replace(`#`,``).trim().toLowerCase()||`dashboard`)}),p.forEach(e=>{e.addEventListener(`click`,t=>{t.preventDefault();let n=e.dataset.view,r=`#${n}`;window.location.hash===r?m(n):window.location.hash=r})}),document.getElementById(`quick-refresh-btn`)?.addEventListener(`click`,()=>{m(window.location.hash.replace(`#`,``).trim().toLowerCase()||`dashboard`)}),document.getElementById(`logout-btn`)?.addEventListener(`click`,async()=>{if(window.confirm(`Sign out of Siranchowk Khaja Ghar Admin?`))try{await a()}catch(e){console.error(`Admin logout failed:`,e),window.UIModule!==void 0&&typeof window.UIModule.showToast==`function`?window.UIModule.showToast(`Unable to sign out. Please try again.`,`error`):alert(`Unable to sign out. Please try again.`)}}),await m(window.location.hash.replace(`#`,``).trim().toLowerCase()||`dashboard`)});