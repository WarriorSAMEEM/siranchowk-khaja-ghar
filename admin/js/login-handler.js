// ============================================================================
// SIRANCHOWK KHAJA GHAR - ADMIN LOGIN HANDLER
// ============================================================================

import {
    loginAdmin,
    checkAdminAuth
} from "./auth.js";

const loginForm = document.getElementById("admin-login-form");
const emailInput = document.getElementById("admin-email");
const passwordInput = document.getElementById("admin-password");
const loginButton = document.getElementById("btn-submit");

const loginError = document.getElementById("login-error");
const errorText = document.getElementById("error-text");

const togglePassword = document.getElementById("toggle-password");
const submitText = document.getElementById("submit-text");
const loading = document.getElementById("loading");

console.log("======================================");
console.log("ADMIN LOGIN HANDLER");
console.log("======================================");

console.log("Login form:", !!loginForm);
console.log("Email input:", !!emailInput);
console.log("Password input:", !!passwordInput);
console.log("Login button:", !!loginButton);
console.log("Login error:", !!loginError);
console.log("Password toggle:", !!togglePassword);


// ============================================================================
// ERROR
// ============================================================================

function showError(message) {

    console.error("LOGIN ERROR:", message);

    if (loginError) {
        loginError.classList.add("show");
    }

    if (errorText) {
        errorText.textContent = message;
    }
}


function hideError() {

    if (loginError) {
        loginError.classList.remove("show");
    }

    if (errorText) {
        errorText.textContent = "";
    }
}


// ============================================================================
// LOADING
// ============================================================================

function setLoading(isLoading) {

    if (loginButton) {
        loginButton.disabled = isLoading;
    }

    if (submitText) {

        submitText.textContent =
            isLoading
                ? "Signing in..."
                : "Sign in securely";
    }

    if (loading) {

        if (isLoading) {
            loading.classList.add("active");
        } else {
            loading.classList.remove("active");
        }
    }
}


// ============================================================================
// PASSWORD TOGGLE
// ============================================================================



// ============================================================================
// CLEAR ERROR WHILE TYPING
// ============================================================================

emailInput?.addEventListener("input", hideError);
passwordInput?.addEventListener("input", hideError);


// ============================================================================
// LOGIN
// ============================================================================

if (!loginForm) {

    console.error(
        "CRITICAL: #admin-login-form not found."
    );

} else {

    loginForm.addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();

            console.log("======================================");
            console.log("LOGIN FORM SUBMITTED");
            console.log("======================================");

            hideError();

            const email =
                emailInput?.value.trim() || "";

            const password =
                passwordInput?.value || "";


            // ------------------------------------------------------------
            // VALIDATION
            // ------------------------------------------------------------

            if (!email) {

                showError(
                    "Please enter your email address."
                );

                emailInput?.focus();

                return;
            }


            if (!password) {

                showError(
                    "Please enter your password."
                );

                passwordInput?.focus();

                return;
            }


            setLoading(true);


            // ------------------------------------------------------------
            // FIREBASE LOGIN
            // ------------------------------------------------------------

            try {

                console.log(
                    "Attempting Firebase authentication..."
                );

                const user =
                    await loginAdmin(
                        email,
                        password
                    );


                // --------------------------------------------------------
                // SUCCESS
                // --------------------------------------------------------

                if (!user) {

                    throw new Error(
                        "Firebase authentication completed, but no user was returned."
                    );
                }


                console.log(
                    "======================================"
                );

                console.log(
                    "FIREBASE LOGIN SUCCESS"
                );

                console.log(
                    "Authenticated user:",
                    user.email
                );

                console.log(
                    "UID:",
                    user.uid
                );

                console.log(
                    "======================================"
                );


                // --------------------------------------------------------
                // IMPORTANT:
                // Give Firebase auth state a moment to settle
                // --------------------------------------------------------

                await new Promise(
                    resolve => setTimeout(resolve, 300)
                );


                console.log(
                    "Checking authenticated session..."
                );


                const authenticatedUser =
                    user;


                if (!authenticatedUser) {

                    throw new Error(
                        "Authenticated user could not be confirmed."
                    );
                }


                console.log(
                    "Authenticated session confirmed."
                );


                // --------------------------------------------------------
                // REDIRECT
                // --------------------------------------------------------

                console.log(
                    "Redirecting to admin dashboard..."
                );

                console.log(
                    "Current URL:",
                    window.location.href
                );

                console.log(
                    "Target:",
                    new URL(
                        "./admin.html",
                        window.location.href
                    ).href
                );


                window.location.assign(
                    new URL(
                        "./admin.html",
                        window.location.href
                    ).href
                );


            } catch (error) {

                console.error(
                    "======================================"
                );

                console.error(
                    "ADMIN LOGIN FAILED"
                );

                console.error(
                    error
                );

                console.error(
                    "======================================"
                );


                showError(
                    error?.message ||
                    "Unable to sign in. Please check your credentials."
                );


                setLoading(false);
            }
        }
    );
}


// ============================================================================
// EXISTING SESSION
// ============================================================================

async function checkExistingSession() {

    try {

        console.log(
            "Checking existing Firebase session..."
        );

        const authenticated =
            await checkAdminAuth();


        if (authenticated) {

            console.log(
                "Existing authenticated session detected."
            );
        }

    } catch (error) {

        console.error(
            "Existing session check failed:",
            error
        );
    }
}


checkExistingSession();


// ============================================================================
// PAGE SHOW
// ============================================================================

window.addEventListener(
    "pageshow",
    () => {

        setLoading(false);

    }
);