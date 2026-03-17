import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Chemins
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Charger le fichier .env
dotenv.config({ path: path.join(__dirname, ".env") });
console.log("API key loaded:", !!process.env.OPENAI_API_KEY);

// App
const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// Listings
const listingsPath = path.join(__dirname, "listings.json");
const listings = JSON.parse(fs.readFileSync(listingsPath, "utf8"));

// Middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

// Client OpenAI
const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Helpers
function extractListingRef(text = "") {
  const match = text.match(/\bL-\d{4}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function getListingSystemPrompt(listing) {
  return `Tu es l'Assistant des immeubles de FluxLocatif.

Règles absolues :
- Réponds uniquement sur l'immeuble fourni dans le contexte.
- L'employé est en lecture seule. Ne propose jamais de modifier les données.
- Si la question demande une traduction, réponds exactement :
"Pour les traductions ou les questions liées à la langue, veuillez utiliser le mode Traducteur."
- Si la question sort du cadre de l'immeuble, réponds exactement :
"Veuillez poser une question liée à cette référence d'immeuble uniquement."
- Garde les réponses courtes, claires et professionnelles.
- N'invente rien. Base-toi seulement sur les informations ci-dessous.

Immeuble :
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

// Routes utilitaires
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Serveur connecté",
    apiKey: !!process.env.OPENAI_API_KEY
  });
});

app.get("/api/listings", (req, res) => {
  const listingsMap = {};
  for (const listing of listings) {
    listingsMap[listing.ref] = listing;
  }
  res.json({ listings: listingsMap });
});

// Route principale
app.post("/api/chat", async (req, res) => {
  try {
    if (!client) {
      return res.status(500).json({
        error: "API key missing"
      });
    }

    const { message, mode } = req.body;

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        error: "Message vide."
      });
    }

    // MODE TRADUCTEUR
    if (mode === "translator") {
      const response = await client.responses.create({
        model: MODEL,
        input: [
          {
            role: "system",
            content: `Tu es le Traducteur de FluxLocatif.

Ton rôle principal :
Traduire du français québécois, souvent familier, abrégé ou rempli de fautes, en français clair, professionnel et adapté au pays ou à la région du locataire.

Important :
- Si l'utilisateur ne précise pas le pays ou la région du locataire, tu dois répondre exactement :
"Pour quel pays ou quelle région dois-je adapter le français ?"
- Dans ce cas, ne traduis pas encore.

Si le pays ou la région est précisé :
- Traduis en français adapté à ce pays ou cette région.
- Corrige les fautes.
- Reformule de manière claire et professionnelle.
- Garde le sens exact du message.

Tu peux aussi :
- traduire vers d'autres langues si l'utilisateur le demande clairement
- expliquer le sens d'un texte
- clarifier une expression seulement si cela est basé sur le texte fourni

Règles strictes :
- Ne réponds jamais aux questions sur les immeubles, loyers, disponibilités, références ou annonces.
- Si l'utilisateur pose une question liée à un immeuble ou à un logement, réponds exactement :
"Pour toute question liée aux immeubles ou aux logements, veuillez utiliser le mode Assistant des immeubles."

Style :
- court
- clair
- professionnel
- naturel

Exemples :

Utilisateur : yer tu dispo le logi
Réponse : Pour quel pays ou quelle région dois-je adapter le français ?

Utilisateur : France - yer tu dispo le logi
Réponse : Le logement est-il disponible ?

Utilisateur : Belgique - c quand jpeu visiter
Réponse : Quand puis-je effectuer une visite du logement ?`
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

    // MODE ASSISTANT DES IMMEUBLES
    const ref = extractListingRef(message);

    if (!ref) {
      return res.json({
        reply: "Veuillez inclure une référence (ex: L-1001).",
        label: "Assistant des immeubles",
        variant: "error"
      });
    }

    const listing = listings.find((l) => l.ref === ref);

    if (!listing) {
      return res.json({
        reply: "Référence non trouvée.",
        label: "Assistant des immeubles",
        variant: "error"
      });
    }

    const systemPrompt = getListingSystemPrompt(listing);

    const response = await client.responses.create({
      model: MODEL,
      input: [
        {
          role: "system",
          content: systemPrompt
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
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Server error"
    });
  }
});

// Start serveur
app.listen(PORT, () => {
  console.log(`FluxLocatif AI lancé sur http://localhost:${PORT}`);
});