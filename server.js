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

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatListingRef(ref) {
  if (ref === null || ref === undefined || ref === "") return "";
  const clean = String(ref).replace(/^L-/i, "").trim();
  return `L-${clean}`;
}

function extractListingRef(text = "") {
  const direct = String(text).match(/\bL-(\d{1,10})\b/i);
  if (direct) return parseInt(direct[1], 10);

  const loose = String(text).match(/\b(\d{3,10})\b/);
  if (loose) return parseInt(loose[1], 10);

  return null;
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Non indiqué";
  }

  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "Non indiqué";
  }

  if (typeof value === "boolean") {
    return value ? "Oui" : "Non";
  }

  return String(value);
}

function buildListingContext(listing) {
  return Object.entries(listing)
    .map(([key, value]) => `${key} : ${formatValue(value)}`)
    .join("\n");
}

function getListingPrompt(listing) {
  const listingContext = buildListingContext(listing);

  return `Tu es l'Assistant des immeubles de FluxLocatif.

Tu réponds uniquement à partir des informations présentes dans la fiche ci-dessous.
Tu peux utiliser TOUTES les colonnes de la fiche.

Règles :
- N'invente rien
- Réponds en français
- Réponds de façon courte, claire et naturelle
- Si l'information n'est pas présente, réponds exactement : "Cette information n'est pas indiquée dans la fiche."
- Tu peux comprendre les variantes de langage comme :
  - électricité / electricite / hydro / courant / lumiere
  - eau chaude / hot water
  - animaux / chien / chat
  - parking / stationnement
- Si une information est présente dans inclusions, notes, electricite, statut, disponibilite, tu peux t'en servir

FICHE DU LOGEMENT :
${listingContext}`;
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
  const numericRef = Number(ref);

  const { data, error } = await supabase
    .from("apartments")
    .select("*")
    .eq("ref", numericRef)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function quickFieldAnswer(listing, question) {
  const q = normalizeText(question);
  const refLabel = formatListingRef(listing.ref);

  const inclusionsText = normalizeText(
    Array.isArray(listing.inclusions)
      ? listing.inclusions.join(", ")
      : listing.inclusions || ""
  );

  const electriciteText = normalizeText(listing.electricite || "");
  const notesText = normalizeText(listing.notes || "");
  const stationnementText = normalizeText(listing.stationnement || "");
  const animauxText = normalizeText(listing.animaux_acceptes || "");
  const fullText = [
    inclusionsText,
    electriciteText,
    notesText,
    stationnementText,
    animauxText,
    normalizeText(listing.disponibilite || ""),
    normalizeText(listing.statut || "")
  ].join(" ");

  if (
    q.includes("electric") ||
    q.includes("hydro") ||
    q.includes("courant") ||
    q.includes("lumiere")
  ) {
    if (listing.electricite) {
      return `Pour ${refLabel}, l'électricité est : ${listing.electricite}.`;
    }

    if (fullText.includes("electric") || fullText.includes("hydro")) {
      return `Pour ${refLabel}, l'information liée à l'électricité est : ${listing.electricite || "mentionnée dans la fiche"}.`;
    }

    return "Cette information n'est pas indiquée dans la fiche.";
  }

  if (q.includes("eau chaude") || q.includes("hot water")) {
    if (fullText.includes("eau chaude")) {
      return `Oui, ${refLabel} inclut l'eau chaude.`;
    }
    return "Cette information n'est pas indiquée dans la fiche.";
  }

  if (q.includes("chauffage")) {
    if (fullText.includes("chauffage")) {
      return `Oui, ${refLabel} inclut le chauffage.`;
    }
    return "Cette information n'est pas indiquée dans la fiche.";
  }

  if (
    q.includes("animal") ||
    q.includes("chien") ||
    q.includes("chat")
  ) {
    if (listing.animaux_acceptes) {
      return `Pour ${refLabel}, animaux acceptés : ${listing.animaux_acceptes}.`;
    }
    return "Cette information n'est pas indiquée dans la fiche.";
  }

  if (
    q.includes("stationnement") ||
    q.includes("parking") ||
    q.includes("garage")
  ) {
    if (listing.stationnement) {
      return `Pour ${refLabel}, stationnement : ${listing.stationnement}.`;
    }
    return "Cette information n'est pas indiquée dans la fiche.";
  }

  if (
    q.includes("disponib") ||
    q.includes("date") ||
    q.includes("quand")
  ) {
    if (listing.disponibilite) {
      return `Pour ${refLabel}, disponibilité : ${listing.disponibilite}.`;
    }
    return "Cette information n'est pas indiquée dans la fiche.";
  }

  if (
    q.includes("prix") ||
    q.includes("loyer") ||
    q.includes("combien")
  ) {
    if (listing.loyer !== null && listing.loyer !== undefined && listing.loyer !== "") {
      return `Le loyer de ${refLabel} est de ${listing.loyer} $.`;
    }
    return "Cette information n'est pas indiquée dans la fiche.";
  }

  if (
    q.includes("superficie") ||
    q.includes("pi2") ||
    q.includes("sqft") ||
    q.includes("grandeur")
  ) {
    if (listing.superficie) {
      return `La superficie de ${refLabel} est de ${listing.superficie}.`;
    }
    return "Cette information n'est pas indiquée dans la fiche.";
  }

  if (
    q.includes("chambre") ||
    q.includes("combien de chambre")
  ) {
    if (listing.chambres !== null && listing.chambres !== undefined && listing.chambres !== "") {
      return `${refLabel} a ${listing.chambres} chambre${Number(listing.chambres) > 1 ? "s" : ""}.`;
    }
    return "Cette information n'est pas indiquée dans la fiche.";
  }

  return null;
}

/* =========================
   HEALTH + LISTINGS
========================= */

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
      if (listing?.ref !== null && listing?.ref !== undefined) {
        map[String(listing.ref)] = {
          ...listing,
          ref: String(listing.ref)
        };
      }
    }

    res.json({ listings: map });
  } catch (error) {
    console.error("Erreur /api/listings :", error);
    res.status(500).json({ error: "Erreur chargement appartements." });
  }
});

/* =========================
   CHAT HISTORY + ACTIVITY
========================= */

app.post("/api/chat-sessions", async (req, res) => {
  try {
    const { user_id, page_path } = req.body || {};

    if (!user_id) {
      return res.status(400).json({ error: "user_id manquant." });
    }

    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({
        user_id,
        page_path: page_path || "/",
        last_seen_at: new Date().toISOString()
      })
      .select("id, user_id, started_at, last_seen_at")
      .single();

    if (error) throw error;

    return res.json({ ok: true, session: data });
  } catch (error) {
    console.error("Erreur /api/chat-sessions :", error);
    return res.status(500).json({
      error: "Erreur création session.",
      details: error.message || String(error)
    });
  }
});

app.patch("/api/chat-sessions/:id/heartbeat", async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body || {};

    if (!id || !user_id) {
      return res.status(400).json({ error: "id ou user_id manquant." });
    }

    const { data, error } = await supabase
      .from("chat_sessions")
      .update({
        last_seen_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("user_id", user_id)
      .select("id, last_seen_at")
      .single();

    if (error) throw error;

    return res.json({ ok: true, session: data });
  } catch (error) {
    console.error("Erreur /api/chat-sessions/:id/heartbeat :", error);
    return res.status(500).json({
      error: "Erreur heartbeat session.",
      details: error.message || String(error)
    });
  }
});

app.patch("/api/chat-sessions/:id/end", async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body || {};
    const now = new Date().toISOString();

    if (!id || !user_id) {
      return res.status(400).json({ error: "id ou user_id manquant." });
    }

    const { data, error } = await supabase
      .from("chat_sessions")
      .update({
        ended_at: now,
        last_seen_at: now
      })
      .eq("id", id)
      .eq("user_id", user_id)
      .select("id, ended_at, last_seen_at")
      .single();

    if (error) throw error;

    return res.json({ ok: true, session: data });
  } catch (error) {
    console.error("Erreur /api/chat-sessions/:id/end :", error);
    return res.status(500).json({
      error: "Erreur fermeture session.",
      details: error.message || String(error)
    });
  }
});

app.post("/api/activity-log", async (req, res) => {
  try {
    const { user_id, session_id, event_type, page_path } = req.body || {};

    if (!user_id || !event_type) {
      return res.status(400).json({ error: "user_id ou event_type manquant." });
    }

    const { data, error } = await supabase
      .from("user_activity_logs")
      .insert({
        user_id,
        session_id: session_id || null,
        event_type,
        page_path: page_path || "/"
      })
      .select("id, event_type, created_at")
      .single();

    if (error) throw error;

    return res.json({ ok: true, activity: data });
  } catch (error) {
    console.error("Erreur /api/activity-log :", error);
    return res.status(500).json({
      error: "Erreur activity log.",
      details: error.message || String(error)
    });
  }
});

app.post("/api/chat-messages", async (req, res) => {
  try {
    const { session_id, user_id, mode, sender, label, text } = req.body || {};

    if (!session_id || !user_id || !mode || !sender || !text) {
      return res.status(400).json({
        error: "session_id, user_id, mode, sender ou text manquant."
      });
    }

    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        session_id,
        user_id,
        mode,
        sender,
        label: label || null,
        text
      })
      .select("id, created_at")
      .single();

    if (error) throw error;

    return res.json({ ok: true, message: data });
  } catch (error) {
    console.error("Erreur /api/chat-messages :", error);
    return res.status(500).json({
      error: "Erreur sauvegarde message.",
      details: error.message || String(error)
    });
  }
});

app.get("/api/chat-messages", async (req, res) => {
  try {
    const { user_id, session_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: "user_id manquant." });
    }

    let query = supabase
      .from("chat_messages")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: true });

    if (session_id) {
      query = query.eq("session_id", session_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.json({ ok: true, messages: data || [] });
  } catch (error) {
    console.error("Erreur /api/chat-messages GET :", error);
    return res.status(500).json({
      error: "Erreur lecture messages.",
      details: error.message || String(error)
    });
  }
});

app.get("/api/user-time-summary", async (req, res) => {
  try {
    const { user_id } = req.query;

    let query = supabase
      .from("user_time_summary")
      .select("*");

    if (user_id) {
      query = query.eq("user_id", user_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.json({ ok: true, summary: data || [] });
  } catch (error) {
    console.error("Erreur /api/user-time-summary :", error);
    return res.status(500).json({
      error: "Erreur lecture résumé temps.",
      details: error.message || String(error)
    });
  }
});

/* =========================
   CHAT AI
========================= */

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

    const directAnswer = quickFieldAnswer(listing, message);

    if (directAnswer) {
      return res.json({
        reply: directAnswer,
        label: "Assistant des immeubles",
        variant: "success",
        reference: String(ref)
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
      reference: String(ref)
    });
  } catch (error) {
    console.error("Erreur /api/chat :", error);
    return res.status(500).json({
      error: "Server error",
      details: error.message || String(error)
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
