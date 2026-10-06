/**
 * Data Service Abstraction Layer
 * Handles CRUD operations via localStorage fallback seed and maps cleanly to Firestore operations later.
 */

const DataService = (() => {
    // Default initial seed data if local storage is empty
    const DEFAULT_SEED = {
        menu: [
            { id: "m1", name: "Special Newari Khaja Set", category: "Khaja Sets", price: 350, description: "Beaten rice, choila, potato salad, boiled egg, & bhatmas.", available: true, featured: true },
            { id: "m2", name: "Chicken Choila", category: "Barbeque / Choila", price: 250, description: "Spicy grilled chicken marinated in traditional spices.", available: true, featured: true },
            { id: "m3", name: "Buff Steam Momo", category: "Momo & Chowmein", price: 150, description: "Freshly steamed buff dumplings served with spicy tomato chutney.", available: true, featured: false }
        ],
        orders: [],
        offers: [
            { id: "of1", title: "10% Off Morning Khaja", description: "Get 10% off on all Khaja sets ordered between 8 AM - 11 AM.", code: "MORNING10", active: true }
        ],
        gallery: [],
        reviews: [],
        customers: [],
        announcements: [
            { id: "an1", title: "Welcome to Siranchowk Khaja Ghar", message: "We are open daily at Khairahani-6, Parsa, Chitwan!", priority: "Normal", active: true }
        ],
        content: {
            heroTitle: "Authentic Siranchowk Khaja Ghar Experience",
            heroSub: "Serving fresh, traditional Nepalese Khaja & Delicacies in Khairahani-6, Parsa, Chitwan.",
            aboutText: "Located behind Chaudhary Medical on the road toward Mal Potke, Siranchowk Khaja Ghar brings authentic local flavors and warm Nepalese hospitality to Parsa, Chitwan."
        },
        seo: {
            metaTitle: "Siranchowk Khaja Ghar — Restaurant in Khairahani, Parsa, Chitwan",
            metaDesc: "Authentic Khaja & Nepalese restaurant at Khairahani-6, Parsa, Chitwan behind Chaudhary Medical. Call 9821233154.",
            keywords: "Siranchowk Khaja Ghar, Khairahani food, Chitwan restaurant, Parsa khaja set"
        },
        settings: {
            phone: ADMIN_CONFIG.business.phone,
            whatsapp: ADMIN_CONFIG.business.whatsapp,
            location: ADMIN_CONFIG.business.location,
            landmark: ADMIN_CONFIG.business.landmark,
            isOpen: true
        },
        auditLogs: [
            { id: "lg1", event: "System Initialized", timestamp: new Date().toISOString(), user: "Admin" }
        ]
    };

    function getItem(key, defaultVal) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : defaultVal;
        } catch (e) {
            console.error(`Error reading ${key}`, e);
            return defaultVal;
        }
    }

    function setItem(key, val) {
        try {
            localStorage.setItem(key, JSON.stringify(val));
        } catch (e) {
            console.error(`Error saving ${key}`, e);
        }
    }

    return {
        // Menu Operations
        async getMenuItems() { return getItem(ADMIN_CONFIG.storageKeys.menu, DEFAULT_SEED.menu); },
        async saveMenuItem(item) {
            const items = await this.getMenuItems();
            if (item.id) {
                const idx = items.findIndex(i => i.id === item.id);
                if (idx !== -1) items[idx] = item;
            } else {
                item.id = Utils.generateId('item');
                items.push(item);
            }
            setItem(ADMIN_CONFIG.storageKeys.menu, items);
            return item;
        },
        async deleteMenuItem(id) {
            let items = await this.getMenuItems();
            items = items.filter(i => i.id !== id);
            setItem(ADMIN_CONFIG.storageKeys.menu, items);
        },

        // Orders Operations
        async getOrders() { return getItem(ADMIN_CONFIG.storageKeys.orders, DEFAULT_SEED.orders); },
        async updateOrderStatus(id, status) {
            const orders = await this.getOrders();
            const order = orders.find(o => o.id === id);
            if (order) {
                order.status = status;
                setItem(ADMIN_CONFIG.storageKeys.orders, orders);
            }
        },

        // Offers Operations
        async getOffers() { return getItem(ADMIN_CONFIG.storageKeys.offers, DEFAULT_SEED.offers); },
        async saveOffer(offer) {
            const offers = await this.getOffers();
            if (offer.id) {
                const idx = offers.findIndex(o => o.id === offer.id);
                if (idx !== -1) offers[idx] = offer;
            } else {
                offer.id = Utils.generateId('offer');
                offers.push(offer);
            }
            setItem(ADMIN_CONFIG.storageKeys.offers, offers);
        },
        async deleteOffer(id) {
            let offers = await this.getOffers();
            offers = offers.filter(o => o.id !== id);
            setItem(ADMIN_CONFIG.storageKeys.offers, offers);
        },

        // Gallery Operations
        async getGallery() { return getItem(ADMIN_CONFIG.storageKeys.gallery, DEFAULT_SEED.gallery); },
        async saveGalleryImage(img) {
            const gallery = await this.getGallery();
            img.id = Utils.generateId('img');
            gallery.push(img);
            setItem(ADMIN_CONFIG.storageKeys.gallery, gallery);
        },
        async deleteGalleryImage(id) {
            let gallery = await this.getGallery();
            gallery = gallery.filter(g => g.id !== id);
            setItem(ADMIN_CONFIG.storageKeys.gallery, gallery);
        },

        // Reviews Operations
        async getReviews() { return getItem(ADMIN_CONFIG.storageKeys.reviews, DEFAULT_SEED.reviews); },
        async updateReviewStatus(id, status) {
            const reviews = await this.getReviews();
            const rev = reviews.find(r => r.id === id);
            if (rev) {
                rev.status = status;
                setItem(ADMIN_CONFIG.storageKeys.reviews, reviews);
            }
        },

        // Customers Operations
        async getCustomers() { return getItem(ADMIN_CONFIG.storageKeys.customers, DEFAULT_SEED.customers); },

        // Announcements Operations
        async getAnnouncements() { return getItem(ADMIN_CONFIG.storageKeys.announcements, DEFAULT_SEED.announcements); },
        async saveAnnouncement(ann) {
            const list = await this.getAnnouncements();
            if (ann.id) {
                const idx = list.findIndex(a => a.id === ann.id);
                if (idx !== -1) list[idx] = ann;
            } else {
                ann.id = Utils.generateId('ann');
                list.push(ann);
            }
            setItem(ADMIN_CONFIG.storageKeys.announcements, list);
        },
        async deleteAnnouncement(id) {
            let list = await this.getAnnouncements();
            list = list.filter(a => a.id !== id);
            setItem(ADMIN_CONFIG.storageKeys.announcements, list);
        },

        // Content Operations
        async getContent() { return getItem(ADMIN_CONFIG.storageKeys.content, DEFAULT_SEED.content); },
        async saveContent(content) { setItem(ADMIN_CONFIG.storageKeys.content, content); },

        // SEO Operations
        async getSEO() { return getItem(ADMIN_CONFIG.storageKeys.seo, DEFAULT_SEED.seo); },
        async saveSEO(seo) { setItem(ADMIN_CONFIG.storageKeys.seo, seo); },

        // Settings & Audit Logs
        async getSettings() { return getItem(ADMIN_CONFIG.storageKeys.settings, DEFAULT_SEED.settings); },
        async saveSettings(settings) { setItem(ADMIN_CONFIG.storageKeys.settings, settings); },
        async getAuditLogs() { return getItem(ADMIN_CONFIG.storageKeys.audit, DEFAULT_SEED.auditLogs); },
        async logEvent(event) {
            const logs = await this.getAuditLogs();
            logs.unshift({ id: Utils.generateId('log'), event, timestamp: new Date().toISOString(), user: "Admin" });
            setItem(ADMIN_CONFIG.storageKeys.audit, logs);
        }
    };
})();