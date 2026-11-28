// ============================================================================
// SIRANCHOWK KHAJA GHAR — FIRESTORE SDK, CONNECTION HEALTHCHECK & STRUCTURED ERRORS
// ============================================================================

import {
    getFirestore,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    collection,
    query,
    where,
    limit,
    serverTimestamp
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
            signedIn: Boolean(auth?.currentUser?.uid),
            isAnonymous: auth?.currentUser?.isAnonymous ?? null,
            providerIds: (auth?.currentUser?.providerData || []).map((provider) => provider.providerId)
        },
        operationType,
        collection: String(path || "").split("/")[0] || "unknown"
    };
    console.error("Firestore Error: ", JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
}

const firestoreDatabaseId = appletConfig?.firestoreDatabaseId || "(default)";

export const firestoreDb = isFirebaseConfigured && app
    ? getFirestore(app, firestoreDatabaseId)
    : null;

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
