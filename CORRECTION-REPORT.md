# Correction Report — Siranchowk Khaja Ghar

## What was changed

- Removed the nested legacy production ZIP. It contained a Firebase service-account JSON file under a public-assets path. That archive is not needed to build or deploy the website.
- Removed generated `dist/` and `node_modules/` from the deliverable so it contains source files only and does not carry stale build output or platform-specific dependencies.
- Tightened Realtime Database rules:
  - Active staff cannot delete orders through the order-update rule.
  - Order reads, updates, cancellations, order tracking, and customer order mirrors now check the effective role/individual permissions.
  - Order-processing staff can update only the inventory stock fields and menu availability fields required for automatic stock deduction; inventory definitions remain manager-controlled.
  - Device reads and staff/settings management respect role permissions.
  - Notification-history child reads no longer bypass the parent permission rule.
- Updated the inventory sync timestamps to write to the narrowly permitted `updatedAt` child path.
- Updated the Cloudflare Worker to validate public order-alert requests and authenticate admin requests before obtaining a Google service-account access token.
- Standardized the Worker on one secret: `FIREBASE_SERVICE_ACCOUNT_JSON`. Added a required-secret declaration to Wrangler configuration and corrected the deployment guide.
- Restricted Vite development and preview servers to `127.0.0.1`; removed the permissive `allowedHosts: true` setting.
- Added `npm run check` / `npm run lint` project validation and two automated Cloudflare Worker smoke tests.
- Updated the README and deployment instructions.

## Checks completed on the final ZIP

- `npm run check` — passed.
- `npm test` — 2 tests passed:
  - Public new-order alert validation, dispatch, and duplicate suppression.
  - Firebase ID-token verification for authenticated admin alerts.
- JavaScript syntax checks — passed for 47 JavaScript files.
- Inline HTML JavaScript syntax — passed.
- Relative module imports and local HTML asset references — passed.
- JSON configuration parsing and root-default-deny rule checks — passed.
- Publishable-file credential scan — passed.
- ZIP integrity check — passed.

## Checks not completed

A production Vite build was not completed in this Linux workspace. The uploaded ZIP's bundled `node_modules` came from Windows and did not include the Linux Rolldown native binding; the package manager could not complete a fresh install in this environment. The corrected ZIP therefore excludes `node_modules/` and `dist/`. Install dependencies on the Windows machine before building:

```powershell
npm ci
npm run check
npm test
npm run build
npm run preview
```

Vite 8 requires Node.js 22.12+ (or 20.19+). The preview URL is `http://127.0.0.1:4173/`.

Firebase Realtime Database rules and the Cloudflare Worker were not deployed. No live orders, customer records, staff accounts, or Cloudflare secrets were changed. Publish the updated `database.rules.json` and deploy the Worker only after local review and approval.

## Credential warning

The removed nested archive contained a copy of a service-account credential. Removing that copy from this corrected ZIP does **not** revoke or rotate the original credential. It remains the user's responsibility to keep the existing key only in the Cloudflare Worker Secret `FIREBASE_SERVICE_ACCOUNT_JSON` and outside the website project, GitHub, and `public/`. Because the user chose to continue using the old key, this report does not claim that the key is safe.
