// ============================================================================
// SIRANCHOWK KHAJA GHAR — AUTHENTICATED CUSTOMER ACCOUNT & ORDER PORTAL
// ============================================================================
// Strictly gates My Account dashboard behind Firebase Customer Authentication.
// Enforces per-UID data access so customers can only view their own records.
// ============================================================================

import {
    db,
    ref,
    onValue,
    update
} from "./firebase.js";
import {
    onCustomerAuthChange,
    loginCustomer,
    registerCustomer,
    loginWithGoogle,
    completeGoogleRedirectSignIn,
    linkCustomerGoogleAccount,
    resendCustomerVerificationEmail,
    reloadCustomerUser,
    changeCustomerPassword,
    changeCustomerEmail,
    resetCustomerPassword,
    updateCustomerProfile,
    logoutCustomer,
    getSafeRedirectTarget,
    mapAuthErrorMessage
} from "./customer-auth.js";
import {
    registerCustomerDeviceNotifications,
    disableCustomerDeviceNotifications
} from "./notifications-client.js";
import { logCustomerActivity } from "./activity-logger.js";

const ORDER_LABELS = {
    pending: "Received — awaiting confirmation",
    accepted: "Accepted",
    preparing: "Preparing your order",
    ready: "Ready for pickup",
    dispatched: "Out for delivery",
    delivered: "Delivered",
    cancelled: "Cancelled"
};

const TERMINAL_STATUSES = new Set(["delivered", "cancelled"]);
const STEP_ORDER = ["pending", "accepted", "preparing", "ready", "dispatched", "delivered"];

const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
}[c]));

function formatDate(value) {
    const date = new Date(Number(value) || value);
    return Number.isNaN(date.getTime())
        ? "Date unavailable"
        : date.toLocaleString("en-NP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kathmandu" });
}

const activeUnsubs = [];
function clearListeners() {
    while (activeUnsubs.length) {
        const unsub = activeUnsubs.pop();
        if (typeof unsub === "function") unsub();
    }
}

let cachedOrders = [];
let cachedOffers = [];
let cachedUsedCoupons = {};
let cachedAnnouncements = [];
let selectedOrderId = null;
let ordersLoadError = false;
let pendingAuthBanner = null;

function redirectIfRequested() {
    const target = getSafeRedirectTarget();
    if (target && target !== "account.html") {
        window.location.replace(target);
        return true;
    }
    return false;
}

function renderAuthGate(initialMode = "login") {
    clearListeners();
    const root = document.getElementById("account-root");
    if (!root) return;

    const mode = initialMode === "signup" ? "signup" : "login";

    root.innerHTML = `
      <section class="auth-gate-wrap">
        <div class="auth-gate-intro">
          <span class="badge-tag">Customer Account</span>
          <h1>Sign in to view your orders &amp; offers</h1>
          <p>Access your Siranchowk Khaja Ghar order history, live order tracking, saved delivery details, and personal coupons securely.</p>
          <ul class="auth-benefits">
            <li>Live status tracking for every website order</li>
            <li>Private order history isolated to your account</li>
            <li>One-click promo codes &amp; saved delivery info</li>
            <li>Optional browser alerts when your food is ready</li>
          </ul>
        </div>

        <div class="auth-card" role="region" aria-label="Customer authentication">
          <div class="auth-tabs" role="tablist">
            <button type="button" class="auth-tab ${mode === "login" ? "active" : ""}" id="tab-login" role="tab" aria-selected="${mode === "login"}">Login</button>
            <button type="button" class="auth-tab ${mode === "signup" ? "active" : ""}" id="tab-signup" role="tab" aria-selected="${mode === "signup"}">Sign Up</button>
          </div>

          <div id="auth-feedback" class="auth-feedback" role="alert" hidden></div>

          <form id="customer-login-form" class="auth-form" ${mode === "login" ? "" : "hidden"}>
            <div class="auth-field">
              <label for="login-email">Email Address</label>
              <input id="login-email" type="email" required autocomplete="email" placeholder="you@example.com">
            </div>
            <div class="auth-field">
              <label for="login-password">Password</label>
              <input id="login-password" type="password" required minlength="6" autocomplete="current-password" placeholder="Enter your password">
            </div>
            <div class="auth-row-between">
              <button type="button" class="auth-text-btn" id="forgot-password-btn">Forgot password?</button>
            </div>
            <button type="submit" class="btn btn-primary auth-submit" id="login-submit-btn">Login to My Account</button>
          </form>

          <form id="customer-signup-form" class="auth-form" ${mode === "signup" ? "" : "hidden"}>
            <div class="auth-field">
              <label for="signup-name">Full Name *</label>
              <input id="signup-name" type="text" required maxlength="80" autocomplete="name" placeholder="Your full name">
            </div>
            <div class="auth-field">
              <label for="signup-phone">Phone Number *</label>
              <input id="signup-phone" type="tel" required maxlength="16" autocomplete="tel" placeholder="98XXXXXXXX">
            </div>
            <div class="auth-field">
              <label for="signup-email">Email Address *</label>
              <input id="signup-email" type="email" required autocomplete="email" placeholder="you@example.com">
            </div>
            <div class="auth-field">
              <label for="signup-address">Default Delivery Area / Landmark (optional)</label>
              <input id="signup-address" type="text" maxlength="180" placeholder="e.g. Parsa Chowk, Khairahani-6">
            </div>
            <div class="auth-field">
              <label for="signup-password">Password * (min. 6 characters)</label>
              <input id="signup-password" type="password" required minlength="6" autocomplete="new-password" placeholder="Create a password">
            </div>
            <div class="auth-field">
              <label for="signup-confirm-password">Confirm Password *</label>
              <input id="signup-confirm-password" type="password" required minlength="6" autocomplete="new-password" placeholder="Re-enter your password">
            </div>
            <button type="submit" class="btn btn-primary auth-submit" id="signup-submit-btn">Create Customer Account</button>
          </form>

          <div class="auth-divider"><span>or continue with</span></div>
          <button type="button" class="auth-google-btn" id="google-signin-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-3l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.2 0-5.8-2.1-6.8-5H1.2v3.1C3.2 21.3 7.3 24 12 24z"/><path fill="#FBBC05" d="M5.2 14.2c-.2-.7-.4-1.5-.4-2.2s.2-1.5.4-2.2V6.7H1.2C.4 8.3 0 10.1 0 12s.4 3.7 1.2 5.3l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.3 0 3.2 2.7 1.2 6.7l4 3.1c1-2.9 3.6-5 6.8-5z"/></svg>
            Continue with Google
          </button>
        </div>
      </section>
    `;

    const feedback = root.querySelector("#auth-feedback");
    const showFeedback = (msg, isSuccess = false) => {
        feedback.hidden = !msg;
        feedback.textContent = msg;
        feedback.className = isSuccess ? "auth-feedback success" : "auth-feedback error";
    };

    if (pendingAuthBanner) {
        showFeedback(pendingAuthBanner.message, pendingAuthBanner.isSuccess);
        pendingAuthBanner = null;
    }

    const tabLogin = root.querySelector("#tab-login");
    const tabSignup = root.querySelector("#tab-signup");
    const loginForm = root.querySelector("#customer-login-form");
    const signupForm = root.querySelector("#customer-signup-form");

    const switchMode = (target) => {
        showFeedback("");
        const isLogin = target === "login";
        tabLogin.classList.toggle("active", isLogin);
        tabSignup.classList.toggle("active", !isLogin);
        tabLogin.setAttribute("aria-selected", String(isLogin));
        tabSignup.setAttribute("aria-selected", String(!isLogin));
        loginForm.hidden = !isLogin;
        signupForm.hidden = isLogin;
    };

    tabLogin.addEventListener("click", () => switchMode("login"));
    tabSignup.addEventListener("click", () => switchMode("signup"));

    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        showFeedback("");
        const btn = root.querySelector("#login-submit-btn");
        btn.disabled = true;
        btn.textContent = "Signing in…";
        try {
            await loginCustomer(
                root.querySelector("#login-email").value,
                root.querySelector("#login-password").value
            );
            redirectIfRequested();
        } catch (err) {
            showFeedback(mapAuthErrorMessage(err));
            btn.disabled = false;
            btn.textContent = "Login to My Account";
        }
    });

    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        showFeedback("");
        const btn = root.querySelector("#signup-submit-btn");
        btn.disabled = true;
        btn.textContent = "Creating account…";
        try {
            const res = await registerCustomer({
                name: root.querySelector("#signup-name").value,
                phone: root.querySelector("#signup-phone").value,
                email: root.querySelector("#signup-email").value,
                address: root.querySelector("#signup-address").value,
                password: root.querySelector("#signup-password").value,
                confirmPassword: root.querySelector("#signup-confirm-password").value
            });
            if (res?.verificationEmailSent) {
                pendingAuthBanner = {
                    message: "Account created! A verification email has been sent to your inbox.",
                    isSuccess: true
                };
            }
            redirectIfRequested();
        } catch (err) {
            showFeedback(mapAuthErrorMessage(err));
            btn.disabled = false;
            btn.textContent = "Create Customer Account";
        }
    });

    root.querySelector("#google-signin-btn").addEventListener("click", async () => {
        showFeedback("");
        try {
            const res = await loginWithGoogle();
            if (!res?.redirecting) {
                redirectIfRequested();
            }
        } catch (err) {
            showFeedback(mapAuthErrorMessage(err));
        }
    });

    root.querySelector("#forgot-password-btn").addEventListener("click", async () => {
        const email = root.querySelector("#login-email").value;
        try {
            await resetCustomerPassword(email);
            showFeedback("Password reset link sent to your email address.", true);
        } catch (err) {
            showFeedback(mapAuthErrorMessage(err));
        }
    });
}

function renderDashboardShell(user, profile) {
    clearListeners();
    const root = document.getElementById("account-root");
    if (!root) return;

    const notifPrefs = profile?.notificationPreferences || {};
    const browserPerm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
    const isPasswordProvider = Array.isArray(user.providerData) && user.providerData.some((p) => p?.providerId === "password");
    const hasGoogleProvider = Array.isArray(user.providerData) && user.providerData.some((p) => p?.providerId === "google.com");
    const emailVerified = Boolean(user.emailVerified);

    root.innerHTML = `
      <section class="account-hero">
        <div class="account-hero-top">
          <div>
            <span class="account-kicker">${emailVerified ? "Verified Email · Customer Account" : "Customer Account · Email Verification Pending"}</span>
            <h1>Welcome, ${safe(profile?.name || user.displayName || "Customer")}</h1>
            <p>${safe(user.email || "")} ${profile?.phone ? `· ${safe(profile.phone)}` : ""}</p>
          </div>
          <div class="account-hero-actions">
            <a href="menu.html" class="account-btn light">Order Food</a>
            <button type="button" class="account-btn outline-light" id="account-logout-btn">Logout</button>
          </div>
        </div>
      </section>

      ${user.email && !emailVerified ? `
        <section class="account-verify-banner" id="email-verify-banner" role="status">
          <div>
            <strong>Verify your email address</strong>
            <p class="account-muted">Please check your inbox (${safe(user.email)}) and click the verification link to keep your account recovery secure.</p>
            <div id="verify-feedback" class="auth-feedback" hidden></div>
          </div>
          <div class="account-verify-actions">
            <button type="button" class="account-btn" id="resend-verification-btn">Resend Verification Email</button>
            <button type="button" class="account-btn secondary" id="refresh-verification-btn">I Have Verified</button>
          </div>
        </section>
      ` : ""}

      <div id="dashboard-feedback" class="auth-feedback ${pendingAuthBanner?.isSuccess ? "success" : "error"}" style="margin-bottom:14px;" ${pendingAuthBanner ? "" : "hidden"}>${pendingAuthBanner ? safe(pendingAuthBanner.message) : ""}</div>

      <section class="account-grid" aria-label="Order summary">
        <div class="account-stat"><small>Total orders</small><strong id="account-total">0</strong></div>
        <div class="account-stat"><small>Active / in progress</small><strong id="account-active">0</strong></div>
        <div class="account-stat"><small>Delivered</small><strong id="account-completed">0</strong></div>
      </section>

      <div class="account-layout">
        <div class="account-main-col">
          <section class="account-card" id="tracking">
            <div class="account-card-head">
              <div>
                <h2>Order History &amp; Live Tracking</h2>
                <p class="account-muted">Only orders linked to your account are shown here.</p>
              </div>
            </div>
            <div id="account-orders" aria-live="polite">
              <div class="account-empty"><p class="account-muted">Loading your orders…</p></div>
            </div>
          </section>

          <section class="account-card" id="coupons-section">
            <div class="account-card-head">
              <div>
                <h2>Coupons &amp; Active Offers</h2>
                <p class="account-muted">Apply an available promo code to your cart or review your used coupons.</p>
              </div>
            </div>
            <div id="account-coupons-list">
              <p class="account-muted">Loading offers…</p>
            </div>
          </section>

          <section class="account-card" id="announcements-section">
            <div class="account-card-head">
              <div>
                <h2>Restaurant Announcements</h2>
                <p class="account-muted">Updates and seasonal specials from Siranchowk Khaja Ghar.</p>
              </div>
            </div>
            <div id="account-announcements-list">
              <p class="account-muted">Loading announcements…</p>
            </div>
          </section>
        </div>

        <aside class="account-side-col">
          <section class="account-card">
            <h2>Profile &amp; Delivery Details</h2>
            <div id="profile-feedback" class="auth-feedback" hidden></div>
            <form id="profile-edit-form" class="auth-form">
              <div class="auth-field">
                <label for="prof-name">Full Name</label>
                <input id="prof-name" type="text" required maxlength="80" value="${safe(profile?.name || user.displayName || "")}">
              </div>
              <div class="auth-field">
                <label for="prof-email">Account Email</label>
                <input id="prof-email" type="email" disabled value="${safe(user.email || "")}">
              </div>
              <div class="auth-field">
                <label for="prof-phone">Phone Number</label>
                <input id="prof-phone" type="tel" maxlength="16" value="${safe(profile?.phone || "")}" placeholder="98XXXXXXXX">
              </div>
              <div class="auth-field">
                <label for="prof-address">Default Delivery Address</label>
                <textarea id="prof-address" rows="2" maxlength="180" placeholder="Area / landmark in Khairahani / Parsa">${safe(profile?.address || "")}</textarea>
              </div>
              <button type="submit" class="account-btn" id="save-profile-btn">Save Profile</button>
            </form>
          </section>

          <section class="account-card">
            <h2>Notification Preferences</h2>
            <p class="account-muted">Control how you receive alerts for your orders and promotional offers.</p>
            <div class="pref-list">
              <label class="pref-toggle">
                <input type="checkbox" id="pref-order-alerts" ${notifPrefs.orderAlerts ? "checked" : ""}>
                <span>Order status updates</span>
              </label>
              <label class="pref-toggle">
                <input type="checkbox" id="pref-offers-optin" ${notifPrefs.offersOptIn ? "checked" : ""}>
                <span>Offers, coupons &amp; announcements</span>
              </label>
            </div>
            <div class="pref-actions">
              <button type="button" class="account-btn" id="enable-notifications">
                ${browserPerm === "granted" && notifPrefs.orderAlerts ? "Refresh Device Push" : "Enable Notifications"}
              </button>
              <button type="button" class="account-btn secondary" id="disable-notifications">Disable</button>
            </div>
            <p class="account-muted" id="notif-pref-status" style="margin-top:8px;">
              Browser permission: <strong>${safe(browserPerm)}</strong>
            </p>
          </section>

          <section class="account-card" id="account-security-card">
            <h2>Account Security</h2>
            <p class="account-muted">Update your sign-in credentials and email verification settings.</p>
            ${isPasswordProvider ? `
              <div id="security-feedback" class="auth-feedback" hidden></div>
              <form id="change-password-form" class="auth-form">
                <h3 class="account-subhead">Change Password</h3>
                <div class="auth-field">
                  <label for="sec-current-password">Current Password</label>
                  <input id="sec-current-password" type="password" required minlength="6" autocomplete="current-password" placeholder="Current password">
                </div>
                <div class="auth-field">
                  <label for="sec-new-password">New Password (min. 6 characters)</label>
                  <input id="sec-new-password" type="password" required minlength="6" autocomplete="new-password" placeholder="New password">
                </div>
                <div class="auth-field">
                  <label for="sec-confirm-password">Confirm New Password</label>
                  <input id="sec-confirm-password" type="password" required minlength="6" autocomplete="new-password" placeholder="Re-enter new password">
                </div>
                <button type="submit" class="account-btn" id="change-password-btn">Update Password</button>
              </form>

              <form id="change-email-form" class="auth-form account-subform-divider">
                <h3 class="account-subhead">Change Email Address</h3>
                <div class="auth-field">
                  <label for="sec-new-email">New Email Address</label>
                  <input id="sec-new-email" type="email" required autocomplete="email" placeholder="new-email@example.com">
                </div>
                <div class="auth-field">
                  <label for="sec-email-password">Current Password</label>
                  <input id="sec-email-password" type="password" required minlength="6" autocomplete="current-password" placeholder="Confirm your current password">
                </div>
                <button type="submit" class="account-btn secondary" id="change-email-btn">Send Email Change Verification</button>
              </form>

              <div class="auth-form account-subform-divider">
                <h3 class="account-subhead">Connected Sign-In Methods</h3>
                ${hasGoogleProvider
                    ? `<p class="account-muted">Google Sign-In is linked to this account.</p>`
                    : `<p class="account-muted">Link your Google account so you can also sign in with Google using this same customer profile.</p>
                       <button type="button" class="auth-google-btn" id="link-google-btn">Link Google Account</button>`
                }
              </div>
            ` : `
              <p class="account-muted">Signed in via Google (${safe(user.email || "")}). Password and email security are managed through your Google Account.</p>
            `}
          </section>
        </aside>
      </div>
    `;

    pendingAuthBanner = null;

    root.querySelector("#resend-verification-btn")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const fb = root.querySelector("#verify-feedback");
        btn.disabled = true;
        try {
            await resendCustomerVerificationEmail();
            if (fb) {
                fb.hidden = false;
                fb.className = "auth-feedback success";
                fb.textContent = "Verification email sent. Please check your inbox and spam folder.";
            }
        } catch (err) {
            if (fb) {
                fb.hidden = false;
                fb.className = "auth-feedback error";
                fb.textContent = mapAuthErrorMessage(err);
            }
        } finally {
            btn.disabled = false;
        }
    });

    root.querySelector("#refresh-verification-btn")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
            const refreshed = await reloadCustomerUser();
            if (refreshed?.emailVerified) {
                const dashFb = root.querySelector("#dashboard-feedback");
                if (dashFb) {
                    dashFb.hidden = false;
                    dashFb.className = "auth-feedback success";
                    dashFb.textContent = "Your email address is now verified.";
                }
            } else if (refreshed) {
                const liveFb = root.querySelector("#verify-feedback");
                if (liveFb) {
                    liveFb.hidden = false;
                    liveFb.className = "auth-feedback error";
                    liveFb.textContent = "Email is not marked verified yet. Click the link in your inbox, then try again.";
                }
            }
        } catch (err) {
            const liveFb = root.querySelector("#verify-feedback");
            if (liveFb) {
                liveFb.hidden = false;
                liveFb.className = "auth-feedback error";
                liveFb.textContent = mapAuthErrorMessage(err);
            }
        } finally {
            const liveBtn = root.querySelector("#refresh-verification-btn");
            if (liveBtn) liveBtn.disabled = false;
        }
    });

    root.querySelector("#change-password-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fb = root.querySelector("#security-feedback");
        const btn = root.querySelector("#change-password-btn");
        btn.disabled = true;
        try {
            await changeCustomerPassword(
                root.querySelector("#sec-current-password").value,
                root.querySelector("#sec-new-password").value,
                root.querySelector("#sec-confirm-password").value
            );
            e.target.reset();
            fb.hidden = false;
            fb.className = "auth-feedback success";
            fb.textContent = "Password updated successfully.";
        } catch (err) {
            fb.hidden = false;
            fb.className = "auth-feedback error";
            fb.textContent = mapAuthErrorMessage(err);
        } finally {
            btn.disabled = false;
        }
    });

    root.querySelector("#change-email-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fb = root.querySelector("#security-feedback");
        const btn = root.querySelector("#change-email-btn");
        btn.disabled = true;
        try {
            await changeCustomerEmail(
                root.querySelector("#sec-new-email").value,
                root.querySelector("#sec-email-password").value
            );
            e.target.reset();
            fb.hidden = false;
            fb.className = "auth-feedback success";
            fb.textContent = "Verification link sent to your new email address. Open that link to finalize the email change.";
        } catch (err) {
            fb.hidden = false;
            fb.className = "auth-feedback error";
            fb.textContent = mapAuthErrorMessage(err);
        } finally {
            btn.disabled = false;
        }
    });

    root.querySelector("#link-google-btn")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        pendingAuthBanner = {
            message: "Google account linked successfully.",
            isSuccess: true
        };
        try {
            await linkCustomerGoogleAccount();
            const liveFb = root.querySelector("#security-feedback");
            if (pendingAuthBanner && liveFb) {
                liveFb.hidden = false;
                liveFb.className = "auth-feedback success";
                liveFb.textContent = pendingAuthBanner.message;
                pendingAuthBanner = null;
            }
        } catch (err) {
            pendingAuthBanner = null;
            const liveFb = root.querySelector("#security-feedback");
            if (liveFb) {
                liveFb.hidden = false;
                liveFb.className = "auth-feedback error";
                liveFb.textContent = mapAuthErrorMessage(err);
            }
        } finally {
            const liveBtn = root.querySelector("#link-google-btn");
            if (liveBtn) liveBtn.disabled = false;
        }
    });

    root.querySelector("#account-logout-btn")?.addEventListener("click", async () => {
        try {
            await logoutCustomer();
        } catch (err) {
            console.warn("Logout warning:", err);
        }
    });

    root.querySelector("#profile-edit-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fb = root.querySelector("#profile-feedback");
        const btn = root.querySelector("#save-profile-btn");
        btn.disabled = true;
        btn.textContent = "Saving…";
        try {
            await updateCustomerProfile(user.uid, {
                name: root.querySelector("#prof-name").value,
                phone: root.querySelector("#prof-phone").value,
                address: root.querySelector("#prof-address").value
            });
            fb.hidden = false;
            fb.className = "auth-feedback success";
            fb.textContent = "Profile updated successfully.";
        } catch (err) {
            fb.hidden = false;
            fb.className = "auth-feedback error";
            fb.textContent = err.message || "Could not update profile.";
        } finally {
            btn.disabled = false;
            btn.textContent = "Save Profile";
        }
    });

    let lastSavedPrefs = {
        orderAlerts: Boolean(notifPrefs.orderAlerts),
        offersOptIn: Boolean(notifPrefs.offersOptIn)
    };

    const savePrefsOnly = async () => {
        const orderEl = root.querySelector("#pref-order-alerts");
        const offersEl = root.querySelector("#pref-offers-optin");
        const statusEl = root.querySelector("#notif-pref-status");
        const orderAlerts = Boolean(orderEl?.checked);
        const offersOptIn = Boolean(offersEl?.checked);

        try {
            await update(ref(db, `users/${user.uid}/profile/notificationPreferences`), {
                orderAlerts,
                offersOptIn,
                updatedAt: Date.now()
            });
            lastSavedPrefs = { orderAlerts, offersOptIn };
            await logCustomerActivity(user.uid, "notification_preferences_updated", {
                orderAlerts,
                offersOptIn
            });
            if (statusEl) statusEl.textContent = "Notification preferences saved.";
        } catch (err) {
            console.warn("Notification preferences update failed:", err);
            if (orderEl) orderEl.checked = lastSavedPrefs.orderAlerts;
            if (offersEl) offersEl.checked = lastSavedPrefs.offersOptIn;
            if (statusEl) {
                statusEl.textContent = err?.code === "PERMISSION_DENIED" || /permission_denied/i.test(err?.message || "")
                    ? "Could not save notification preferences (database permission required)."
                    : (err?.message || "Could not save notification preferences right now.");
            }
        }
    };

    root.querySelector("#pref-order-alerts")?.addEventListener("change", savePrefsOnly);
    root.querySelector("#pref-offers-optin")?.addEventListener("change", savePrefsOnly);

    root.querySelector("#enable-notifications")?.addEventListener("click", async () => {
        const statusEl = root.querySelector("#notif-pref-status");
        try {
            const prefs = {
                orderAlerts: true,
                offersOptIn: root.querySelector("#pref-offers-optin").checked
            };
            const res = await registerCustomerDeviceNotifications(user, prefs);
            root.querySelector("#pref-order-alerts").checked = res.granted;
            lastSavedPrefs = { orderAlerts: Boolean(res.granted), offersOptIn: Boolean(prefs.offersOptIn) };
            await logCustomerActivity(user.uid, "notification_preferences_updated", {
                orderAlerts: res.granted,
                offersOptIn: prefs.offersOptIn,
                browserPermission: res.permission
            });
            statusEl.textContent = res.granted
                ? "Notifications enabled for this device."
                : `Browser permission: ${res.permission}`;
        } catch (err) {
            statusEl.textContent = err.message || "Could not enable notifications.";
        }
    });

    root.querySelector("#disable-notifications")?.addEventListener("click", async () => {
        const statusEl = root.querySelector("#notif-pref-status");
        try {
            await disableCustomerDeviceNotifications(user);
            root.querySelector("#pref-order-alerts").checked = false;
            root.querySelector("#pref-offers-optin").checked = false;
            lastSavedPrefs = { orderAlerts: false, offersOptIn: false };
            await logCustomerActivity(user.uid, "notification_preferences_updated", {
                orderAlerts: false,
                offersOptIn: false
            });
            if (statusEl) statusEl.textContent = "Notifications disabled for this device.";
        } catch (err) {
            console.warn("Disable notifications failed:", err);
            if (statusEl) statusEl.textContent = err?.message || "Could not disable notifications right now.";
        }
    });

    // Subscribe ONLY to this authenticated user's orders
    ordersLoadError = false;
    const ordersUnsub = onValue(ref(db, `users/${user.uid}/orders`), (snap) => {
        ordersLoadError = false;
        const val = snap.val() || {};
        cachedOrders = Object.values(val).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        renderOrdersSection(user.uid);
        watchUserOrderTracking(user.uid);
    }, (err) => {
        console.warn("Could not read user orders:", err);
        ordersLoadError = true;
        cachedOrders = [];
        renderOrdersSection(user.uid);
    });
    activeUnsubs.push(ordersUnsub);

    // Subscribe to used coupons for this user
    const usedCouponsUnsub = onValue(ref(db, `users/${user.uid}/coupons`), (snap) => {
        cachedUsedCoupons = snap.val() || {};
        renderCouponsSection();
    }, (err) => {
        console.warn("Could not read user coupons:", err);
        cachedUsedCoupons = {};
        renderCouponsSection();
    });
    activeUnsubs.push(usedCouponsUnsub);

    // Subscribe to active public offers
    const offersUnsub = onValue(ref(db, "offers"), (snap) => {
        const val = snap.val() || {};
        cachedOffers = Object.entries(val).map(([id, off]) => ({ id, ...off }));
        renderCouponsSection();
    }, (err) => {
        console.warn("Could not load offers:", err);
        cachedOffers = [];
        renderCouponsSection();
    });
    activeUnsubs.push(offersUnsub);

    // Subscribe to customer announcements
    const annUnsub = onValue(ref(db, "announcements/customer"), (snap) => {
        const val = snap.val() || {};
        cachedAnnouncements = Object.entries(val)
            .map(([id, item]) => ({ id, ...item }))
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        renderAnnouncementsSection();
    }, (err) => {
        console.warn("Could not load announcements:", err);
        cachedAnnouncements = [];
        renderAnnouncementsSection();
    });
    activeUnsubs.push(annUnsub);
}

const trackingUnsubs = new Map();
function watchUserOrderTracking(uid) {
    cachedOrders.forEach((order) => {
        const token = order.customerTrackingToken || order.token;
        if (!token || trackingUnsubs.has(token)) return;
        const unsub = onValue(ref(db, `orderTracking/${token}`), (snap) => {
            if (!snap.exists()) return;
            const live = snap.val();
            const target = cachedOrders.find((o) => o.id === order.id);
            if (target && (target.status !== live.status || target.customerMessage !== live.customerMessage)) {
                target.status = live.status || target.status;
                target.customerMessage = live.customerMessage || "";
                target.updatedAt = live.updatedAt || target.updatedAt;
                renderOrdersSection(uid);
            }
        }, () => {});
        trackingUnsubs.set(token, unsub);
        activeUnsubs.push(unsub);
    });
}

function renderOrdersSection() {
    const totalEl = document.getElementById("account-total");
    const activeEl = document.getElementById("account-active");
    const completedEl = document.getElementById("account-completed");
    const host = document.getElementById("account-orders");
    if (!host) return;

    const total = cachedOrders.length;
    const active = cachedOrders.filter((o) => !TERMINAL_STATUSES.has(o.status || "pending")).length;
    const completed = cachedOrders.filter((o) => o.status === "delivered").length;

    if (totalEl) totalEl.textContent = String(total);
    if (activeEl) activeEl.textContent = String(active);
    if (completedEl) completedEl.textContent = String(completed);

    if (!total) {
        if (ordersLoadError) {
            host.innerHTML = `
              <div class="account-empty">
                <h3>Unable to load your order history right now</h3>
                <p class="account-muted">Please check your connection or contact the restaurant if this persists.</p>
                <a class="account-btn" href="menu.html">Explore the Menu</a>
              </div>
            `;
            return;
        }
        host.innerHTML = `
          <div class="account-empty">
            <h3>No orders placed with this account yet</h3>
            <p class="account-muted">Orders you submit while signed in will appear here with real-time status tracking.</p>
            <a class="account-btn" href="menu.html">Explore the Menu</a>
          </div>
        `;
        return;
    }

    host.innerHTML = cachedOrders.map((order) => {
        const status = order.status || "pending";
        const shortId = safe(String(order.id).slice(-8).toUpperCase());
        const itemsHtml = Array.isArray(order.items) && order.items.length
            ? order.items.map((i) => `<li>${safe(i.quantity)} × ${safe(i.name)}</li>`).join("")
            : `<li>${safe(order.summary || "Order items")}</li>`;
        const isExpanded = selectedOrderId === order.id;
        const stepIdx = STEP_ORDER.indexOf(status);

        return `
          <article class="account-order-item">
            <div class="account-order-top">
              <div>
                <h3>Order #${shortId}</h3>
                <div class="account-muted">${formatDate(order.createdAt)} · ${safe(order.orderType || "Order")}</div>
              </div>
              <span class="account-status ${safe(status)}">${safe(ORDER_LABELS[status] || status)}</span>
            </div>

            <ul class="account-items-list">${itemsHtml}</ul>

            ${order.couponCode ? `<div class="account-muted">Coupon applied: <strong>${safe(order.couponCode)}</strong> (${safe(order.couponSummary || "")})</div>` : ""}
            ${order.customerMessage ? `<div class="account-order-note">${safe(order.customerMessage)}</div>` : ""}

            <div class="account-order-bottom">
              <span class="account-muted">${order.deliveryAddress ? `Delivery: ${safe(order.deliveryAddress)}` : "Counter pickup / dine-in"}</span>
              <button type="button" class="account-btn secondary toggle-order-track" data-order-id="${safe(order.id)}">
                ${isExpanded ? "Hide Tracking" : "View Tracking"}
              </button>
            </div>

            ${isExpanded ? `
              <div class="order-timeline" aria-label="Order progress">
                ${status === "cancelled"
                    ? `<p class="account-muted" style="color:#a53e35;">This order was cancelled. Please contact 9821233154 if you need help.</p>`
                    : STEP_ORDER.map((step, idx) => `
                        <div class="timeline-step ${idx <= stepIdx ? "done" : ""}">
                          <span class="timeline-dot"></span>
                          <span>${safe(step.charAt(0).toUpperCase() + step.slice(1))}</span>
                        </div>
                      `).join("")
                }
              </div>
            ` : ""}
          </article>
        `;
    }).join("");

    host.querySelectorAll(".toggle-order-track").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.orderId;
            selectedOrderId = selectedOrderId === id ? null : id;
            renderOrdersSection();
        });
    });
}

function renderCouponsSection() {
    const host = document.getElementById("account-coupons-list");
    if (!host) return;

    const now = Date.now();
    const available = cachedOffers.filter((off) =>
        off &&
        off.active !== false &&
        (!off.expiresAt || Number(off.expiresAt) > now) &&
        !(cachedUsedCoupons[off.id]?.used)
    );
    const used = Object.values(cachedUsedCoupons).filter((c) => c && c.used);

    if (!available.length && !used.length) {
        host.innerHTML = `<p class="account-muted">No active coupons or used coupons on your account right now.</p>`;
        return;
    }

    host.innerHTML = `
      ${available.length ? `
        <h3 class="account-subhead">Available Coupons</h3>
        <div class="coupon-grid">
          ${available.map((off) => `
            <div class="coupon-item">
              <div>
                <strong>${safe(off.title || off.code)}</strong>
                <div class="account-muted">${safe(off.description || "")}</div>
                <code class="public-offer-code">${safe(off.code)}</code>
              </div>
              <button type="button" class="account-btn apply-coupon-account" data-code="${safe(off.code)}">Apply to Cart</button>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${used.length ? `
        <h3 class="account-subhead" style="margin-top:16px;">Used Coupons</h3>
        <div class="coupon-grid">
          ${used.map((c) => `
            <div class="coupon-item used">
              <div>
                <strong>${safe(c.code)}</strong> — ${safe(c.title || c.summary || "Redeemed")}
                <div class="account-muted">Used on ${formatDate(c.usedAt)}</div>
              </div>
              <span class="account-status delivered">Used</span>
            </div>
          `).join("")}
        </div>
      ` : ""}
    `;

    host.querySelectorAll(".apply-coupon-account").forEach((btn) => {
        btn.addEventListener("click", () => {
            const code = btn.dataset.code;
            if (window.SKGCart && typeof window.SKGCart.applyCouponCode === "function") {
                window.SKGCart.applyCouponCode(code);
                window.SKGCart.open();
            }
        });
    });
}

function renderAnnouncementsSection() {
    const host = document.getElementById("account-announcements-list");
    if (!host) return;
    if (!cachedAnnouncements.length) {
        host.innerHTML = `<p class="account-muted">No customer announcements right now.</p>`;
        return;
    }
    host.innerHTML = cachedAnnouncements.slice(0, 6).map((a) => `
      <article class="announcement-item">
        <strong>${safe(a.title)}</strong>
        <p>${safe(a.body || a.message || "")}</p>
        <small class="account-muted">${formatDate(a.createdAt)}</small>
      </article>
    `).join("");
}

document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(window.location.search);
    const initialMode = params.get("mode") || "login";

    try {
        const redirectRes = await completeGoogleRedirectSignIn();
        if (redirectRes?.user && redirectIfRequested()) {
            return;
        }
    } catch (err) {
        pendingAuthBanner = { message: mapAuthErrorMessage(err), isSuccess: false };
    }

    onCustomerAuthChange(({ user, profile }) => {
        if (!user) {
            renderAuthGate(initialMode);
        } else {
            if (redirectIfRequested()) return;
            renderDashboardShell(user, profile);
        }
    });
});
