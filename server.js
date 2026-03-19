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

const DATA_DIR = path.join(__dirname, ".data");
const LISTINGS_PATH = path.join(__dirname, "listings.json");
const CANDIDATES_PATH = path.join(DATA_DIR, "candidates.json");
const CHAT_MESSAGES_PATH = path.join(DATA_DIR, "chat-messages.json");
const CHAT_SESSIONS_PATH = path.join(DATA_DIR, "chat-sessions.json");
const USER_DAILY_TIME_PATH = path.join(DATA_DIR, "user-daily-time.json");

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

async function ensureDataFile(filePath, fallbackValue) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallbackValue, null, 2));
  }
}

async function readJsonFile(filePath, fallbackValue) {
  await ensureDataFile(filePath, fallbackValue);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

function normalizeRef(ref) {
  return String(ref || "").trim().replace(/^L-/i, "");
}

function toListingRecord(key, value) {
  const ref = normalizeRef(value?.ref || key);
  const rentValue = value?.loyer ?? value?.rent ?? "";
  const bedroomsValue = value?.chambres ?? value?.bedrooms ?? "";
  const availabilityValue = value?.disponibilite ?? value?.availability ?? "";
  const statusValue = value?.statut ?? value?.status ?? "";
  const paidParkingPriceValue = value?.prix_stationnement_payant ?? null;
  const accesTerrainValue = value?.acces_au_terrain ?? value?.acces_terrain ?? "";
  const freeParkingValue = value?.nombre_stationnements_gratuits ?? value?.stationnements_gratuits ?? null;
  const paidParkingValue = value?.nombre_stationnements_payants ?? value?.stationnements_payants ?? null;
  const buildingUnitsValue = value?.nombre_logements_batisse ?? value?.nombre_logements_batiment ?? null;

  return {
    ...value,
    ref,
    adresse: value?.adresse ?? value?.address ?? "",
    ville: value?.ville ?? value?.city ?? "",
    type_logement: value?.type_logement ?? "",
    chambres: bedroomsValue,
    superficie: value?.superficie ?? "",
    loyer: rentValue,
    inclusions: value?.inclusions ?? "",
    statut: statusValue,
    stationnement: value?.stationnement ?? "",
    animaux_acceptes: value?.animaux_acceptes ?? "",
    meuble: value?.meuble ?? "",
    disponibilite: availabilityValue,
    notes: value?.notes ?? "",
    electricite: value?.electricite ?? "",
    balcon: value?.balcon ?? "",
    wifi: value?.wifi ?? "",
    acces_au_terrain: accesTerrainValue,
    nombre_stationnements_gratuits: freeParkingValue,
    nombre_stationnements_payants: paidParkingValue,
    prix_stationnement_payant: paidParkingPriceValue,
    electros_inclus: value?.electros_inclus ?? "",
    laveuse_secheuse: value?.laveuse_secheuse ?? "",
    nombre_logements_batisse: buildingUnitsValue,
    rangement: value?.rangement ?? "",
    address: value?.address ?? value?.adresse ?? "",
    city: value?.city ?? value?.ville ?? "",
    rent: rentValue,
    bedrooms: bedroomsValue,
    availability: availabilityValue,
    status: statusValue,
    description: value?.description ?? ""
  };
}

async function loadListingsMap() {
  const raw = await readJsonFile(LISTINGS_PATH, {});
  const normalized = {};

  Object.entries(raw).forEach(([key, value]) => {
    const record = toListingRecord(key, value);
    normalized[record.ref] = record;
  });

  return normalized;
}

async function saveListingsMap(listingsMap) {
  const output = {};

  Object.values(listingsMap)
    .sort((a, b) => Number(a.ref) - Number(b.ref))
    .forEach((listing) => {
      output[`L-${listing.ref}`] = {
        ref: `L-${listing.ref}`,
        address: listing.address || listing.adresse || "",
        city: listing.city || listing.ville || "",
        rent: listing.rent || listing.loyer || "",
        bedrooms: listing.bedrooms || listing.chambres || "",
        availability: listing.availability || listing.disponibilite || "",
        status: listing.status || listing.statut || "",
        notes: listing.notes || "",
        description: listing.description || "",
        adresse: listing.adresse || listing.address || "",
        ville: listing.ville || listing.city || "",
        type_logement: listing.type_logement || "",
        chambres: listing.chambres || listing.bedrooms || "",
        superficie: listing.superficie || "",
        loyer: listing.loyer || listing.rent || "",
        inclusions: listing.inclusions || "",
        statut: listing.statut || listing.status || "",
        stationnement: listing.stationnement || "",
        animaux_acceptes: listing.animaux_acceptes || "",
        meuble: listing.meuble || "",
        disponibilite: listing.disponibilite || listing.availability || "",
        electricite: listing.electricite || "",
        balcon: listing.balcon || "",
        wifi: listing.wifi || "",
        acces_au_terrain: listing.acces_au_terrain || "",
        nombre_stationnements_gratuits: listing.nombre_stationnements_gratuits ?? null,
        nombre_stationnements_payants: listing.nombre_stationnements_payants ?? null,
        prix_stationnement_payant: listing.prix_stationnement_payant ?? null,
        electros_inclus: listing.electros_inclus || "",
        laveuse_secheuse: listing.laveuse_secheuse || "",
        nombre_logements_batisse: listing.nombre_logements_batisse ?? null,
        rangement: listing.rangement || ""
      };
    });

  await writeJsonFile(LISTINGS_PATH, output);
}

function nextListingRef(listingsMap) {
  const refs = Object.keys(listingsMap).map((ref) => Number(ref)).filter(Number.isFinite);
  const nextRef = refs.length ? Math.max(...refs) + 1 : 1001;
  return String(nextRef);
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getTodayString(date = new Date()) {
  return date.toISOString().split("T")[0];
}

async function appendChatMessage(message) {
  const messages = await readJsonFile(CHAT_MESSAGES_PATH, []);
  messages.push(message);
  await writeJsonFile(CHAT_MESSAGES_PATH, messages);
}

async function upsertChatSession(userId) {
  const sessions = await readJsonFile(CHAT_SESSIONS_PATH, []);
  const now = new Date().toISOString();
  let session = sessions.find((item) => item.user_id === userId && !item.ended_at);

  if (!session) {
    session = {
      id: createId("session"),
      user_id: userId,
      started_at: now,
      ended_at: null,
      last_seen_at: now
    };
    sessions.push(session);
  } else {
    session.last_seen_at = now;
  }

  await writeJsonFile(CHAT_SESSIONS_PATH, sessions);
  return session;
}

async function recordUserDailyTime(userId) {
  const summary = await readJsonFile(USER_DAILY_TIME_PATH, []);
  const day = getTodayString();
  let row = summary.find((item) => item.user_id === userId && item.day === day);

  if (!row) {
    row = {
      user_id: userId,
      full_name: userId === "employee-manuel" ? "Employé manuel" : userId,
      day,
      heartbeat_count: 0,
      total_seconds: 0
    };
    summary.push(row);
  }

  row.heartbeat_count += 1;
  row.total_seconds += 60;

  await writeJsonFile(USER_DAILY_TIME_PATH, summary);
}

function extractListingReference(message) {
  const match = String(message || "").match(/\bL-(\d+)\b/i);
  return match ? match[1] : "";
}

function buildTranslatorFallbackReply(message) {
  const text = String(message || "").trim().toLowerCase();

  if (
    text.includes("dispo") ||
    text.includes("disponible") ||
    text.includes("available") ||
    text.includes("vacant")
  ) {
    return [
      "Bonjour,",
      "",
      "Oui, le logement est toujours disponible.",
      "",
      "Souhaitez-vous planifier une visite ou obtenir plus d'informations ?",
      "",
      "Cordialement,"
    ].join("\n");
  }

  if (text.includes("lease") && text.includes("tomorrow")) {
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

function buildTranslatorFallbackTranslation(message) {
  const text = String(message || "").trim().toLowerCase();

  if (!text) {
    return "Le locataire souhaite obtenir des informations sur le logement.";
  }

  if (
    text.includes("dispo") ||
    text.includes("disponible") ||
    text.includes("available") ||
    text.includes("vacant")
  ) {
    return "Est-ce que le logement est disponible ?";
  }

  if (text.includes("prix") || text.includes("loyer") || text.includes("rent")) {
    return "Quel est le loyer demandé pour ce logement ?";
  }

  if (
    text.includes("visit") ||
    text.includes("visite") ||
    text.includes("see it") ||
    text.includes("tour")
  ) {
    return "Est-ce qu'il serait possible de planifier une visite du logement ?";
  }

  if (
    text.includes("when") ||
    text.includes("quand") ||
    text.includes("move") ||
    text.includes("availability")
  ) {
    return "À partir de quelle date le logement est-il disponible ?";
  }

  return "Le locataire souhaite obtenir plus d'informations au sujet du logement.";
}

function buildTranslatorFallbackPayload(message) {
  return {
    translation: buildTranslatorFallbackTranslation(message),
    reply: buildTranslatorFallbackReply(message)
  };
}

async function generateTranslatorPayload(message) {
  if (!openai) {
    return buildTranslatorFallbackPayload(message);
  }

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Tu es un assistant locatif. Tu dois toujours supposer que le message vient d'un locataire qui parle d'un appartement. Interprete l'intention dans un contexte immobilier. Ne traduis jamais mot a mot. Retourne uniquement un objet JSON avec deux champs string: translation et reply. translation: reformulation en francais international, claire, neutre et bien ecrite. reply: reponse suggeree en francais canadien, professionnelle, naturelle et prete a envoyer par un proprietaire ou un employe de location. Ne pose pas de question de clarification sauf si le message est vraiment incomprehensible."
      },
      {
        role: "user",
        content: `Message a traiter :\n${message}`
      }
    ]
  });

  const content = response.choices?.[0]?.message?.content?.trim();

  if (!content) {
    return buildTranslatorFallbackPayload(message);
  }

  try {
    const parsed = JSON.parse(content);

    if (
      typeof parsed?.translation === "string" &&
      parsed.translation.trim() &&
      typeof parsed?.reply === "string" &&
      parsed.reply.trim()
    ) {
      return {
        translation: parsed.translation.trim(),
        reply: parsed.reply.trim()
      };
    }
  } catch {
    return buildTranslatorFallbackPayload(message);
  }

  return buildTranslatorFallbackPayload(message);
}

async function generateListingReply(message, listing) {
  if (!openai) {
    return [
      `Voici les informations disponibles pour L-${listing.ref}.`,
      "",
      listing.adresse ? `Adresse : ${listing.adresse}` : "",
      listing.ville ? `Ville : ${listing.ville}` : "",
      listing.type_logement ? `Type : ${listing.type_logement}` : "",
      listing.chambres ? `Chambres : ${listing.chambres}` : "",
      listing.superficie ? `Superficie : ${listing.superficie}` : "",
      listing.loyer ? `Loyer : ${listing.loyer}` : "",
      listing.disponibilite ? `Disponibilité : ${listing.disponibilite}` : "",
      listing.statut ? `Statut : ${listing.statut}` : "",
      listing.notes ? `Notes : ${listing.notes}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "Tu es un assistant interne pour une equipe de location. Reponds seulement avec les informations fournies sur l'appartement. Si l'information manque, dis-le clairement sans inventer."
      },
      {
        role: "user",
        content: `Appartement : ${JSON.stringify(listing, null, 2)}\n\nQuestion : ${message}`
      }
    ]
  });

  return response.choices?.[0]?.message?.content?.trim() || "Aucune réponse disponible.";
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/listings", async (_req, res) => {
  try {
    const listings = await loadListingsMap();
    res.json({ ok: true, listings });
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
  const userId = String(req.body?.user_id || "employee-manuel");

  if (!mode || !message) {
    return res.status(400).json({
      ok: false,
      error: "Le mode et le message sont obligatoires."
    });
  }

  try {
    await upsertChatSession(userId);
    await recordUserDailyTime(userId);
    await appendChatMessage({
      id: createId("msg"),
      user_id: userId,
      mode,
      sender: "user",
      text: message,
      created_at: new Date().toISOString()
    });

    if (mode === "translator") {
      const translatorPayload = await generateTranslatorPayload(message);
      const assistantText = [
        `Français international : ${translatorPayload.translation}`,
        `Réponse suggérée : ${translatorPayload.reply}`
      ].join("\n\n");

      await appendChatMessage({
        id: createId("msg"),
        user_id: userId,
        mode,
        sender: "assistant",
        text: assistantText,
        created_at: new Date().toISOString()
      });

      return res.json({
        ok: true,
        label: "Traducteur",
        variant: "success",
        translation: translatorPayload.translation,
        reply: translatorPayload.reply
      });
    }

    if (mode === "listing") {
      const listings = await loadListingsMap();
      const reference = extractListingReference(message);
      const listing = listings[reference];

      if (!reference || !listing) {
        return res.status(400).json({
          ok: false,
          error: "Référence d'appartement introuvable dans le message."
        });
      }

      const reply = await generateListingReply(message, listing);

      await appendChatMessage({
        id: createId("msg"),
        user_id: userId,
        mode,
        sender: "assistant",
        text: reply,
        created_at: new Date().toISOString()
      });

      return res.json({
        ok: true,
        label: "Assistant des immeubles",
        variant: "success",
        reference,
        reply
      });
    }

    return res.status(400).json({
      ok: false,
      error: "Mode non pris en charge."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Impossible de traiter la demande."
    });
  }
});

app.get("/api/admin/user-daily-time", async (req, res) => {
  try {
    const requestedDay = String(req.query.day || "").trim();
    const summary = await readJsonFile(USER_DAILY_TIME_PATH, []);
    const filtered = requestedDay
      ? summary.filter((row) => row.day === requestedDay)
      : summary;

    res.json({ ok: true, summary: filtered });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Impossible de charger le temps utilisateur."
    });
  }
});

app.get("/api/admin/chat-sessions", async (_req, res) => {
  try {
    const sessions = await readJsonFile(CHAT_SESSIONS_PATH, []);
    res.json({ ok: true, sessions });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Impossible de charger les sessions."
    });
  }
});

app.get("/api/admin/chat-messages", async (req, res) => {
  try {
    const userId = String(req.query.user_id || "").trim();
    const messages = await readJsonFile(CHAT_MESSAGES_PATH, []);
    const filtered = userId
      ? messages.filter((message) => message.user_id === userId)
      : messages;

    res.json({ ok: true, messages: filtered });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Impossible de charger les messages."
    });
  }
});

app.get("/api/admin/apartments", async (_req, res) => {
  try {
    const listings = await loadListingsMap();
    res.json({ ok: true, apartments: Object.values(listings) });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Impossible de charger les appartements."
    });
  }
});

app.post("/api/admin/apartments", async (req, res) => {
  try {
    const listings = await loadListingsMap();
    const ref = nextListingRef(listings);
    const payload = req.body || {};

    listings[ref] = toListingRecord(`L-${ref}`, {
      ref: `L-${ref}`,
      ...payload
    });

    await saveListingsMap(listings);

    res.status(201).json({
      ok: true,
      generated_ref: `L-${ref}`,
      apartment: listings[ref]
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Impossible de créer l'appartement."
    });
  }
});

app.put("/api/admin/apartments/:ref", async (req, res) => {
  try {
    const ref = normalizeRef(req.params.ref);
    const listings = await loadListingsMap();

    if (!listings[ref]) {
      return res.status(404).json({
        ok: false,
        error: "Appartement introuvable."
      });
    }

    listings[ref] = toListingRecord(`L-${ref}`, {
      ...listings[ref],
      ...req.body,
      ref: `L-${ref}`
    });

    await saveListingsMap(listings);

    return res.json({
      ok: true,
      apartment: listings[ref]
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Impossible de modifier l'appartement."
    });
  }
});

app.delete("/api/admin/apartments/:ref", async (req, res) => {
  try {
    const ref = normalizeRef(req.params.ref);
    const listings = await loadListingsMap();

    if (!listings[ref]) {
      return res.status(404).json({
        ok: false,
        error: "Appartement introuvable."
      });
    }

    delete listings[ref];
    await saveListingsMap(listings);

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Impossible de supprimer l'appartement."
    });
  }
});

app.get("/api/admin/candidates", async (req, res) => {
  try {
    const requestedStatus = String(req.query.status || "").trim();
    const candidates = await readJsonFile(CANDIDATES_PATH, []);
    const filtered = requestedStatus
      ? candidates.filter((candidate) => candidate.status === requestedStatus)
      : candidates;

    res.json({ ok: true, candidates: filtered });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Impossible de charger les candidats."
    });
  }
});

app.post("/api/admin/candidates", async (req, res) => {
  try {
    const candidates = await readJsonFile(CANDIDATES_PATH, []);
    const candidate = {
      id: createId("candidate"),
      created_at: new Date().toISOString(),
      admin_notes: "",
      ...req.body
    };

    candidates.push(candidate);
    await writeJsonFile(CANDIDATES_PATH, candidates);

    res.status(201).json({
      ok: true,
      candidate
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Impossible de créer le candidat."
    });
  }
});

app.put("/api/admin/candidates/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const candidates = await readJsonFile(CANDIDATES_PATH, []);
    const candidate = candidates.find((item) => String(item.id) === id);

    if (!candidate) {
      return res.status(404).json({
        ok: false,
        error: "Candidat introuvable."
      });
    }

    Object.assign(candidate, req.body || {}, {
      updated_at: new Date().toISOString()
    });

    await writeJsonFile(CANDIDATES_PATH, candidates);

    return res.json({
      ok: true,
      candidate
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Impossible de modifier le candidat."
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
