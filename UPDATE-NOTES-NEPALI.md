# Siranchowk Khaja Ghar — Final Local Review Update Notes

## लागू गरिएका सुधारहरू

1. सबै public pages, Admin dashboard र Admin Login मा एउटै premium warm-neutral design system लागू गरिएको छ। मुख्य palette terracotta, warm cream, slate ink र muted gold हो। Admin dashboard light theme मै राखिएको छ।
2. Text/background contrast, focus states, cards, navigation, forms, buttons र responsive layouts का overrides थपिएका छन्।
3. Cart का hard-coded teal/green brand colors लाई नयाँ design system सँग मिलाइएको छ; WhatsApp र success/error status colors भने तिनको अर्थ स्पष्ट राख्न अलग छन्।
4. Customer ले Add to cart गर्नुअघि sign in गर्नुपर्छ। Login redirect गर्दा pending item सुरक्षित राखिन्छ र login पछि cart मा restore हुन्छ। Checkout र WhatsApp order action पनि sign-in gated छन्।
5. Browser बाट canonical `/orders`, `/orderTracking`, customer order mirror र coupon-use records मा direct write हटाइएको छ। अब Worker को authenticated `create_order` endpoint ले current menu/stock/coupon price verify गरेर यी records atomic multi-location update मार्फत लेख्छ। Worker unavailable भए checkout fail-closed हुन्छ।
6. Customer ले order total मा mismatch देखेमा नयाँ server total confirm नगरेसम्म order create हुँदैन।
7. Firebase RTDB rules मा customer direct order/tracking/mirror/coupon writes बन्द गरिएको छ; staff/owner permission flow कायम राखिएको छ।
8. Firestore rules मा hard-coded admin email हटाएर primary owner UID authority बनाइएको छ। Admin records सिर्जना/अपडेट/हटाउने अधिकार primary owner मा सीमित गरिएको छ।
9. Maps grounding request static Cloudflare Pages बाट पनि चलोस् भनेर Worker endpoint थपिएको छ। यसको लागि `GEMINI_API_KEY` Worker secret optional रूपमा राख्नुपर्छ।
10. `public/_headers` मा same-origin geolocation अनुमति, frame blocking र safer opener policy थपिएको छ।
11. Vite preview र Node development server default रूपमा localhost मा bind हुन्छन्।
12. Cart/order, Worker, Maps grounding, menu prices र rules behavior जाँच्ने verification checks/tests थपिएका छन्।

## जस्ताको तस्तै राखिएका business details

- Chicken Momo Rs.130; Buff Momo Rs.140; Veg Chowmein Rs.100; Chicken Chowmein Rs.150.
- Roti को online price unset नै राखिएको छ।
- Paratha Rs.30; Milk Tea Rs.25; Black Tea Rs.19; Biryani Rs.350; Chana Rs.30; Keema Rs.120; Sukuti Rs.120; Boiled Egg Rs.30; Fried Chicken Rs.200.
- Restaurant location, phone, halal positioning र opening hours परिवर्तन गरिएको छैन।

## स्थानीय जाँचको नतिजा

- `npm run check`: PASS — 20 project checks; 68 JavaScript files syntax-checked.
- `node --test scripts/worker-hardening.test.js`: PASS — 21/21 tests.
- `node --check cloudflare-worker/worker.js`, `js/order-system.js`, `js/maps-locator.js`: PASS.
- `database.rules.json`: JSON parse PASS.
- `npm ci`: यस execution environment मा timeout भयो; dependencies पूर्ण रूपमा install भएनन्।
- त्यसैले पूर्ण `npm test`, `npm run build`, Rules simulator र browser end-to-end tests यहाँ सफलतापूर्वक चलाइएको भनेर दाबी गरिएको छैन।

## Publish अघि आवश्यक बाहिरी काम

1. यदि पुरानो ZIP/repository मा Firebase service-account private key कहिल्यै थियो भने पुरानो key revoke गरेर नयाँ key बनाउनुहोस्। पुरानो key पुनः प्रयोग नगर्नुहोस्।
2. Cloudflare Worker मा `FIREBASE_SERVICE_ACCOUNT_JSON` secret सेट गरी नयाँ Worker deploy गर्नुहोस्।
3. Maps grounding चाहिने हो भने `GEMINI_API_KEY` Worker secret पनि सेट गर्नुहोस्।
4. Firebase Console मा `database.rules.json` publish गर्नुहोस्; Firestore features ашигിക്കുന്നുവെങ്കിൽ `firestore.rules` पनि emulator-ээр шалгаेर deploy गर्नुहोस्।
5. Cloudflare Pages मा `VITE_PUSH_WORKER_URL`, Firebase web config र `VITE_GOOGLE_MAPS_API_KEY` आवश्यकतानुसार सेट गर्नुहोस्। Browser Firebase API key र Maps key सार्वजनिक bundle मा जान सक्छन्; HTTP referrer restrictions अनिवार्य छन्।
6. `npm ci`, `npm run check`, `npm test`, `npm run build` आफ्नै Windows/Node 22.12+ environment मा पूरा चलाएर मात्रै publish गर्नुहोस्।
7. Live test: sign-in → Add to cart → server-priced checkout → customer history → tracking → staff status update → admin push → Maps grounding.

## महत्त्वपूर्ण सीमा

Cloudflare Pages मा `dist/` static site deploy हुन्छ; `server.ts` र `server-platform.ts` का Express/SSR routes त्यहाँ स्वतः deploy हुँदैनन्। Frontend Firebase र Cloudflare Worker बाट चल्ने paths अलग राखिएका छन्, तर article/profile-specific server-rendered SEO metadata अझै Pages static build मा पूर्ण रूपमा उपलब्ध छैन। त्यसलाई production SEO को लागि छुट्टै Pages Functions/Worker SSR implementation चाहिन्छ।
