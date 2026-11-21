> **Data compatibility note:** The supplied RTDB export contains legacy `pushSubscriptions` and `pushNotificationEvents` records, but the current frontend and Worker do not use those paths. The current rules explicitly deny client access to them to protect stored FCM tokens. Existing records are not deleted. Do not re-enable these paths without a reviewed server-side migration.

# Siranchowk Khaja Ghar — Production Deployment & Setup Checklist

Follow these steps to publish your upgraded site, Realtime Database security rules, and Web Push Worker without committing any private keys or credentials.

---

## 1. Publish Firebase Realtime Database Security Rules (Required First)

1. Open the [Firebase Console](https://console.firebase.google.com/) and select project **`plasma-bounty-474104-m6`**.
2. Go to **Build → Realtime Database → Rules**.
3. Copy the entire contents of `database.rules.json` from the project root and paste it into the Firebase Rules editor.
4. Click **Publish**.
   - **Why this is required:** Customer account isolation (`users/$uid`, `users/$uid/activity`, `users/$uid/devices`), single-use coupon locks, 5-tier staff RBAC (`staff/` & `rbac/roles`), persistent admin device control & per-device preferences (`adminDevices/`), inventory & stock logs (`inventory/items`, `inventory/movements`, `inventory/stockAvailability`), write-only public visitor telemetry (`analytics/events`, `visitorSessions`, `visitorProfiles`), append-only `loginHistory`, `auditLogs`, and `securityLogs`, role-restricted 5-channel `notificationHistory`, editable notification templates, and `settings/analytics` permissions are enforced inside Firebase using these rules.
   - Alternatively, deploy from CLI if Firebase CLI is installed:
     ```bash
     firebase deploy --only database
     ```

---

## 2. Enable Firebase Authentication Providers

1. In Firebase Console, open **Build → Authentication → Sign-in method**.
2. Confirm **Email/Password** is **Enabled** (used for both Customer accounts and Staff Admin accounts).
3. Enable **Google** Sign-In if you want customers to use **"Continue with Google"** on `account.html`.
4. Under **Authentication → Settings → Authorized domains**, add your Cloudflare Pages domain (e.g. `siranchowk-khaja-ghar.pages.dev`) and any custom domain.

---

## 3. Deploy Frontend Website via GitHub + Cloudflare Pages (Free Tier)

1. Push the upgraded project directory to your GitHub repository (excluding `node_modules/`, `dist/`, and any `.env*` files — `.gitignore` already protects these).
2. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages → Create → Pages → Connect to Git**.
3. Select your repository and configure build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Node version (Environment variable):** `NODE_VERSION = 22`
4. Click **Save and Deploy**. Cloudflare Pages builds both the customer site and `/admin/admin.html`.

---

## 4. Enable Background Push Notifications via Cloudflare Worker (Optional / Free Tier)

In-panel live alerts and customer tracking work immediately via Firebase Realtime Database. To also send background OS/browser push notifications when tabs are closed:

1. **Generate Web Push VAPID Key in Firebase:**
   - Firebase Console → **Project Settings → Cloud Messaging → Web Push certificates**.
   - Click **Generate key pair** and copy the **public key**.
   - Paste it inside **Admin Panel → Settings → Public VAPID Key** and save.

2. **Create a Firebase Service Account Key (Keep Private — Never Upload to GitHub):**
   - Firebase Console → **Project Settings → Service accounts → Generate new private key**.
   - Keep the downloaded JSON safely on your computer; extract `client_email` and `private_key`.

3. **Set the single private Worker secret and deploy:**
   - Keep the downloaded service-account JSON outside the website project and outside `public/`.
   - In PowerShell, from the project folder, set the full JSON as one Worker secret (the value is read from the private file and is never printed). `wrangler secret put` immediately publishes a Worker version:
     ```powershell
     Get-Content -Raw "$env:USERPROFILE\SKG-PRIVATE\firebase-service-account.json" | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --name siranchowk-notifications
     ```
   - Then deploy the Worker:
     ```powershell
     cd cloudflare-worker
     npx wrangler deploy
     ```
   - The Worker expects exactly `FIREBASE_SERVICE_ACCOUNT_JSON`; the older split secrets `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` are not used by this version.
   - Never paste the JSON or private key into ChatGPT, source files, GitHub, or the website's `public/` folder.
   *(If upgrading an existing deployment, confirm the Cloudflare secret name and Worker configuration match `cloudflare-worker/worker.js` so new-order and per-device notifications execute server-side.)*
4. Copy your deployed Worker URL (e.g., `https://siranchowk-push-worker.yourname.workers.dev`).
5. Sign in to **Admin Panel (`admin/admin.html`) → Settings → Cloudflare Push Worker URL**, paste the URL, and save.
6. Update `ALLOWED_ORIGIN` in `cloudflare-worker/wrangler.toml` if you use a custom domain, then re-run `npx wrangler deploy`.

---

## 5. First-Time Owner Sign-In Checklist

1. Open `/admin/login.html` and sign in with your Owner email & password (UID: `47SB1i4UL5hlUVPqM1tQoKJFdaM2`).
2. The very first Owner device automatically bootstraps as `approved`. Any additional Owner devices (2nd/3rd phone or laptop) and all Admin/Staff devices register as `pending` until you approve them under **Devices**.
3. Open **Devices** (or **Notification Center → My Device Preferences**) to enable push alerts and customize per-device categories (`New Website Orders`, `Order Cancellations`, `Important Order Updates`, `Security Alerts`, `Staff Announcements`).
4. Open **Notification Center → Order Templates** to customize automatic customer order messages (`pending`, `accepted`, `preparing`, `ready`, `dispatched`, `delivered`, `cancelled`, `delayed`, `payment_update`).
5. Open **Categories** (`#categories`) and click **Initialize Standard Categories** if you want the standard menu categories saved to Firebase RTDB.
6. Open **Inventory & Stock** (`#inventory`) to add real ingredients or portion items, set low-stock alert thresholds, and link them to dishes so stock deducts automatically when orders are accepted and dishes auto-mark unavailable at `0` stock.
7. Open **Staff** (`#staff`) and **Roles & Permissions** (`#roles`) to configure granular access to analytics, visitor sessions, customer PII (`viewCustomerContactDetails`), 10-category Activity Logs, security logs, notifications, and CSV exports.
8. Open **Settings** (`#settings`) → **Analytics & Retention Settings** to customize `retentionDays` (default `90`), `dormantDays` (`30`), and customer engagement tier thresholds, and use **Reports & Exports** (`#reports-exports`) for CSV/print exports and Spark-plan pruning.



---

## Audit additions (rules verification and Worker configuration)

### Verify rules before publishing
1. `npm test` runs `scripts/rules.test.js` (31 scenarios) against `database.rules.json` using the offline `targaryen` simulator. This is **not** the official emulator.
2. Before publishing, repeat the key scenarios in the Firebase Console **Rules Playground** (anonymous create order, anonymous read `/orders`, staff update order, anonymous read `/analytics/events`) or in the Firebase Emulator Suite (`firebase emulators:start --only database`), which needs Java and network access to Google.
3. Publish only after you approve. Keep the previous rules (Console -> Realtime Database -> Rules -> history) for rollback.

### Worker configuration (names only; never commit values)
| Name | Kind | Where |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | **Secret** | `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --name siranchowk-notifications` |
| `FIREBASE_PROJECT_ID` | Variable | `cloudflare-worker/wrangler.toml` `[vars]` |
| `FIREBASE_DATABASE_URL` | Variable | `wrangler.toml` `[vars]` |
| `PRIMARY_OWNER_UID` | Variable | `wrangler.toml` `[vars]` |
| `ALLOWED_ORIGINS` | Variable | `wrangler.toml` `[vars]` (comma separated, no `*`) |

If any of these is missing the Worker answers `503 {"code":"worker_not_configured"}` and `npx wrangler tail` shows which name is missing (names only).

### Deploy
```powershell
cd cloudflare-worker
npx wrangler deploy --dry-run      # validates config, uploads nothing
npx wrangler deploy                # only after owner approval
```
Frontend build variable `VITE_PUSH_WORKER_URL` (Cloudflare Pages -> Settings -> Variables) must be the deployed Worker URL.

See `AUDIT-REPORT.md` for the full audit, permission matrix and checklist.
