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
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    sendPasswordResetEmail,
    GoogleAuthProvider,
    signInWithPopup,
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
            lastActiveAt: now
        };
        if (extra.name && !existing.name) patch.name = String(extra.name).slice(0, 80);
        if (extra.phone && !existing.phone) patch.phone = String(extra.phone).slice(0, 16);
        if (user.email && !existing.email) patch.email = String(user.email).slice(0, 120);
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

export async function loginCustomer(email, password) {
    if (!email || !password) {
        throw new Error("Email and password are required.");
    }
    const cleanEmail = email.trim();
    try {
        await setPersistence(auth, browserLocalPersistence);
        const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
        const profile = await ensureCustomerProfile(cred.user, {
            recordLogin: true,
            authProvider: "password"
        });
        currentUser = cred.user;
        currentProfile = profile;
        markCustomerLoginStart();
        await recordLoginEvent({
            uid: cred.user.uid,
            name: profile?.name || cred.user.displayName || "",
            email: cred.user.email || cleanEmail,
            role: "customer",
            method: "password",
            result: "success"
        });
        await logCustomerActivity(cred.user.uid, "login", { method: "password" });
        notifySubscribers();
        return { user: cred.user, profile };
    } catch (error) {
        await recordLoginEvent({
            uid: "unauthenticated",
            email: cleanEmail,
            role: "customer",
            method: "password",
            result: "failed",
            reason: error?.code || error?.message || "login_failed"
        });
        throw error;
    }
}

export async function registerCustomer({ name, phone, email, password, address = "" }) {
    const cleanName = String(name || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanEmail = String(email || "").trim();

    if (cleanName.length < 2) throw new Error("Please enter your full name.");
    if (cleanPhone && !/^[0-9+()\- ]{7,16}$/.test(cleanPhone)) {
        throw new Error("Please enter a valid phone number.");
    }
    if (!cleanEmail) throw new Error("Please enter a valid email address.");
    if (!password || password.length < 6) {
        throw new Error("Password must be at least 6 characters.");
    }

    await setPersistence(auth, browserLocalPersistence);
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
    const profile = await ensureCustomerProfile(cred.user, {
        name: cleanName,
        phone: cleanPhone,
        address: String(address || "").trim(),
        authProvider: "password",
        initialLoginCount: 1
    });
    currentUser = cred.user;
    currentProfile = profile;
    markCustomerLoginStart();
    await recordLoginEvent({
        uid: cred.user.uid,
        name: cleanName,
        email: cred.user.email || cleanEmail,
        role: "customer",
        method: "password_signup",
        result: "success"
    });
    await logCustomerActivity(cred.user.uid, "account_registered", { method: "password" });
    notifySubscribers();
    return { user: cred.user, profile };
}

export async function loginWithGoogle() {
    try {
        await setPersistence(auth, browserLocalPersistence);
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        const cred = await signInWithPopup(auth, provider);
        const profile = await ensureCustomerProfile(cred.user, {
            recordLogin: true,
            authProvider: "google"
        });
        currentUser = cred.user;
        currentProfile = profile;
        markCustomerLoginStart();
        await recordLoginEvent({
            uid: cred.user.uid,
            name: profile?.name || cred.user.displayName || "",
            email: cred.user.email || "",
            role: "customer",
            method: "google",
            result: "success"
        });
        await logCustomerActivity(cred.user.uid, "login", { method: "google" });
        notifySubscribers();
        return { user: cred.user, profile };
    } catch (error) {
        await recordLoginEvent({
            uid: "unauthenticated",
            email: "",
            role: "customer",
            method: "google",
            result: "failed",
            reason: error?.code || error?.message || "google_signin_failed"
        });
        throw error;
    }
}

export async function resetCustomerPassword(email) {
    if (!email || !email.trim()) {
        throw new Error("Enter your email address first to receive a password reset link.");
    }
    await sendPasswordResetEmail(auth, email.trim());
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
    const file = window.location.pathname.split("/").pop() || "index.html";
    return file === "" ? "index.html" : file;
}

export function renderDynamicNavigation() {
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
            <li><a href="index.html" class="nav-link ${current === "index.html" ? "active" : ""}">Home</a></li>
            <li><a href="menu.html" class="nav-link ${current === "menu.html" ? "active" : ""}">Menu</a></li>
            <li><a href="about.html" class="nav-link ${current === "about.html" ? "active" : ""}">About</a></li>
            <li><a href="contact.html" class="nav-link ${current === "contact.html" ? "active" : ""}">Contact</a></li>
            <li><a href="account.html?mode=login" class="nav-link ${isAccountPage && !window.location.search.includes("signup") ? "active" : ""}" data-auth-nav="login">Login</a></li>
            <li><a href="account.html?mode=signup" class="nav-link ${isAccountPage && window.location.search.includes("signup") ? "active" : ""}" data-auth-nav="signup">Sign Up</a></li>
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
            <li><a href="index.html" class="nav-link ${current === "index.html" ? "active" : ""}">Home</a></li>
            <li><a href="menu.html" class="nav-link ${current === "menu.html" ? "active" : ""}">Menu</a></li>
            <li><a href="account.html" class="nav-link ${isAccountPage && hash !== "#tracking" ? "active" : ""}" title="${escapeHTML(currentUser.email || displayFirst)}">My Account</a></li>
            <li><a href="#cart" class="nav-link nav-cart-trigger" id="nav-link-cart">Cart (<span id="nav-cart-inline-count">0</span>)</a></li>
            <li><a href="account.html#tracking" class="nav-link ${isAccountPage && hash === "#tracking" ? "active" : ""}">Order Tracking</a></li>
            <li><button type="button" class="nav-link nav-logout-btn" id="nav-logout-btn">Logout</button></li>
        `;

        if (navActions) {
            navActions.innerHTML = `
                <a href="account.html" class="btn btn-outline header-cta">
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
                window.location.replace("account.html?mode=login");
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

document.addEventListener("DOMContentLoaded", () => {
    renderDynamicNavigation();
});

export function mapAuthErrorMessage(error) {
    const code = error?.code || "";
    switch (code) {
        case "auth/invalid-credential":
        case "auth/wrong-password":
        case "auth/user-not-found":
            return "Invalid email or password. Please check your credentials and try again.";
        case "auth/email-already-in-use":
            return "An account with this email already exists. Please log in instead.";
        case "auth/weak-password":
            return "Password should be at least 6 characters long.";
        case "auth/invalid-email":
            return "Please enter a valid email address.";
        case "auth/popup-closed-by-user":
            return "Sign-in window was closed before completing.";
        case "auth/too-many-requests":
            return "Too many attempts. Please wait a few minutes and try again.";
        case "auth/network-request-failed":
            return "Network error. Please check your internet connection.";
        default:
            return error?.message || "Authentication failed. Please try again.";
    }
}
