// ============================================================================
// SIRANCHOWK KHAJA GHAR — FIREBASE APP, DATABASE, AUTH & MESSAGING
// ============================================================================

import { initializeApp, getApps, getApp } from "firebase/app";
import {
    getDatabase,
    ref,
    get,
    child,
    push,
    set,
    update,
    remove,
    query,
    orderByChild,
    orderByKey,
    startAt,
    endAt,
    equalTo,
    limitToLast,
    onValue,
    serverTimestamp,
    runTransaction
} from "firebase/database";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    sendPasswordResetEmail,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserSessionPersistence,
    browserLocalPersistence
} from "firebase/auth";
import {
    getMessaging,
    getToken,
    onMessage,
    isSupported as isMessagingSupported
} from "firebase/messaging";

export const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAtMCvjCOM_fQHAJzzeaFsUiwQ0Ms6wvns",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "plasma-bounty-474104-m6.firebaseapp.com",
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://plasma-bounty-474104-m6-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "plasma-bounty-474104-m6",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "plasma-bounty-474104-m6.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "229985321157",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:229985321157:web:7bcb63b2c3bc062fa870ac"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getDatabase(app);
export const auth = getAuth(app);

export function getStaffProvisionerAuth() {
    const existing = getApps().find((a) => a.name === "skg-staff-provisioner");
    const secondaryApp = existing || initializeApp(firebaseConfig, "skg-staff-provisioner");
    return getAuth(secondaryApp);
}

let messagingInstance = null;

export async function getFirebaseMessaging() {
    try {
        if (messagingInstance) return messagingInstance;
        const supported = await isMessagingSupported();
        if (!supported) return null;
        messagingInstance = getMessaging(app);
        return messagingInstance;
    } catch (error) {
        console.warn("Firebase Messaging is unavailable in this browser:", error);
        return null;
    }
}

export async function registerMessagingToken(vapidKey, serviceWorkerRegistration = null) {
    if (!vapidKey) return null;
    const messaging = await getFirebaseMessaging();
    if (!messaging) return null;
    try {
        const options = { vapidKey };
        if (serviceWorkerRegistration) {
            options.serviceWorkerRegistration = serviceWorkerRegistration;
        }
        return await getToken(messaging, options);
    } catch (error) {
        console.warn("Could not obtain FCM registration token:", error);
        return null;
    }
}

export async function listenForegroundMessages(handler) {
    const messaging = await getFirebaseMessaging();
    if (!messaging || typeof handler !== "function") return () => {};
    return onMessage(messaging, handler);
}

export {
    ref,
    get,
    child,
    push,
    set,
    update,
    remove,
    query,
    orderByChild,
    orderByKey,
    startAt,
    endAt,
    equalTo,
    limitToLast,
    onValue,
    serverTimestamp,
    runTransaction,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    sendPasswordResetEmail,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserSessionPersistence,
    browserLocalPersistence,
    app
};
