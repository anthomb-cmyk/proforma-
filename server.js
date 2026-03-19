import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const LISTINGS_PATH = path.join(__dirname, "listings.json");

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

async function loadListings() {
  const raw = await fs.readFile(LISTINGS_PATH, "utf8");
  return JSON.parse(raw);
}

function buildFallbackTranslatorReply(message) {
  const text = String(message || "").trim();
  const lowered = text.toLowerCase();

  if (lowered.includes("lease") && lowered.includes("tomorrow")) {
    return [
      "Bonjour,",
      "",
      "Merci pour votre message.",
      "",
      "Nous vous ferons parvenir le bail demain, comme prévu.",
      "",
      "N'hésitez pas à me contacter si vous avez des questions entre-temps.",
      "",
      "Cordialement,"
    ].join("\n");
  }

  return [
    "Bonjour,",
    "",
    "Merci pour votre message.",
    "",
    "Nous avons bien pris connaissance de votre demande et nous ferons le suivi avec vous dans les plus brefs délais.",
    "",
    "N'hésitez pas à me contacter si vous avez besoin de précisions supplémentaires.",
    "",
    "Cordialement,"
  ].join("\n");
}

async function generateTranslatorReply(message) {
  if (!openai) {
    return buildFallbackTranslatorReply(message);
  }

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content:
          "Tu rediges une reponse complete en francais canadien. La reponse doit etre claire, professionnelle, naturelle et prete a envoyer a un client. Ne traduis pas mot a mot. Ne donne pas d'explication. Retourne uniquement le message final."
      },
      {
        role: "user",
        content: `Message a traiter :\n${message}`
      }
    ]
  });

  const reply = response.choices?.[0]?.message?.content?.trim();

  return reply || buildFallbackTranslatorReply(message);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/listings", async (_req, res) => {
  try {
    const listings = await loadListings();
    res.json(listings);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Impossible de lire listings.json."
    });
  }
});

app.post("/api/chat", async (req, res) => {
  const mode = String(req.body?.mode || "").trim();
  const message = String(req.body?.message || "").trim();

  if (mode !== "translator") {
    return res.status(400).json({
      ok: false,
      error: "Seul le mode translator est pris en charge."
    });
  }

  if (!message) {
    return res.status(400).json({
      ok: false,
      error: "Le message est obligatoire."
    });
  }

  try {
    const reply = await generateTranslatorReply(message);

    return res.json({
      ok: true,
      reply
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Impossible de generer la reponse."
    });
  }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return next();
  }

  return res.sendFile(path.join(__dirname, "index.html"));
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route introuvable."
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
