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

const APP_USERNAME = process.env.APP_USERNAME || "admin";
const APP_PASSWORD = process.env.APP_PASSWORD || "1234";

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
app.use(express.static(__dirname));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username === APP_USERNAME && password === APP_PASSWORD) {
    return res.json({ ok: true });
  }

  return res.status(401).json({
    ok: false,
    error: "Identifiants invalides."
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/listings", (req, res) => {
  const map = {};
  listings.forEach((l) => {
    map[l.ref] = l;
  });
  res.json({ listings: map });
});

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
              "Transforme ce texte en français international clair, professionnel et naturel. Si l'utilisateur demande une autre langue, traduis vers cette langue. Si la question concerne un immeuble ou un logement, réponds exactement : Pour toute question liée aux immeubles ou aux logements, veuillez utiliser le mode Assistant des immeubles."
          },
          { role: "user", content: message }
        ]
      });

      return res.json({
        reply: response.output_text || "Erreur de réponse.",
        label: "Traducteur",
        variant: "success"
      });
    }

    const refMatch = message.match(/\bL-\d{4}\b/i);

    if (!refMatch) {
      return res.json({
        reply: "Veuillez inclure une référence (ex: L-1001).",
        label: "Assistant des immeubles",
        variant: "error"
      });
    }

    const ref = refMatch[0].toUpperCase();
    const listing = listings.find((l) => l.ref === ref);

    if (!listing) {
      return res.json({
        reply: "Référence non trouvée.",
        label: "Assistant des immeubles",
        variant: "error"
      });
    }

    const response = await client.responses.create({
      model: MODEL,
      input: [
        {
          role: "system",
          content: `Tu réponds uniquement avec ces informations sur l'immeuble :
Référence : ${listing.ref}
Adresse : ${listing.address}
Ville : ${listing.city}
Loyer : ${listing.rent}
Chambres : ${listing.bedrooms}
Disponibilité : ${listing.availability}
Statut : ${listing.status}
Description : ${listing.description}
Notes : ${listing.notes}

Règles :
- Réponds seulement avec ces infos
- N'invente rien
- Sois court, clair et professionnel`
        },
        { role: "user", content: message }
      ]
    });

    return res.json({
      reply: response.output_text || "Erreur de réponse.",
      label: "Assistant des immeubles",
      variant: "success",
      reference: ref
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
