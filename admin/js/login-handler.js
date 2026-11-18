// ============================================================================
// SIRANCHOWK KHAJA GHAR — ADMIN LOGIN HANDLER
// ============================================================================

import { loginAdmin, checkAdminAuth } from "./auth.js";

const loginForm = document.getElementById("admin-login-form");
const emailInput = document.getElementById("admin-email");
const passwordInput = document.getElementById("admin-password");
const loginButton = document.getElementById("btn-submit");
const loginError = document.getElementById("login-error");
const errorText = document.getElementById("error-text");
const submitText = document.getElementById("submit-text");
const loading = document.getElementById("loading");

function showError(message) {
    if (loginError) loginError.classList.add("show");
    if (errorText) errorText.textContent = message;
}

function hideError() {
    if (loginError) loginError.classList.remove("show");
    if (errorText) errorText.textContent = "";
}

function setLoading(isLoading) {
    if (loginButton) loginButton.disabled = isLoading;
    if (submitText) {
        submitText.textContent = isLoading ? "Signing in..." : "Sign in securely";
    }
    if (loading) {
        loading.classList.toggle("active", Boolean(isLoading));
    }
}

emailInput?.addEventListener("input", hideError);
passwordInput?.addEventListener("input", hideError);

// Show revocation/block reason if redirected with ?reason=...
try {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("reason");
    if (reason) {
        showError(reason);
    }
} catch {
    // Ignore URL parsing edge cases
}

if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideError();

        const email = emailInput?.value.trim() || "";
        const password = passwordInput?.value || "";

        if (!email) {
            showError("Please enter your email address.");
            emailInput?.focus();
            return;
        }
        if (!password) {
            showError("Please enter your password.");
            passwordInput?.focus();
            return;
        }

        setLoading(true);
        try {
            const user = await loginAdmin(email, password);
            if (!user) {
                throw new Error("Authentication could not be verified.");
            }
            window.location.assign(new URL("./admin.html", window.location.href).href);
        } catch (error) {
            showError(error?.message || "Unable to sign in. Please check your credentials.");
            setLoading(false);
        }
    });
}

(async function checkExistingSession() {
    try {
        await checkAdminAuth();
    } catch (error) {
        if (error?.message) {
            showError(error.message);
        }
    }
})();

window.addEventListener("pageshow", () => {
    setLoading(false);
});