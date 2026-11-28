# Current Security Specification — Siranchowk Khaja Ghar

## Realtime Database

- Root `.read` and `.write` remain denied by default.
- Customer profile, devices, activity, notifications and order mirrors are isolated by Firebase Auth UID.
- Customers cannot write canonical `/orders`, `/orderTracking`, `/users/{uid}/orders` or coupon-use records directly.
- Customer orders are created only through the Cloudflare Worker `create_order` action, which verifies the Firebase ID token, current menu/stock/coupon pricing and order inputs before one atomic multi-location RTDB update.
- The browser fails closed when the Worker is unavailable or the server-calculated total differs from the displayed total.
- Per-customer idempotency references prevent duplicate order creation after a lost response; cart, coupon and tracking-token local storage is scoped per Firebase UID.
- Staff order changes require active staff status and effective RBAC permissions; staff cannot create canonical orders or delete existing orders through their update path.
- Order tracking reads require the 48-character unguessable tracking token.
- Public menu and explicitly public profile/article data are readable only on their designated paths. Private drafts, customer PII, staff data, orders and analytics remain protected.

## Firestore

- Admin authority is based on the primary owner UID `47SB1i4UL5hlUVPqM1tQoKJFdaM2` and owner-created admin records; no hard-coded email address grants admin access.
- Only the primary owner can create, update or remove admin records. Other admins cannot grant additional admin access.
- Customer preferences and saved places are isolated by authenticated UID.
- Unused concierge chat-session rules and client functions were removed.

## Cloudflare Worker

- `FIREBASE_SERVICE_ACCOUNT_JSON` is a required Worker secret; never place it in frontend code, GitHub or public assets.
- `GEMINI_API_KEY` is optional and is used only by the Worker-backed Google Maps grounding action.
- `create_order` requires a valid Firebase ID token and is rate-limited.
- `maps_grounding` validates input, uses the server-side API key, applies a request limit and returns only HTTPS Google Maps links.
- Existing staff actions use Worker-side Firebase ID-token verification and RBAC checks.

## Required validation before production

1. Validate `database.rules.json` with the official Firebase Realtime Database Emulator/Rules Playground.
2. Validate `firestore.rules` with the official Firestore Emulator in a staging project.
3. Run the full dependency install, `npm run check`, `npm test` and `npm run build`.
4. Deploy the Worker before publishing the RTDB rules and new Pages frontend.
5. Run live staging tests for customer login, cart restoration, secure checkout, order tracking, staff order updates, notifications and Maps grounding.

## Known integrity limitations requiring follow-up

- Public browser analytics events/session/profile writes are currently write-only at RTDB but are not routed through the Worker. They can be spoofed or inflated by automated clients; do not treat them as authoritative business or security metrics.
- Social engagement counters have bounded client-side +/-1 writes but do not have server-side cross-checks against unique like/follow/comment edges. Automated authenticated clients may manipulate counts.
- Single-use coupon use is checked against RTDB but lacks an atomic reservation across different devices.
- Inventory is deducted when staff confirms/processes an order, not reserved when a pending order is first created. Multiple pending orders can race against low stock.

These limitations are recorded rather than hidden. A production hardening phase should move these writes behind rate-limited Worker actions and add tested transactional reservation/reconciliation before using the metrics or coupon/stock constraints for high-stakes business decisions.
