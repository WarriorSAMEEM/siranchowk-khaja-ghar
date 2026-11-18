# Siranchowk Khaja Ghar — Update notes

## Applied in this package

1. The shared cart/checkout UI now initializes on the homepage as well as the Menu page.
2. Homepage dish cards get the same Add to cart control used on the Menu page.
3. Customer-facing WhatsApp order CTAs outside the footer now open the shared cart/checkout instead of bypassing it. If the CTA belongs to a dish card, that dish is added to the cart first.
4. WhatsApp checkout now requires the customer's name and phone number and checks delivery address when Delivery is selected.
5. Admin responsive CSS has extra small-screen overflow, card, navigation, and metric-grid handling.

## Important limitations — not yet implemented

- Google/email customer sign-in and requiring sign-in before ordering. This needs a customer authentication flow, Firebase Auth provider configuration, account UI, and database rules migration.
- Full account order history. The current site stores a latest-order tracking token locally; it is not a multi-order authenticated account history.
- Push notifications when the browser is closed. Current order notifications are foreground/browser-page notifications only. True background push needs Firebase Cloud Messaging, a VAPID key, a service worker, notification permission, and server-side/admin send logic.
- Full analytics dashboard, visitor identity, date-range reporting, IP/device bans, forced logout/kick, and timed lockouts. These need a secure backend and strict database rules. A browser-only site must not be trusted to enforce bans or expose IP addresses. IP collection should be limited, disclosed in a privacy notice, and protected with access controls.

## Build and deploy

This ZIP contains source files, not `node_modules` or generated `dist`. Run `npm install`, then `npm run build`. Deploy the generated `dist` folder using the same hosting workflow as the previous version.

The build could not be verified in this environment because the ZIP's bundled native Rolldown dependency did not include a compatible Linux binding. JavaScript syntax checks passed for the changed order system and existing main/admin scripts. Please run the build on your Windows machine before deploying.

## Test before publishing

1. Open the homepage and confirm the floating cart button appears.
2. Click Add to cart on a homepage dish and confirm its name/quantity appears.
3. Click a homepage dish's WhatsApp Order button and confirm it adds that dish and opens checkout.
4. Try WhatsApp with blank name/phone; it should ask for the missing details.
5. Enter name, phone, items, and delivery address if needed; confirm the WhatsApp message contains the details.
6. Repeat on Menu page and check the existing website order submission and admin order status flow.
7. Check admin at phone width and tablet width before deployment.


## नयाँ अपडेट: Customer Profile / My Orders (Pre-login UI)
- सबै मुख्य public pages मा My Account navigation link थपिएको छ।
- `account.html` मा order summary, previous orders र order status section थपिएको छ।
- नयाँ सफल website orders को विवरण browser-local history मा save हुन्छ।
- Firebase orderTracking token उपलब्ध भए status realtime मा update हुन्छ।
- Browser notification permission माग्ने UI छ; यो page खुला हुँदा status परिवर्तनमा मात्र notification दिन्छ।
- यो login integration होइन: history हाल सोही browser/device मा मात्र देखिन्छ। पुराना order records को पूरा विवरण Firebase बाट ग्राहकले पढ्न पाउने व्यवस्था अझै छैन।
- Google/Email login, cross-device history र background push notifications अर्को चरणमा जोड्नुपर्छ।
