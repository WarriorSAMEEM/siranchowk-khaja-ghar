
import {
  db,
  auth,
  ref,
  push,
  set,
  update
} from "./firebase.js";

const DEFAULT_WORKER_URL =
  "https://siranchowk-notifications.minecraftboot411-cloudflare.workers.dev";
const WORKER_URL = (
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_PUSH_WORKER_URL
    ? String(import.meta.env.VITE_PUSH_WORKER_URL).trim().replace(/\/+$/, "")
    : "") || DEFAULT_WORKER_URL
);
const WORKER_TIMEOUT_MS = 8000;

const MAX_DETAIL_KEYS = 12;
const MAX_TEXT_LENGTH = 240;

function safeText(value, maxLength = MAX_TEXT_LENGTH) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

function detectClientEnvironment() {
  const ua =
    typeof navigator !== "undefined"
      ? navigator.userAgent || ""
      : "";

  let browser = "Unknown";
  let os = "Unknown";
  let deviceType = "desktop";

  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  if (/Android/i.test(ua)) {
    os = "Android";
    deviceType = "mobile";
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    os = "iOS";
    deviceType = /iPad/i.test(ua) ? "tablet" : "mobile";
  } else if (/Windows/i.test(ua)) {
    os = "Windows";
  } else if (/Mac OS X|Macintosh/i.test(ua)) {
    os = "macOS";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  return {
    browser,
    os,
    deviceType,
    userAgent: safeText(ua, 500)
  };
}

function getCurrentClientSessionId() {
  const key = "skg_client_session_id";

  try {
    let sessionId = sessionStorage.getItem(key);

    if (!sessionId) {
      sessionId =
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      sessionStorage.setItem(key, sessionId);
    }

    return safeText(sessionId, 100);
  } catch {
    return `session-${Date.now()}`;
  }
}

function sanitizeMetadata(metadata = {}) {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return {};
  }

  const cleaned = {};

  const blockedKeyPattern =
    /password|token|secret|credential|authorization|api.?key|private.?key/i;

  let count = 0;

  for (const [rawKey, rawValue] of Object.entries(metadata)) {
    if (count >= MAX_DETAIL_KEYS) break;

    const key = safeText(rawKey, 60);

    if (!key || blockedKeyPattern.test(key)) continue;

    if (
      rawValue === null ||
      typeof rawValue === "boolean" ||
      (
        typeof rawValue === "number" &&
        Number.isFinite(rawValue)
      )
    ) {
      cleaned[key] = rawValue;
      count++;
      continue;
    }

    if (typeof rawValue === "string") {
      cleaned[key] = safeText(rawValue);
      count++;
    }
  }

  return cleaned;
}

async function getAuthenticatedIdToken() {
  const user = auth.currentUser;

  if (!user) return null;

  try {
    return await user.getIdToken();
  } catch (error) {
    console.warn(
      "Could not obtain Firebase ID token:",
      error
    );

    return null;
  }
}

async function sendWorkerEvent(type, payload = {}) {
  const idToken = await getAuthenticatedIdToken();

  if (!idToken) {
    return false;
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS)
    : null;

  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        type,
        ...payload
      }),
      ...(controller ? { signal: controller.signal } : {})
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
      console.warn(`${type} Worker telemetry skipped:`, {
        status: response.status,
        message:
          result.error ||
          result.message ||
          "Unknown error"
      });

      return false;
    }

    return true;
  } catch (error) {
    console.warn(
      `${type} Worker telemetry skipped:`,
      error?.name === "AbortError" ? "Request timed out" : (error?.message || error)
    );

    return false;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Records authenticated login/logout events.
 *
 * Supported actions:
 * login, logout
 *
 * Supported methods:
 * password, google, password_signup
 */
export async function recordLoginEvent({
  action = "login",
  result = "success",
  method = "password",
  portal = "customer",
  sessionId = "",
  deviceId = "",
  sessionDurationSec = null,
  metadata = {}
} = {}) {
  const allowedActions = ["login", "logout"];
  const allowedResults = ["success", "failed"];
  const allowedMethods = [
    "password",
    "google",
    "password_signup"
  ];
  const allowedPortals = ["customer", "admin"];

  if (!allowedActions.includes(action)) {
    console.warn("Invalid login event action.");
    return false;
  }

  if (!allowedResults.includes(result)) {
    console.warn("Invalid login event result.");
    return false;
  }

  if (!allowedMethods.includes(method)) {
    method = "password";
  }

  if (!allowedPortals.includes(portal)) {
    portal = "customer";
  }

  // This endpoint only accepts authenticated events.
  if (!auth.currentUser) {
    return false;
  }

  const environment = detectClientEnvironment();
  const payload = {
    action,
    result,
    method,
    portal,
    sessionId: safeText(
      sessionId || getCurrentClientSessionId(),
      100
    ),
    deviceId: safeText(deviceId, 120),
    browser: environment.browser,
    os: environment.os,
    deviceType: environment.deviceType,
    userAgent: environment.userAgent,
    metadata: sanitizeMetadata(metadata)
  };

  if (
    sessionDurationSec !== null &&
    sessionDurationSec !== undefined &&
    Number.isFinite(Number(sessionDurationSec)) &&
    Number(sessionDurationSec) >= 0
  ) {
    payload.sessionDurationSec = Math.min(
      Math.round(Number(sessionDurationSec)),
      2592000
    );
  }

  return sendWorkerEvent("login_event", payload);
}

/**
 * Writes customer activity to the customer's own Firebase path.
 * Supports customer self-logging and authorized staff order lifecycle logging.
 */
export async function logCustomerActivity(
  uid,
  type,
  details = {}
) {
  if (!uid || !type) return false;

  const currentUser = auth.currentUser;

  if (!currentUser) {
    return false;
  }

  const isOwnerSession = currentUser.uid === uid;

  try {
    const activityRef = push(
      ref(db, `users/${uid}/activity`)
    );

    await set(activityRef, {
      id: activityRef.key,
      actorUid: currentUser.uid,
      type: safeText(type, 48),
      details: sanitizeMetadata(details),
      timestamp: Date.now(),
      sessionId: getCurrentClientSessionId(),
      ...detectClientEnvironment()
    });

    if (isOwnerSession) {
      await update(
        ref(db, `users/${uid}/profile`),
        {
          lastActiveAt: Date.now()
        }
      ).catch(() => {});
    }

    return true;
  } catch (error) {
    console.warn(
      "Customer activity write skipped:",
      error?.message || error
    );

    return false;
  }
}

/**
 * Sends security events through the authenticated Worker.
 */
export async function logSecurityEvent({
  type,
  eventType,
  action,
  target = "",
  details = {},
  metadata = {}
} = {}) {
  const securityEventType = safeText(
    type || eventType || action,
    80
  );

  if (!securityEventType) {
    console.warn(
      "Security event skipped: missing event type."
    );

    return false;
  }

  return sendWorkerEvent("security_event", {
    eventType: securityEventType,
    target: safeText(target, 160),
    details: sanitizeMetadata({
      ...sanitizeMetadata(details),
      ...sanitizeMetadata(metadata)
    }),
    sessionId: getCurrentClientSessionId(),
    ...detectClientEnvironment()
  });
}

const VALID_NOTIFICATION_CHANNELS = new Set([
  "admin",
  "customer",
  "orders",
  "security",
  "campaigns"
]);
const VALID_NOTIFICATION_STATUSES = new Set([
  "created",
  "queued",
  "sent_to_provider",
  "delivered",
  "failed"
]);

export function normalizeNotificationHistoryEntry(
  channelOrPayload = "orders",
  payloadArg = null
) {
  const isTwoArg = typeof channelOrPayload === "string" || payloadArg !== null;
  const rawPayload = isTwoArg
    ? (payloadArg && typeof payloadArg === "object" ? payloadArg : {})
    : (channelOrPayload && typeof channelOrPayload === "object" ? channelOrPayload : {});

  const requestedChannel = isTwoArg
    ? channelOrPayload
    : (rawPayload.channel || "orders");
  const cleanChannel = safeText(requestedChannel, 32).toLowerCase();
  const channel = VALID_NOTIFICATION_CHANNELS.has(cleanChannel)
    ? cleanChannel
    : "orders";

  const rawStatus = safeText(rawPayload.status || "created", 40).toLowerCase();
  const mappedStatus = rawStatus === "sent" ? "sent_to_provider" : rawStatus;
  const status = VALID_NOTIFICATION_STATUSES.has(mappedStatus)
    ? mappedStatus
    : "created";

  const entry = {
    channel,
    title: safeText(rawPayload.title || rawPayload.type || "Notification", 140),
    message: safeText(rawPayload.message || rawPayload.body || "", 400),
    type: safeText(rawPayload.type || channel, 80),
    targetAudience: safeText(
      rawPayload.targetAudience || rawPayload.target || "",
      160
    ),
    status,
    actorUid: safeText(
      rawPayload.actorUid || auth.currentUser?.uid || "system",
      128
    ),
    createdAt: Number(rawPayload.createdAt || rawPayload.timestamp) || Date.now()
  };

  if (rawPayload.id) {
    entry.referenceId = safeText(rawPayload.id, 128);
  }
  if (rawPayload.failureDetails) {
    entry.failureDetails = safeText(rawPayload.failureDetails, 240);
  }
  if (Number.isFinite(Number(rawPayload.targetedCount))) {
    entry.targetedCount = Math.max(0, Math.round(Number(rawPayload.targetedCount)));
  }
  if (Number.isFinite(Number(rawPayload.sentCount))) {
    entry.sentCount = Math.max(0, Math.round(Number(rawPayload.sentCount)));
  }
  if (Number.isFinite(Number(rawPayload.failedCount))) {
    entry.failedCount = Math.max(0, Math.round(Number(rawPayload.failedCount)));
  }
  if (Array.isArray(rawPayload.deliveryResults) && rawPayload.deliveryResults.length) {
    entry.deliveryResults = rawPayload.deliveryResults.slice(0, 50);
  }
  if (rawPayload.metadata && typeof rawPayload.metadata === "object") {
    entry.metadata = sanitizeMetadata(rawPayload.metadata);
  }

  return entry;
}

/**
 * Writes separated notification history under notificationHistory/{channel}/{recordId}
 * matching RTDB validation rules.
 */
export async function recordNotificationHistory(
  channelOrPayload = "orders",
  payloadArg = null
) {
  try {
    const entry = normalizeNotificationHistoryEntry(channelOrPayload, payloadArg);
    const historyRef = push(
      ref(db, `notificationHistory/${entry.channel}`)
    );

    await set(historyRef, {
      id: historyRef.key,
      ...entry
    });

    return true;
  } catch (error) {
    console.warn(
      "Notification history write skipped:",
      error?.message || error
    );

    return false;
  }
}
