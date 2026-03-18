import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

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

let mailer = null;

try {
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    mailer = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });
    console.log("Mailer prêt");
  } else {
    console.log("Mailer non configuré");
  }
} catch (error) {
  console.error("Erreur initialisation mailer :", error);
}

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
  - meublé / meuble
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

async function sendCandidateNotificationEmail(candidate) {
  if (!mailer || !process.env.EMAIL_NOTIFY_TO) {
    console.warn("Email notification non configurée.");
    return;
  }

  const subject = `Nouveau locataire potentiel — L-${candidate.apartment_ref}`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <h2>Nouveau locataire potentiel</h2>
      <p><strong>Appartement :</strong> L-${candidate.apartment_ref || "-"}</p>
      <p><strong>Nom :</strong> ${candidate.candidate_name || "-"}</p>
      <p><strong>Téléphone :</strong> ${candidate.phone || "-"}</p>
      <p><strong>Email :</strong> ${candidate.email || "-"}</p>
      <p><strong>Emploi :</strong> ${candidate.job_title || "-"}</p>
      <p><strong>Employeur :</strong> ${candidate.employer_name || "-"}</p>
      <p><strong>Depuis combien de temps :</strong> ${candidate.employment_length || "-"}</p>
      <p><strong>Statut emploi :</strong> ${candidate.employment_status || "-"}</p>
      <p><strong>Revenu mensuel :</strong> ${candidate.monthly_income || "-"}</p>
      <p><strong>Crédit :</strong> ${candidate.credit_level || "-"}</p>
      <p><strong>Dossier TAL :</strong> ${candidate.tal_record || "-"}</p>
      <p><strong>Nombre de personnes :</strong> ${candidate.occupants_total || "-"}</p>
      <p><strong>Animaux :</strong> ${candidate.pets || "-"}</p>
      <p><strong>Notes employé :</strong> ${candidate.employee_notes || "-"}</p>
      <hr />
      <p><a href="https://fluxlocatif.up.railway.app/admin.html">Ouvrir l’admin FluxLocatif</a></p>
    </div>
  `;

  const text = `
Nouveau locataire potentiel

Appartement : L-${candidate.apartment_ref || "-"}
Nom : ${candidate.candidate_name || "-"}
Téléphone : ${candidate.phone || "-"}
Email : ${candidate.email || "-"}
Emploi : ${candidate.job_title || "-"}
Employeur : ${candidate.employer_name || "-"}
Depuis combien de temps : ${candidate.employment_length || "-"}
Statut emploi : ${candidate.employment_status || "-"}
Revenu mensuel : ${candidate.monthly_income || "-"}
Crédit : ${candidate.credit_level || "-"}
Dossier TAL : ${candidate.tal_record || "-"}
Nombre de personnes : ${candidate.occupants_total || "-"}
Animaux : ${candidate.pets || "-"}
Notes employé : ${candidate.employee_notes || "-"}

Admin :
https://fluxlocatif.up.railway.app/admin.html
  `;

  await mailer.sendMail({
    from: `"FluxLocatif" <${process.env.GMAIL_USER}>`,
    to: process.env.EMAIL_NOTIFY_TO,
    subject,
    text,
    html
  });
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
  const meubleText = normalizeText(listing.meuble || "");

  const fullText = [
    inclusionsText,
    electriciteText,
    notesText,
    stationnementText,
    animauxText,
    meubleText,
    normalizeText(listing.disponibilite || ""),
    normalizeText(listing.statut || "")
  ].join(" ");

  if (
    q.includes("meubl") ||
    q.includes("meuble")
  ) {
    if (listing.meuble) {
      const answer = normalizeText(listing.meuble);
      if (answer === "oui") return `Oui, ${refLabel} est meublé.`;
      if (answer === "non") return `Non, ${refLabel} n'est pas meublé.`;
      return `Pour ${refLabel}, meublé : ${listing.meuble}.`;
    }
    return "Cette information n'est pas indiquée dans la fiche.";
  }

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

  if (q.includes("animal") || q.includes("chien") || q.includes("chat")) {
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

  if (q.includes("disponib") || q.includes("date") || q.includes("quand")) {
    if (listing.disponibilite) {
      return `Pour ${refLabel}, disponibilité : ${listing.disponibilite}.`;
    }
    return "Cette information n'est pas indiquée dans la fiche.";
  }

  if (q.includes("prix") || q.includes("loyer") || q.includes("combien")) {
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

  if (q.includes("chambre") || q.includes("combien de chambre")) {
    if (listing.chambres !== null && listing.chambres !== undefined && listing.chambres !== "") {
      return `${refLabel} a ${listing.chambres} chambre${Number(listing.chambres) > 1 ? "s" : ""}.`;
    }
    return "Cette information n'est pas indiquée dans la fiche.";
  }

  return null;
}

/* =========================
   API ROUTES
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

app.get("/api/admin/user-daily-time", async (req, res) => {
  try {
    const { day, user_id } = req.query;

    let query = supabase
      .from("user_daily_time_from_heartbeat_named")
      .select("*")
      .order("day", { ascending: false });

    if (day) {
      query = query.eq("day", day);
    }

    if (user_id) {
      query = query.eq("user_id", user_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ summary: data || [] });
  } catch (error) {
    console.error("Erreur /api/admin/user-daily-time :", error);
    res.status(500).json({
      error: "Erreur chargement temps heartbeat.",
      details: error.message || String(error)
    });
  }
});

app.get("/api/admin/chat-sessions", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("*")
      .order("started_at", { ascending: false });

    if (error) throw error;

    res.json({ sessions: data || [] });
  } catch (error) {
    console.error("Erreur /api/admin/chat-sessions :", error);
    res.status(500).json({ error: "Erreur chargement sessions." });
  }
});

app.get("/api/admin/chat-messages", async (req, res) => {
  try {
    const { user_id } = req.query;

    let query = supabase
      .from("chat_messages")
      .select("*")
      .order("created_at", { ascending: false });

    if (user_id) {
      query = query.eq("user_id", user_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ messages: data || [] });
  } catch (error) {
    console.error("Erreur /api/admin/chat-messages :", error);
    res.status(500).json({ error: "Erreur chargement messages." });
  }
});

app.post("/api/admin/apartments", async (req, res) => {
  try {
    const {
      adresse,
      ville,
      type_logement,
      chambres,
      superficie,
      loyer,
      inclusions,
      statut,
      stationnement,
      animaux_acceptes,
      meuble,
      disponibilite,
      notes,
      electricite
    } = req.body || {};

    if (!adresse || !ville) {
      return res.status(400).json({
        error: "adresse et ville sont requis."
      });
    }

    const { data: existing, error: existingError } = await supabase
      .from("apartments")
      .select("ref")
      .order("ref", { ascending: false })
      .limit(1);

    if (existingError) throw existingError;

    const lastRef = existing?.[0]?.ref ? Number(existing[0].ref) : 1000;
    const nextRef = lastRef + 1;

    const payload = {
      ref: nextRef,
      adresse,
      ville,
      type_logement: type_logement || null,
      chambres:
        chambres !== "" && chambres !== null && chambres !== undefined
          ? Number(chambres)
          : null,
      superficie: superficie || null,
      loyer:
        loyer !== "" && loyer !== null && loyer !== undefined
          ? Number(loyer)
          : null,
      inclusions: inclusions || null,
      statut: statut || null,
      stationnement: stationnement || null,
      animaux_acceptes: animaux_acceptes || null,
      meuble: meuble || null,
      disponibilite: disponibilite || null,
      notes: notes || null,
      electricite: electricite || null
    };

    const { data, error } = await supabase
      .from("apartments")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    res.json({
      ok: true,
      apartment: data,
      generated_ref: `L-${nextRef}`
    });
  } catch (error) {
    console.error("Erreur /api/admin/apartments POST :", error);
    res.status(500).json({
      error: "Erreur création appartement.",
      details: error.message || String(error)
    });
  }
});

app.put("/api/admin/apartments/:ref", async (req, res) => {
  try {
    const { ref } = req.params;
    const numericRef = Number(String(ref).replace(/^L-/i, "").trim());

    if (!numericRef) {
      return res.status(400).json({ error: "Référence invalide." });
    }

    const updates = { ...req.body };

    if ("ref" in updates) delete updates.ref;

    if ("chambres" in updates) {
      updates.chambres =
        updates.chambres !== "" && updates.chambres !== null && updates.chambres !== undefined
          ? Number(updates.chambres)
          : null;
    }

    if ("loyer" in updates) {
      updates.loyer =
        updates.loyer !== "" && updates.loyer !== null && updates.loyer !== undefined
          ? Number(updates.loyer)
          : null;
    }

    const { data, error } = await supabase
      .from("apartments")
      .update(updates)
      .eq("ref", numericRef)
      .select("*")
      .single();

    if (error) throw error;

    res.json({ ok: true, apartment: data });
  } catch (error) {
    console.error("Erreur /api/admin/apartments PUT :", error);
    res.status(500).json({
      error: "Erreur modification appartement.",
      details: error.message || String(error)
    });
  }
});

app.delete("/api/admin/apartments/:ref", async (req, res) => {
  try {
    const { ref } = req.params;
    const numericRef = Number(String(ref).replace(/^L-/i, "").trim());

    if (!numericRef) {
      return res.status(400).json({ error: "Référence invalide." });
    }

    const { error } = await supabase
      .from("apartments")
      .delete()
      .eq("ref", numericRef);

    if (error) throw error;

    res.json({ ok: true });
  } catch (error) {
    console.error("Erreur /api/admin/apartments DELETE :", error);
    res.status(500).json({
      error: "Erreur suppression appartement.",
      details: error.message || String(error)
    });
  }
});

app.post("/api/admin/candidates", async (req, res) => {
  try {
    const payload = { ...req.body };

    if (!payload.apartment_ref) {
      return res.status(400).json({ error: "apartment_ref manquant." });
    }

    payload.apartment_ref = Number(payload.apartment_ref);

    payload.monthly_income =
      payload.monthly_income !== "" && payload.monthly_income !== null && payload.monthly_income !== undefined
        ? Number(payload.monthly_income)
        : null;

    payload.occupants_total =
      payload.occupants_total !== "" && payload.occupants_total !== null && payload.occupants_total !== undefined
        ? Number(payload.occupants_total)
        : null;

    const { data, error } = await supabase
      .from("rental_applications")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    try {
      await sendCandidateNotificationEmail(data);
    } catch (mailError) {
      console.error("Erreur envoi email candidat :", mailError);
    }

    res.json({ ok: true, candidate: data });
  } catch (err) {
    console.error("Erreur création candidat :", err);
    res.status(500).json({ error: "Erreur création candidat" });
  }
});

app.get("/api/admin/candidates", async (req, res) => {
  try {
    const { status } = req.query;

    let query = supabase
      .from("rental_applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ candidates: data || [] });
  } catch (err) {
    console.error("Erreur candidats :", err);
    res.status(500).json({ error: "Erreur candidats" });
  }
});

app.put("/api/admin/candidates/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("rental_applications")
      .update(req.body)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    res.json({ ok: true, candidate: data });
  } catch (err) {
    console.error("Erreur update candidat :", err);
    res.status(500).json({ error: "Erreur update candidat" });
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

/* =========================
   FRONTEND ROUTES
========================= */

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// fallback SEULEMENT pour les routes non-api
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
