// ============================================================================
// SIRANCHOWK KHAJA GHAR — GOOGLE MAPS JS API + MAPS GROUNDING EXPLORER
// ============================================================================

import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { onCustomerAuthChange, loginWithGoogle } from "./customer-auth.js";
import {
    listSavedPlaces,
    savePlaceToFirestore,
    removeSavedPlace
} from "./firestore-service.js";

const RESTAURANT_COORDS = { lat: 27.6087174620, lng: 84.5682702860 };

const WAYPOINTS = [
    {
        id: "restaurant",
        label: "SKG",
        title: "Siranchowk Khaja Ghar (सिरानचोक खाजा घर)",
        subtitle: "Khairahani-6, Parsa — Behind Chaudhary Medical",
        hours: "Open Daily: 6:30 AM – 9:00 PM • 100% Halal",
        position: { lat: 27.6087174620, lng: 84.5682702860 },
        color: "#B94A2C"
    },
    {
        id: "chaudhary-medical",
        label: "MED",
        title: "Chaudhary Medical Landmark",
        subtitle: "Turn into the lane directly behind Chaudhary Medical",
        hours: "Main landmark (~30m from entrance)",
        position: { lat: 27.60902, lng: 84.56848 },
        color: "#2E6F5E"
    },
    {
        id: "parsa-chowk",
        label: "HWY",
        title: "Parsa Chowk (Mahendra Highway)",
        subtitle: "East-West Highway junction in Khairahani, Chitwan",
        hours: "2 min walk south-west to Siranchowk Khaja Ghar",
        position: { lat: 27.61115, lng: 84.56792 },
        color: "#D49A3A"
    }
];

let quotaDefenseInstalled = false;
let mapsOptionsConfigured = false;
let resolvedMapsApiKey = "";
let currentAuthUser = null;

function installQuotaDefenseAndBanner() {
    if (quotaDefenseInstalled || typeof window === "undefined") return;
    quotaDefenseInstalled = true;

    const triggerQuotaEvent = (reason = "quota_exceeded") => {
        window.dispatchEvent(new CustomEvent("gmp-quota-exceeded", { detail: { reason } }));
    };

    const previousAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
        triggerQuotaEvent("gm_authFailure");
        if (typeof previousAuthFailure === "function") {
            try { previousAuthFailure(); } catch {}
        }
    };

    const originalConsoleError = console.error.bind(console);
    console.error = (...args) => {
        try {
            const joined = args.map((item) => String(item || "")).join(" ");
            if (/OverQuotaMapError|QuotaExceededError|RESOURCE_EXHAUSTED|RefererNotAllowedMapError|ApiTargetBlockedMapError/i.test(joined)) {
                triggerQuotaEvent(joined.slice(0, 120));
            }
        } catch {}
        originalConsoleError(...args);
    };

    window.addEventListener("gmp-quota-exceeded", () => {
        showQuotaBanner();
    });
}

function showQuotaBanner() {
    if (typeof document === "undefined") return;
    if (document.getElementById("skg-gmp-quota-banner")) return;

    const banner = document.createElement("div");
    banner.id = "skg-gmp-quota-banner";
    banner.className = "skg-gmp-quota-banner";
    banner.setAttribute("role", "alert");

    const text = document.createElement("p");
    text.className = "skg-gmp-quota-text";
    text.append(
        document.createTextNode("Google Maps Platform quota reached. If you are the app owner, visit "),
    );
    const link = document.createElement("a");
    link.href = "https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "maps developer site for instructions to update your account";
    text.append(link, document.createTextNode("."));

    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "skg-gmp-quota-close";
    dismissBtn.setAttribute("aria-label", "Dismiss Maps quota notice");
    dismissBtn.textContent = "×";
    dismissBtn.addEventListener("click", () => banner.remove());

    banner.append(text, dismissBtn);
    document.body.prepend(banner);
}

async function fetchMapsApiKey() {
    if (resolvedMapsApiKey) return resolvedMapsApiKey;
    const envKey = typeof import.meta !== "undefined" && import.meta.env
        ? String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").trim()
        : "";
    if (envKey) {
        resolvedMapsApiKey = envKey;
        return resolvedMapsApiKey;
    }

    try {
        const res = await fetch("/api/config/maps", { headers: { Accept: "application/json" } });
        if (res.status === 429) {
            window.dispatchEvent(new CustomEvent("gmp-quota-exceeded", { detail: { reason: "HTTP 429" } }));
            return "";
        }
        if (res.ok) {
            const data = await res.json();
            resolvedMapsApiKey = String(data?.apiKey || "").trim();
            return resolvedMapsApiKey;
        }
    } catch {}
    return "";
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function formatSimpleMarkdown(raw) {
    const escaped = escapeHTML(raw || "");
    return escaped
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>")
        .replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`)
        .replace(/\n{2,}/g, "</p><p>")
        .replace(/\n/g, "<br>");
}

async function mountInteractiveMap(mapContainer, focusControlButtons = []) {
    const key = await fetchMapsApiKey();
    if (!key) {
        mapContainer.innerHTML = `
            <div class="skg-map-fallback">
                <h4>Siranchowk Khaja Ghar — Khairahani-6, Parsa, Chitwan</h4>
                <p>Located right behind Chaudhary Medical (27.6087° N, 84.5683° E).</p>
                <a class="btn btn-primary" href="https://www.google.com/maps/dir/?api=1&destination=27.6087174620,84.5682702860" target="_blank" rel="noopener noreferrer">Open Turn-by-Turn Directions ↗</a>
            </div>
        `;
        return;
    }

    try {
        if (!mapsOptionsConfigured) {
            setOptions({
                key,
                v: "weekly",
                language: "en",
                region: "NP",
                mapIds: ["DEMO_MAP_ID"]
            });
            mapsOptionsConfigured = true;
        }

        const { Map, InfoWindow } = await importLibrary("maps");
        const { AdvancedMarkerElement, PinElement } = await importLibrary("marker");

        const map = new Map(mapContainer, {
            center: RESTAURANT_COORDS,
            zoom: 16,
            mapId: "DEMO_MAP_ID",
            gestureHandling: "cooperative",
            mapTypeControl: false,
            streetViewControl: true,
            fullscreenControl: true,
            internalUsageAttributionIds: ["gmp_mcp_codeassist_v1_aistudio"]
        });

        const infoWindow = new InfoWindow({ maxWidth: 280 });
        const markerById = new globalThis.Map();

        const openInfoForWaypoint = (wp, marker) => {
            const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${wp.position.lat},${wp.position.lng}`;
            infoWindow.setContent(`
                <div class="skg-map-infowindow">
                    <strong>${escapeHTML(wp.title)}</strong>
                    <p>${escapeHTML(wp.subtitle)}</p>
                    <small>${escapeHTML(wp.hours)}</small>
                    <div class="skg-map-iw-links">
                        <a href="${directionsUrl}" target="_blank" rel="noopener noreferrer">Directions in Google Maps ↗</a>
                    </div>
                </div>
            `);
            infoWindow.open({ anchor: marker, map });
        };

        WAYPOINTS.forEach((wp) => {
            const pin = new PinElement({
                background: wp.color,
                borderColor: "#FFFFFF",
                glyphColor: "#FFFFFF",
                glyphText: wp.label,
                scale: wp.id === "restaurant" ? 1.18 : 0.96
            });

            const marker = new AdvancedMarkerElement({
                map,
                position: wp.position,
                content: pin,
                title: wp.title
            });

            marker.addListener("click", () => {
                map.panTo(wp.position);
                openInfoForWaypoint(wp, marker);
            });

            markerById.set(wp.id, { wp, marker });
        });

        // Open main restaurant marker info window on ready
        const mainEntry = markerById.get("restaurant");
        if (mainEntry) {
            openInfoForWaypoint(mainEntry.wp, mainEntry.marker);
        }

        focusControlButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
                const targetId = btn.getAttribute("data-waypoint");
                const entry = markerById.get(targetId);
                if (!entry) return;
                focusControlButtons.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                map.panTo(entry.wp.position);
                map.setZoom(targetId === "parsa-chowk" ? 15 : 17);
                openInfoForWaypoint(entry.wp, entry.marker);
            });
        });
    } catch (error) {
        const msg = String(error?.message || error || "");
        if (/quota|429|RESOURCE_EXHAUSTED|OverQuota/i.test(msg)) {
            window.dispatchEvent(new CustomEvent("gmp-quota-exceeded", { detail: { reason: msg } }));
        }
        mapContainer.innerHTML = `
            <div class="skg-map-fallback">
                <h4>Interactive Map Unavailable</h4>
                <p>You can still open exact coordinates behind Chaudhary Medical in Google Maps.</p>
                <a class="btn btn-primary" href="https://www.google.com/maps/dir/?api=1&destination=27.6087174620,84.5682702860" target="_blank" rel="noopener noreferrer">Open Google Maps Directions ↗</a>
            </div>
        `;
    }
}

function inferCategoryFromQuery(queryText = "", title = "") {
    const combined = `${queryText} ${title}`.toLowerCase();
    if (/hospital|clinic|medical|pharmacy/.test(combined)) return "medical";
    if (/bus|transit|chowk|station|stand/.test(combined)) return "transit";
    if (/atm|bank/.test(combined)) return "atm";
    if (/hotel|cafe|restaurant|khaja|food/.test(combined)) return "restaurant";
    return "landmark";
}

function initNearbyGuidePanel() {
    const panel = document.getElementById("skg-nearby-guide");
    if (!panel) return;

    const form = panel.querySelector("#skg-nearby-form");
    const input = panel.querySelector("#skg-nearby-input");
    const geoBtn = panel.querySelector("#skg-nearby-geo-btn");
    const statusEl = panel.querySelector("#skg-nearby-status");
    const answerEl = panel.querySelector("#skg-nearby-answer");
    const placesEl = panel.querySelector("#skg-nearby-places");
    const savedSection = panel.querySelector("#skg-saved-places-list");

    let customCoords = null;

    async function refreshSavedPlacesUI() {
        if (!savedSection) return;
        if (!currentAuthUser?.uid) {
            savedSection.innerHTML = `
                <div class="skg-saved-signin-cta">
                    <span>Sign in with Google to bookmark nearby Khairahani landmarks &amp; transit stops.</span>
                    <button type="button" class="btn btn-outline skg-inline-google-btn" id="skg-places-google-signin">Sign in with Google</button>
                </div>
            `;
            savedSection.querySelector("#skg-places-google-signin")?.addEventListener("click", async () => {
                try {
                    await loginWithGoogle();
                } catch (err) {
                    if (statusEl) statusEl.textContent = err?.message || "Google sign-in failed.";
                }
            });
            return;
        }

        try {
            const saved = await listSavedPlaces(currentAuthUser.uid);
            if (!saved.length) {
                savedSection.innerHTML = `<p class="skg-saved-empty">No bookmarked landmarks yet. Ask about nearby places above and click "Save Spot".</p>`;
                return;
            }

            savedSection.replaceChildren();
            saved.forEach((item) => {
                const row = document.createElement("div");
                row.className = "skg-saved-place-row";

                const info = document.createElement("div");
                const link = document.createElement("a");
                link.href = item.mapsUri;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = item.title;
                const badge = document.createElement("span");
                badge.className = "skg-place-cat";
                badge.textContent = item.category;
                info.append(link, badge);

                const delBtn = document.createElement("button");
                delBtn.type = "button";
                delBtn.className = "skg-place-remove-btn";
                delBtn.textContent = "Remove";
                delBtn.addEventListener("click", async () => {
                    delBtn.disabled = true;
                    try {
                        await removeSavedPlace(item.placeId);
                        await refreshSavedPlacesUI();
                    } catch (err) {
                        delBtn.disabled = false;
                        if (statusEl) statusEl.textContent = "Could not remove saved place.";
                    }
                });

                row.append(info, delBtn);
                savedSection.appendChild(row);
            });
        } catch {
            savedSection.innerHTML = `<p class="skg-saved-empty">Could not load saved places right now.</p>`;
        }
    }

    onCustomerAuthChange(({ user }) => {
        currentAuthUser = user || null;
        refreshSavedPlacesUI();
    });

    async function runGroundingQuery(queryText) {
        const cleanQuery = String(queryText || "").trim();
        if (!cleanQuery) return;
        if (input) input.value = cleanQuery;

        if (statusEl) statusEl.textContent = "Searching Google Maps data around Khairahani-6, Parsa...";
        if (answerEl) answerEl.innerHTML = "";
        if (placesEl) placesEl.replaceChildren();

        try {
            const payload = {
                query: cleanQuery,
                lat: customCoords ? customCoords.lat : RESTAURANT_COORDS.lat,
                lng: customCoords ? customCoords.lng : RESTAURANT_COORDS.lng
            };

            const res = await fetch("/api/maps-grounding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.status === 429) {
                window.dispatchEvent(new CustomEvent("gmp-quota-exceeded", { detail: { reason: "Grounding 429" } }));
            }

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || `Request failed (${res.status})`);
            }

            if (statusEl) statusEl.textContent = `Grounded with Google Maps (${data.model || "gemini-4-hydrogen"})`;
            if (answerEl) {
                answerEl.innerHTML = `<div class="skg-grounding-prose"><p>${formatSimpleMarkdown(data.answer)}</p></div>`;
            }

            const places = Array.isArray(data.places) ? data.places : [];
            if (placesEl) {
                if (!places.length) {
                    placesEl.innerHTML = `<p class="skg-saved-empty">No specific place cards returned for that query. Try asking about nearby landmarks or hospitals.</p>`;
                } else {
                    places.forEach((place) => {
                        const card = document.createElement("article");
                        card.className = "skg-grounded-place-card";

                        const header = document.createElement("div");
                        header.className = "skg-grounded-place-head";

                        const link = document.createElement("a");
                        link.href = place.uri;
                        link.target = "_blank";
                        link.rel = "noopener noreferrer";
                        link.className = "skg-grounded-place-title";
                        link.textContent = `${place.title} ↗`;

                        const saveBtn = document.createElement("button");
                        saveBtn.type = "button";
                        saveBtn.className = "skg-save-place-btn";
                        saveBtn.textContent = currentAuthUser ? "Save Spot" : "Sign in to Save";
                        saveBtn.addEventListener("click", async () => {
                            try {
                                if (!currentAuthUser) {
                                    await loginWithGoogle();
                                    return;
                                }
                                if (!currentAuthUser.emailVerified) {
                                    throw new Error("Please verify your email or sign in with Google to save spots.");
                                }
                                saveBtn.disabled = true;
                                saveBtn.textContent = "Saving...";
                                await savePlaceToFirestore({
                                    title: place.title,
                                    mapsUri: place.uri,
                                    category: inferCategoryFromQuery(cleanQuery, place.title),
                                    notes: cleanQuery.slice(0, 180)
                                });
                                saveBtn.textContent = "Saved";
                                await refreshSavedPlacesUI();
                            } catch (err) {
                                saveBtn.disabled = false;
                                saveBtn.textContent = "Save Spot";
                                if (statusEl) statusEl.textContent = err?.message || "Could not save spot.";
                            }
                        });

                        header.append(link, saveBtn);
                        card.appendChild(header);

                        if (Array.isArray(place.snippets) && place.snippets.length) {
                            const quote = document.createElement("p");
                            quote.className = "skg-grounded-snippet";
                            quote.textContent = `"${place.snippets[0].slice(0, 180)}"`;
                            card.appendChild(quote);
                        }

                        placesEl.appendChild(card);
                    });
                }
            }
        } catch (error) {
            if (statusEl) statusEl.textContent = error?.message || "Unable to fetch nearby place insights right now.";
        }
    }

    form?.addEventListener("submit", (e) => {
        e.preventDefault();
        runGroundingQuery(input?.value || "");
    });

    panel.querySelectorAll("[data-nearby-prompt]").forEach((btn) => {
        btn.addEventListener("click", () => {
            runGroundingQuery(btn.getAttribute("data-nearby-prompt"));
        });
    });

    geoBtn?.addEventListener("click", () => {
        if (!navigator.geolocation) {
            if (statusEl) statusEl.textContent = "Browser geolocation is unavailable; using Khairahani-6 Parsa coordinates.";
            return;
        }
        geoBtn.disabled = true;
        geoBtn.textContent = "Locating...";
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                customCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                geoBtn.disabled = false;
                geoBtn.textContent = "Using My Location ✓";
                if (statusEl) statusEl.textContent = "Ready with your live GPS coordinates.";
            },
            () => {
                geoBtn.disabled = false;
                geoBtn.textContent = "Use My Location";
                if (statusEl) statusEl.textContent = "Location permission declined; using Siranchowk Khaja Ghar coordinates.";
            },
            { timeout: 6000 }
        );
    });
}

document.addEventListener("DOMContentLoaded", () => {
    installQuotaDefenseAndBanner();

    const mainMapEl = document.getElementById("skg-interactive-map");
    if (mainMapEl) {
        const waypointButtons = Array.from(document.querySelectorAll("[data-waypoint]"));
        mountInteractiveMap(mainMapEl, waypointButtons);
    }

    const previewMapEl = document.getElementById("skg-home-map");
    if (previewMapEl) {
        mountInteractiveMap(previewMapEl, []);
    }

    initNearbyGuidePanel();
});
