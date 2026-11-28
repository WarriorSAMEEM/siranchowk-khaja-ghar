// ============================================================================
// SIRANCHOWK KHAJA GHAR — CUSTOMER AUTHENTICATION & DYNAMIC NAVIGATION
// ============================================================================

import {
    auth,
    db,
    ref,
    get,
    set,
    update,
    runTransaction,
    onAuthStateChanged,
    onIdTokenChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    sendPasswordResetEmail,
    sendEmailVerification,
    updatePassword,
    verifyBeforeUpdateEmail,
    EmailAuthProvider,
    reauthenticateWithCredential,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    linkWithPopup,
    signOut,
    setPersistence,
    browserLocalPersistence
} from "./firebase.js";
import { maybeShowCustomerNotificationInvite, attachForegroundNotificationToast, refreshCustomerFcmTokenIfGranted } from "./notifications-client.js";
import { recordLoginEvent, logCustomerActivity } from "./activity-logger.js";

const CUST_LOGIN_TS_KEY = "skg_cust_login_ts_v1";

function markCustomerLoginStart() {
    try { sessionStorage.setItem(CUST_LOGIN_TS_KEY, String(Date.now())); } catch {}
}

function consumeCustomerSessionDurationSec() {
    try {
        const started = Number(sessionStorage.getItem(CUST_LOGIN_TS_KEY) || 0);
        sessionStorage.removeItem(CUST_LOGIN_TS_KEY);
        if (started > 0 && Date.now() >= started) {
            return Math.round((Date.now() - started) / 1000);
        }
    } catch {}
    return null;
}

let currentUser = null;
let currentProfile = null;
let authResolved = false;
const authSubscribers = new Set();

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function getSafeSessionId() {
    try {
        return sessionStorage.getItem("siranchowk_analytics_session") || "";
    } catch {
        return "";
    }
}

const SAFE_REDIRECT_PAGES = new Set([
    "index.html",
    "menu.html",
    "about.html",
    "contact.html",
    "account.html",
    "explore.html",
    "blog.html",
    "article.html",
    "profile.html",
    "creator-studio.html"
]);

const SAFE_SSR_PREFIXES = [
    "/explore",
    "/blog",
    "/category/",
    "/user/",
    "/creator/studio"
];

export function getSafeRedirectTarget(search = "") {
    try {
        const raw = new URLSearchParams(search || (typeof window !== "undefined" ? window.location.search : "")).get("redirect") || "";
        const trimmed = raw.trim();
        if (!trimmed) return "";
        // Reject protocol schemes, protocol-relative URLs, backslashes, credentials, traversal, or control chars
        if (
            /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ||
            trimmed.startsWith("//") ||
            /[\\\r\n\0@]/.test(trimmed) ||
            /(?:^|\/)\.\.(?:\/|$)/.test(trimmed)
        ) {
            return "";
        }

        const hashIdx = trimmed.indexOf("#");
        const beforeHash = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
        const hashRaw = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : "";
        const safeHash = hashRaw ? `#${hashRaw.replace(/[^a-zA-Z0-9_-]/g, "")}` : "";

        const qIdx = beforeHash.indexOf("?");
        const pathRaw = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash;
        const queryRaw = qIdx >= 0 ? beforeHash.slice(qIdx) : "";
        const safeQuery = /^\?[a-zA-Z0-9_=&.%+-]*$/.test(queryRaw) ? queryRaw : "";

        const cleanNoLeadingSlash = pathRaw.replace(/^\/+/, "");
        if (SAFE_REDIRECT_PAGES.has(cleanNoLeadingSlash)) {
            return `${cleanNoLeadingSlash}${safeQuery}${safeHash}`;
        }

        const normalizedPath = `/${cleanNoLeadingSlash}`;
        if (normalizedPath.startsWith("/admin")) return "";
        const matchesSsr = SAFE_SSR_PREFIXES.some((prefix) =>
            prefix.endsWith("/")
                ? normalizedPath.startsWith(prefix) && normalizedPath.length > prefix.length
                : normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
        );
        if (matchesSsr) {
            return `${normalizedPath}${safeQuery}${safeHash}`;
        }
        return "";
    } catch {
        return "";
    }
}

function isValidEmailFormat(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());
}

export async function ensureCustomerProfile(user, extra = {}) {
    if (!user?.uid) return null;
    const now = Date.now();
    const providerId = extra.authProvider || user.providerData?.[0]?.providerId || "password";
    const fallbackProfile = {
        uid: user.uid,
        name: String(extra.name || user.displayName || (user.email ? user.email.split("@")[0] : "Customer")).slice(0, 80),
        email: String(user.email || "").slice(0, 120),
        phone: String(extra.phone || user.phoneNumber || "").slice(0, 16),
        address: String(extra.address || "").slice(0, 180),
        authProvider: String(providerId).slice(0, 40),
        emailVerified: Boolean(user.emailVerified),
        accountStatus: "active",
        loginCount: Number(extra.initialLoginCount || 1),
        lastLoginAt: now,
        lastActiveAt: now,
        lastSessionId: getSafeSessionId().slice(0, 96),
        notificationPreferences: {
            orderAlerts: false,
            offersOptIn: false,
            browserPermission: typeof Notification !== "undefined" ? Notification.permission : "default",
            updatedAt: now
        },
        createdAt: now,
        updatedAt: now
    };

    try {
        const profileRef = ref(db, `users/${user.uid}/profile`);
        const snapshot = await get(profileRef);

        if (!snapshot.exists()) {
            await set(profileRef, fallbackProfile);
            return fallbackProfile;
        }

        const existing = snapshot.val() || {};
        const patch = {
            updatedAt: now,
            lastActiveAt: now,
            emailVerified: Boolean(user.emailVerified)
        };
        if (extra.name && !existing.name) patch.name = String(extra.name).slice(0, 80);
        if (extra.phone && !existing.phone) patch.phone = String(extra.phone).slice(0, 16);
        if (user.email && existing.email !== user.email) patch.email = String(user.email).slice(0, 120);
        if (!existing.accountStatus) patch.accountStatus = "active";
        if (!existing.authProvider) patch.authProvider = String(providerId).slice(0, 40);

        if (extra.recordLogin) {
            patch.lastLoginAt = now;
            patch.lastSessionId = getSafeSessionId().slice(0, 96);
        }

        await update(profileRef, patch).catch((err) => {
            console.warn("Customer profile update skipped:", err?.message || err);
        });

        if (extra.recordLogin) {
            await runTransaction(ref(db, `users/${user.uid}/profile/loginCount`), (curr) => {
                const num = Number(curr || 0);
                return Number.isFinite(num) && num >= 0 ? num + 1 : 1;
            }).catch(() => {});
            const updatedSnap = await get(profileRef).catch(() => null);
            if (updatedSnap?.exists()) return updatedSnap.val();
        }

        return { ...existing, ...patch };
    } catch (err) {
        console.warn("Customer profile sync skipped:", err?.message || err);
        return fallbackProfile;
    }
}

export async function updateCustomerProfile(uid, updates) {
    if (!uid || auth.currentUser?.uid !== uid) {
        throw new Error("You can only update your own profile.");
    }
    const clean = {
        name: String(updates.name || "").trim().slice(0, 80),
        phone: String(updates.phone || "").trim().slice(0, 16),
        address: String(updates.address || "").trim().slice(0, 180),
        updatedAt: Date.now(),
        lastActiveAt: Date.now()
    };
    if (clean.name.length < 2) {
        throw new Error("Please enter a valid full name (at least 2 characters).");
    }
    if (clean.phone && !/^[0-9+()\- ]{7,16}$/.test(clean.phone)) {
        throw new Error("Please enter a valid phone number.");
    }

    await update(ref(db, `users/${uid}/profile`), clean);
    if (auth.currentUser && clean.name) {
        await updateProfile(auth.currentUser, { displayName: clean.name }).catch(() => {});
    }
    currentProfile = { ...(currentProfile || {}), ...clean };
    await logCustomerActivity(uid, "profile_updated", {
        hasPhone: Boolean(clean.phone),
        hasAddress: Boolean(clean.address)
    });
    notifySubscribers();
    return currentProfile;
}

async function finalizeAuthenticatedCustomer(user, { method = "password", authProvider = "password", activityType = "login", extraProfile = {} } = {}) {
    let profile = {
        uid: user.uid,
        name: extraProfile.name || user.displayName || (user.email ? user.email.split("@")[0] : "Customer"),
        email: user.email || "",
        phone: extraProfile.phone || "",
        address: extraProfile.address || "",
        authProvider,
        emailVerified: Boolean(user.emailVerified)
    };

    try {
        profile = await ensureCustomerProfile(user, {
            recordLogin: activityType === "login",
            authProvider,
            ...extraProfile
        });
    } catch (profileErr) {
        console.warn("Customer profile sync warning:", profileErr?.message || profileErr);
    }

    currentUser = user;
    currentProfile = profile;
    markCustomerLoginStart();
    notifySubscribers();

    // Non-blocking telemetry: Worker/CORS/network errors must never fail valid Firebase sign-in.
    recordLoginEvent({
        action: "login",
        result: "success",
        method,
        portal: "customer"
    }).catch(() => {});

    logCustomerActivity(user.uid, activityType, { method: authProvider }).catch(() => {});

    return profile;
}

export async function loginCustomer(email, password) {
    const cleanEmail = String(email || "").trim();
    if (!cleanEmail || !password) {
        throw new Error("Email and password are required.");
    }
    if (!isValidEmailFormat(cleanEmail)) {
        throw new Error("Please enter a valid email address.");
    }

    await setPersistence(auth, browserLocalPersistence).catch(() => {});
    const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
    const profile = await finalizeAuthenticatedCustomer(cred.user, {
        method: "password",
        authProvider: "password",
        activityType: "login"
    });
    return { user: cred.user, profile };
}

export async function registerCustomer({
    name,
    phone = "",
    email,
    password,
    confirmPassword,
    address = ""
}) {
    const cleanName = String(name || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanEmail = String(email || "").trim();

    if (cleanName.length < 2) throw new Error("Please enter your full name (at least 2 characters).");
    if (cleanPhone && !/^[0-9+()\- ]{7,16}$/.test(cleanPhone)) {
        throw new Error("Please enter a valid phone number.");
    }
    if (!isValidEmailFormat(cleanEmail)) throw new Error("Please enter a valid email address.");
    if (!password || password.length < 6) {
        throw new Error("Password must be at least 6 characters.");
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
        throw new Error("Passwords do not match. Please re-enter the same password.");
    }

    await setPersistence(auth, browserLocalPersistence).catch(() => {});
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});

    let verificationEmailSent = false;
    try {
        await sendEmailVerification(cred.user);
        verificationEmailSent = true;
    } catch (verifyErr) {
        console.warn("Verification email dispatch skipped:", verifyErr?.message || verifyErr);
    }

    const profile = await finalizeAuthenticatedCustomer(cred.user, {
        method: "password_signup",
        authProvider: "password",
        activityType: "account_registered",
        extraProfile: {
            name: cleanName,
            phone: cleanPhone,
            address: String(address || "").trim(),
            initialLoginCount: 1
        }
    });
    return { user: cred.user, profile, verificationEmailSent };
}

export async function loginWithGoogle() {
    await setPersistence(auth, browserLocalPersistence).catch(() => {});
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    try {
        const cred = await signInWithPopup(auth, provider);
        const profile = await finalizeAuthenticatedCustomer(cred.user, {
            method: "google",
            authProvider: "google",
            activityType: "login"
        });
        return { user: cred.user, profile, redirecting: false };
    } catch (error) {
        if (
            error?.code === "auth/popup-blocked" ||
            error?.code === "auth/operation-not-supported-in-this-environment"
        ) {
            await signInWithRedirect(auth, provider);
            return { user: null, profile: null, redirecting: true };
        }
        throw error;
    }
}

export async function completeGoogleRedirectSignIn() {
    try {
        const result = await getRedirectResult(auth);
        if (!result?.user) return null;
        const profile = await finalizeAuthenticatedCustomer(result.user, {
            method: "google",
            authProvider: "google",
            activityType: "login"
        });
        return { user: result.user, profile };
    } catch (error) {
        throw error;
    }
}

export async function linkCustomerGoogleAccount() {
    const user = auth.currentUser;
    if (!user) {
        throw new Error("Please sign in first.");
    }
    const alreadyLinked = Array.isArray(user.providerData) && user.providerData.some((p) => p?.providerId === "google.com");
    if (alreadyLinked) {
        throw new Error("Google sign-in is already linked to this account.");
    }
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const result = await linkWithPopup(user, provider);
    currentUser = result.user || auth.currentUser;
    if (currentUser?.uid) {
        await update(ref(db, `users/${currentUser.uid}/profile`), {
            emailVerified: Boolean(currentUser.emailVerified),
            updatedAt: Date.now()
        }).catch(() => {});
        if (currentProfile) {
            currentProfile = {
                ...currentProfile,
                emailVerified: Boolean(currentUser.emailVerified)
            };
        }
        logCustomerActivity(currentUser.uid, "google_account_linked", { method: "google.com" }).catch(() => {});
    }
    notifySubscribers();
    return currentUser;
}

export async function resendCustomerVerificationEmail() {
    const user = auth.currentUser;
    if (!user) throw new Error("Please sign in first.");
    if (user.emailVerified) {
        throw new Error("Your email address is already verified.");
    }
    await sendEmailVerification(user);
    return true;
}

export async function reloadCustomerUser() {
    const user = auth.currentUser;
    if (!user) return null;
    await user.reload();
    currentUser = auth.currentUser;
    if (currentUser?.emailVerified) {
        await update(ref(db, `users/${currentUser.uid}/profile`), {
            emailVerified: true,
            email: String(currentUser.email || "").slice(0, 120),
            updatedAt: Date.now()
        }).catch(() => {});
        if (currentProfile) {
            currentProfile = {
                ...currentProfile,
                emailVerified: true,
                email: currentUser.email || currentProfile.email
            };
        }
    }
    notifySubscribers();
    return currentUser;
}

export async function changeCustomerPassword(currentPassword, newPassword, confirmNewPassword) {
    const user = auth.currentUser;
    if (!user || !user.email) {
        throw new Error("Please sign in to change your password.");
    }
    if (!currentPassword) {
        throw new Error("Please enter your current password.");
    }
    if (!newPassword || newPassword.length < 6) {
        throw new Error("New password must be at least 6 characters.");
    }
    if (confirmNewPassword !== undefined && newPassword !== confirmNewPassword) {
        throw new Error("New passwords do not match.");
    }
    if (currentPassword === newPassword) {
        throw new Error("New password must be different from your current password.");
    }
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
    logCustomerActivity(user.uid, "password_changed", { method: "password" }).catch(() => {});
    return true;
}

export async function changeCustomerEmail(newEmail, currentPassword) {
    const user = auth.currentUser;
    const cleanEmail = String(newEmail || "").trim();
    if (!user || !user.email) {
        throw new Error("Please sign in to change your email address.");
    }
    if (!isValidEmailFormat(cleanEmail)) {
        throw new Error("Please enter a valid new email address.");
    }
    if (cleanEmail.toLowerCase() === user.email.toLowerCase()) {
        throw new Error("The new email address matches your current email.");
    }
    if (!currentPassword) {
        throw new Error("Please enter your current password to confirm this change.");
    }
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await verifyBeforeUpdateEmail(user, cleanEmail);
    logCustomerActivity(user.uid, "email_change_requested", { requestedEmailDomain: cleanEmail.split("@")[1] || "" }).catch(() => {});
    return true;
}

export async function resetCustomerPassword(email) {
    const cleanEmail = String(email || "").trim();
    if (!cleanEmail) {
        throw new Error("Enter your email address first to receive a password reset link.");
    }
    if (!isValidEmailFormat(cleanEmail)) {
        throw new Error("Please enter a valid email address.");
    }
    await sendPasswordResetEmail(auth, cleanEmail);
}

export async function logoutCustomer() {
    if (currentUser?.uid) {
        const now = Date.now();
        const durationSec = consumeCustomerSessionDurationSec();
        await update(ref(db, `users/${currentUser.uid}/profile`), {
            lastLogoutAt: now,
            ...(durationSec !== null ? { lastSessionDurationSec: durationSec } : {})
        }).catch(() => {});
        await recordLoginEvent({
            uid: currentUser.uid,
            name: currentProfile?.name || currentUser.displayName || "",
            email: currentUser.email || "",
            role: "customer",
            method: currentProfile?.authProvider || "password",
            action: "logout",
            result: "success",
            sessionDurationSec: durationSec
        }).catch(() => {});
        await logCustomerActivity(currentUser.uid, "logout", {
            ...(durationSec !== null ? { sessionDurationSec: durationSec } : {})
        }).catch(() => {});
    }
    await signOut(auth);
    currentUser = null;
    currentProfile = null;
    notifySubscribers();
}

export function getCustomerState() {
    return {
        resolved: authResolved,
        user: currentUser,
        profile: currentProfile
    };
}

export function onCustomerAuthChange(callback) {
    authSubscribers.add(callback);
    if (authResolved) {
        callback({ user: currentUser, profile: currentProfile });
    }
    return () => authSubscribers.delete(callback);
}

function notifySubscribers() {
    renderDynamicNavigation();
    authSubscribers.forEach((cb) => {
        try {
            cb({ user: currentUser, profile: currentProfile });
        } catch (err) {
            console.error("Customer auth listener error:", err);
        }
    });
}

function currentPageSlug() {
    const path = window.location.pathname || "/";
    if (path.startsWith("/explore") || path.startsWith("/category/")) return "explore.html";
    if (path.startsWith("/blog")) return "blog.html";
    if (path.startsWith("/user/")) return "profile.html";
    if (path.startsWith("/creator/studio")) return "creator-studio.html";
    const file = path.split("/").pop() || "index.html";
    return file === "" ? "index.html" : file;
}

export function renderDynamicNavigation() {
    if (typeof document === "undefined") return;
    const nav = document.getElementById("primary-nav");
    if (!nav) return;

    const navList = nav.querySelector(".nav-list");
    const navActions = nav.querySelector(".nav-actions");
    if (!navList) return;

    const current = currentPageSlug();
    const isAccountPage = current === "account.html";
    const hash = window.location.hash;

    if (!currentUser) {
        navList.innerHTML = `
            <li><a href="/index.html" class="nav-link ${current === "index.html" ? "active" : ""}">Home</a></li>
            <li><a href="/menu.html" class="nav-link ${current === "menu.html" ? "active" : ""}">Menu</a></li>
            <li><a href="/explore.html" class="nav-link ${current === "explore.html" ? "active" : ""}">Explore</a></li>
            <li><a href="/blog.html" class="nav-link ${current === "blog.html" ? "active" : ""}">Blog</a></li>
            <li><a href="/about.html" class="nav-link ${current === "about.html" ? "active" : ""}">About</a></li>
            <li><a href="/contact.html" class="nav-link ${current === "contact.html" ? "active" : ""}">Contact</a></li>
            <li><a href="/account.html?mode=login" class="nav-link ${isAccountPage ? "active" : ""}" data-auth-nav="login">Login</a></li>
        `;

        if (navActions) {
            navActions.innerHTML = `
                <button type="button" class="btn btn-primary header-cta nav-cart-trigger" id="nav-open-cart-btn">
                    Cart <span class="nav-cart-badge" id="nav-cart-badge">0</span>
                </button>
            `;
        }
    } else {
        const displayFirst = escapeHTML((currentProfile?.name || currentUser.displayName || "Account").split(" ")[0]);
        navList.innerHTML = `
            <li><a href="/index.html" class="nav-link ${current === "index.html" ? "active" : ""}">Home</a></li>
            <li><a href="/menu.html" class="nav-link ${current === "menu.html" ? "active" : ""}">Menu</a></li>
            <li><a href="/explore.html" class="nav-link ${current === "explore.html" ? "active" : ""}">Explore</a></li>
            <li><a href="/blog.html" class="nav-link ${current === "blog.html" ? "active" : ""}">Blog</a></li>
            <li><a href="/creator-studio.html" class="nav-link ${current === "creator-studio.html" ? "active" : ""}">Studio</a></li>
            <li><a href="/account.html" class="nav-link ${isAccountPage && hash !== "#tracking" ? "active" : ""}" title="${escapeHTML(currentUser.email || displayFirst)}">Account</a></li>
            <li><button type="button" class="nav-link nav-logout-btn" id="nav-logout-btn">Logout</button></li>
        `;

        if (navActions) {
            navActions.innerHTML = `
                <button type="button" class="btn btn-outline header-cta nav-cart-trigger" id="nav-open-cart-btn" style="margin-right:0.4rem;">
                    Cart <span class="nav-cart-badge" id="nav-cart-badge">0</span>
                </button>
                <a href="/account.html" class="btn btn-primary header-cta">
                    ${displayFirst}
                </a>
            `;
        }
    }

    nav.querySelectorAll(".nav-cart-trigger").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.preventDefault();
            if (window.SKGCart && typeof window.SKGCart.open === "function") {
                window.SKGCart.open();
            }
            closeMobileDrawer();
        });
    });

    nav.querySelector("#nav-logout-btn")?.addEventListener("click", async () => {
        try {
            await logoutCustomer();
            closeMobileDrawer();
            if (currentPageSlug() === "account.html") {
                window.location.replace("/account.html?mode=login");
            }
        } catch (err) {
            console.error("Logout failed:", err);
        }
    });

    nav.querySelectorAll("a.nav-link").forEach((link) => {
        link.addEventListener("click", () => closeMobileDrawer());
    });

    if (window.SKGCart && typeof window.SKGCart.syncNavCount === "function") {
        window.SKGCart.syncNavCount();
    }
}

function closeMobileDrawer() {
    const nav = document.getElementById("primary-nav");
    const toggleBtn = document.querySelector(".mobile-nav-toggle");
    if (nav) nav.classList.remove("is-open");
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "false");
}

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        try {
            currentProfile = await ensureCustomerProfile(user);
        } catch (err) {
            console.warn("Could not load customer profile:", err);
            currentProfile = {
                uid: user.uid,
                name: user.displayName || (user.email ? user.email.split("@")[0] : "Customer"),
                email: user.email || ""
            };
        }
        maybeShowCustomerNotificationInvite(user);
        attachForegroundNotificationToast();
        refreshCustomerFcmTokenIfGranted(user, currentProfile?.notificationPreferences || null);
    } else {
        currentProfile = null;
    }
    authResolved = true;
    notifySubscribers();
});

onIdTokenChanged(auth, async (user) => {
    if (!user && currentUser) {
        currentUser = null;
        currentProfile = null;
        notifySubscribers();
        return;
    }
    if (user) {
        try {
            await user.getIdToken();
        } catch (tokenErr) {
            if (tokenErr?.code === "auth/user-token-expired" || tokenErr?.code === "auth/user-disabled") {
                await signOut(auth).catch(() => {});
                currentUser = null;
                currentProfile = null;
                notifySubscribers();
            }
        }
    }
});

if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
        renderDynamicNavigation();
    });
}

export function mapAuthErrorMessage(error) {
    const code = error?.code || "";
    switch (code) {
        case "auth/invalid-credential":
        case "auth/wrong-password":
        case "auth/user-not-found":
            return "Invalid email or password. Please check your credentials and try again.";
        case "auth/email-already-in-use":
            return "An account with this email already exists. Please log in instead.";
        case "auth/account-exists-with-different-credential":
            return "An account already exists with this email using a different sign-in method (such as Email/Password). Log in with your original method first.";
        case "auth/credential-already-in-use":
            return "This Google account is already linked to a different user profile.";
        case "auth/provider-already-linked":
            return "Google sign-in is already linked to your account.";
        case "auth/weak-password":
            return "Password should be at least 6 characters long.";
        case "auth/invalid-email":
        case "auth/missing-email":
            return "Please enter a valid email address.";
        case "auth/user-disabled":
            return "This account has been disabled. Please contact Siranchowk Khaja Ghar support.";
        case "auth/requires-recent-login":
            return "For your security, please verify your current password or sign in again before making this change.";
        case "auth/popup-closed-by-user":
            return "Sign-in window was closed before completing.";
        case "auth/cancelled-popup-request":
            return "A sign-in popup is already open. Please finish or close it and try again.";
        case "auth/popup-blocked":
            return "Popup was blocked by your browser. Redirecting to Google Sign-In instead.";
        case "auth/unauthorized-domain":
            return "This domain is not yet authorized in Firebase Authentication settings.";
        case "auth/operation-not-allowed":
            return "This sign-in method is not enabled yet in Firebase Authentication.";
        case "auth/expired-action-code":
            return "This verification or reset link has expired. Please request a new one.";
        case "auth/invalid-action-code":
            return "This verification or reset link is invalid or has already been used.";
        case "auth/user-token-expired":
            return "Your session has expired. Please sign in again.";
        case "auth/too-many-requests":
            return "Too many attempts. Please wait a few minutes and try again.";
        case "auth/network-request-failed":
            return "Network error. Please check your internet connection.";
        default:
            return error?.message || "Authentication failed. Please try again.";
    }
}
