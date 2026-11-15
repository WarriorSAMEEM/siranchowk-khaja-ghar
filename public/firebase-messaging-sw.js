
/* Siranchowk Khaja Ghar — Background Push Notifications */

importScripts(
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyAtMCvjCOM_fQHAJzzeaFsUiwQ0Ms6wvns",
  authDomain: "plasma-bounty-474104-m6.firebaseapp.com",
  databaseURL:
    "https://plasma-bounty-474104-m6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "plasma-bounty-474104-m6",
  storageBucket: "plasma-bounty-474104-m6.firebasestorage.app",
  messagingSenderId: "229985321157",
  appId: "1:229985321157:web:7bcb63b2c3bc062fa870ac"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title =
    payload.data?.title ||
    "Siranchowk Khaja Ghar";

  const options = {
    body:
      payload.data?.body ||
      "You have a new update.",
    icon: "/assets/icons/favicon.svg",
    badge: "/assets/icons/favicon.svg",
    data: {
      link: payload.data?.link || "/"
    }
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const link = event.notification.data?.link || "/";

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(link);
          return client.focus();
        }
      }

      return clients.openWindow(link);
    })
  );
});
