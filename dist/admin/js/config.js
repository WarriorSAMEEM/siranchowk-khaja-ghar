/**
 * Global Configuration for Siranchowk Khaja Ghar Admin Panel
 * Holds non-sensitive operational metadata and backend targets.
 */

const ADMIN_CONFIG = {
    business: {
        name: "Siranchowk Khaja Ghar",
        location: "Khairahani-6, Parsa, Chitwan, Nepal",
        landmark: "Behind Chaudhary Medical",
        roadDirection: "Road toward Mal Potke",
        phone: "9821233154",
        whatsapp: "9821233154",
        currency: "NPR",
        currencySymbol: "Rs.",
        isOpen: true,
        timezone: "Asia/Kathmandu"
    },
    storageKeys: {
        menu: "skg_menu_items",
        orders: "skg_orders",
        offers: "skg_offers",
        gallery: "skg_gallery",
        reviews: "skg_reviews",
        customers: "skg_customers",
        announcements: "skg_announcements",
        content: "skg_website_content",
        seo: "skg_seo_settings",
        settings: "skg_business_settings",
        audit: "skg_audit_logs",
        session: "skg_admin_session"
    },
    firebaseConfig: {
        apiKey: "", // Populated when connecting Firebase
        authDomain: "",
        projectId: "",
        storageBucket: "",
        messagingSenderId: "",
        appId: ""
    }
};

Object.freeze(ADMIN_CONFIG);