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
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const listingsPath = path.join(__dirname, "listings.json");
let listings = [];

try {
  if (fs.existsSync(listingsPath)) {
    const raw = JSON.parse(fs.readFileSync(listingsPath, "utf8"));
    listings = Array.isArray(raw) ? raw : raw.listings || [];
  } else {
    console.warn("listings.json introuvable, liste vide utilisée.");
    listings = [];
  }
} catch (error) {
  console.error("Erreur lors du chargement de listings.json :", error);
  listings = [];
}

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY manquante.");
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function extractListingRef(text = "") {
  const match = text.match(/\bL-\d{4}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function getListingPrompt(listing) {
  return `Tu es l'Assistant des immeubles de FluxLocatif.

Tu dois répondre uniquement avec les informations ci-dessous.
N'invente rien.
Sois court, clair et professionnel.

Référence : ${listing.ref}
Adresse : ${listing.address}
Ville : ${listing.city}
Loyer : ${listing.rent}
Chambres : ${listing.bedrooms}
Disponibilité : ${listing.availability}
Statut : ${listing.status}
Description : ${listing.description}
Notes : ${listing.notes}`;
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Serveur connecté"
  });
});

app.get("/api/listings", (req, res) => {
  const map = {};

  for (const listing of listings) {
    if (listing?.ref) {
      map[listing.ref] = listing;
    }
  }

  res.json({ listings: map });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, mode } = req.body || {};

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        error: "Message vide."
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY manquante."
      });
    }

    if (mode === "translator") {
      const response = await client.responses.create({
        model: MODEL,
        input: [
          {
            role: "system",
            content:
              "Transforme le texte en français international clair, professionnel et naturel. Si l'utilisateur demande clairement une autre langue, traduis vers cette langue. Si la question concerne un immeuble ou un logement, réponds exactement : Pour toute question liée aux immeubles ou aux logements, veuillez utiliser le mode Assistant des immeubles."
          },
          {
            role: "user",
            content: message
          }
        ]
      });

      return res.json({
        reply: response.output_text || "Erreur de réponse.",
        label: "Traducteur",
        variant: "success"
      });
    }

    const ref = extractListingRef(message);

    if (!ref) {
      return res.json({
        reply: "Veuillez inclure une référence (ex: L-1001).",
        label: "Assistant des immeubles",
        variant: "error"
      });
    }

    const listing = listings.find((item) => item.ref === ref);

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
          content: getListingPrompt(listing)
        },
        {
          role: "user",
          content: message
        }
      ]
    });

    return res.json({
      reply: response.output_text || "Erreur de réponse.",
      label: "Assistant des immeubles",
      variant: "success",
      reference: ref
    });
  } catch (error) {
    console.error("Erreur /api/chat :", error);
    return res.status(500).json({
      error: "Server error"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
