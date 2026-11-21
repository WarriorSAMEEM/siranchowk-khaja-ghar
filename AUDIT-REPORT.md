# Siranchowk Khaja Ghar — Firebase + Cloudflare Audit Report

Audited: the supplied project ZIP (`database.rules.json`, `firestore.rules`, JavaScript files, `cloudflare-worker/`) plus the separately supplied RTDB JSON export. The export is not included in the distributable ZIP.
Nothing was published, deployed, or changed in production. No secrets were created or read.

## 0. Read this first — inputs that were not what the brief described

| Brief says | What was actually supplied / found | Consequence |
|---|---|---|
| A "supplied replacement Rules file" (owner-only, no staff/rbac) | Only the ZIP's own `database.rules.json` (the legacy staff/rbac rules). No replacement file arrived. | I audited and patched the ZIP's rules. I did **not** drop `staff`/`rbac`: the code needs them (see §2). |
| A Realtime Database JSON export | The actual export `plasma-bounty-474104-m6-default-rtdb-export(2).json` was supplied and inspected after the first audit report was written. | This revised report includes the observed root paths and structures. The export is audit input only and is deliberately not copied into the distributable ZIP because it contains customer data and FCM registration tokens. |
| `pushSubscriptions/*` and `pushNotificationEvents/*` are used | The export DOES contain both paths. `pushSubscriptions/admin/{uid}/{subscriptionId}` and `pushSubscriptions/customer/{trackingToken}/{subscriptionId}` each contain `{fcmToken, registeredAt}`. `pushNotificationEvents/adminNewOrders/{eventId}` contains `{createdAt}`. However, no frontend code, Worker code, or current rules reference these paths. | These are legacy/orphaned data paths relative to the supplied code. The revised rules explicitly deny client reads/writes to both paths to protect FCM bearer tokens and prevent unsupported writes. Existing records are preserved; nothing was deleted or migrated. If the old feature must be reactivated, implement a reviewed migration/server-only design first. |
| Firebase project `siranchowk-khaja-ghar` | Every config (`firebase-applet-config.json`, `wrangler.toml`, Worker tests, RTDB URL) uses project `plasma-bounty-474104-m6`. They are consistent with each other. | **Owner must confirm** which project ID is real before deploying. If it is `siranchowk-khaja-ghar`, `wrangler.toml` and the Pages build variables must change together. |
| Firebase Rules Emulator | The official emulator jar cannot be downloaded in this sandbox. | Rules were tested with `targaryen`, an offline simulator that evaluates the real `database.rules.json`. This is **not** the official emulator; see §6 for what is and isn't verified. |

### Actual RTDB export reconciliation (added after the initial report)

The supplied export has exactly these root keys: `analytics`, `orderTracking`, `orders`, `pushNotificationEvents`, `pushSubscriptions`, `users`, `visitorProfiles`, and `visitorSessions`. The two notification paths were present in the export but absent from the current application code. The export contained one `pushNotificationEvents/adminNewOrders` record, an `admin` subscription under the owner UID, and a `customer` subscription keyed by a 48-character tracking token. Each subscription record contained an FCM token and registration timestamp. These values are sensitive registration credentials; the export is not included in the output ZIP.

The revised `database.rules.json` now explicitly sets `.read: false` and `.write: false` at both `pushSubscriptions` and `pushNotificationEvents`. This is intentionally conservative because the supplied current app does not use these paths. It does not delete or modify existing database records. It prevents public or client access to stored FCM tokens until a supported server-side migration is designed.

The export's RTDB URL, `firebase-applet-config.json` project ID, `js/firebase.js` project-to-database mapping, and `cloudflare-worker/wrangler.toml` all consistently identify project ID `plasma-bounty-474104-m6`. `siranchowk-khaja-ghar` is the website/Cloudflare Pages name, not the Firebase project ID shown in these configurations. The production project identity still needs the owner to confirm in Firebase Console before publishing or deploying.

## A. Summary of findings

The core security design is sound and was confirmed by tests: root is default-deny; anonymous users cannot read orders, analytics, sessions, profiles or staff; customers are isolated by uid; the primary owner UID is protected; `loginHistory`/`securityLogs` are Worker-write only.

Gaps found and fixed (13), plus 11 open items that need your decision (§D2).
Before the fixes, 9 of 31 rules scenarios failed; after, all pass.

## B. Firebase paths used by the application

Realtime Database (from every `ref()` / Worker REST call):

| Path | Used by |
|---|---|
| `orders/{id}` | `js/order-system.js:691-742` (create), `admin/js/orders.js` (read/update), `js/inventory-sync.js` (flags), Worker `new_order_alert` |
| `orderTracking/{token}` | `js/order-system.js:745` (create), `js/order-system.js:941`, `js/account.js:766` (read), `admin/js/orders.js:468,619` (staff update) |
| `users/{uid}/profile` (+`/notificationPreferences`, `/loginCount`) | `js/customer-auth.js`, `js/account.js:640`, `js/notifications-client.js` |
| `users/{uid}/devices/{deviceId}` | `js/notifications-client.js:113,146,166`; Worker reads for customer push |
| `users/{uid}/activity/{id}` | `js/activity-logger.js:311` |
| `users/{uid}/orders/{id}`, `/coupons/{id}`, `/notifications/{id}` | `js/order-system.js:753-783`, `admin/js/orders.js:179,476` |
| `staff/{uid}`, `rbac/roles` | `admin/js/auth.js:75,123`, `staff.js`, `roles.js`, Worker permission checks |
| `adminDevices/{deviceId}` | `js/device-manager.js:145-298`, `js/notifications-client.js:187-229`, `admin/js/devices.js` |
| `adminNotifications/{id}` | `js/inventory-sync.js:99`, `admin/js/notifications.js:489` |
| `notificationHistory/{channel}/{id}` | `js/activity-logger.js:471`, Worker |
| `auditLogs/{id}` | `js/audit-logger.js:42` |
| `loginHistory`, `securityLogs` | Worker only (write); admin reads |
| `analytics/events/{id}` | `js/analytics-tracker.js:326` (write); admin reports (read/delete) |
| `visitorSessions/{id}`, `visitorProfiles/{id}` | `js/analytics-tracker.js:282-283` (write); admin reads |
| `menu_items`, `categories`, `offers`, `announcements/customer` | public read; staff write |
| `settings/business`, `settings/pushPublic`, `settings/analytics`, `settings/notificationTemplates` | `js/main.js:303`, `js/notifications-client.js:36,63`, admin settings |
| `inventory/items`, `inventory/movements`, `inventory/stockAvailability` | `js/inventory-sync.js`, `admin/js/inventory.js`, `js/main.js:295` |
| `pushSubscriptions/*`, `pushNotificationEvents/*` | **legacy data exists in the supplied export; current app does not use it; explicitly denied** |

Cloud Firestore (separate service, chatbot/maps features): `admins`, `userPreferences`, `chatSessions` (+`messages`), `savedPlaces` via `js/firestore-service.js`.

## C. Permission matrix (after fixes)

Staff roles use the defaults in `js/rbac.js` unless `rbac/roles` or `staff/{uid}/customPermissions` override them. R = read, C = create, U = update, D = delete. "—" = denied.

| Path | Anonymous | Signed-in customer | Staff (officer/helper/moderator, defaults) | Admin | Owner |
|---|---|---|---|---|---|
| `orders` list | — | — | R | R | R |
| `orders/{id}` | C (valid pending website order only) | C (valid, own uid only) | U (status etc.); cancel only if allowed; no delete | U incl. cancel | R/U |
| `orderTracking/{token}` | R with the 48-char token; C only if token matches that order | same | U status/message (cancel per perm) | U | U |
| `users/{uid}/profile` | — | R/U own only | R (moderator+ via `users` read) | R | R |
| `users/{uid}/devices` | — | R/C/U own only | — (moderator/admin can read via `users`) | R | R |
| `users/{uid}/activity` | — | C own (append-only) | C (order staff) | C | C |
| `users/{uid}/orders,coupons,notifications` | — | C own once; no edits | U orders/notifications (updateOrders) | U | U |
| `analytics/events` | **C** (schema-validated) | C | R only with analytics perms; D owner only | R | R/D |
| `visitorSessions`, `visitorProfiles` | **C/U** (schema-validated, no read, no delete) | same | R only with analytics perms | R | R/D |
| `adminDevices/{id}` | — | — | read own; C own **pending**; U own non-privileged fields | — (owner approves) | R/C/U/D |
| `adminNotifications` | — | — | C only category `low_stock` (needs updateOrders) | C (manageInventory) | C |
| `staff/{uid}` | — | — | R own record | R all; C/U lower roles | R/C/U/D (not self-delete) |
| `rbac/roles` | — | — | R | R | R/W |
| `inventory/stockAvailability`, menu, categories, offers, announcements, `settings/business`, `settings/pushPublic` | R | R | per permission | per permission | R/W |
| `auditLogs` | — | — | C (own actor uid) | R | R |
| `loginHistory`, `securityLogs` | — | — | — | — | R (writes only via Worker) |
| `pushSubscriptions`, `pushNotificationEvents` | — | — | — | — | — (legacy export data; explicit deny; preserved in database) |

## D. Rules/code mismatches

### D1. Fixed

| # | Source (original line) | Problem | Fix |
|---|---|---|---|
| 1 | `js/device-manager.js:149` | Non-owner staff do `get(adminDevices/<new id>)` before registering; rules denied reading a missing device, so a helper/officer/moderator/admin's first-device login threw. | Rules: active staff may read a **non-existent** `adminDevices/{id}` (learns nothing). |
| 2 | `js/inventory-sync.js:99,112` | Order staff trigger low-stock alerts, but rules blocked `adminNotifications` writes and `inventory/items/{id}/lowStockAlertSentAt`; Worker also returned 403. Alerts silently failed for officer/moderator/helper. | Rules: `low_stock` alerts by order staff (sender must equal caller) + `lowStockAlertSentAt`. Worker: `admin_alert` with category `low_stock` allowed for `updateOrders`. All other broadcasts still need `sendNotifications`/`manageInventory` (tested). |
| 3 | `cloudflare-worker/worker.js` `hasPerm` | Fallback was `role === "admin"`, so with no `rbac/roles` (your export has none) officers/helpers/moderators were refused by the Worker although rules and `js/rbac.js` allow them. | Worker uses a defaults table identical to `js/rbac.js`; a test fails if they drift. |
| 4 | worker `new_order_alert`, `customer_order_update` | Unauthenticated `orderId` and staff `customerUid` were placed into REST URLs unvalidated (`../` path traversal). | ID allow-list + per-segment URL encoding; tested. |
| 5 | worker `rtdbGet/Patch/Post` | OAuth token sent as `?access_token=` in URLs (ends up in logs). | `Authorization: Bearer` header. |
| 6 | worker top-level `catch` | Missing/invalid secret produced a generic 500 "Worker execution error". | Typed config error → `503 {"code":"worker_not_configured"}`; response names nothing; `wrangler tail` shows the missing **name** only. Covers missing secret, bad JSON, wrong project, bad key, rejected credential, missing vars. |
| 7 | `js/order-system.js:745` / rules `orderTracking` | Anyone could pre-create tracking records for any unused 48-char token and any `orderId`; unknown fields (e.g. PII) allowed. | Creation now requires `orders/{orderId}/customerTrackingToken === token` (the app writes the order first, so the real flow still works); unknown fields rejected. |
| 8 | `js/analytics-tracker.js:326-332` / rules | Event creation only required `eventType`+`timestamp`: unlimited keys and sizes. | Per-field type/length schema, unknown keys rejected. Older events (missing newer fields) still validate. |
| 9 | `js/analytics-tracker.js:282-283` | Session/profile writes unvalidated; a profile's `firstVisitAt` could be rewound. | Schema for both; `firstVisitAt` cannot go backwards. |
| 10 | `js/notifications-client.js:113,146,210` | `fcmToken` unvalidated in both token locations. | Rules: URL-safe charset, ≤4096. Worker: invalid tokens are reported `failed` and never sent to FCM. |
| 11 | `adminDevices` rules | `pushStatus`, `approvalStatus`, `blocked` unconstrained. | Enum/boolean validation. |
| 12 | `package-lock.json` | Out of sync with `package.json` → `npm ci` failed, baseline `npm test` could not run. | Regenerated with `npm install`; `npm ci` verified. |
| 13 | `package.json` | `npm test` ran only `worker.test.js`. | Now `node --test scripts/*.test.js`. |

### D2. Not fixed — needs your decision or is out of scope

1. **Rate limiting is per-Worker-isolate memory** (`RATE_LIMIT_BUCKETS`). It slows casual abuse but is not a global limit. Add a Cloudflare Rate Limiting rule on the Worker route (dashboard setting).
2. **Anonymous analytics/session/profile writes are inherently open**; I can only validate shape. Volume abuse needs Firebase App Check or a Cloudflare rule.
3. **`new_order_alert` 15-minute window uses the customer's device clock** (`createdAt`). A phone whose clock is >15 min wrong still places the order but no admin push is sent. I did not add a rules check on `createdAt` because that would reject the customer's order itself.
4. **`pushAlertDispatched` is check-then-set** (not atomic): two simultaneous requests could both notify.
5. **Staff with `users` read access (moderator/admin) can read customers' `fcmToken`s** via `users/{uid}/devices`. Not public; removing it needs moving tokens to a server-only path (a redesign I did not do).
6. **Dead FCM tokens are never pruned** after `UNREGISTERED` responses.
7. **`customer_order_update`: any staff with `updateOrders` can push a custom message to any customer uid** (by design for status updates).
8. **`firestore.rules` hard-codes an admin by e-mail (`minecraftboot411@gmail.com`, verified)** in addition to an `admins` collection, a different identity model from the owner-UID model used for RTDB. Firestore rules were **not tested** (no emulator). Confirm this is intended, or tell me to align it to the owner UID.
9. **Firebase web API key is committed** in `firebase-applet-config.json`. That is normal for Firebase web apps, but restrict it by HTTP referrer in Google Cloud Console.
10. **Project ID mismatch** with the brief (see §0).
11. **Service-account key history**: `CORRECTION-REPORT.md` says an earlier ZIP contained a service-account JSON. Removing the copy does not revoke it. Rotate that key (Google Cloud -> IAM -> Service accounts -> Keys), then `wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON` with the new one.

## E. Modified and added files

| File | Change |
|---|---|
| `database.rules.json` | Fixes 1, 2, 7-11 above; explicitly denies the two legacy export-only notification paths. Existing authorization logic untouched; staff/rbac preserved. |
| `cloudflare-worker/worker.js` | Fixes 2-6, 10; exports `DEFAULT_ROLE_PERMISSIONS`, `isPlausibleFcmToken` for tests. |
| `scripts/rules.test.js` (new) | 31 rules scenarios built from the app's real payloads. |
| `scripts/worker-hardening.test.js` (new) | 16 Worker tests. |
| `package.json`, `package-lock.json` | Test script; `targaryen` dev dependency; lockfile synced. |
| `DEPLOYMENT-GUIDE.md` | Rule verification, Worker config table, deploy commands. |
| `AUDIT-REPORT.md` (new) | This report. |

No frontend source files needed changes: every mismatch was resolvable in the rules or Worker without weakening security.

## G. Test results (actual)

| Command | Result |
|---|---|
| Baseline (original ZIP) `npm ci` | **Failed** (lockfile out of sync) |
| Rules suite on **original** rules | 31 tests: **22 pass, 9 fail** (the gaps above) |
| `npm test` (final) | **64 / 64 pass** (31 rules + 17 existing Worker + 16 new Worker) |
| `npm run check` | **Pass** (13 checks) |
| `npm run build` | **Pass** |
| `wrangler deploy --dry-run` (wrangler 4.166) | **Pass**; config and bindings parse |
| Rendering, 7 pages × desktop 1366×800 and mobile 390×844 | No horizontal overflow, no JavaScript errors (the sandbox cannot reach Firebase, so live login/order flows were **not** exercised) |

Brief's test list → coverage: 1-6 `orders`/`orderTracking` tests; 7 owner tests; 8-9 `users` tests; 10-13 analytics/visitor tests; 14-15 `adminDevices` / `users/devices` tests (the real push-registration paths); 16 the legacy `pushNotificationEvents` and `pushSubscriptions` paths are unused by current code and explicitly denied; 17-19 Worker CORS/auth/secrets tests; 20 rendering only.

## H. Cloudflare Worker deployment instructions

1. Confirm the Firebase project ID (§0). Keep `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL` in `wrangler.toml` matching it.
2. Rotate the service-account key if it was ever in a ZIP/repo (§D2.11). Create the key for a service account with Firebase Realtime Database + Cloud Messaging access.
3. `cd cloudflare-worker`; `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --name siranchowk-notifications` and paste the JSON when prompted (do not put it in a file in this repo).
4. `npx wrangler deploy --dry-run`, then `npx wrangler deploy` after you approve.
5. Cloudflare Pages -> Settings -> Variables: `VITE_PUSH_WORKER_URL` = Worker URL (plus the `VITE_FIREBASE_*` and `VITE_VAPID_PUBLIC_KEY` values from `.env.example`).
6. Add a Cloudflare Rate Limiting rule for the Worker route.
7. Smoke test: `npx wrangler tail`, place a test order on the site; expect no `[worker-config]` lines.

## I. Required Cloudflare configuration names (no values)

- **Secret:** `FIREBASE_SERVICE_ACCOUNT_JSON`
- **Variables (in `wrangler.toml`):** `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL`, `PRIMARY_OWNER_UID`, `ALLOWED_ORIGINS`
- **Pages build variables:** `VITE_PUSH_WORKER_URL`, `VITE_VAPID_PUBLIC_KEY`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`
- `GEMINI_API_KEY` / `VITE_GOOGLE_MAPS_API_KEY` are used by the optional `server.ts` chatbot/maps server, not by the Worker.

## J. Production-readiness checklist

- [ ] Confirm Firebase project ID (§0)
- [ ] Re-run the key rules scenarios in the Firebase **Rules Playground** or Emulator (the simulator is not the official engine)
- [ ] Approve, then publish `database.rules.json` (keep the old version for rollback)
- [ ] Rotate the service-account key if it was ever exposed; set `FIREBASE_SERVICE_ACCOUNT_JSON`
- [ ] Approve, then deploy the Worker; set `VITE_PUSH_WORKER_URL`
- [ ] Add Cloudflare rate-limit rule; consider Firebase App Check
- [ ] Restrict the Firebase web API key by referrer
- [ ] Decide on the Firestore e-mail admin (§D2.8) and test Firestore rules in the emulator
- [ ] Live test on the deployed site: guest order, signed-in order, tracking page, staff status update, helper first-device login, low-stock alert, admin new-order push on a real phone
- [ ] Review §D2 open items

## Independent revalidation after receiving the actual RTDB export

The following checks were run again in the repair workspace after reconciling the export:

| Check | Result | Notes |
|---|---|---|
| `node scripts/verify-project.js` | PASS | All 13 project checks passed, including 53 JavaScript syntax checks, import/path checks, Firebase config checks, default-deny root, and credential/archive scan. |
| `node --test scripts/worker-hardening.test.js` | PASS | 16/16 Worker hardening tests passed. |
| `python -m json.tool database.rules.json` | PASS | Rules file is valid JSON. This does not parse/evaluate Firebase Rules expressions. |
| Actual RTDB export reconciliation | PASS | Confirmed the eight root keys and legacy notification data shapes. The export itself is not included in the ZIP. |
| Full `npm ci` in this workspace | NOT COMPLETED | Install attempt timed out; the resulting `node_modules` is incomplete. |
| Full `npm test` | NOT COMPLETED HERE | The Worker hardening suite passes, but the existing Worker suite cannot load because the incomplete install is missing `firebase/app`; the Rules suite also requires `targaryen`, which is missing. Claude's earlier report records 64/64 passing in its own environment; that result has not been independently reproduced in this workspace. |
| `npm run build` | NOT RUN HERE | Vite is missing from the incomplete dependency installation. Claude's earlier report records a successful build in its environment; not independently reproduced here. |
| Official Firebase Emulator / live Firebase / live FCM | NOT VERIFIED | Do not treat the package as production-approved until these are checked. |

This revised package is a locally audited candidate, not a production certification. Do not publish rules or deploy the Worker until the full dependency install, full test suite, official Firebase Rules validation, and live smoke tests have been completed.
