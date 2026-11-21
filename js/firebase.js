// ============================================================================
// SIRANCHOWK KHAJA GHAR — FIREBASE APP, DATABASE, AUTH & MESSAGING
// ============================================================================

import { initializeApp, getApps, getApp } from "firebase/app";
import {
    getDatabase,
    ref as fbRef,
    get as fbGet,
    child as fbChild,
    push as fbPush,
    set as fbSet,
    update as fbUpdate,
    remove as fbRemove,
    query as fbQuery,
    orderByChild as fbOrderByChild,
    orderByKey as fbOrderByKey,
    startAt as fbStartAt,
    endAt as fbEndAt,
    equalTo as fbEqualTo,
    limitToLast as fbLimitToLast,
    onValue as fbOnValue,
    serverTimestamp as fbServerTimestamp,
    runTransaction as fbRunTransaction
} from "firebase/database";
import {
    getAuth,
    signInWithEmailAndPassword as fbSignInWithEmailAndPassword,
    createUserWithEmailAndPassword as fbCreateUserWithEmailAndPassword,
    updateProfile as fbUpdateProfile,
    sendPasswordResetEmail as fbSendPasswordResetEmail,
    sendEmailVerification as fbSendEmailVerification,
    updatePassword as fbUpdatePassword,
    verifyBeforeUpdateEmail as fbVerifyBeforeUpdateEmail,
    EmailAuthProvider,
    reauthenticateWithCredential as fbReauthenticateWithCredential,
    GoogleAuthProvider,
    signInWithPopup as fbSignInWithPopup,
    signInWithRedirect as fbSignInWithRedirect,
    getRedirectResult as fbGetRedirectResult,
    linkWithPopup as fbLinkWithPopup,
    signOut as fbSignOut,
    onAuthStateChanged as fbOnAuthStateChanged,
    onIdTokenChanged as fbOnIdTokenChanged,
    setPersistence as fbSetPersistence,
    browserSessionPersistence,
    browserLocalPersistence
} from "firebase/auth";
import {
    getMessaging,
    getToken,
    onMessage,
    isSupported as isMessagingSupported
} from "firebase/messaging";

import appletConfig from "../firebase-applet-config.json" with { type: "json" };

const DEFAULT_RTDB_URLS = Object.freeze({
    "plasma-bounty-474104-m6": "https://plasma-bounty-474104-m6-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const metaEnv = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};

export function resolveFirebaseConfig(
    env = {},
    fallbackConfig = appletConfig,
    isBrowser = typeof window !== "undefined"
) {
    const hasExplicitEnv = Boolean(env?.VITE_FIREBASE_API_KEY && env?.VITE_FIREBASE_PROJECT_ID);
    const fallback = (isBrowser || hasExplicitEnv) && fallbackConfig && typeof fallbackConfig === "object"
        ? fallbackConfig
        : {};

    const apiKey = env?.VITE_FIREBASE_API_KEY || fallback.apiKey || "";
    const projectId = env?.VITE_FIREBASE_PROJECT_ID || fallback.projectId || "";
    const authDomain = env?.VITE_FIREBASE_AUTH_DOMAIN || fallback.authDomain || (projectId ? `${projectId}.firebaseapp.com` : "");
    const databaseURL = env?.VITE_FIREBASE_DATABASE_URL || fallback.databaseURL || DEFAULT_RTDB_URLS[projectId] || "";
    const storageBucket = env?.VITE_FIREBASE_STORAGE_BUCKET || fallback.storageBucket || "";
    const messagingSenderId = env?.VITE_FIREBASE_MESSAGING_SENDER_ID || fallback.messagingSenderId || "";
    const appId = env?.VITE_FIREBASE_APP_ID || fallback.appId || "";

    return {
        apiKey,
        authDomain,
        databaseURL,
        projectId,
        storageBucket,
        messagingSenderId,
        appId
    };
}

export const firebaseConfig = resolveFirebaseConfig(metaEnv, appletConfig, typeof window !== "undefined");

export const isFirebaseConfigured = Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.databaseURL &&
    firebaseConfig.projectId
);

let app = null;
let db = { __unconfigured: true };
let auth = { currentUser: null };

if (isFirebaseConfigured) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    db = getDatabase(app);
    auth = getAuth(app);
} else if (typeof window !== "undefined") {
    console.warn("[AI Studio] Firebase environment variables are not configured — running with offline fallback mode.");
}

export { db, auth, app };

export function getStaffProvisionerAuth() {
    if (!isFirebaseConfigured) return auth;
    const existing = getApps().find((a) => a.name === "skg-staff-provisioner");
    const secondaryApp = existing || initializeApp(firebaseConfig, "skg-staff-provisioner");
    return getAuth(secondaryApp);
}

let messagingInstance = null;

export async function getFirebaseMessaging() {
    if (!isFirebaseConfigured || !app) return null;
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
    if (!vapidKey || !isFirebaseConfigured) return null;
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
    if (!isFirebaseConfigured) return () => {};
    const messaging = await getFirebaseMessaging();
    if (!messaging || typeof handler !== "function") return () => {};
    return onMessage(messaging, handler);
}

function makeEmptySnapshot(targetRef = null) {
    return {
        key: targetRef?.key ?? null,
        size: 0,
        exists: () => false,
        val: () => null,
        numChildren: () => 0,
        forEach: () => {}
    };
}

function makeMockRef(path = "") {
    const clean = String(path || "").replace(/^\/+|\/+$/g, "");
    const parts = clean ? clean.split("/") : [];
    return {
        _path: clean,
        key: parts.length ? parts[parts.length - 1] : null
    };
}

const unconfiguredAuthError = () =>
    new Error("Firebase is not configured. Set VITE_FIREBASE_* environment variables to enable authentication.");

export const ref = (database, path = "") =>
    isFirebaseConfigured ? fbRef(database, path) : makeMockRef(path);

export const child = (parentRef, path = "") =>
    isFirebaseConfigured
        ? fbChild(parentRef, path)
        : makeMockRef([parentRef?._path, String(path || "").replace(/^\/+|\/+$/g, "")].filter(Boolean).join("/"));

export const get = async (queryOrRef) =>
    isFirebaseConfigured ? fbGet(queryOrRef) : makeEmptySnapshot(queryOrRef);

export const push = (parentRef, value) => {
    if (isFirebaseConfigured) {
        return value !== undefined ? fbPush(parentRef, value) : fbPush(parentRef);
    }
    const key = `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const nextRef = makeMockRef([parentRef?._path, key].filter(Boolean).join("/"));
    return Object.assign(Promise.resolve(nextRef), nextRef);
};

export const set = async (targetRef, value) =>
    isFirebaseConfigured ? fbSet(targetRef, value) : undefined;

export const update = async (targetRef, values) =>
    isFirebaseConfigured ? fbUpdate(targetRef, values) : undefined;

export const remove = async (targetRef) =>
    isFirebaseConfigured ? fbRemove(targetRef) : undefined;

export const query = (targetRef, ...constraints) =>
    isFirebaseConfigured ? fbQuery(targetRef, ...constraints) : targetRef;

export const orderByChild = (path) =>
    isFirebaseConfigured ? fbOrderByChild(path) : {};

export const orderByKey = () =>
    isFirebaseConfigured ? fbOrderByKey() : {};

export const startAt = (value, key) =>
    isFirebaseConfigured ? fbStartAt(value, key) : {};

export const endAt = (value, key) =>
    isFirebaseConfigured ? fbEndAt(value, key) : {};

export const equalTo = (value, key) =>
    isFirebaseConfigured ? fbEqualTo(value, key) : {};

export const limitToLast = (limit) =>
    isFirebaseConfigured ? fbLimitToLast(limit) : {};

export const onValue = (targetRef, callback, cancelCallback) => {
    if (isFirebaseConfigured) {
        return fbOnValue(targetRef, callback, cancelCallback);
    }
    queueMicrotask(() => {
        if (typeof callback === "function") callback(makeEmptySnapshot(targetRef));
    });
    return () => {};
};

export const serverTimestamp = () =>
    isFirebaseConfigured ? fbServerTimestamp() : Date.now();

export const runTransaction = async (targetRef, transactionUpdate, options) => {
    if (isFirebaseConfigured) {
        return fbRunTransaction(targetRef, transactionUpdate, options);
    }
    return { committed: false, snapshot: makeEmptySnapshot(targetRef) };
};

export const signInWithEmailAndPassword = (authInstance, email, password) =>
    isFirebaseConfigured
        ? fbSignInWithEmailAndPassword(authInstance, email, password)
        : Promise.reject(unconfiguredAuthError());

export const createUserWithEmailAndPassword = (authInstance, email, password) =>
    isFirebaseConfigured
        ? fbCreateUserWithEmailAndPassword(authInstance, email, password)
        : Promise.reject(unconfiguredAuthError());

export const updateProfile = (user, profile) =>
    isFirebaseConfigured ? fbUpdateProfile(user, profile) : Promise.resolve();

export const sendPasswordResetEmail = (authInstance, email, actionCodeSettings) =>
    isFirebaseConfigured
        ? fbSendPasswordResetEmail(authInstance, email, actionCodeSettings)
        : Promise.reject(unconfiguredAuthError());

export const sendEmailVerification = (user, actionCodeSettings) =>
    isFirebaseConfigured
        ? fbSendEmailVerification(user, actionCodeSettings)
        : Promise.reject(unconfiguredAuthError());

export const updatePassword = (user, newPassword) =>
    isFirebaseConfigured
        ? fbUpdatePassword(user, newPassword)
        : Promise.reject(unconfiguredAuthError());

export const verifyBeforeUpdateEmail = (user, newEmail, actionCodeSettings) =>
    isFirebaseConfigured
        ? fbVerifyBeforeUpdateEmail(user, newEmail, actionCodeSettings)
        : Promise.reject(unconfiguredAuthError());

export const reauthenticateWithCredential = (user, credential) =>
    isFirebaseConfigured
        ? fbReauthenticateWithCredential(user, credential)
        : Promise.reject(unconfiguredAuthError());

export const signInWithPopup = (authInstance, provider) =>
    isFirebaseConfigured
        ? fbSignInWithPopup(authInstance, provider)
        : Promise.reject(unconfiguredAuthError());

export const signInWithRedirect = (authInstance, provider) =>
    isFirebaseConfigured
        ? fbSignInWithRedirect(authInstance, provider)
        : Promise.reject(unconfiguredAuthError());

export const getRedirectResult = (authInstance) =>
    isFirebaseConfigured
        ? fbGetRedirectResult(authInstance)
        : Promise.resolve(null);

export const linkWithPopup = (user, provider) =>
    isFirebaseConfigured
        ? fbLinkWithPopup(user, provider)
        : Promise.reject(unconfiguredAuthError());

export const signOut = (authInstance) =>
    isFirebaseConfigured ? fbSignOut(authInstance) : Promise.resolve();

export const onAuthStateChanged = (authInstance, observer, error, completed) => {
    if (isFirebaseConfigured) {
        return fbOnAuthStateChanged(authInstance, observer, error, completed);
    }
    const callback = typeof observer === "function" ? observer : observer?.next;
    queueMicrotask(() => {
        if (typeof callback === "function") callback(null);
    });
    return () => {};
};

export const onIdTokenChanged = (authInstance, observer, error, completed) => {
    if (isFirebaseConfigured) {
        return fbOnIdTokenChanged(authInstance, observer, error, completed);
    }
    const callback = typeof observer === "function" ? observer : observer?.next;
    queueMicrotask(() => {
        if (typeof callback === "function") callback(null);
    });
    return () => {};
};

export const setPersistence = (authInstance, persistence) =>
    isFirebaseConfigured ? fbSetPersistence(authInstance, persistence) : Promise.resolve();

export {
    GoogleAuthProvider,
    EmailAuthProvider,
    browserSessionPersistence,
    browserLocalPersistence
};
