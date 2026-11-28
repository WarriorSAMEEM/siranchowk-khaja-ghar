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
import {
    ensurePublicProfile,
    fetchUserBookmarks,
    fetchMySocialNotifications,
    markSocialNotificationRead,
    syncEmailVerificationBadge
} from "./social-service.js";
import { renderProfileBadgesHtml } from "./badges.js";
import { buildArticleUrl, buildProfileUrl } from "./platform-core.js";

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

          <section class="account-card" id="bookmarks-section">
            <div class="account-card-head">
              <div>
                <h2>Saved Article Bookmarks</h2>
                <p class="account-muted">Private reading list isolated to your account.</p>
              </div>
              <a href="/explore.html" class="account-btn secondary">Explore More</a>
            </div>
            <div id="account-bookmarks-list">
              <p class="account-muted">Loading your saved bookmarks…</p>
            </div>
          </section>

          <section class="account-card" id="social-notifications-section">
            <div class="account-card-head">
              <div>
                <h2>Community Notifications</h2>
                <p class="account-muted">New followers, comments, reposts, and creator/badge updates.</p>
              </div>
            </div>
            <div id="account-social-notifs-list">
              <p class="account-muted">Loading community updates…</p>
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

          <section class="account-card" id="creator-hub-card">
            <h2>Community &amp; Creator Profile</h2>
            <div id="account-public-profile-summary">
              <p class="account-muted">Loading your public profile &amp; verification badges…</p>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">
              <a href="/creator-studio.html" class="account-btn">Open Creator Studio</a>
              <a href="/explore.html" class="account-btn secondary">Explore Community</a>
            </div>
          </section>

          <section class="account-card">
            <h2>Notification Preferences</h2>
            <p class="account-muted">Control how you receive alerts for your orders, promotional offers, and community activity.</p>
            <div class="pref-list">
              <label class="pref-toggle">
                <input type="checkbox" id="pref-order-alerts" ${notifPrefs.orderAlerts ? "checked" : ""}>
                <span>Order status updates</span>
              </label>
              <label class="pref-toggle">
                <input type="checkbox" id="pref-offers-optin" ${notifPrefs.offersOptIn ? "checked" : ""}>
                <span>Offers, coupons &amp; announcements</span>
              </label>
              <label class="pref-toggle">
                <input type="checkbox" id="pref-social-followers" ${notifPrefs.notifyFollowers !== false ? "checked" : ""}>
                <span>New follower notifications</span>
              </label>
              <label class="pref-toggle">
                <input type="checkbox" id="pref-social-interactions" ${notifPrefs.notifyLikesComments !== false ? "checked" : ""}>
                <span>Article likes, comments &amp; reposts</span>
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
        const followersEl = root.querySelector("#pref-social-followers");
        const interactionsEl = root.querySelector("#pref-social-interactions");
        const statusEl = root.querySelector("#notif-pref-status");
        const orderAlerts = Boolean(orderEl?.checked);
        const offersOptIn = Boolean(offersEl?.checked);
        const notifyFollowers = followersEl ? Boolean(followersEl.checked) : true;
        const notifyLikesComments = interactionsEl ? Boolean(interactionsEl.checked) : true;

        try {
            await update(ref(db, `users/${user.uid}/profile/notificationPreferences`), {
                orderAlerts,
                offersOptIn,
                notifyFollowers,
                notifyLikesComments,
                notifyReposts: notifyLikesComments,
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
    root.querySelector("#pref-social-followers")?.addEventListener("change", savePrefsOnly);
    root.querySelector("#pref-social-interactions")?.addEventListener("change", savePrefsOnly);

    // Load Creator Hub, Verification Badges, Private Bookmarks & Social Notifications
    (async () => {
        try {
            await syncEmailVerificationBadge(user);
            const pub = await ensurePublicProfile(user);
            const pubHost = document.getElementById("account-public-profile-summary");
            if (pubHost && pub) {
                const badgesHtml = renderProfileBadgesHtml(pub.badges || {}, {
                    includeEmailVerified: true,
                    specialtyNote: pub.specialtyNote || ""
                });
                pubHost.innerHTML = `
                  <p class="account-muted">Public handle: <a href="${safe(buildProfileUrl(pub.username))}"><strong>@${safe(pub.username)}</strong></a> · Creator status: <strong>${safe(pub.creatorStatus || "none")}</strong></p>
                  ${badgesHtml || `<p class="account-muted">Verify your email to show Email Verified status; creator &amp; specialist badges are admin-granted.</p>`}
                `;
            }

            const bookmarks = await fetchUserBookmarks(user.uid);
            const bmHost = document.getElementById("account-bookmarks-list");
            if (bmHost) {
                bmHost.innerHTML = bookmarks.length
                    ? `<div class="coupon-grid">${bookmarks.map((b) => `
                        <div class="coupon-item">
                          <div>
                            <a href="${safe(buildArticleUrl(b.slug || b.articleId))}"><strong>${safe(b.title || "Saved Article")}</strong></a>
                            <div class="account-muted">${safe(b.authorName || "")} · Saved ${formatDate(b.savedAt)}</div>
                          </div>
                          <a href="${safe(buildArticleUrl(b.slug || b.articleId))}" class="account-btn secondary">Read</a>
                        </div>
                      `).join("")}</div>`
                    : `<p class="account-muted">You have not saved any article bookmarks yet.</p>`;
            }

            const socialNotifs = await fetchMySocialNotifications(user.uid, 20);
            const snHost = document.getElementById("account-social-notifs-list");
            if (snHost) {
                snHost.innerHTML = socialNotifs.length
                    ? socialNotifs.map((n) => `
                        <article class="announcement-item" style="${n.read ? "opacity:0.75;" : ""}">
                          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
                            <strong>${safe(n.title)}</strong>
                            ${!n.read ? `<button type="button" class="account-btn secondary mark-snotif-read" data-sn-id="${safe(n.id)}" style="padding:4px 10px;font-size:12px;">Mark read</button>` : `<span class="account-muted">Read</span>`}
                          </div>
                          ${n.body ? `<p>${safe(n.body)}</p>` : ""}
                          <small class="account-muted">${formatDate(n.createdAt)}${n.link ? ` · <a href="${safe(n.link)}">Open</a>` : ""}</small>
                        </article>
                      `).join("")
                    : `<p class="account-muted">No community notifications yet.</p>`;
                snHost.querySelectorAll(".mark-snotif-read").forEach((btn) => {
                    btn.addEventListener("click", async () => {
                        await markSocialNotificationRead(user.uid, btn.dataset.snId);
                        btn.replaceWith(Object.assign(document.createElement("span"), { className: "account-muted", textContent: "Read" }));
                    });
                });
            }
        } catch {
            // Non-blocking enrichment
        }
    })();

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

function renderAccountBillHtml(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const shortId = safe(String(order.id).slice(-8).toUpperCase());
    const subtotal = typeof order.subtotalAmount === "number"
        ? order.subtotalAmount
        : items.reduce((sum, i) => sum + Number(i.lineTotal || (Number(i.unitPrice || 0) * Number(i.quantity || 0))), 0);
    const discount = Number(order.discountAmount || 0);
    const total = typeof order.totalAmount === "number" ? order.totalAmount : Math.max(0, subtotal - discount);
    const hasSnapshot = typeof order.totalAmount === "number" || items.some((i) => typeof i.unitPrice === "number");

    return `
      <div style="max-width:520px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;border:1px solid #d5e1de;border-radius:12px;padding:18px;background:#fff;color:#122b28;">
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #e2ebe8;padding-bottom:8px;margin-bottom:10px;">
          <div>
            <h2 style="margin:0;font-size:18px;">Siranchowk Khaja Ghar</h2>
            <div style="font-size:12px;color:#475569;">Khairahani-6, Parsa, Chitwan · Tel: 9821233154</div>
          </div>
          <div style="text-align:right;">
            <strong>Bill #${shortId}</strong>
            <div style="font-size:12px;color:#475569;">${formatDate(order.createdAt)}</div>
          </div>
        </div>
        <div style="font-size:13px;margin-bottom:8px;">
          <strong>${safe(order.customerName || "Customer")}</strong> (${safe(order.customerPhone || "")}) · ${safe(order.orderType || "Order")}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;">
          <thead>
            <tr style="border-bottom:1px solid #cbd5e1;">
              <th style="text-align:left;padding:5px 4px;">Item</th>
              <th style="text-align:center;padding:5px 4px;">Qty</th>
              <th style="text-align:right;padding:5px 4px;">Rate</th>
              <th style="text-align:right;padding:5px 4px;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((i) => `
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:5px 4px;">${safe(i.name)}</td>
                <td style="text-align:center;padding:5px 4px;">${safe(i.quantity)}</td>
                <td style="text-align:right;padding:5px 4px;">${typeof i.unitPrice === "number" ? `Rs. ${safe(i.unitPrice)}` : "—"}</td>
                <td style="text-align:right;padding:5px 4px;">${typeof i.lineTotal === "number" ? `Rs. ${safe(i.lineTotal)}` : (typeof i.unitPrice === "number" ? `Rs. ${safe(i.unitPrice * i.quantity)}` : "—")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        ${hasSnapshot ? `
          <div style="display:grid;gap:4px;font-size:13px;border-top:1px solid #cbd5e1;padding-top:8px;">
            <div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>Rs. ${safe(subtotal)}</span></div>
            ${discount > 0 ? `<div style="display:flex;justify-content:space-between;color:#15803d;"><span>Discount (${safe(order.couponCode || "Coupon")})</span><span>− Rs. ${safe(discount)}</span></div>` : ""}
            <div style="display:flex;justify-content:space-between;font-weight:800;font-size:15px;"><span>Total (NPR)</span><span>Rs. ${safe(total)}</span></div>
          </div>
        ` : `<p style="font-size:12px;color:#475569;">Legacy order — counter confirmation applied.</p>`}
      </div>
    `;
}

function printAccountBill(order) {
    let host = document.getElementById("skg-print-host");
    if (!host) {
        host = document.createElement("div");
        host.id = "skg-print-host";
        host.style.display = "none";
        document.body.appendChild(host);
    }
    host.innerHTML = renderAccountBillHtml(order);
    host.style.display = "block";
    window.print();
    host.style.display = "none";
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
        const items = Array.isArray(order.items) ? order.items : [];
        const itemsHtml = items.length
            ? items.map((i) => {
                const lineRate = typeof i.unitPrice === "number"
                    ? ` — Rs. ${safe(i.unitPrice)} × ${safe(i.quantity)} = <strong>Rs. ${safe(i.lineTotal ?? i.unitPrice * i.quantity)}</strong>`
                    : "";
                return `<li>${safe(i.quantity)} × ${safe(i.name)}${lineRate}</li>`;
            }).join("")
            : `<li>${safe(order.summary || "Order items")}</li>`;
        const hasTotal = typeof order.totalAmount === "number";
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

            ${hasTotal ? `
              <div class="account-muted" style="margin:6px 0;font-weight:700;color:#123f3b;">
                ${Number(order.discountAmount || 0) > 0 ? `Subtotal: Rs. ${safe(order.subtotalAmount ?? order.totalAmount)} · Discount: − Rs. ${safe(order.discountAmount)} · ` : ""}
                Total: Rs. ${safe(order.totalAmount)} (NPR)
              </div>
            ` : ""}

            ${order.couponCode ? `<div class="account-muted">Coupon applied: <strong>${safe(order.couponCode)}</strong> (${safe(order.couponSummary || "")})</div>` : ""}
            ${order.customerMessage ? `<div class="account-order-note">${safe(order.customerMessage)}</div>` : ""}

            <div class="account-order-bottom">
              <span class="account-muted">${order.deliveryAddress ? `Delivery: ${safe(order.deliveryAddress)}` : "Counter pickup / dine-in"}</span>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button type="button" class="account-btn secondary print-account-bill" data-order-id="${safe(order.id)}">Print / Save Bill</button>
                <button type="button" class="account-btn secondary toggle-order-track" data-order-id="${safe(order.id)}">
                  ${isExpanded ? "Hide Tracking" : "View Tracking"}
                </button>
              </div>
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

    host.querySelectorAll(".print-account-bill").forEach((btn) => {
        btn.addEventListener("click", () => {
            const order = cachedOrders.find((o) => o.id === btn.dataset.orderId);
            if (order) printAccountBill(order);
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
