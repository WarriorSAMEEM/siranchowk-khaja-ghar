/**
 * Shared configuration for Siranchowk Khaja Ghar Admin Panel.
 * Contains public business details only (no secrets).
 */
export const ADMIN_CONFIG = Object.freeze({
    business: {
        name: "Siranchowk Khaja Ghar",
        nepaliName: "सिरानचोक खाजा घर",
        location: "Khairahani-6, Parsa, Chitwan, Nepal",
        landmark: "Behind Chaudhary Medical",
        roadDirection: "Road toward Mal Potke",
        phone: "9821233154",
        whatsapp: "9779821233154",
        hours: "6:30 AM – 9:00 PM Daily",
        openingDate: "28 September 2026 / Ashoj 12, 2083",
        currency: "NPR",
        currencySymbol: "Rs.",
        timezone: "Asia/Kathmandu"
    }
});

if (typeof window !== "undefined") {
    window.ADMIN_CONFIG = ADMIN_CONFIG;
}
