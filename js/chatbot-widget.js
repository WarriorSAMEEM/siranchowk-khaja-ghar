// ============================================================================
// SIRANCHOWK KHAJA GHAR — GEMINI MULTI-TURN CONCIERGE WIDGET
// ============================================================================

import { onCustomerAuthChange, loginWithGoogle } from "./customer-auth.js";
import {
    createChatSession,
    appendChatMessageBatch,
    listUserChatSessions,
    loadChatMessages,
    archiveChatSession
} from "./firestore-service.js";

const QUICK_PROMPTS = [
    "When is Friday Biryani served?",
    "Is all food 100% Halal?",
    "Suggest a fresh Momo + Milk Tea combo",
    "What landmarks & transit are near Parsa Chowk?"
];

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function formatChatMarkdown(raw) {
    const escaped = escapeHTML(raw || "");
    return escaped
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>")
        .replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`)
        .replace(/\n{2,}/g, "<br><br>")
        .replace(/\n/g, "<br>");
}

function initChatbotWidget() {
    if (typeof document === "undefined" || window.location.pathname.includes("/admin/")) return;
    if (document.getElementById("skg-concierge-root")) return;

    const root = document.createElement("div");
    root.id = "skg-concierge-root";
    root.className = "skg-concierge-root";
    root.innerHTML = `
      <button type="button" class="skg-concierge-fab" id="skg-concierge-toggle" aria-expanded="false" aria-controls="skg-concierge-drawer">
        Ask Khaja Concierge
      </button>
      <section class="skg-concierge-drawer" id="skg-concierge-drawer" role="dialog" aria-label="Siranchowk Khaja Ghar Concierge" hidden>
        <header class="skg-concierge-head">
          <div>
            <strong>Khaja Ghar Concierge</strong>
            <span>Menu, Halal Info &amp; Khairahani Guide</span>
          </div>
          <button type="button" class="skg-concierge-close" id="skg-concierge-close" aria-label="Close concierge">×</button>
        </header>

        <div class="skg-concierge-controls">
          <select id="skg-concierge-model" aria-label="Select response mode">
            <option value="gemini-4-hydrogen">Smart Guide (gemini-4-hydrogen)</option>
            <option value="gemini-3.1-flash-lite">Quick Answer (gemini-3.1-flash-lite)</option>
          </select>
          <label class="skg-concierge-maps-opt">
            <input type="checkbox" id="skg-concierge-maps-toggle">
            <span>Maps Grounding</span>
          </label>
        </div>

        <div class="skg-concierge-auth-bar" id="skg-concierge-auth-bar">
          <span id="skg-concierge-auth-status">Chat is in local session mode.</span>
          <div class="skg-concierge-session-actions">
            <button type="button" id="skg-concierge-signin-btn">Sign in with Google to Save</button>
            <select id="skg-concierge-sessions" hidden aria-label="Saved chats"></select>
            <button type="button" id="skg-concierge-new-btn" hidden>New Chat</button>
          </div>
        </div>

        <div class="skg-concierge-messages" id="skg-concierge-messages" aria-live="polite">
          <div class="skg-chat-bubble model">
            <p>Namaste! Welcome to <strong>Siranchowk Khaja Ghar</strong> in Khairahani-6, Parsa. Ask me about our 100% Halal momo, chowmein, tea, Friday biryani, or nearby Chitwan landmarks.</p>
          </div>
          <div class="skg-concierge-chips" id="skg-concierge-chips">
            ${QUICK_PROMPTS.map((q) => `<button type="button" class="skg-chip-btn" data-prompt="${escapeHTML(q)}">${escapeHTML(q)}</button>`).join("")}
          </div>
        </div>

        <form class="skg-concierge-form" id="skg-concierge-form">
          <input type="text" id="skg-concierge-input" maxlength="2000" placeholder="Ask about dishes, hours, or nearby places..." autocomplete="off">
          <button type="submit" id="skg-concierge-send">Send</button>
        </form>
      </section>
    `;
    document.body.appendChild(root);

    const toggleBtn = root.querySelector("#skg-concierge-toggle");
    const closeBtn = root.querySelector("#skg-concierge-close");
    const drawer = root.querySelector("#skg-concierge-drawer");
    const modelSelect = root.querySelector("#skg-concierge-model");
    const mapsToggle = root.querySelector("#skg-concierge-maps-toggle");
    const authStatus = root.querySelector("#skg-concierge-auth-status");
    const signInBtn = root.querySelector("#skg-concierge-signin-btn");
    const sessionsSelect = root.querySelector("#skg-concierge-sessions");
    const newChatBtn = root.querySelector("#skg-concierge-new-btn");
    const messagesBox = root.querySelector("#skg-concierge-messages");
    const form = root.querySelector("#skg-concierge-form");
    const input = root.querySelector("#skg-concierge-input");
    const sendBtn = root.querySelector("#skg-concierge-send");

    let currentUser = null;
    let activeSessionId = null;
    let conversationHistory = [];
    let busy = false;

    function setOpen(open) {
        if (open) {
            drawer.removeAttribute("hidden");
            toggleBtn.setAttribute("aria-expanded", "true");
            input.focus();
        } else {
            drawer.setAttribute("hidden", "");
            toggleBtn.setAttribute("aria-expanded", "false");
        }
    }

    toggleBtn.addEventListener("click", () => {
        setOpen(drawer.hasAttribute("hidden"));
    });
    closeBtn.addEventListener("click", () => setOpen(false));

    function appendBubble(role, text, places = []) {
        const bubble = document.createElement("div");
        bubble.className = `skg-chat-bubble ${role === "user" ? "user" : "model"}`;
        const p = document.createElement("p");
        p.innerHTML = formatChatMarkdown(text);
        bubble.appendChild(p);

        if (Array.isArray(places) && places.length) {
            const linksList = document.createElement("div");
            linksList.className = "skg-chat-places";
            places.forEach((pl) => {
                if (!pl?.uri) return;
                const a = document.createElement("a");
                a.href = pl.uri;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = `📍 ${pl.title || "Open in Google Maps"} ↗`;
                linksList.appendChild(a);
            });
            bubble.appendChild(linksList);
        }

        messagesBox.appendChild(bubble);
        messagesBox.scrollTop = messagesBox.scrollHeight;
        return bubble;
    }

    async function refreshUserSessions() {
        if (!currentUser?.uid) {
            sessionsSelect.hidden = true;
            newChatBtn.hidden = true;
            signInBtn.hidden = false;
            authStatus.textContent = "Sign in with Google to save your chat history.";
            return;
        }
        signInBtn.hidden = true;
        newChatBtn.hidden = false;
        authStatus.textContent = `Signed in as ${currentUser.displayName || currentUser.email}`;

        try {
            const list = await listUserChatSessions(currentUser.uid);
            const activeOnes = list.filter((s) => s.status !== "archived");
            sessionsSelect.innerHTML = `<option value="">Current Chat</option>` +
                activeOnes.map((s) => `<option value="${escapeHTML(s.sessionId)}">${escapeHTML(s.title)} (${s.messageCount || 0})</option>`).join("");
            sessionsSelect.hidden = activeOnes.length === 0;
            if (activeSessionId && activeOnes.some((s) => s.sessionId === activeSessionId)) {
                sessionsSelect.value = activeSessionId;
            }
        } catch {
            sessionsSelect.hidden = true;
        }
    }

    onCustomerAuthChange(({ user }) => {
        currentUser = user || null;
        if (!currentUser) activeSessionId = null;
        refreshUserSessions();
    });

    signInBtn.addEventListener("click", async () => {
        try {
            await loginWithGoogle();
        } catch (err) {
            appendBubble("model", err?.message || "Google Sign-In could not be completed.");
        }
    });

    newChatBtn.addEventListener("click", async () => {
        if (activeSessionId && currentUser?.uid) {
            archiveChatSession(activeSessionId).catch(() => {});
        }
        activeSessionId = null;
        conversationHistory = [];
        messagesBox.innerHTML = `
          <div class="skg-chat-bubble model">
            <p>Started a fresh conversation. What would you like to know about Siranchowk Khaja Ghar?</p>
          </div>
        `;
        await refreshUserSessions();
    });

    sessionsSelect.addEventListener("change", async () => {
        const chosenId = sessionsSelect.value;
        if (!chosenId || !currentUser?.uid) return;
        try {
            const msgs = await loadChatMessages(chosenId, currentUser.uid);
            activeSessionId = chosenId;
            conversationHistory = msgs.map((m) => ({ role: m.role, text: m.text }));
            messagesBox.replaceChildren();
            msgs.forEach((m) => {
                const links = Array.isArray(m.groundingUrls)
                    ? m.groundingUrls.map((u) => ({ title: "Google Maps Place", uri: u }))
                    : [];
                appendBubble(m.role, m.text, links);
            });
        } catch {
            appendBubble("model", "Could not load that saved conversation.");
        }
    });

    async function sendMessage(rawText) {
        const text = String(rawText || "").trim();
        if (!text || busy) return;
        busy = true;
        sendBtn.disabled = true;
        input.value = "";

        root.querySelector("#skg-concierge-chips")?.remove();
        appendBubble("user", text);

        const typingBubble = appendBubble("model", "Thinking...");
        const selectedModel = modelSelect.value || "gemini-4-hydrogen";
        const useMaps = Boolean(mapsToggle.checked);

        try {
            if (currentUser?.uid && currentUser?.emailVerified) {
                if (!activeSessionId) {
                    activeSessionId = await createChatSession(text.slice(0, 60), selectedModel);
                }
                if (activeSessionId) {
                    await appendChatMessageBatch({
                        sessionId: activeSessionId,
                        role: "user",
                        text,
                        modelUsed: "user-input"
                    });
                }
            }

            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    history: conversationHistory.slice(-16),
                    model: selectedModel,
                    useMaps
                })
            });

            if (res.status === 429) {
                window.dispatchEvent(new CustomEvent("gmp-quota-exceeded", { detail: { reason: "Chat 429" } }));
            }

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || `Request failed (${res.status})`);
            }

            typingBubble.remove();
            const replyText = String(data.reply || "");
            const places = Array.isArray(data.places) ? data.places : [];
            appendBubble("model", replyText, places);

            conversationHistory.push({ role: "user", text });
            conversationHistory.push({ role: "model", text: replyText });

            if (currentUser?.uid && currentUser?.emailVerified && activeSessionId) {
                await appendChatMessageBatch({
                    sessionId: activeSessionId,
                    role: "model",
                    text: replyText.slice(0, 4000),
                    modelUsed: data.model || selectedModel,
                    groundingUrls: places.map((p) => p.uri).filter(Boolean)
                });
                refreshUserSessions().catch(() => {});
            }
        } catch (err) {
            typingBubble.remove();
            appendBubble("model", err?.message || "Sorry, the concierge service is unavailable right now.");
        } finally {
            busy = false;
            sendBtn.disabled = false;
        }
    }

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        sendMessage(input.value);
    });

    root.querySelectorAll("[data-prompt]").forEach((btn) => {
        btn.addEventListener("click", () => sendMessage(btn.getAttribute("data-prompt")));
    });
}

document.addEventListener("DOMContentLoaded", initChatbotWidget);
