import{d as e,f as t,n,p as r,u as i}from"./firebase-hDDeNwgu.js";var a={name:`Siranchowk Khaja Ghar`,phone:`9821233154`,whatsapp:`9779821233154`},o=`skg_cart_v2`,s=`skg_customer_tracking_v2`,c=new Map,l=e=>String(e??``).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#39;`})[e]);function u(){try{let e=JSON.parse(localStorage.getItem(o)||`[]`);Array.isArray(e)&&e.forEach(e=>{e&&typeof e.name==`string`&&Number.isInteger(e.quantity)&&e.quantity>0&&e.quantity<=20&&c.set(e.name,e.quantity)})}catch(e){console.warn(`Saved cart could not be restored.`,e)}}function d(){try{localStorage.setItem(o,JSON.stringify([...c].map(([e,t])=>({name:e,quantity:t}))))}catch(e){console.warn(`Cart could not be saved on this device.`,e)}}function f(){let e=new Uint8Array(24);return crypto.getRandomValues(e),[...e].map(e=>e.toString(16).padStart(2,`0`)).join(``)}function p(){if(document.getElementById(`skg-order-styles`))return;let e=document.createElement(`style`);e.id=`skg-order-styles`,e.textContent=`
      .skg-add-cart{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:42px;padding:10px 15px;border:1px solid #087f78;border-radius:12px;background:#087f78;color:#fff;font-family:inherit;font-size:14px;font-weight:700;line-height:1.2;cursor:pointer;transition:transform .18s ease,background .18s ease}
      .skg-add-cart:hover{background:#066b65;transform:translateY(-1px)}
      .skg-add-cart:focus-visible,.skg-cart-fab:focus-visible,.skg-panel button:focus-visible{outline:3px solid #67d5c8;outline-offset:3px}
      .skg-cart-fab{position:fixed;z-index:1000;right:20px;bottom:20px;display:flex;align-items:center;gap:10px;padding:14px 19px;border:0;border-radius:999px;background:#123f3b;color:#fff;font-weight:800;box-shadow:0 12px 34px #102f2d35;cursor:pointer}
      .skg-cart-count{display:grid;place-items:center;min-width:23px;height:23px;padding:0 6px;border-radius:99px;background:#fff;color:#123f3b;font-size:12px}
      .skg-modal{position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;padding:16px;background:#102b2bcc;backdrop-filter:blur(5px)}
      .skg-modal.open{display:flex}
      .skg-panel{width:min(600px,100%);max-height:min(92vh,850px);overflow:auto;padding:clamp(20px,4vw,30px);border:1px solid #e3eeeb;border-radius:24px;background:#fff;color:#183b39;box-shadow:0 25px 90px #061d1b55}
      .skg-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
      .skg-panel h2{margin:0 0 5px;font-size:clamp(22px,4vw,28px);letter-spacing:-.03em}
      .skg-panel-subtitle{margin:0;color:#6b817e;font-size:13px;line-height:1.5}
      .skg-close{flex:0 0 auto;width:38px;height:38px;border:0;border-radius:50%;background:#eef5f3;color:#183b39;font-size:19px;cursor:pointer}
      .skg-cart-lines{margin:14px 0 18px}
      .skg-line{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid #e8efed}
      .skg-line-name{font-weight:700;overflow-wrap:anywhere}
      .skg-qty-controls{display:flex;align-items:center;gap:8px;white-space:nowrap}
      .skg-qty-controls button{width:30px;height:30px;border:1px solid #dbe7e4;border-radius:9px;background:#f7faf9;color:#21413e;font-weight:800;cursor:pointer}
      .skg-remove{border-color:#f0d8d5!important;background:#fff7f6!important;color:#a53e35!important}
      .skg-empty{padding:22px 10px;text-align:center;color:#71837f}
      .skg-field{display:grid;gap:6px;margin:13px 0}
      .skg-field label{font-size:13px;font-weight:800;color:#294a46}
      .skg-field input,.skg-field select,.skg-field textarea{width:100%;min-height:46px;box-sizing:border-box;padding:11px 13px;border:1px solid #d5e2df;border-radius:11px;background:#fff;color:#183b39;font:inherit}
      .skg-field textarea{min-height:82px;resize:vertical}
      .skg-field input:focus,.skg-field select:focus,.skg-field textarea:focus{outline:0;border-color:#159f91;box-shadow:0 0 0 3px #159f9120}
      .skg-order-notice{margin:15px 0;padding:13px 15px;border:1px solid #f0dfb7;border-radius:13px;background:#fffaf0;color:#76531c;font-size:13px;line-height:1.55}
      .skg-order-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:17px}
      .skg-order-actions button,.skg-order-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:11px 16px;border:0;border-radius:12px;font-family:inherit;font-size:14px;font-weight:800;text-decoration:none;cursor:pointer}
      .skg-submit{flex:1 1 190px;background:#087f78;color:#fff}
      .skg-whatsapp{flex:1 1 170px;background:#e8f7ef;color:#176b3b}
      .skg-call{flex:1 1 130px;background:#eef4f3;color:#21413e}
      .skg-submit:disabled{opacity:.6;cursor:wait}
      .skg-result{margin-top:16px;padding:15px;border:1px solid #b9e1d6;border-radius:14px;background:#f0faf6;color:#205a49;line-height:1.55}
      .skg-result strong{display:block;margin-bottom:4px}
      .skg-result-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:11px}
      .skg-result-actions button,.skg-result-actions a{padding:9px 12px;border:1px solid #cbded8;border-radius:10px;background:#fff;color:#205a49;font-weight:700;text-decoration:none;cursor:pointer}
      .skg-tracking{margin:14px 0;padding:12px 14px;border:1px solid #d9e9e5;border-radius:12px;background:#f6fbfa;color:#355c55;font-size:13px}
      @media(max-width:520px){.skg-cart-fab{right:14px;bottom:14px;padding:12px 15px}.skg-order-actions{display:grid}.skg-order-actions>*{width:100%}.skg-line{align-items:flex-start}}
      @media(prefers-reduced-motion:reduce){.skg-add-cart{transition:none}}
    `,document.head.appendChild(e)}function m(){return[...c].map(([e,t])=>({name:e,quantity:t}))}function h(){return[...c.values()].reduce((e,t)=>e+t,0)}function g(){if(p(),!document.getElementById(`skg-cart-fab`)){let e=document.createElement(`button`);e.id=`skg-cart-fab`,e.className=`skg-cart-fab`,e.type=`button`,e.setAttribute(`aria-haspopup`,`dialog`),e.innerHTML=`
            🛒 Your cart
            <span class="skg-cart-count" id="skg-cart-count">0</span>
        `,e.addEventListener(`click`,b),document.body.appendChild(e)}if(!document.getElementById(`skg-checkout-modal`)){let e=document.createElement(`div`);e.id=`skg-checkout-modal`,e.className=`skg-modal`,e.innerHTML=`
          <section class="skg-panel" role="dialog" aria-modal="true" aria-labelledby="skg-title">
            <div class="skg-panel-head">
              <div>
                <h2 id="skg-title">Your order</h2>
                <p class="skg-panel-subtitle">
                    Review your items and send your order to our team.
                </p>
              </div>
              <button class="skg-close" type="button" aria-label="Close order panel">×</button>
            </div>

            <div id="skg-cart-lines" class="skg-cart-lines" aria-live="polite"></div>

            <div class="skg-order-notice">
              <strong>Order confirmation notice</strong><br>
              Website orders are requests only. Our team may not see them immediately,
              and the order is not confirmed until we contact you.
              For urgent orders, message us on WhatsApp or call ${a.phone}.
              Final prices and delivery availability are confirmed by our team.
            </div>

            <form id="skg-checkout-form" novalidate>
              <div class="skg-field">
                <label for="skg-name">Your name *</label>
                <input id="skg-name" name="customerName" maxlength="80"
                    required autocomplete="name" placeholder="Enter your full name">
              </div>

              <div class="skg-field">
                <label for="skg-phone">Phone number *</label>
                <input id="skg-phone" name="customerPhone" type="tel"
                    maxlength="16" required autocomplete="tel"
                    inputmode="tel" pattern="[0-9+() -]{7,16}"
                    placeholder="98XXXXXXXX">
              </div>

              <div class="skg-field">
                <label for="skg-method">Order method *</label>
                <select id="skg-method" name="orderType" required>
                    <option value="Pickup">Pickup / Takeaway</option>
                    <option value="Delivery">Local delivery (subject to confirmation)</option>
                    <option value="Dine-in">Dine-in</option>
                </select>
              </div>

              <div class="skg-field" id="skg-address-wrap" hidden>
                <label for="skg-address">Delivery address / nearby landmark *</label>
                <input id="skg-address" name="deliveryAddress"
                    maxlength="180" autocomplete="street-address"
                    placeholder="Your delivery location">
              </div>

              <div class="skg-field">
                <label for="skg-notes">
                    Special instructions
                    <span class="skg-panel-subtitle">(optional)</span>
                </label>
                <textarea id="skg-notes" name="notes" maxlength="400"
                    placeholder="Spice preference, instructions, etc."></textarea>
              </div>

              <div class="skg-order-actions">
                <button class="skg-submit" type="submit">
                    Send website order
                </button>

                <button class="skg-whatsapp" id="skg-whatsapp" type="button">
                    Continue on WhatsApp
                </button>

                <a class="skg-call" href="tel:${a.phone}">
                    Call ${a.phone}
                </a>
              </div>
            </form>

            <div id="skg-result" class="skg-result"
                role="status" aria-live="polite" hidden></div>
          </section>
        `,document.body.appendChild(e),e.querySelector(`.skg-close`).addEventListener(`click`,x),e.addEventListener(`click`,t=>{t.target===e&&x()}),e.querySelector(`#skg-whatsapp`).addEventListener(`click`,T),e.querySelector(`#skg-checkout-form`).addEventListener(`submit`,E),e.querySelector(`#skg-method`).addEventListener(`change`,y),document.addEventListener(`keydown`,e=>{e.key===`Escape`&&x()})}document.querySelectorAll(`.dish-card`).forEach(e=>{let t=e.querySelector(`.dish-footer`);if(!t||t.querySelector(`.skg-add-cart`))return;let n=e.querySelector(`h3`)?.textContent?.trim();if(!n)return;let r=document.createElement(`button`);r.type=`button`,r.className=`skg-add-cart`,r.textContent=`＋ Add to cart`,r.setAttribute(`aria-label`,`Add ${n} to cart`),r.addEventListener(`click`,()=>{let e=(c.get(n)||0)+1;if(e>20){_(`Maximum 20 portions per menu item.`);return}c.set(n,e),d();let t=document.querySelector(`#skg-checkout-form [type='submit']`);t&&(t.textContent=`Send website order`),v(),r.textContent=`✓ Added`,window.setTimeout(()=>{r.textContent=`＋ Add to cart`},1e3)}),t.appendChild(r)}),v()}function _(e){let t=document.getElementById(`skg-cart-lines`);if(t){let n=document.createElement(`p`);n.className=`skg-tracking`,n.textContent=e,t.prepend(n)}}function v(){let e=document.getElementById(`skg-cart-count`);e&&(e.textContent=String(h()));let t=document.getElementById(`skg-cart-lines`);if(t){if(!c.size){t.innerHTML=`
            <div class="skg-empty">
                Your cart is empty.<br>
                Add a few favourites from the menu to get started.
            </div>
        `;return}t.innerHTML=[...c.entries()].map(([e,t])=>`
      <div class="skg-line">
        <span class="skg-line-name">${l(e)}</span>

        <span class="skg-qty-controls">
          <button type="button"
              data-dec="${l(e)}"
              aria-label="Decrease ${l(e)}">−</button>

          <strong>${t}</strong>

          <button type="button"
              data-inc="${l(e)}"
              aria-label="Increase ${l(e)}">+</button>

          <button type="button"
              class="skg-remove"
              data-del="${l(e)}"
              aria-label="Remove ${l(e)}">×</button>
        </span>
      </div>
    `).join(``),t.querySelectorAll(`[data-dec]`).forEach(e=>{e.addEventListener(`click`,()=>{let t=e.dataset.dec,n=(c.get(t)||0)-1;n<=0?c.delete(t):c.set(t,n),d(),v()})}),t.querySelectorAll(`[data-inc]`).forEach(e=>{e.addEventListener(`click`,()=>{let t=e.dataset.inc,n=(c.get(t)||0)+1;n<=20?c.set(t,n):_(`Maximum 20 portions per menu item.`),d(),v()})}),t.querySelectorAll(`[data-del]`).forEach(e=>{e.addEventListener(`click`,()=>{c.delete(e.dataset.del),d(),v()})})}}function y(){let e=document.getElementById(`skg-method`)?.value===`Delivery`,t=document.getElementById(`skg-address-wrap`),n=document.getElementById(`skg-address`);t&&(t.hidden=!e),n&&(n.required=e)}function b(){let e=document.getElementById(`skg-checkout-modal`);e&&(e.classList.add(`open`),v(),e.querySelector(`#skg-name`)?.focus(),document.body.style.overflow=`hidden`)}function x(){let e=document.getElementById(`skg-checkout-modal`);e&&e.classList.remove(`open`),document.body.style.overflow=``}function S(){let e=document.getElementById(`skg-checkout-form`);return{name:e.querySelector(`#skg-name`).value.trim(),phone:e.querySelector(`#skg-phone`).value.trim(),method:e.querySelector(`#skg-method`).value,address:e.querySelector(`#skg-address`).value.trim(),notes:e.querySelector(`#skg-notes`).value.trim()}}function C(e,t=!0){if(!c.size)return`Your cart is empty. Please add at least one item.`;if(t&&e.name.length<2)return`Please enter your name.`;if(t&&!/^[0-9+() -]{7,16}$/.test(e.phone))return`Please enter a valid phone number.`;if(e.phone){if(!/^[0-9+() -]{7,16}$/.test(e.phone))return`Please check your phone number.`;let t=e.phone.replace(/\D/g,``);if(t.length<7||t.length>15)return`Please check your phone number.`}return e.method===`Delivery`&&e.address.length<4?`Please enter your delivery address or a nearby landmark.`:``}function w(e){return[`Namaste ${a.name}! I would like to place an order:`,``,...m().map(e=>`${e.quantity} × ${e.name}`),``,`Name: ${e.name||`Not provided`}`,`Phone: ${e.phone||`Not provided`}`,`Order type: ${e.method}`,`Address: ${e.address||`Not applicable`}`,`Instructions: ${e.notes||`None`}`,``,`Please confirm availability and final prices. Thank you.`].join(`
`)}function T(){let e=S(),t=C(e,!0);if(t){alert(t);return}let n=`https://wa.me/${a.whatsapp}?text=`+encodeURIComponent(w(e));window.open(n,`_blank`,`noopener,noreferrer`)}async function E(i){i.preventDefault();let o=i.currentTarget,u=o.querySelector(`[type="submit"]`),p=S(),h=C(p);if(h){alert(h);return}u.disabled=!0,u.textContent=`Sending securely…`;let g=e(t(n,`orders`)),_=g.key;if(!_){alert(`Could not generate an order reference. Please try again.`),u.disabled=!1,u.textContent=`Send website order`;return}let b=f(),x=Date.now(),w=m(),T={id:_,customerName:p.name,customerPhone:p.phone,items:w,summary:w.map(e=>`${e.quantity} × ${e.name}`).join(`, `),orderType:p.method,deliveryAddress:p.address,notes:p.notes,status:`pending`,source:`website`,currency:`NPR`,priceStatus:`confirm_at_counter`,customerTrackingToken:b,createdAt:x,updatedAt:x},E={orderId:_,status:`pending`,updatedAt:x},D=!1;try{await r(g,T);try{await r(t(n,`orderTracking/${b}`),E),D=!0}catch(e){console.error(`Order was saved, but tracking could not be saved:`,e)}if(D)try{localStorage.setItem(s,JSON.stringify({id:_,token:b}))}catch(e){console.warn(`Tracking information could not be saved locally:`,e)}try{let e=`skg_customer_orders_v1`,t=JSON.parse(localStorage.getItem(e)||`[]`);t.unshift({id:_,token:D?b:null,customerName:p.name,customerPhone:p.phone,items:w,summary:T.summary,orderType:p.method,deliveryAddress:p.address,notes:p.notes,status:`pending`,createdAt:x}),localStorage.setItem(e,JSON.stringify(t.slice(0,50)))}catch(e){console.warn(`Local customer order history could not be saved.`,e)}c.clear(),d(),v();let e=document.getElementById(`skg-result`);e.hidden=!1,e.innerHTML=`
          <strong>Order request received</strong>

          Your reference is
          <b>${l(_.slice(-8).toUpperCase())}</b>.

          This is not an acceptance confirmation.
          Our team will contact you to confirm availability,
          final prices and delivery.

          <div class="skg-result-actions">
            ${D?`<button type="button"
                        id="skg-enable-customer-notifications">
                        Enable status alerts
                       </button>`:``}

            <a href="https://wa.me/${a.whatsapp}?text=${encodeURIComponent(`Namaste! I submitted website order ${_}. Please confirm it.`)}"
               target="_blank"
               rel="noopener noreferrer">
                Confirm on WhatsApp
            </a>

            <a href="tel:${a.phone}">
                Call ${a.phone}
            </a>
          </div>

          <div id="skg-customer-tracking" class="skg-tracking">
            ${D?`Current status: Waiting for the restaurant to review your order.`:`Your order was received, but live tracking is temporarily unavailable. Please contact the restaurant to check its status.`}
          </div>
        `,D&&(document.getElementById(`skg-enable-customer-notifications`)?.addEventListener(`click`,O),k(b,document.getElementById(`skg-customer-tracking`))),o.reset(),y(),u.textContent=`Order sent`}catch(e){console.error(`Website order submission failed:`,e),alert(`We could not save your website order. Please try WhatsApp or call the restaurant.`)}finally{u.disabled=!1,u.textContent===`Sending securely…`&&(u.textContent=`Send website order`)}}var D=!1;async function O(){if(!(`Notification`in window)){alert(`This browser does not support notifications. Keep this page open to see order status updates.`);return}try{let e=await Notification.requestPermission();D=e===`granted`;let t=document.getElementById(`skg-enable-customer-notifications`);t&&(t.textContent=D?`Status alerts enabled`:`Alerts not enabled`),e!==`granted`&&alert(`Notifications were not allowed. You can still track your order while this page is open.`)}catch(e){console.error(`Notification permission error:`,e),alert(`Could not enable notifications in this browser.`)}}function k(e,r){let o=!0,s=null,c={pending:`Received — waiting for restaurant confirmation`,accepted:`Accepted by the restaurant`,preparing:`Being prepared`,ready:`Ready for pickup`,dispatched:`Out for delivery`,delivered:`Delivered`,cancelled:`Cancelled`};i(t(n,`orderTracking/${e}`),e=>{if(!e.exists())return;let t=e.val(),n=t.status||`pending`;r.textContent=`Order ${t.orderId||``}: ${c[n]||n}. ${t.customerMessage||``}`,!o&&s!==n&&D&&`Notification`in window&&new Notification(`${a.name} — order update`,{body:c[n]||n,icon:`/assets/icons/favicon.svg`}),s=n,o=!1},e=>{console.error(`Customer order tracking listener failed:`,e),r.textContent=`Live tracking is temporarily unavailable. Please contact the restaurant.`})}function A(){try{let e=JSON.parse(localStorage.getItem(s)||`null`);if(!e?.token||!e?.id)return;let t=document.querySelector(`main`);if(!t||document.getElementById(`skg-restored-tracking`))return;let n=document.createElement(`div`);n.id=`skg-restored-tracking`,n.className=`skg-tracking`,n.innerHTML=`
            <strong>Recent order tracking</strong>
            <div id="skg-restored-tracking-status">
                Loading your latest order…
            </div>
        `,t.prepend(n),k(e.token,n.querySelector(`#skg-restored-tracking-status`))}catch(e){console.warn(`Saved order tracking could not be restored.`,e)}}document.addEventListener(`DOMContentLoaded`,()=>{u(),g();let e=document.getElementById(`menu-grid-container`);e&&new MutationObserver(()=>g()).observe(e,{childList:!0,subtree:!0}),document.querySelectorAll(`a[href*="wa.me"]`).forEach(e=>{e.dataset.skgCartBound!==`true`&&(e.closest(`footer`)||(e.classList.contains(`btn`)||e.classList.contains(`btn-sm`)||e.classList.contains(`header-cta`))&&(e.dataset.skgCartBound=`true`,e.addEventListener(`click`,t=>{t.preventDefault();let n=e.closest(`.dish-card`)?.querySelector(`h3`)?.textContent?.trim();if(n){let e=c.get(n)||0;e<20&&c.set(n,e+1),d(),v()}b()})))}),A()});