# Siranchowk Khaja Ghar — Website & Order Desk

A Vite + Firebase website for Siranchowk Khaja Ghar, Khairahani-6, Parsa, Chitwan.

## What is included

- Public restaurant website and menu.
- Menu cart with quantity controls and cart persistence on the same browser.
- Website order requests saved to Firebase Realtime Database.
- WhatsApp order handoff and click-to-call fallback.
- Customer order tracking by a high-entropy private tracking token.
- Focused admin panel with only Dashboard and Customer Orders.
- Live in-panel notifications for new orders and status changes.
- Optional browser notifications while the admin panel is open.
- Realtime Database rules in `database.rules.json`.

## Local development

Requirements: Node.js 20.19+ (or a current supported LTS release) and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

Build the production site:

```bash
npm run build
npm run preview
```

## Firebase setup — required before accepting live orders

1. Open the Firebase Console for the existing project.
2. Open **Realtime Database → Rules**.
3. Review `database.rules.json` in this project and publish those rules.
4. Confirm that the authorized Firebase Authentication UID in the rules is the same admin UID already used in `admin/js/auth.js`.
5. Test as a signed-out visitor: website order creation should work, but reading the orders list must be denied.
6. Test as the authorized admin: the admin panel should be able to read orders and update order statuses.

Do not publish permissive rules such as `.read: true` or `.write: true` at the database root. Do not share passwords or service-account private keys.

## Order behaviour and important limitations

- A website checkout creates a **pending order request**. It is not automatically accepted or confirmed.
- The restaurant must check availability and contact the customer before accepting/preparing the order.
- Menu prices are not configured as verified numeric prices in the supplied project. The website therefore does not invent a total; staff must confirm the final price with the customer.
- Delivery is subject to the restaurant confirming the address and availability.
- WhatsApp uses the restaurant number already present in the project. The customer can also call the same number.
- In-panel alerts and browser notifications work while the admin panel is open. Background push notifications after the browser is closed are **not enabled**; they require a Firebase Web Push VAPID key, token registration, and deployed Cloud Functions.

## Admin panel

Open `/admin/login.html` and use the existing Firebase Email/Password admin account. No new login system or admin account has been added.

The admin panel intentionally focuses on:
- Dashboard overview.
- Incoming website orders.
- Customer contact actions.
- Order status updates.

Website copy and SEO metadata remain in the website source and are not editable from the admin panel.

## Deployment

The project includes `firebase.json` pointing to `database.rules.json` and the optional `functions` directory. Publishing database rules and deploying Cloud Functions are separate Firebase operations; building the website does not publish either one.

Before deploying, run `npm run build` and inspect the generated `dist` folder. Never upload `.env.local`, `node_modules`, or local development files as part of the website deployment.
