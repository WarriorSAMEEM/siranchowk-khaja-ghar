import { loginAdmin, checkAdminAuth } from "./auth.js";

// ============================================================
// INITIAL AUTH CHECK
// ============================================================

checkAdminAuth();


// ============================================================
// DOM ELEMENTS
// ============================================================

const loginForm = document.getElementById("admin-login-form");

const errorAlert = document.getElementById("login-error");

const errorText = document.getElementById("error-text");

const submitBtn = document.getElementById("btn-submit");

const submitText = document.getElementById("submit-text");

const loading = document.getElementById("loading");

const emailInput = document.getElementById("admin-email");

const passwordInput = document.getElementById("admin-password");

const passwordToggle =
  document.getElementById("toggle-password");


// ============================================================
// HELPER — SHOW ERROR
// ============================================================

function showLoginError(message) {

  if (errorText) {
    errorText.textContent =
      message || "Invalid email or password.";
  }

  if (errorAlert) {
    errorAlert.classList.add("show");

    // Compatibility with older CSS
    errorAlert.style.display = "block";
  }
}


// ============================================================
// HELPER — HIDE ERROR
// ============================================================

function hideLoginError() {

  if (errorAlert) {
    errorAlert.classList.remove("show");

    // Compatibility with older CSS
    errorAlert.style.display = "none";
  }
}


// ============================================================
// BUTTON — LOADING STATE
// ============================================================

function setLoading(isLoading) {

  if (!submitBtn) {
    return;
  }

  submitBtn.disabled = isLoading;

  if (submitText) {
    submitText.style.display =
      isLoading ? "none" : "inline";
  }

  if (loading) {
    loading.classList.toggle("active", isLoading);
  }

  // Fallback for an older login.html
  if (!submitText && !loading) {

    submitBtn.innerHTML = isLoading
      ? "Authenticating..."
      : "Sign in securely";
  }
}


// ============================================================
// PASSWORD VISIBILITY TOGGLE
// ============================================================

passwordToggle?.addEventListener("click", () => {

  if (!passwordInput) {
    return;
  }

  const isPassword =
    passwordInput.type === "password";

  passwordInput.type =
    isPassword ? "text" : "password";

  passwordToggle.textContent =
    isPassword ? "Hide" : "Show";

  passwordToggle.setAttribute(
    "aria-label",
    isPassword
      ? "Hide password"
      : "Show password"
  );
});


// ============================================================
// LOGIN FORM
// ============================================================

loginForm?.addEventListener("submit", async (event) => {

  event.preventDefault();

  hideLoginError();

  // ----------------------------------------------------------
  // Get values
  // ----------------------------------------------------------

  const email =
    emailInput?.value.trim() || "";

  const password =
    passwordInput?.value || "";


  // ----------------------------------------------------------
  // Client-side validation
  // ----------------------------------------------------------

  if (!email) {

    showLoginError(
      "Please enter your email address."
    );

    emailInput?.focus();

    return;
  }


  if (!password) {

    showLoginError(
      "Please enter your password."
    );

    passwordInput?.focus();

    return;
  }


  // ----------------------------------------------------------
  // Start loading
  // ----------------------------------------------------------

  setLoading(true);


  try {

    // --------------------------------------------------------
    // Firebase Authentication
    // --------------------------------------------------------

    const result =
      await loginAdmin(email, password);


    // --------------------------------------------------------
    // Successful login
    // --------------------------------------------------------

    if (result.success) {

      /*
       * Firebase authentication has succeeded.
       *
       * Redirect only after successful authentication.
       */

      window.location.replace("./admin.html");

      return;
    }


    // --------------------------------------------------------
    // Failed login
    // --------------------------------------------------------

    showLoginError(
      result.error ||
      "Invalid email or password."
    );

    passwordInput?.focus();

    passwordInput?.select();

  } catch (error) {

    console.error(
      "Login handler error:",
      error
    );

    showLoginError(
      "Something went wrong. Please try again."
    );

  } finally {

    // --------------------------------------------------------
    // Restore button
    // --------------------------------------------------------

    setLoading(false);
  }

});


// ============================================================
// CLEAR ERROR WHEN USER STARTS TYPING
// ============================================================

emailInput?.addEventListener(
  "input",
  hideLoginError
);

passwordInput?.addEventListener(
  "input",
  hideLoginError
);