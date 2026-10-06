import { auth } from "../../js/firebase.js";

import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserSessionPersistence
} from "firebase/auth";

// ============================================================
// SESSION CONFIGURATION
// ============================================================
//
// browserSessionPersistence:
// Login session current browser tab/session भित्र कायम रहन्छ.
//
// Browser/tab session समाप्त भएपछि Firebase authentication
// session पनि समाप्त हुन्छ.
//
// IMPORTANT:
// कुनै पनि email/password यहाँ hardcode गरिएको छैन.
// Firebase Authentication ले credentials verify गर्छ.
// ============================================================

let persistenceReady = false;

const persistencePromise = setPersistence(
    auth,
    browserSessionPersistence
)
    .then(() => {
        persistenceReady = true;
        return true;
    })
    .catch((error) => {
        console.error("Firebase persistence error:", error);
        persistenceReady = false;
        return false;
    });

// ============================================================
// PATH HELPERS
// ============================================================

function getCurrentFile() {
    const path = window.location.pathname;
    return path.split("/").pop()?.toLowerCase() || "index.html";
}

function isLoginPage() {
    return getCurrentFile() === "login.html";
}

function isAdminPage() {
    return getCurrentFile() === "admin.html";
}

// ============================================================
// WAIT FOR FIREBASE AUTH STATE
// ============================================================
//
// Firebase ले current authentication state load गर्न केही
// milliseconds लिन सक्छ.
//
// त्यसैले auth.currentUser लाई तुरुन्त check गर्नुको सट्टा
// onAuthStateChanged मार्फत state confirm गर्छौं.
// ============================================================

function waitForAuthState() {
    return new Promise((resolve) => {
        let resolved = false;

        const unsubscribe = onAuthStateChanged(
            auth,
            (user) => {
                if (resolved) return;

                resolved = true;
                unsubscribe();
                resolve(user);
            },
            (error) => {
                if (resolved) return;

                resolved = true;
                unsubscribe();

                console.error(
                    "Firebase auth state error:",
                    error
                );

                resolve(null);
            }
        );
    });
}

// ============================================================
// ADMIN AUTH GUARD
// ============================================================
//
// admin.html directly खोल्दा:
//
// NOT LOGGED IN
//       ↓
// login.html
//
// LOGGED IN
//       ↓
// admin.html
//
// login.html मा already authenticated छ भने:
//
// login.html
//    ↓
// admin.html
//
// NOTE:
// यो frontend navigation guard हो.
//
// वास्तविक database protection Firebase Realtime Database
// Security Rules बाट enforce गर्नुपर्छ.
// ============================================================

export async function checkAdminAuth() {
    try {
        // Make sure Firebase persistence configuration has settled.
        await persistencePromise;

        const user = await waitForAuthState();

        const loginPage = isLoginPage();
        const adminPage = isAdminPage();

        // --------------------------------------------------------
        // USER NOT AUTHENTICATED
        // --------------------------------------------------------

        if (!user) {
            if (adminPage) {
                window.location.replace("./login.html");
            }

            return null;
        }

        // --------------------------------------------------------
        // USER AUTHENTICATED
        // --------------------------------------------------------

        if (user && loginPage) {
            window.location.replace("./admin.html");
            return user;
        }

        return user;

    } catch (error) {
        console.error(
            "Admin authentication check failed:",
            error
        );

        // Fail closed:
        // authentication check fail भयो भने admin page access
        // allow नगर्ने.
        if (isAdminPage()) {
            window.location.replace("./login.html");
        }

        return null;
    }
}

// ============================================================
// ADMIN LOGIN
// ============================================================

export async function loginAdmin(email, password) {
    try {
        // Wait until session persistence is configured.
        await persistencePromise;

        const cleanEmail = String(email || "").trim();
        const cleanPassword = String(password || "");

        // --------------------------------------------------------
        // BASIC VALIDATION
        // --------------------------------------------------------

        if (!cleanEmail || !cleanPassword) {
            return {
                success: false,
                error: "Email and password are required."
            };
        }

        if (cleanPassword.length < 6) {
            return {
                success: false,
                error: "Invalid email or password."
            };
        }

        // --------------------------------------------------------
        // FIREBASE AUTHENTICATION
        // --------------------------------------------------------

        const userCredential =
            await signInWithEmailAndPassword(
                auth,
                cleanEmail,
                cleanPassword
            );

        return {
            success: true,
            user: userCredential.user
        };

    } catch (error) {
        console.error("Admin login error:", error);

        let message =
            "Unable to sign in. Please try again.";

        switch (error.code) {

            case "auth/invalid-credential":
            case "auth/user-not-found":
            case "auth/wrong-password":
                message = "Invalid email or password.";
                break;

            case "auth/invalid-email":
                message =
                    "Please enter a valid email address.";
                break;

            case "auth/user-disabled":
                message =
                    "This account has been disabled.";
                break;

            case "auth/too-many-requests":
                message =
                    "Too many unsuccessful attempts. Please try again later.";
                break;

            case "auth/network-request-failed":
                message =
                    "Network error. Please check your internet connection.";
                break;

            case "auth/operation-not-allowed":
                message =
                    "Email/password authentication is not enabled.";
                break;

            default:
                message =
                    "Authentication failed. Please try again.";
        }

        return {
            success: false,
            error: message,
            code: error.code || "unknown"
        };
    }
}

// ============================================================
// ADMIN LOGOUT
// ============================================================

export async function logoutAdmin() {
    try {
        await signOut(auth);

        window.location.replace("./login.html");

        return {
            success: true
        };

    } catch (error) {
        console.error("Logout error:", error);

        return {
            success: false,
            error: "Unable to logout. Please try again.",
            code: error.code || "unknown"
        };
    }
}

// ============================================================
// CURRENT USER
// ============================================================

export function getCurrentAdmin() {
    return auth.currentUser;
}

// ============================================================
// AUTH STATE LISTENER
// ============================================================
//
// Other admin modules ले authentication state monitor गर्न
// यो function प्रयोग गर्न सक्छन्.
// ============================================================

export function listenToAuthState(callback) {
    if (typeof callback !== "function") {
        throw new TypeError(
            "listenToAuthState requires a callback function."
        );
    }

    return onAuthStateChanged(auth, (user) => {
        callback(user);
    });
}

// ============================================================
// AUTH PERSISTENCE STATUS
// ============================================================

export function isAuthPersistenceReady() {
    return persistenceReady;
}