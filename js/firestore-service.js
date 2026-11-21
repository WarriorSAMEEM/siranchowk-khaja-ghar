// ============================================================================
// SIRANCHOWK KHAJA GHAR — FIRESTORE SDK, CONNECTION HEALTHCHECK & STRUCTURED ERRORS
// ============================================================================

import {
    getFirestore,
    doc,
    getDoc,
    getDocFromServer,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    collection,
    query,
    where,
    limit,
    writeBatch,
    serverTimestamp,
    increment
} from "firebase/firestore";
import { app, auth, isFirebaseConfigured } from "./firebase.js";
import appletConfig from "../firebase-applet-config.json" with { type: "json" };

export const OperationType = Object.freeze({
    CREATE: "create",
    UPDATE: "update",
    DELETE: "delete",
    LIST: "list",
    GET: "get",
    WRITE: "write"
});

export function handleFirestoreError(error, operationType, path) {
    const errInfo = {
        error: error instanceof Error ? error.message : String(error),
        authInfo: {
            userId: auth?.currentUser?.uid ?? null,
            email: auth?.currentUser?.email ?? null,
            emailVerified: auth?.currentUser?.emailVerified ?? null,
            isAnonymous: auth?.currentUser?.isAnonymous ?? null,
            tenantId: auth?.currentUser?.tenantId ?? null,
            providerInfo: (auth?.currentUser?.providerData || []).map((provider) => ({
                providerId: provider.providerId,
                email: provider.email
            }))
        },
        operationType,
        path
    };
    console.error("Firestore Error: ", JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
}

const firestoreDatabaseId = appletConfig?.firestoreDatabaseId || "(default)";

export const firestoreDb = isFirebaseConfigured && app
    ? getFirestore(app, firestoreDatabaseId)
    : null;

export async function testFirestoreConnection() {
    if (!firestoreDb) return;
    try {
        await getDocFromServer(doc(firestoreDb, "test", "connection"));
    } catch (error) {
        if (error instanceof Error && error.message.includes("the client is offline")) {
            console.error("Please check your Firebase configuration.");
        }
    }
}

if (typeof window !== "undefined") {
    testFirestoreConnection();
}

function makeFirestoreSafeId(prefix = "id") {
    const randomPart =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, "")
            : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}_${randomPart}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

function sanitizeCategory(raw) {
    const val = String(raw || "other").toLowerCase();
    const allowed = new Set(["restaurant", "landmark", "transit", "medical", "atm", "other"]);
    return allowed.has(val) ? val : "other";
}

function isValidMapsUri(uri) {
    return /^https:\/\/(www\.)?(google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl)/.test(
        String(uri || "").trim()
    );
}

// ----------------------------------------------------------------------------
// Chat Sessions & Messages (Master Gate + Batch Atomic Counter)
// ----------------------------------------------------------------------------

export async function listUserChatSessions(uid) {
    if (!firestoreDb || !uid) return [];
    const path = "chatSessions";
    try {
        const q = query(
            collection(firestoreDb, path),
            where("ownerId", "==", uid),
            limit(20)
        );
        const snap = await getDocs(q);
        const sessions = [];
        snap.forEach((docSnap) => {
            sessions.push(docSnap.data());
        });
        sessions.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
        return sessions;
    } catch (error) {
        handleFirestoreError(error, OperationType.LIST, path);
        return [];
    }
}

export async function createChatSession(title = "Kitchen Concierge", model = "gemini-4-hydrogen") {
    const user = auth?.currentUser;
    if (!firestoreDb || !user?.uid) {
        throw new Error("Please sign in with Google to save chat history.");
    }
    const sessionId = makeFirestoreSafeId("sess");
    const path = `chatSessions/${sessionId}`;
    const safeModel = model === "gemini-3.1-flash-lite" ? "gemini-3.1-flash-lite" : "gemini-4-hydrogen";
    const safeTitle = String(title || "Kitchen Concierge").trim().slice(0, 120) || "Kitchen Concierge";

    try {
        await setDoc(doc(firestoreDb, "chatSessions", sessionId), {
            sessionId,
            ownerId: user.uid,
            title: safeTitle,
            model: safeModel,
            status: "active",
            messageCount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return sessionId;
    } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
        return null;
    }
}

export async function loadChatMessages(sessionId, uid) {
    if (!firestoreDb || !sessionId || !uid) return [];
    const path = `chatSessions/${sessionId}/messages`;
    try {
        const q = query(
            collection(firestoreDb, "chatSessions", sessionId, "messages"),
            where("ownerId", "==", uid),
            limit(80)
        );
        const snap = await getDocs(q);
        const messages = [];
        snap.forEach((docSnap) => {
            messages.push(docSnap.data());
        });
        messages.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
        return messages;
    } catch (error) {
        handleFirestoreError(error, OperationType.LIST, path);
        return [];
    }
}

export async function appendChatMessageBatch({
    sessionId,
    role,
    text,
    modelUsed = "gemini-4-hydrogen",
    groundingUrls = []
}) {
    const user = auth?.currentUser;
    if (!firestoreDb || !user?.uid || !sessionId) return null;

    const messageId = makeFirestoreSafeId("msg");
    const msgPath = `chatSessions/${sessionId}/messages/${messageId}`;
    const safeRole = role === "model" ? "model" : "user";
    const safeModel =
        modelUsed === "gemini-3.1-flash-lite" || modelUsed === "user-input"
            ? modelUsed
            : "gemini-4-hydrogen";
    const safeUrls = Array.isArray(groundingUrls)
        ? groundingUrls.filter((u) => typeof u === "string" && u.length >= 10 && u.length <= 500).slice(0, 10)
        : [];

    try {
        const batch = writeBatch(firestoreDb);
        const sessionRef = doc(firestoreDb, "chatSessions", sessionId);
        const msgRef = doc(firestoreDb, "chatSessions", sessionId, "messages", messageId);

        const payload = {
            messageId,
            sessionId,
            ownerId: user.uid,
            role: safeRole,
            text: String(text || "").trim().slice(0, 4000) || "Message",
            modelUsed: safeModel,
            createdAt: serverTimestamp()
        };
        if (safeUrls.length > 0) {
            payload.groundingUrls = safeUrls;
        }

        batch.set(msgRef, payload);
        batch.update(sessionRef, {
            messageCount: increment(1),
            model: safeModel === "user-input" ? "gemini-4-hydrogen" : safeModel,
            updatedAt: serverTimestamp()
        });

        await batch.commit();
        return messageId;
    } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, msgPath);
        return null;
    }
}

export async function archiveChatSession(sessionId) {
    if (!firestoreDb || !sessionId) return;
    const path = `chatSessions/${sessionId}`;
    try {
        await updateDoc(doc(firestoreDb, "chatSessions", sessionId), {
            status: "archived",
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
    }
}

// ----------------------------------------------------------------------------
// Saved Chitwan Places from Google Maps Grounding
// ----------------------------------------------------------------------------

export async function listSavedPlaces(uid) {
    if (!firestoreDb || !uid) return [];
    const path = "savedPlaces";
    try {
        const q = query(
            collection(firestoreDb, path),
            where("userId", "==", uid),
            limit(30)
        );
        const snap = await getDocs(q);
        const places = [];
        snap.forEach((docSnap) => {
            places.push(docSnap.data());
        });
        places.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        return places;
    } catch (error) {
        handleFirestoreError(error, OperationType.LIST, path);
        return [];
    }
}

export async function savePlaceToFirestore({ title, mapsUri, category = "landmark", notes = "" }) {
    const user = auth?.currentUser;
    if (!firestoreDb || !user?.uid) {
        throw new Error("Please sign in with a verified Google account to save places.");
    }
    const cleanUri = String(mapsUri || "").trim().slice(0, 500);
    if (!isValidMapsUri(cleanUri)) {
        throw new Error("Only verified Google Maps URLs can be saved.");
    }
    const placeId = makeFirestoreSafeId("place");
    const path = `savedPlaces/${placeId}`;
    try {
        await setDoc(doc(firestoreDb, "savedPlaces", placeId), {
            placeId,
            userId: user.uid,
            title: String(title || "Saved Place").trim().slice(0, 140) || "Saved Place",
            mapsUri: cleanUri,
            category: sanitizeCategory(category),
            notes: String(notes || "").trim().slice(0, 300),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return placeId;
    } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
        return null;
    }
}

export async function removeSavedPlace(placeId) {
    if (!firestoreDb || !placeId) return;
    const path = `savedPlaces/${placeId}`;
    try {
        await deleteDoc(doc(firestoreDb, "savedPlaces", placeId));
    } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
    }
}

export async function saveUserDiningPreference({ displayName, preferredDiningMode = "dine-in", spicePreference = "medium" }) {
    const user = auth?.currentUser;
    if (!firestoreDb || !user?.uid) return;
    const path = `userPreferences/${user.uid}`;
    const safeMode = ["dine-in", "takeaway", "delivery"].includes(preferredDiningMode) ? preferredDiningMode : "dine-in";
    const safeSpice = ["mild", "medium", "spicy"].includes(spicePreference) ? spicePreference : "medium";
    const safeName = String(displayName || user.displayName || "Customer").trim().slice(0, 80) || "Customer";

    try {
        const refDoc = doc(firestoreDb, "userPreferences", user.uid);
        const snap = await getDoc(refDoc);
        if (!snap.exists()) {
            await setDoc(refDoc, {
                uid: user.uid,
                displayName: safeName,
                preferredDiningMode: safeMode,
                spicePreference: safeSpice,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        } else {
            await updateDoc(refDoc, {
                displayName: safeName,
                preferredDiningMode: safeMode,
                spicePreference: safeSpice,
                updatedAt: serverTimestamp()
            });
        }
    } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
    }
}
