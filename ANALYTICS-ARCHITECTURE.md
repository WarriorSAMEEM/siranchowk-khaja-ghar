# Siranchowk Khaja Ghar — Analytics, Customer Intelligence & Audit Architecture

This document describes the Firebase Realtime Database schema, RBAC permissions, Spark-plan cost controls, and privacy protections implemented for **Siranchowk Khaja Ghar**.

---

## 1. Realtime Database Structure

```json
{
  "analytics": {
    "events": {
      "$eventId": {
        "eventType": "page_view | product_view | add_to_cart | checkout_started | order_submitted | whatsapp_click",
        "sessionId": "ses_...",
        "visitorId": "vis_...",
        "isReturning": false,
        "authState": "anonymous | authenticated",
        "page": "/menu.html",
        "pageTitle": "...",
        "referrer": "",
        "referrerHost": "Direct",
        "device": "mobile | tablet | desktop",
        "browser": "Chrome | Safari | Firefox | Edge | Opera | Other",
        "operatingSystem": "Android | iOS | Windows | macOS | Linux | Other",
        "screenWidth": 390,
        "screenHeight": 844,
        "language": "en-US",
        "timestamp": "2026-...",
        "numericTimestamp": 1760000000000
      }
    }
  },
  "visitorSessions": {
    "$sessionId": {
      "sessionId": "ses_...",
      "visitorId": "vis_...",
      "startTime": 1760000000000,
      "lastActivityAt": 1760000060000,
      "endTime": 1760000120000,
      "estimatedDurationSec": 120,
      "pageCount": 3,
      "pagesVisited": {
        "menu_html": { "path": "/menu.html", "views": 1, "estimatedDurationSec": 45, "lastVisitedAt": 1760000050000 }
      },
      "landingPage": "/",
      "lastPage": "/menu.html",
      "device": "mobile",
      "browser": "Chrome",
      "operatingSystem": "Android",
      "referrer": "",
      "referrerHost": "Direct",
      "isReturning": false
    }
  },
  "visitorProfiles": {
    "$visitorId": {
      "visitorId": "vis_...",
      "firstVisitAt": 1760000000000,
      "lastVisitAt": 1760000060000,
      "visitCount": 2,
      "lastSessionId": "ses_...",
      "device": "mobile",
      "browser": "Chrome",
      "operatingSystem": "Android"
    }
  },
  "users": {
    "$uid": {
      "profile": {
        "uid": "$uid",
        "name": "...",
        "email": "...",
        "phone": "...",
        "address": "...",
        "authProvider": "password | google",
        "accountStatus": "active",
        "loginCount": 4,
        "lastLoginAt": 1760000000000,
        "lastActiveAt": 1760000060000,
        "lastSessionId": "ses_...",
        "createdAt": 1759000000000,
        "updatedAt": 1760000000000
      },
      "activity": {
        "$actId": {
          "id": "$actId",
          "actorUid": "$uid",
          "type": "account_registered | login | logout | profile_updated | notification_preferences_updated | add_to_cart | checkout_started | whatsapp_order_clicked | coupon_used | order_placed | order_status_changed",
          "details": {},
          "sessionId": "ses_...",
          "timestamp": 1760000000000
        }
      }
    }
  },
  "loginHistory": {
    "$logId": {
      "id": "$logId",
      "uid": "$uid | unauthenticated",
      "name": "...",
      "email": "...",
      "role": "customer | owner | admin | moderator | officer | helper",
      "method": "password | password_signup | google | admin_password",
      "result": "success | failed",
      "reason": "",
      "deviceType": "mobile | tablet | desktop",
      "browser": "Chrome",
      "operatingSystem": "Android",
      "sessionId": "ses_...",
      "deviceId": "",
      "timestamp": 1760000000000
    }
  },
  "auditLogs": {
    "$logId": {
      "action": "order_status_updated | product_created | inventory_restock | report_exported_csv | ...",
      "actorUid": "$uid",
      "actorName": "...",
      "actorEmail": "...",
      "actorRole": "owner | admin | moderator | officer | helper",
      "target": "...",
      "status": "success | failed",
      "metadata": {},
      "timestamp": 1760000000000
    }
  },
  "securityLogs": {
    "$logId": {
      "id": "$logId",
      "eventType": "failed_customer_login | failed_admin_login | repeated_failed_logins | unauthorized_admin_access | permission_denied | blocked_device_login_attempt | device_approved | device_blocked | rbac_role_updated | staff_created | ...",
      "severity": "info | warning | high | critical",
      "actorUid": "$uid | unauthenticated | system",
      "actorEmail": "...",
      "actorRole": "...",
      "target": "...",
      "deviceType": "...",
      "browser": "...",
      "operatingSystem": "...",
      "details": {},
      "timestamp": 1760000000000
    }
  },
  "notificationHistory": {
    "admin | customer | orders | security | campaigns": {
      "$recordId": {
        "id": "$recordId",
        "channel": "admin | customer | orders | security | campaigns",
        "title": "...",
        "message": "...",
        "type": "newOrders | order_accepted | securityAlerts | Promotional Announcement | ...",
        "targetAudience": "all_approved_admin_devices | customer:{uid} | ...",
        "status": "created | queued | sent_to_provider | delivered | failed",
        "actorUid": "$uid | system",
        "targetedCount": 2,
        "sentCount": 2,
        "failedCount": 0,
        "deliveryResults": [],
        "createdAt": 1760000000000
      }
    }
  },
  "settings": {
    "analytics": {
      "retentionDays": 90,
      "dormantDays": 30,
      "highlyActiveMinOrders": 5,
      "activeMinOrders": 2
    },
    "notificationTemplates": {
      "pending": "Your order has been received successfully.",
      "accepted": "Your order has been confirmed. We are getting it ready.",
      "preparing": "Your order is now being prepared.",
      "ready": "Your order is ready.",
      "dispatched": "Your order is on its way.",
      "delivered": "Your order has been delivered. Thank you for choosing Siranchowk Khaja Ghar.",
      "cancelled": "Your order has been cancelled. Please contact us if you need assistance.",
      "delayed": "Your order #{orderShort} is slightly delayed. Thank you for your patience; we will update you shortly.",
      "payment_update": "Your payment or refund status for order #{orderShort} has been updated."
    }
  }
}
```

---

## 2. Privacy & Data-Protection Guarantees

1. **Zero Browser Fingerprinting & Zero Public PII:**
   - Anonymous visitors receive random first-party identifiers (`vis_...` in `localStorage`, `ses_...` in `sessionStorage`) without canvas/audio/hardware fingerprinting.
   - Public visitors currently have write-only access to `analytics/events`, `visitorSessions`, and `visitorProfiles` (reads are blocked for non-staff). These browser-originated records do not expose private customer data, but they are not tamper-proof: automated clients can spoof or inflate analytics. Do not use them for billing, staff performance or other security-sensitive decisions until writes are moved behind a rate-limited Worker endpoint.
   - Anonymous pre-login visitor sessions are **never** silently linked or merged into registered customer identities.
2. **Do Not Track & Explicit Opt-Out:**
   - `js/analytics-tracker.js` automatically pauses tracking when `navigator.doNotTrack === "1"` or when the visitor toggles **Privacy & Analytics Preferences** in the site footer (`skg_analytics_optout`).
3. **Zero Stored Secrets:**
   - `loginHistory`, `auditLogs`, `securityLogs`, `notificationHistory`, and `users/{uid}/activity` strip any keys matching `password`, `token`, `secret`, `credential`, or `apikey`, and RTDB validation rules explicitly forbid `password`, `token`, and `secret` fields.
4. **Field-Level PII Masking:**
   - Staff roles without `viewCustomerContactDetails` automatically see masked emails (`a***@domain.com`), masked phones (`98****54`), and truncated UIDs across Customer Management, Login History, User Activity, Customer Engagement, Activity Logs, and Exports.
5. **Multi-Device Admin Governance & Honest Statuses:**
   - The very first Owner browser bootstraps as `approved`; any 2nd/3rd Owner device or Admin/Staff device registers as `pending` until explicitly approved by the Owner under **Devices**. Pending/blocked devices never receive push alerts.
   - Per-device notification category preferences (`newOrders`, `orderCancellations`, `orderUpdates`, `securityAlerts`, `staffAnnouncements`) are enforced both client-side and in `cloudflare-worker/worker.js`.
   - Order lifecycle pushes are strictly idempotent (`notifiedStatuses` + `pushAlertDispatched`), and delivered status notifications never fire unless explicitly marked `delivered`.
   - Push history statuses honestly distinguish `created`, `queued`, `sent_to_provider` (FCM accepted), `delivered`, and `failed`.
6. **Honest Metric Definitions:**
   - **Estimated Session Duration:** Measured only while the browser tab is visible (60-second heartbeat + `visibilitychange` / `pagehide` flush).
   - **Bounce Rate:** Computed strictly over closed/idle sessions (`>= 30 min` idle or explicit `endTime`) with `pageCount <= 1` and `estimatedDurationSec <= 10`. Returns `N/A` when no closed sessions exist yet.
   - **Order Revenue:** Explicitly labeled **Total Sales Revenue (Estimated)** — calculated only from orders with numeric subtotals and excludes net profit claims.
   - **No Fabricated Data:** All dashboards render empty states (`0`, `N/A`, or `Not recorded`) until real traffic/orders occur.

---

## 3. Firebase Spark Plan Efficiency & Data Retention

- **Low-Write Tracking:** Client pages emit one initial `page_view` + session upsert on page load and at most one heartbeat write per 60 seconds while the tab is visible (no polling loops or live listeners on public traffic). This limits normal-client writes but is not a server-side rate limit; see the analytics integrity warning above.
- **Bounded Admin Queries:** `loginHistory`, `auditLogs`, and `securityLogs` query `limitToLast(500)` indexed on `.indexOn` keys, supporting `Today`, `Yesterday`, `7d`, `30d`, `This Month`, `Previous Month`, `90d`, and `Custom` date filters.
- **Owner Retention & Pruning:** Under **Settings → Analytics & Retention Settings**, the Owner configures `retentionDays` (default `90`), `dormantDays` (`30`), and engagement tiers. Under **Reports & Exports**, the Owner can prune expired anonymous `analytics/events` and `visitorSessions` records while preserving customer accounts, orders, audit logs, and security logs.

