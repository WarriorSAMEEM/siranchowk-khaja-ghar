// ============================================================================
// SIRANCHOWK KHAJA GHAR - FIREBASE CONFIGURATION
// ============================================================================
// Firebase App
// Realtime Database
// Authentication
// ============================================================================

import { initializeApp } from "firebase/app";

import {
    getDatabase,
    ref,
    get,
    child,
    push,
    set
} from "firebase/database";

import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserSessionPersistence
} from "firebase/auth";


// ============================================================================
// FIREBASE CONFIGURATION
// ============================================================================

const firebaseConfig = {
    apiKey: "AIzaSyAtMCvjCOM_fQHAJzzeaFsUiwQ0Ms6wvns",
    authDomain: "plasma-bounty-474104-m6.firebaseapp.com",
    databaseURL:
        "https://plasma-bounty-474104-m6-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "plasma-bounty-474104-m6",
    storageBucket: "plasma-bounty-474104-m6.firebasestorage.app",
    messagingSenderId: "229985321157",
    appId: "1:229985321157:web:7bcb63b2c3bc062fa870ac"
};


// ============================================================================
// INITIALIZE FIREBASE
// ============================================================================

const app = initializeApp(firebaseConfig);


// ============================================================================
// FIREBASE SERVICES
// ============================================================================

export const db = getDatabase(app);

export const auth = getAuth(app);


// ============================================================================
// DATABASE EXPORTS
// ============================================================================

export {
    ref,
    get,
    child,
    push,
    set
};


// ============================================================================
// AUTHENTICATION EXPORTS
// ============================================================================

export {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserSessionPersistence
};


// ============================================================================
// FIREBASE APP EXPORT
// ============================================================================

export { app };