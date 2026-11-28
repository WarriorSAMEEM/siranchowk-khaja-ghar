# Siranchowk Khaja Ghar — Business Website & Management System

**Location:** Khairahani-6, Parsa, Chitwan, Nepal (Behind Chaudhary Medical)  
**Phone / WhatsApp:** +977 9821233154  
**Opening Hours:** 6:30 AM – 9:00 PM Daily  

---

## Core Architecture

### 1. Customer Website (`index.html`, `menu.html`, `about.html`, `contact.html`, `account.html`)
- **Dynamic Navigation:**
  - Signed out: `Home`, `Menu`, `About`, `Contact`, `Login`, `Sign Up`, `Cart`
  - Signed in: `Home`, `Menu`, `My Account`, `Cart`, `Order Tracking`, `Logout`
- **Customer Account Portal (`/account.html`):**
  - Protected behind Firebase Authentication (Email/Password, Google Sign-In, Password Reset).
  - Unauthenticated visitors never see dashboard metrics or customer records.
  - Per-UID isolated profile editing, order history & expandable live status timelines, available & redeemed coupons, published customer announcements, and notification opt-in preferences.
- **Authenticated Checkout (`/js/order-system.js`):**
  - Customers must sign in before adding items to the cart or submitting an order. A pending Add-to-cart action is preserved across the login redirect.
  - The browser never writes canonical orders or tracking records directly. The Cloudflare Worker verifies the Firebase ID token, current menu/stock/coupon prices, and writes the order, tracking record, customer history mirror, and coupon-use record in one Realtime Database multi-location update.
  - Checkout fails closed if the Worker is unavailable or the server total differs from the displayed total.

### 2. Owner-Controlled Enterprise Admin Panel (`/admin/login.html` & `/admin/admin.html`)
Organized into dedicated, RBAC-enforced sections:

**Analytics, Customer Intelligence, Logs & Notification Suite:**
1. **Business Overview** (`#overview`) — executive KPIs (orders, pending, kitchen, traffic today, active visitors, security alerts, low stock), quick actions, recent orders, and recent staff/security events
2. **Website Analytics** (`#website-analytics` / `#analytics`) — first-party sessions, unique visitors, today/this week/this month visitors, avg pages/session, page views, new vs returning, active visitors, average estimated duration, bounce rate (closed sessions), device/browser/OS/referrer/page breakdowns, period-over-period comparisons, CSV export, and presets (`Today`, `Yesterday`, `7d`, `30d`, `This Month`, `Previous Month`, `90d`, `Custom`)
3. **Visitor Analytics** (`#visitor-analytics`) — anonymous visitor session logs, landing/exit pages, page journeys, dwell times, and new vs returning inspection
4. **Customer Management** (`#customers`) — searchable registered customer directory (`New`, `Returning`, `Active`, `Inactive`), last login/logout & avg auth session duration, registered customer devices, frequent dishes & recent purchases, direct timeline link, and RBAC field-level PII masking (`viewCustomerContactDetails`)
5. **User Login History** (`#login-history`) — customer & staff login/logout events with session duration, failure reasons, device, browser, and method
6. **User Activity** (`#user-activity`) — per-customer interactive chronological timeline (`account_registered`, `login`, `logout`, `add_to_cart`, `checkout_started`, `order_placed`, `order_status_changed`, `coupon_used`, `profile_updated`, `whatsapp_order_clicked`)
7. **Customer Engagement** (`#customer-engagement`) — real DAU / WAU / MAU, new registrations vs returning active users, repeat buyers, configurable activity tiers, most viewed vs most ordered items, and notification opt-in rates
8. **Order Analytics** (`#order-analytics`) — today's & period orders, full lifecycle breakdown, completion rate, repeat customer rate, category counts, peak ordering hours (NPT), top dishes, coupon redemptions, CSV export, and Total Sales Revenue (Estimated)
9. **Activity Logs (10 Categories)** (`#activity-logs`) — 10 strictly separated audit/log tabs (Admin Login, Customer Login, Website Visitors, Admin Activity, Order Activity, Product Activity, Device Activity, Notification Logs, Security Logs, Staff & Permission Changes) with RBAC gating, filters, inspect modal & CSV export
10. **Admin Activity Logs** (`#audit-logs`) & **Security Logs** (`#security-logs`) — dedicated immutable operational & security event views
11. **Reports & Exports** (`#reports-exports`) — formula-safe CSV exports & formatted printable reports across 7 datasets plus Spark-plan anonymous analytics retention cleanup

**Operations, Multi-Device Notifications & Governance:**
- **Orders** (`#orders`) — live order desk with idempotent status notifications, customizable templates, Delay Notice & Payment/Refund modals, and automated inventory sync
- **Notification Center & History** (`#notifications`) — separated 5-channel Notification History (`Admin`, `Customer`, `Orders`, `Security`, `Campaigns`) with per-device delivery inspection, Send Admin Alert, My Device Preferences (5 category toggles), and Order Notification Templates editor
- **Customer Announcements** (`#customer-announcements`) — audience targeting (`Opted-in`, `Active 30d`, `Repeat Buyers`, `Account Feed Only`), optional scheduled dispatch, live preview card, and confirmation flow
- **Devices** (`#devices`) — Owner bootstrap approval for 1st device (`pending` for 2nd/3rd Owner & all Staff devices), remote block/revoke, and per-device notification category governance
- **Products** (`#products`), **Inventory & Stock** (`#inventory`), **Categories** (`#categories`), **Offers / Coupons** (`#offers`), **Staff** (`#staff`), **Roles & Permissions** (`#roles`), **Settings** (`#settings`)

### 3. Security Rules, Privacy & Push Infrastructure
- **`database.rules.json`**: Enforces strict per-UID customer isolation (`users/$uid`, `users/$uid/devices`), append-only customer timelines (`users/$uid/activity`), write-only public visitor telemetry (`visitorSessions`, `visitorProfiles`, `analytics/events`), append-only `loginHistory`, `auditLogs`, and `securityLogs`; role-restricted notification history and editable notification templates; 25-permission RBAC checks across 5 roles (`Owner > Admin > Moderator > Officer > Helper`), and permanent protection for primary Owner UID (`47SB1i4UL5hlUVPqM1tQoKJFdaM2`).
- **`ANALYTICS-ARCHITECTURE.md`**: Complete RTDB schema, privacy guarantees (DNT + footer opt-out, zero fingerprinting, zero secret logging), and Spark-plan data retention guide.
- **`public/firebase-messaging-sw.js`**: Background Web Push service worker.
- **`cloudflare-worker/worker.js`**: Zero-dependency Cloudflare Worker supporting authenticated `create_order`, `maps_grounding`, `new_order_alert`, `admin_alert`, `customer_order_update`, and `customer_campaign`; it honors per-device approval and notification preferences. `FIREBASE_SERVICE_ACCOUNT_JSON` stays in Worker Secrets. `GEMINI_API_KEY` is an optional Worker secret for Google Maps grounding.

---

## Local Development

```bash
npm ci
npm run check
npm test
npm run dev
```

The Express/Vite development server is local-only at `http://127.0.0.1:3000/`.

Build production assets:

```bash
npm run build
npm run preview
```

The static Vite production preview is local-only at `http://127.0.0.1:4173/`. Vite 8 requires Node.js 22.12+ (or 20.19+).

See `DEPLOYMENT-GUIDE.md` for complete GitHub + Cloudflare Pages + Cloudflare Worker + Firebase Console setup instructions.


## Final review and deployment

See `FINAL-LOCAL-REVIEW.md` for the latest local code review, implemented fixes, verification results and remaining staging requirements. Follow `DEPLOYMENT-GUIDE.md` for the safe Worker → Firebase rules → Pages rollout order.
