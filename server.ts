import express from "express";
import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, "dist");

function readCliArg(flagName: string): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === flagName && args[i + 1] && !args[i + 1].startsWith("--")) {
      return args[i + 1];
    }
    if (arg.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1);
    }
  }
  return "";
}

function resolveListenPort(): number {
  const cliPort = Number(readCliArg("--port"));
  if (Number.isInteger(cliPort) && cliPort > 0 && cliPort < 65536) {
    return cliPort;
  }
  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  // In container dev mode Nginx binds NGINX_PORT (8080) and proxies to DEFAULT_APP_PORT (3000)
  if (Number.isInteger(envPort) && envPort > 0 && envPort !== nginxPort) {
    return envPort;
  }
  const defaultAppPort = Number(process.env.DEFAULT_APP_PORT);
  return Number.isInteger(defaultAppPort) && defaultAppPort > 0 ? defaultAppPort : 3000;
}

const PORT = resolveListenPort();
const HOST = readCliArg("--host") || process.env.HOST || "0.0.0.0";

const RESTAURANT_COORDS = {
  latitude: 27.6087174620,
  longitude: 84.5682702860
};

const ALLOWED_MODELS = new Set(["gemini-4-hydrogen", "gemini-3.1-flash-lite"]);

const SYSTEM_INSTRUCTION = `You are the friendly digital concierge for Siranchowk Khaja Ghar (सिरानचोक खाजा घर), a 100% Halal restaurant and local khaja ghar located in Khairahani-6, Parsa, Chitwan, Nepal (behind Chaudhary Medical).

Verified Restaurant Facts:
- Name: Siranchowk Khaja Ghar (सिरानचोक खाजा घर)
- Location: Khairahani-6, Parsa, Chitwan, Nepal — Behind Chaudhary Medical (approx. 27.6087° N, 84.5683° E)
- Hours: Open Daily 6:30 AM – 9:00 PM Nepal Time (Monday–Sunday)
- Halal Guarantee: 100% Halal food cooked fresh daily
- Contact & Ordering: Phone 9821233154 | WhatsApp +977 9821233154
- Signature Menu Items:
  * Momo: Chicken Momo (चिकेन म:म), Buff Momo (बफ म:म) with house tomato-sesame chutney
  * Chowmein: Veg Chowmein (भेज चाउमिन), Chicken Chowmein (चिकेन चाउमिन)
  * Bread / Roti: Roti (रोटी), Paratha (पराठा)
  * Tea: Milk Tea (चिया दुध), Black Tea (कालो चिया)
  * Rice & Specials: Special Chicken Biryani (बिरयानी) — prepared on Fridays and special festive days
  * Snacks & Other: Spiced Chana (चना), Keema (कीमा), Sukuti (सुकुटी), Boiled Egg (उसिनेको अण्डा), Fried Chicken (फ्राइड चिकेन)
- Ordering Policy: Customers can submit order requests through the website Cart, or call / WhatsApp 9821233154 for faster confirmation. Final counter pricing and delivery availability are confirmed directly by our kitchen team.

Guidelines:
- Be warm, concise, accurate, and helpful in English or Nepali when asked.
- Never invent menu prices or claim delivery to unverified addresses; let guests know exact prices are confirmed at the counter or via WhatsApp 9821233154.
- When Google Maps grounding is enabled, cite real places accurately from Maps tools.`;

interface ChatTurn {
  role: "user" | "model";
  text: string;
}

interface GroundedPlace {
  title: string;
  uri: string;
  placeId: string;
  snippets: string[];
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error(
      "GEMINI_API_KEY is not configured. Add it in Settings > Secrets (or server environment) to enable Gemini responses."
    ) as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } }
  });
}

function formatGeminiError(error: unknown): { status: number; message: string } {
  const raw = error instanceof Error ? error.message : String(error || "AI request failed");
  const statusMatch =
    (typeof error === "object" && error !== null && "status" in error && Number((error as { status?: number }).status)) ||
    (typeof error === "object" && error !== null && "statusCode" in error && Number((error as { statusCode?: number }).statusCode)) ||
    500;
  const status = Number.isFinite(statusMatch) && statusMatch >= 400 && statusMatch < 600 ? statusMatch : 500;

  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(raw)) {
    return {
      status: status === 500 ? 403 : status,
      message: "Gemini API key was rejected or lacks permission. Please verify GEMINI_API_KEY in Settings > Secrets."
    };
  }
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(raw)) {
    return {
      status: 429,
      message: "Gemini API rate limit or quota reached. Please wait a moment and try again."
    };
  }
  return { status, message: raw };
}

function extractGroundedPlaces(response: unknown): GroundedPlace[] {
  const r = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          maps?: {
            title?: string;
            uri?: string;
            placeId?: string;
            placeAnswerSources?: {
              reviewSnippets?: Array<{ content?: string; text?: string }>;
            };
          };
        }>;
      };
    }>;
  };
  const chunks = r?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];

  const seen = new Set<string>();
  const places: GroundedPlace[] = [];

  for (const chunk of chunks) {
    const maps = chunk?.maps;
    if (!maps?.uri) continue;
    if (seen.has(maps.uri)) continue;
    seen.add(maps.uri);

    const snippets = Array.isArray(maps.placeAnswerSources?.reviewSnippets)
      ? maps.placeAnswerSources.reviewSnippets
          .map((s) => String(s?.content || s?.text || "").trim())
          .filter(Boolean)
          .slice(0, 2)
      : [];

    places.push({
      title: String(maps.title || "Google Maps Place").slice(0, 140),
      uri: String(maps.uri),
      placeId: String(maps.placeId || "").slice(0, 128),
      snippets
    });
  }

  return places;
}

function clampCoord(val: unknown, fallback: number, min: number, max: number): number {
  const num = Number(val);
  if (!Number.isFinite(num) || num < min || num > max) return fallback;
  return num;
}

function createApiRouter() {
  const router = express.Router();
  router.use(express.json({ limit: "256kb" }));

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, service: "siranchowk-khaja-ghar" });
  });

  router.get("/config/maps", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const apiKey = (process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "").trim();
    res.json({
      apiKey,
      mapId: "DEMO_MAP_ID",
      center: {
        lat: RESTAURANT_COORDS.latitude,
        lng: RESTAURANT_COORDS.longitude
      },
      quotaMode: "demo"
    });
  });

  router.post("/chat", async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        message?: unknown;
        history?: unknown;
        model?: unknown;
        useMaps?: unknown;
        latLng?: { latitude?: unknown; longitude?: unknown };
      };

      const message = typeof body?.message === "string" ? body.message.trim() : "";
      if (!message || message.length > 4000) {
        res.status(400).json({ error: "Please enter a message between 1 and 4000 characters." });
        return;
      }

      const useMaps = Boolean(body?.useMaps);
      const requestedModel = typeof body?.model === "string" ? body.model.trim() : "gemini-4-hydrogen";
      const model = useMaps
        ? "gemini-4-hydrogen"
        : ALLOWED_MODELS.has(requestedModel)
          ? requestedModel
          : "gemini-4-hydrogen";

      const rawHistory = Array.isArray(body?.history) ? (body.history as ChatTurn[]) : [];
      const formattedHistory = rawHistory
        .slice(-24)
        .filter((turn) => (turn?.role === "user" || turn?.role === "model") && typeof turn?.text === "string" && turn.text.trim())
        .map((turn) => ({
          role: turn.role,
          parts: [{ text: turn.text.trim().slice(0, 4000) }]
        }));

      const latitude = clampCoord(body?.latLng?.latitude, RESTAURANT_COORDS.latitude, -90, 90);
      const longitude = clampCoord(body?.latLng?.longitude, RESTAURANT_COORDS.longitude, -180, 180);

      const ai = getGeminiClient();
      const chatConfig: Record<string, unknown> = {
        systemInstruction: SYSTEM_INSTRUCTION
      };

      if (useMaps) {
        chatConfig.tools = [{ googleMaps: {} }];
        chatConfig.toolConfig = {
          retrievalConfig: {
            latLng: { latitude, longitude }
          }
        };
      }

      const chat = ai.chats.create({
        model,
        history: formattedHistory,
        config: chatConfig
      });

      const response = await chat.sendMessage({ message });
      const places = useMaps ? extractGroundedPlaces(response) : [];

      res.json({
        reply: response.text || "I received your question, please feel free to ask anything about our menu or location.",
        model,
        places
      });
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  router.post("/maps-grounding", async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        query?: unknown;
        lat?: unknown;
        lng?: unknown;
      };

      const userQuery = typeof body?.query === "string" ? body.query.trim() : "";
      if (!userQuery || userQuery.length > 500) {
        res.status(400).json({ error: "Please enter a location question (1–500 characters)." });
        return;
      }

      const latitude = clampCoord(body?.lat, RESTAURANT_COORDS.latitude, -90, 90);
      const longitude = clampCoord(body?.lng, RESTAURANT_COORDS.longitude, -180, 180);

      const ai = getGeminiClient();
      const groundedPrompt = `Context: A visitor is checking places around Siranchowk Khaja Ghar (Khairahani-6, Parsa, Chitwan, Nepal — behind Chaudhary Medical, coordinates ${latitude.toFixed(6)}, ${longitude.toFixed(6)}).
Visitor question: ${userQuery}
Respond helpfully with specific real nearby landmarks, transit stops, or amenities grounded via Google Maps.`;

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: groundedPrompt,
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: { latitude, longitude }
            }
          }
        }
      });

      const places = extractGroundedPlaces(response);
      res.json({
        answer: response.text || "No nearby summary was returned for this location query.",
        model: "gemini-4-hydrogen",
        center: { lat: latitude, lng: longitude },
        places
      });
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  return router;
}

async function startServer() {
  const app = express();
  app.disable("x-powered-by");

  app.use("/api", createApiRouter());

  const useProdStatic =
    process.env.NODE_ENV === "production" && fs.existsSync(path.join(DIST_DIR, "index.html"));

  let viteServer: { close: () => Promise<void>; middlewares: express.RequestHandler } | null = null;

  if (useProdStatic) {
    app.use(express.static(DIST_DIR, { extensions: ["html"] }));
    app.get("/admin", (_req: Request, res: Response) => {
      res.redirect("/admin/login.html");
    });
  } else {
    const viteReady = import("vite").then(({ createServer: createViteServer }) =>
      createViteServer({
        root: ROOT_DIR,
        server: {
          middlewareMode: true,
          hmr: false,
          ws: false
        },
        appType: "mpa"
      })
    ).then((vite) => {
      viteServer = vite;
      return vite;
    });

    app.use(async (req: Request, res: Response, next: express.NextFunction) => {
      try {
        const vite = await viteReady;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  }

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`Siranchowk Khaja Ghar server listening on http://${HOST}:${PORT}`);
  });

  httpServer.on("error", (err) => {
    console.error("Server listen error:", err);
    process.exit(1);
  });

  const shutdown = async () => {
    try {
      await viteServer?.close();
    } catch {}
    httpServer.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
