import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = "gpt-4.1-mini";

// LOGIN
const APP_USERNAME = process.env.APP_USERNAME;
const APP_PASSWORD = process.env.APP_PASSWORD;

// LOAD LISTINGS
const listingsPath = path.join(__dirname, "listings.json");
let listings = [];

try {
  const raw = JSON.parse(fs.readFileSync(listingsPath, "utf8"));
  listings = Array.isArray(raw) ? raw : raw.listings || [];
} catch (err) {
  console.error("Erreur chargement listings:", err);
}

app.use(cors());
app.use(express.json());

// 🔒 AUTH MIDDLEWARE
app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/login") ||
    req.path.startsWith("/login") ||
    req.path === "/"
  ) {
    return next();
  }

  const auth = req.headers.authorization || "";
  const expected =
    "Basic " +
    Buffer.from(`${APP_USERNAME}:${APP_PASSWORD}`).toString("base64");

  if (auth === expected) return next();

  return res.status(401).json({ error: "Unauthorized" });
});

// STATIC
app.use(express.static(__dirname));

// OPENAI
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// LOGIN API
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (username === APP_USERNAME && password === APP_PASSWORD) {
    const token = Buffer.from(`${username}:${password}`).toString("base64");
    return res.json({ ok: true, token });
  }

  return res.status(401).json({ ok: false });
});

// HEALTH
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// LISTINGS
app.get("/api/listings", (req, res) => {
  const map = {};
  listings.forEach((l) => (map[l.ref] = l));
  res.json({ listings: map });
});

// CHAT
app.post("/api/chat", async (req, res) => {
  try {
    const { message, mode } = req.body;

    if (mode === "translator") {
      const response = await client.responses.create({
        model: MODEL,
        input: [
          {
            role: "system",
            content:
              "Transforme ce texte en français international clair et professionnel."
          },
          { role: "user", content: message }
        ]
      });

      return res.json({
        reply: response.output_text
      });
    }

    const refMatch = message.match(/\bL-\d{4}\b/i);
    if (!refMatch) {
      return res.json({
        reply: "Veuillez inclure une référence (ex: L-1001)."
      });
    }

    const ref = refMatch[0].toUpperCase();
    const listing = listings.find((l) => l.ref === ref);

    if (!listing) {
      return res.json({
        reply: "Référence non trouvée."
      });
    }

    const response = await client.responses.create({
      model: MODEL,
      input: [
        {
          role: "system",
          content: `Tu réponds uniquement avec ces infos:\n${JSON.stringify(
            listing
          )}`
        },
        { role: "user", content: message }
      ]
    });

    res.json({
      reply: response.output_text,
      reference: ref
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
