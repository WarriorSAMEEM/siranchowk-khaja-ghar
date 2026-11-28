# Siranchowk Khaja Ghar — Final Deployment Guide

This package changes the order-write architecture. **Do not publish the new frontend before the updated Cloudflare Worker is deployed and configured.** The browser no longer has permission to create canonical orders directly; checkout deliberately fails closed when the Worker is unavailable.

## 0. Before touching production

1. Keep a backup of the currently deployed project and current Firebase rules.
2. The Firebase project configured in this source is `plasma-bounty-474104-m6`. Confirm that this is the intended production project in Firebase Console.
3. If a Firebase service-account JSON/private key was ever included in an older ZIP, repository, prompt, or public folder, revoke that key in Google Cloud IAM and create a new one. Removing an exposed copy does not revoke the credential.
4. Never put service-account JSON or a Gemini API key in frontend variables, source files, GitHub, or ChatGPT.

## 1. Prepare and deploy the Cloudflare Worker first

The Worker now handles:
- `create_order`: verifies Firebase ID token, current menu/stock/coupon pricing, store-open status and expected total; writes order, tracking, customer order mirror and coupon-use record atomically.
- `new_order_alert`: sends the admin order notification after the order is created.
- `maps_grounding`: optional Google Maps grounded nearby-place search.
- Existing admin/customer notification, creator moderation and protected media actions.

### Required Worker secret

From PowerShell, open the project folder, then run:

```powershell
Set-Location .\cloudflare-worker
Get-Content -Raw "$env:USERPROFILE\SKG-PRIVATE\firebase-service-account.json" | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
```

Use the newly rotated service-account JSON stored outside the project. Do not print or paste its contents into chat. The service account needs the Realtime Database and Firebase Cloud Messaging access required by this Worker.

### Optional Maps grounding secret

Only if you want the nearby-place question feature to return Google Maps grounded results:

```powershell
npx wrangler secret put GEMINI_API_KEY
```

The key is stored as a Worker secret. It is never sent to the browser. If omitted, the interactive map can still load, but grounded nearby-place search returns a safe “not configured” response.

### Validate and deploy

Still inside `cloudflare-worker`:

```powershell
npx wrangler deploy --dry-run
npx wrangler deploy
```

The actual deploy is a production change. Run it only after reviewing the dry-run and approving it.

Check the Worker health URL in a browser:

`https://siranchowk-notifications.minecraftboot411-cloudflare.workers.dev/health`

Use the exact URL returned by your Cloudflare account if it differs. The health response should report `ok: true`.

## 2. Publish Firebase Realtime Database rules

1. Open Firebase Console → project `plasma-bounty-474104-m6` → Build → Realtime Database → Rules.
2. Back up the current live rules.
3. Paste the complete `database.rules.json` from this package and review the diff.
4. Publish only after approving it.

Important behavior after these rules are published:
- Customers cannot write directly to `/orders`, `/orderTracking`, `/users/{uid}/orders`, or coupon-use locks.
- The trusted Cloudflare Worker writes those records using the service account.
- Customers can read their own account order history; tracking remains available only with the high-entropy tracking token.
- Owner/staff order updates continue through the existing RBAC rules.

Because the rules block direct customer order creation, make sure the new Worker is live first. If it is not live, checkout is supposed to fail rather than accept a client-calculated total.

## 3. Publish Firestore rules (only if the Firestore features are used)

`firestore.rules` was also hardened:
- Admin authority is based on the primary owner UID, not a hard-coded email address.
- Only the primary owner can create, update or remove admin records.
- An admin cannot grant admin access to another account.

The Firestore rules were not validated with the official emulator in this review. First run the Firestore Emulator/rules tests in a separate staging project. Then, after reviewing the diff, publish with:

```powershell
firebase deploy --only firestore:rules
```

Do not skip emulator validation if saved places or user-preference features are important to production.

## 4. Firebase Authentication

In Firebase Console → Authentication → Sign-in method:
1. Enable Email/Password.
2. Enable Google only if you want Google sign-in.
3. Under Authorized domains, add `siranchowk-khaja-ghar.pages.dev` and any production custom domain.
4. Confirm the primary owner UID is `47SB1i4UL5hlUVPqM1tQoKJFdaM2` before deploying rules.

## 5. Configure Cloudflare Pages

Pages → your project → Settings → Environment variables. Configure these for Production (and Preview if needed):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_PUSH_WORKER_URL` — exact deployed Worker URL, without guessing it
- `VITE_VAPID_PUBLIC_KEY` — the public Web Push VAPID key if background push is enabled
- `VITE_GOOGLE_MAPS_API_KEY` — optional browser Maps JavaScript key

`VITE_FIREBASE_API_KEY`, `VITE_GOOGLE_MAPS_API_KEY`, and VAPID public key are browser-side configuration, not service-account secrets. Restrict the Firebase web API key and Maps key by allowed HTTP referrers and only the APIs actually used.

The Pages environment `VITE_PUSH_WORKER_URL` takes precedence over an older Worker URL saved under `settings/pushPublic`, so the frontend uses the Worker you configured for this build.

### Build settings

- Build command: `npm run build`
- Output directory: `dist`
- Node version: `22.12.0` or later

Deploy from the Git repository only after the local checks below pass and the Worker/rules are ready.

## 6. Local verification before publishing

Use Node.js 22.12+ on the Windows machine:

```powershell
npm ci
npm run check
npm test
npm run build
npm run preview
```

The Express/Vite development server is `http://127.0.0.1:3000/`. The static production preview is `http://127.0.0.1:4173/`.

This review environment completed `npm run check` and the Worker hardening tests, but its `npm ci` timed out. Therefore the full test suite and Vite production build must still be run successfully on your machine before publishing.

## 7. Required live smoke tests

Use a staging/test customer account and a small test order first:

1. Signed-out visitor clicks Add to cart → redirected to login; the selected item is restored after successful login.
2. Signed-out visitor cannot submit checkout or WhatsApp order actions.
3. Signed-in customer adds Chicken Momo and checks the displayed total is Rs. 130.
4. Place a test order. Confirm the Worker creates `/orders/{id}`, `/orderTracking/{token}` and `/users/{uid}/orders/{id}` with `priceStatus: server_verified`.
5. Tamper with the browser-side price or expected total in a test environment → Worker must reject the mismatch and create no order.
6. Confirm Roti remains non-orderable online while its price is unset.
7. Confirm customer can see only their own order history and can track with their own token.
8. Update order status as an authorized staff account; verify customer account tracking and notifications.
9. Test admin new-order push on a real phone/browser if FCM is configured.
10. Test Maps grounding only if `GEMINI_API_KEY` was configured.
11. Test at desktop, tablet and mobile widths; inspect contrast, keyboard focus and horizontal overflow.

## 8. Important hosting limitation

Cloudflare Pages deploys the Vite `dist/` static website. It does **not** automatically deploy the Express routes in `server.ts` or `server-platform.ts`. The production order and Maps-grounding flows now use the Cloudflare Worker. Client-side community/profile content uses Firebase directly. Article/profile-specific server-rendered SEO metadata is still not implemented for the static Pages deployment; a separate Pages Functions/Worker SSR implementation is required if that becomes a production requirement.

## 9. Rollback

Keep the old Pages deployment and old Firebase rules version available. If a smoke test fails:
- Roll back the Pages deployment to the previous known-good version.
- Restore the previous RTDB rules only if necessary and only after assessing the security impact; the old rules may permit direct client order writes.
- Do not restore a revoked service-account key.


For the latest file-by-file review summary and exact verification limitations, read `FINAL-LOCAL-REVIEW.md`.
