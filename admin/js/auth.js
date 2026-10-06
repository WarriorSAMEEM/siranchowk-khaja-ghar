/**
 * Authentication Architecture Ready Module
 * Prepares session states and role checks for Firebase Auth integration.
 */

const AuthModule = (() => {
    let currentUser = {
        uid: "admin_local_01",
        displayName: "Admin Manager",
        role: "Owner / Administrator",
        email: "admin@siranchowk.com"
    };

    return {
        getCurrentUser() {
            return currentUser;
        },
        isAuthenticated() {
            return !!currentUser;
        },
        logout() {
            UIModule.showToast("Signed out successfully", "info");
            setTimeout(() => {
                window.location.reload();
            }, 800);
        }
    };
})();