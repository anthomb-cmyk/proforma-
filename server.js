import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY manquante.");
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Variables Supabase manquantes.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
Adresse : ${listing.adresse}
Ville : ${listing.ville}
Type de logement : ${listing.type_logement ?? ""}
Chambres : ${listing.chambres ?? ""}
Superficie : ${listing.superficie ?? ""}
Loyer : ${listing.loyer ?? ""}
Inclusions : ${listing.inclusions ?? ""}
Disponibilité : ${listing.disponibilite ?? ""}
Statut : ${listing.statut ?? ""}
Stationnement : ${listing.stationnement === true ? "Oui" : listing.stationnement === false ? "Non" : ""}
Animaux acceptés : ${listing.animaux_acceptes === true ? "Oui" : listing.animaux_acceptes === false ? "Non" : ""}
Meublé : ${listing.meuble === true ? "Oui" : listing.meuble === false ? "Non" : ""}
Description : ${listing.description ?? ""}
Notes : ${listing.notes ?? ""}`;
}

async function getAllListings() {
  const { data, error } = await supabase
    .from("apartments")
    .select("*")
    .order("ref", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getListingByRef(ref) {
  const { data, error } = await supabase
    .from("apartments")
    .select("*")
    .eq("ref", ref)
    .maybeSingle();

  if (error) throw error;
  return data;
}

app.get("/api/health", async (req, res) => {
  try {
    const { error } = await supabase.from("apartments").select("ref").limit(1);
    if (error) throw error;

    res.json({
      ok: true,
      message: "Serveur connecté"
    });
  } catch (error) {
    console.error("Erreur /api/health :", error);
    res.status(500).json({
      ok: false,
      error: "Connexion Supabase impossible."
    });
  }
});

app.get("/api/listings", async (req, res) => {
  try {
    const listings = await getAllListings();
    const map = {};

    for (const listing of listings) {
      if (listing?.ref) {
        map[listing.ref] = listing;
      }
    }

    res.json({ listings: map });
  } catch (error) {
    console.error("Erreur /api/listings :", error);
    res.status(500).json({ error: "Erreur chargement appartements." });
  }
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
      const response = await openai.responses.create({
        model: MODEL,
        input: [
          {
            role: "system",
            content:
              "Corrige et reformule le texte en français international clair, professionnel et naturel. Ne fais rien d’autre. Ne donne aucune instruction. Ne redirige jamais vers un autre mode. Répond uniquement avec le texte corrigé."
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

    const listing = await getListingByRef(ref);

    if (!listing) {
      return res.json({
        reply: "Référence non trouvée.",
        label: "Assistant des immeubles",
        variant: "error"
      });
    }

    const response = await openai.responses.create({
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
