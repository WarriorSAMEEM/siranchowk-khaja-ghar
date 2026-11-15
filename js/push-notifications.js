
/* =========================================================
   SIRANCHOWK KHAJA GHAR — PUSH NOTIFICATION REGISTRATION
   ========================================================= */

import { app, auth } from "./firebase.js";

import {
  getMessaging,
  getToken,
  isSupported
} from "firebase/messaging";

const WORKER_URL =
  "https://siranchowk-notifications.minecraftboot411-cloudflare.workers.dev";

const VAPID_PUBLIC_KEY =
  "BCMZtPRC07sO3RJxWP0rFJjMzs7Pf-cFHKb1Q4ciMBSxTm_x5jitpvFpcShw7wnDwOCDP_5pIqGEZYxrCXu1VmU";

async function getBrowserFCMToken() {
  if (!("Notification" in window)) {
    throw new Error("This browser does not support notifications.");
  }

  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support service workers.");
  }

  if (!(await isSupported())) {
    throw new Error("Firebase Messaging is not supported in this browser.");
  }

  let permission = Notification.permission;

  if (permission !== "granted") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const registration = await navigator.serviceWorker.register(
    "/firebase-messaging-sw.js"
  );

  await navigator.serviceWorker.ready;

  const messaging = getMessaging(app);

  const token = await getToken(messaging, {
    vapidKey: VAPID_PUBLIC_KEY,
    serviceWorkerRegistration: registration
  });

  if (!token) {
    throw new Error("Firebase could not generate a push token.");
  }

  return token;
}

async function sendRegistration(endpoint, data, idToken = null) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  const response = await fetch(`${WORKER_URL}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(data)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.success !== true) {
    throw new Error(
      result.error || `Registration failed (${response.status}).`
    );
  }

  return result;
}

/* Register a customer's device for order updates. */
export async function enableCustomerPush(trackingToken) {
  if (!/^[a-f0-9]{48}$/i.test(String(trackingToken || ""))) {
    throw new Error("Invalid order tracking token.");
  }

  const fcmToken = await getBrowserFCMToken();

  return sendRegistration("/register-customer", {
    trackingToken,
    fcmToken
  });
}

/* Register the authenticated administrator's device. */
export async function enableAdminPush() {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Please sign in to the admin panel first.");
  }

  const idToken = await user.getIdToken();

  const fcmToken = await getBrowserFCMToken();

  return sendRegistration(
    "/register-admin",
    { fcmToken },
    idToken
  );
}












/* Send an order-status notification to the customer's registered devices. */
export async function notifyCustomerOrderStatus(orderId, status) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Admin is not signed in.");
  }

  const idToken = await user.getIdToken();

  return sendRegistration(
    "/notify-order",
    { orderId, status },
    idToken
  );
}

/* Notify the administrator about a newly saved website order. */
export async function notifyAdminNewOrder(orderId) {
  return sendRegistration(
    "/notify-admin",
    { orderId }
  );
}