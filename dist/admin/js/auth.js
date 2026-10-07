// ============================================================================
// SIRANCHOWK KHAJA GHAR - ADMIN AUTHENTICATION
// ============================================================================

import {
    auth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserSessionPersistence
} from "../../js/firebase.js";


// ============================================================================
// CURRENT USER
// ============================================================================

let currentUser = null;


// ============================================================================
// AUTH STATE LISTENER
// ============================================================================
//
// Firebase needs a small amount of time to restore the authenticated
// session when a new page loads.
//
// onAuthStateChanged() is the reliable way to wait for that state.
// ============================================================================

onAuthStateChanged(auth, (user) => {

    currentUser = user;

    console.log(
        "Firebase auth state changed:",
        user ? user.email : "No authenticated user"
    );

});


// ============================================================================
// WAIT FOR FIREBASE AUTH STATE
// ============================================================================

function waitForAuthState() {

    return new Promise((resolve) => {

        // ------------------------------------------------------------
        // If Firebase already knows the user, return immediately.
        // ------------------------------------------------------------

        if (auth.currentUser) {

            currentUser =
                auth.currentUser;

            resolve(auth.currentUser);

            return;
        }


        // ------------------------------------------------------------
        // Otherwise wait for Firebase to restore the session.
        // ------------------------------------------------------------

        let unsubscribe = null;


        unsubscribe =
            onAuthStateChanged(
                auth,
                (user) => {

                    if (unsubscribe) {
                        unsubscribe();
                    }

                    currentUser =
                        user;

                    resolve(user);
                }
            );

    });
}


// ============================================================================
// CHECK ADMIN AUTHENTICATION
// ============================================================================

export async function checkAdminAuth() {

    const currentPath =
        window.location.pathname;


    const isLoginPage =
        currentPath.endsWith(
            "/admin/login.html"
        ) ||
        currentPath.endsWith(
            "/admin/login"
        );


    const isAdminPage =
        currentPath.endsWith(
            "/admin/admin.html"
        ) ||
        currentPath.endsWith(
            "/admin/admin"
        );


    console.log(
        "Checking admin authentication..."
    );


    // ========================================================================
    // WAIT FOR FIREBASE TO RESTORE AUTH STATE
    // ========================================================================

    const user =
        await waitForAuthState();


    // ========================================================================
    // NOT AUTHENTICATED
    // ========================================================================

    if (!user) {

        console.warn(
            "No authenticated Firebase user found."
        );


        if (isAdminPage) {

            console.log(
                "Redirecting unauthenticated user to login..."
            );


            window.location.replace(
                "./login.html"
            );
        }


        return false;
    }


    // ========================================================================
    // AUTHENTICATED
    // ========================================================================

    currentUser =
        user;


    console.log(
        "Admin authentication verified:",
        user.email
    );


    // ========================================================================
    // USER IS ALREADY LOGGED IN AND OPENS LOGIN PAGE
    // ========================================================================

    if (isLoginPage) {

        console.log(
            "Authenticated user is on login page."
        );


        window.location.replace(
            "./admin.html"
        );


        return user;
    }


    // ========================================================================
    // AUTHENTICATED USER
    // ========================================================================

    return user;
}


// ============================================================================
// ADMIN LOGIN
// ============================================================================

export async function loginAdmin(
    email,
    password
) {

    if (!email || !password) {

        throw new Error(
            "Email and password are required."
        );
    }


    try {

        // ====================================================================
        // SESSION PERSISTENCE
        // ====================================================================

        await setPersistence(
            auth,
            browserSessionPersistence
        );


        // ====================================================================
        // FIREBASE EMAIL/PASSWORD LOGIN
        // ====================================================================

        const result =
            await signInWithEmailAndPassword(
                auth,
                email.trim(),
                password
            );


        // ====================================================================
        // STORE USER
        // ====================================================================

        currentUser =
            result.user;


        console.log(
            "Admin authentication successful:",
            result.user.email
        );


        console.log(
            "Admin UID:",
            result.user.uid
        );


        return result.user;


    } catch (error) {

        console.error(
            "Admin login error:",
            error
        );


        let message =
            "Login failed. Please check your email and password.";


        switch (error.code) {

            case "auth/invalid-credential":

                message =
                    "Invalid email or password.";

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
                    "Too many login attempts. Please try again later.";

                break;


            case "auth/network-request-failed":

                message =
                    "Network error. Please check your internet connection.";

                break;


            case "auth/user-not-found":

                message =
                    "No account found with this email.";

                break;


            case "auth/wrong-password":

                message =
                    "Incorrect password.";

                break;


            case "auth/operation-not-allowed":

                message =
                    "Email/password authentication is not enabled in Firebase.";

                break;
        }


        throw new Error(message);
    }
}


// ============================================================================
// LOGOUT
// ============================================================================

export async function logoutAdmin() {

    try {

        await signOut(auth);


        currentUser =
            null;


        console.log(
            "Admin logged out successfully."
        );


        window.location.replace(
            "./login.html"
        );


    } catch (error) {

        console.error(
            "Admin logout error:",
            error
        );


        throw error;
    }
}


// ============================================================================
// GET CURRENT ADMIN
// ============================================================================

export function getCurrentAdmin() {

    return (
        auth.currentUser ||
        currentUser ||
        null
    );
}


// ============================================================================
// AUTH STATE LISTENER
// ============================================================================

export function listenToAuthState(
    callback
) {

    return onAuthStateChanged(
        auth,
        (user) => {

            currentUser =
                user;


            if (
                typeof callback ===
                "function"
            ) {

                callback(user);
            }
        }
    );
}


// ============================================================================
// CHECK WHETHER AUTH IS READY
// ============================================================================

export function isAuthPersistenceReady() {

    return !!(
        auth.currentUser ||
        currentUser
    );
}