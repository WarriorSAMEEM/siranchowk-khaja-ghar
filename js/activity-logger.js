
import {
  db,
  auth,
  ref,
  push,
  set,
  update
} from "./firebase.js";

const WORKER_URL =
  "https://siranchowk-notifications.minecraftboot411-cloudflare.workers.dev";

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
    console.warn(
      `${type} skipped: no authenticated Firebase user.`
    );

    return false;
  }

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
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
      console.error(`${type} Worker request failed:`, {
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
    console.error(
      `${type} Worker request error:`,
      error
    );

    return false;
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
    console.warn(
      "Login event skipped: Firebase user is not authenticated."
    );

    return false;
  }

  const environment = detectClientEnvironment();

  return sendWorkerEvent("login_event", {
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
  });
}

/**
 * Writes customer activity to the customer's own Firebase path.
 * Fields match the current database validation rules.
 */
export async function logCustomerActivity(
  uid,
  type,
  details = {}
) {
  if (!uid || !type) return false;

  const currentUser = auth.currentUser;

  if (!currentUser || currentUser.uid !== uid) {
    console.warn(
      "Customer activity skipped: UID does not match session."
    );

    return false;
  }

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

    await update(
      ref(db, `users/${uid}/profile`),
      {
        lastActiveAt: Date.now()
      }
    );

    return true;
  } catch (error) {
    console.error(
      "Customer activity write failed:",
      error
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

/**
 * Preserves existing notification history behavior.
 */
export async function recordNotificationHistory({
  type = "notification",
  title = "",
  message = "",
  target = "",
  status = "sent",
  metadata = {}
} = {}) {
  try {
    const historyRef = push(
      ref(db, "notificationHistory")
    );

    await set(historyRef, {
      type: safeText(type, 80),
      title: safeText(title),
      message: safeText(message),
      target: safeText(target, 160),
      status: safeText(status, 40),
      metadata: sanitizeMetadata(metadata),
      timestamp: Date.now()
    });

    return true;
  } catch (error) {
    console.error(
      "Notification history write failed:",
      error
    );

    return false;
  }
}
