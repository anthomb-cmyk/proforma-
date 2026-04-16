import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

import cors from "cors";
import compression from "compression";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import OpenAI, { toFile } from "openai";
import { Resend } from "resend";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createChatRouter } from "./routes/chat.js";
import { createListingsRouter } from "./routes/listings.js";
import { createOpenAIService } from "./services/openaiService.js";
import { createListingsService } from "./services/listingsService.js";
import { createQualificationService } from "./services/qualificationService.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://nuuzkvgyolxbawvqyugu.supabase.co";
const PUBLIC_APP_URL = String(process.env.PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVER_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_103-rw3MwM7k2xUeMMUodg_fRr9vUD4";
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const INVITATION_FROM_EMAIL = String(process.env.INVITATION_FROM_EMAIL || process.env.FROM_EMAIL || "").trim();
const ADMIN_NOTIFICATION_EMAIL = String(process.env.ADMIN_NOTIFICATION_EMAIL || "").trim();
const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
const TWILIO_PHONE_NUMBER = String(process.env.TWILIO_PHONE_NUMBER || "").trim();
const TWILIO_FORWARD_TO = String(process.env.TWILIO_FORWARD_TO || "").trim();
const TWILIO_RECORD_CALLS = String(process.env.TWILIO_RECORD_CALLS || "true").trim().toLowerCase() !== "false";
const OPENAI_TRANSCRIPTION_MODEL = String(process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1").trim();

const DATA_DIR = path.join(__dirname, ".data");
const LISTINGS_PATH = path.join(__dirname, "listings.json");
const LOCATIONS_PATH = path.join(__dirname, "locations-quebec.json");
const CLIENTS_PATH = path.join(__dirname, "clients.json");
const CLIENT_INVITATIONS_PATH = path.join(DATA_DIR, "client_invitations.json");
const LEGACY_CLIENT_INVITATIONS_PATH = path.join(DATA_DIR, "client-invitations.json");
const CANDIDATES_PATH = path.join(DATA_DIR, "candidates.json");
const CHAT_MESSAGES_PATH = path.join(DATA_DIR, "chat-messages.json");
const TRANSLATOR_THREAD_STATE_PATH = path.join(DATA_DIR, "translator-thread-state.json");
const TRANSLATOR_REPORTS_PATH = path.join(DATA_DIR, "translator-reports.json");
const CHAT_SESSIONS_PATH = path.join(DATA_DIR, "chat-sessions.json");
const USER_DAILY_TIME_PATH = path.join(DATA_DIR, "user-daily-time.json");
const WORKSPACE_MESSAGES_PATH = path.join(DATA_DIR, "workspace-messages.json");
const LISTING_TASKS_PATH = path.join(DATA_DIR, "listing-tasks.json");
const NOTIFICATIONS_PATH = path.join(DATA_DIR, "notifications.json");
const CALL_LOGS_PATH = path.join(DATA_DIR, "call-logs.json");
const PROFORMA_WEB_BUILD_DIR = path.join(__dirname, "proforma-web", "build");
const PROFORMA_WEB_BUILD_INDEX = path.join(PROFORMA_WEB_BUILD_DIR, "index.html");
const HAS_PROFORMA_WEB_BUILD = existsSync(PROFORMA_WEB_BUILD_INDEX);

const TRANSLATOR_STEP_ORDER = [
  "move_in_date",
  "occupants_total",
  "has_animals",
  "animal_type",
  "employment_status",
  "employer",
  "employment_duration",
  "income",
  "credit",
  "tal",
  "full_name",
  "phone",
  "email"
];

const TRANSLATOR_QUESTION_TYPES = [
  "availability",
  "price",
  "electricity",
  "heating",
  "inclusions",
  "appliances",
  "pets",
  "parking",
  "location",
  "deposit",
  "visit",
  "none"
];
const LISTING_QUESTION_TYPES_THAT_HIJACK_DEMAIN = [
  "pets",
  "electricity",
  "heating",
  "inclusions",
  "appliances",
  "parking",
  "visit",
  "price"
];

const TRANSLATOR_REPORT_REASONS = [
  "off_topic",
  "misunderstood_message",
  "wrong_listing_info",
  "wrong_next_question",
  "other"
];

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const openaiService = createOpenAIService({
  openaiClient: openai,
  assistantModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  translatorModel: process.env.OPENAI_TRANSLATOR_MODEL || "gpt-4o-mini"
});
const resendClient = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
console.log("Resend initialized:", Boolean(resendClient));
const hasSupabaseAdminAccess = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
// Prefer the service-role key for backend token verification. Fallback keys keep the route fail-closed,
// but they are not the ideal long-term backend credential.
const supabaseServerClient = SUPABASE_URL && SUPABASE_SERVER_KEY
  ? createSupabaseClient(SUPABASE_URL, SUPABASE_SERVER_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

app.use(cors());
app.use(compression({
  filter: (req, res) => {
    if (req.path === "/api/chat") {
      return false;
    }
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: "1mb" }));

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Trop de requêtes IA en peu de temps. Réessayez dans quelques minutes."
  }
});

app.use((req, res, next) => {
  const hostname = String(req.hostname || "").trim().toLowerCase();
  const isClientDomain = hostname === "client.fluxlocatif.com";

  if (!isClientDomain) {
    return next();
  }

  if (req.path === "/" || req.path === "/index.html" || req.path === "/login.html") {
    return res.redirect(302, "/client.html");
  }

  return next();
});

app.get("/employee-style.css", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(path.join(__dirname, "style.css"));
});

app.get("/style.css", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(path.join(__dirname, "style.css"));
});

app.get("/employee.js", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(path.join(__dirname, "script.js"));
});

app.use(express.static(path.join(__dirname, "public"), {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
}));

if (HAS_PROFORMA_WEB_BUILD) {
  app.use(express.static(PROFORMA_WEB_BUILD_DIR, { index: false }));
}

app.get("/", (req, res) => {
  if (HAS_PROFORMA_WEB_BUILD) {
    return res.sendFile(PROFORMA_WEB_BUILD_INDEX);
  }
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/index.html", (req, res) => {
  if (HAS_PROFORMA_WEB_BUILD) {
    return res.sendFile(PROFORMA_WEB_BUILD_INDEX);
  }
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login", (req, res) => {
  return res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/admin", (req, res) => {
  return res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/employee", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(path.join(__dirname, "index.html"));
});

app.use(express.static(__dirname, { index: false }));

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

  try {
    return JSON.parse(raw);
  } catch (error) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const corruptBackupPath = `${filePath}.corrupt-${timestamp}`;
    await fs.writeFile(corruptBackupPath, raw);
    await fs.writeFile(filePath, JSON.stringify(fallbackValue, null, 2));
    return structuredClone(fallbackValue);
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

function normalizeDialPhone(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  if (raw.startsWith("+")) {
    return `+${raw.replace(/[^\d]/g, "")}`;
  }

  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return "";
}

function getTwilioBasicAuthHeader() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return "";
  }
  return `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}

async function loadCallLogs() {
  return readJsonFile(CALL_LOGS_PATH, []);
}

async function saveCallLogs(callLogs) {
  await writeJsonFile(CALL_LOGS_PATH, callLogs);
}

function createTranslatorFieldState() {
  return {
    value: null,
    known: false,
    confidence: 0,
    source: null,
    updated_at: null
  };
}

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toPublicUrl(pathname) {
  if (!PUBLIC_APP_URL) {
    return "";
  }

  return `${PUBLIC_APP_URL}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function sendTwiml(res, twiml) {
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  return res.status(200).send(twiml);
}

function createTranslatorQualificationState() {
  return {
    move_in_date: createTranslatorFieldState(),
    occupants_total: createTranslatorFieldState(),
    has_animals: createTranslatorFieldState(),
    animal_type: createTranslatorFieldState(),
    employment_status: createTranslatorFieldState(),
    employer: createTranslatorFieldState(),
    employment_duration: createTranslatorFieldState(),
    income: createTranslatorFieldState(),
    credit: createTranslatorFieldState(),
    tal: createTranslatorFieldState(),
    full_name: createTranslatorFieldState(),
    phone: createTranslatorFieldState(),
    email: createTranslatorFieldState()
  };
}

function createDefaultTranslatorThreadState(threadKey, employeeUserId = "", listingRef = "") {
  return {
    thread_key: String(threadKey || "").trim(),
    employee_user_id: String(employeeUserId || "").trim(),
    listing_ref: listingRef ? `L-${normalizeRef(listingRef)}` : "",
    current_step: "move_in_date",
    last_asked_step: null,
    last_detected_listing_question: null,
    last_message_at: null,
    conversationMessages: [],
    qualification: createTranslatorQualificationState(),
    visit_prequalification: {
      required: true,
      ready: false
    }
  };
}

async function loadTranslatorThreadStateStore() {
  return readJsonFile(TRANSLATOR_THREAD_STATE_PATH, {});
}

async function getTranslatorThreadState(threadKey, options = {}) {
  const normalizedThreadKey = String(threadKey || "").trim();
  const store = await loadTranslatorThreadStateStore();
  const existingState = normalizedThreadKey ? store[normalizedThreadKey] || null : null;
  const state = existingState
    ? {
        ...createDefaultTranslatorThreadState(normalizedThreadKey),
        ...existingState,
        conversationMessages: Array.isArray(existingState?.conversationMessages)
          ? existingState.conversationMessages
              .map((entry) => ({
                role: String(entry?.role || "").trim(),
                content: String(entry?.content || "").trim()
              }))
              .filter((entry) => entry.role && entry.content)
              .slice(-40)
          : [],
        qualification: {
          ...createTranslatorQualificationState(),
          ...(existingState?.qualification || {})
        },
        visit_prequalification: {
          required: true,
          ready: false,
          ...(existingState?.visit_prequalification || {})
        }
      }
    : createDefaultTranslatorThreadState(
        normalizedThreadKey,
        options?.employeeUserId,
        options?.listingRef
      );

  if (options?.employeeUserId) {
    state.employee_user_id = String(options.employeeUserId).trim();
  }

  if (options?.listingRef) {
    const nextListingRef = `L-${normalizeRef(options.listingRef)}`;
    if (state.listing_ref && state.listing_ref !== nextListingRef) {
      state.last_detected_listing_question = null;
    }
    state.listing_ref = nextListingRef;
  }

  return state;
}

async function saveTranslatorThreadState(state) {
  const normalizedThreadKey = String(state?.thread_key || "").trim();

  if (!normalizedThreadKey) {
    return;
  }

  const store = await loadTranslatorThreadStateStore();
  store[normalizedThreadKey] = state;
  await writeJsonFile(TRANSLATOR_THREAD_STATE_PATH, store);
}

const QUEBEC_LOCATIONS = await readJsonFile(LOCATIONS_PATH, []);
const QUEBEC_LOCATION_MAP = new Map(
  QUEBEC_LOCATIONS.map((location) => [normalizeLocationText(location.label), location])
);

function normalizeRef(ref) {
  return String(ref || "").trim().replace(/^L-/i, "");
}

function slugifyText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeLocationText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function parseCoordinate(value) {
  return parseNumber(value);
}

function getPreloadedLocation(value) {
  const normalizedValue = normalizeLocationText(value);
  return normalizedValue ? QUEBEC_LOCATION_MAP.get(normalizedValue) || null : null;
}

function resolveClosestQuebecLocation(value) {
  const rawValue = String(value || "").trim();
  const normalizedValue = normalizeLocationText(rawValue);

  if (!normalizedValue) {
    return null;
  }

  const exactLocation = getPreloadedLocation(rawValue);
  if (exactLocation) {
    return exactLocation;
  }

  const inputTokens = normalizedValue.match(/[a-z0-9]+/g) || [];
  let bestMatch = null;
  let bestScore = 0;

  for (const location of QUEBEC_LOCATIONS) {
    const locationKey = normalizeLocationText(location.label);
    const locationTokens = locationKey.match(/[a-z0-9]+/g) || [];
    let score = 0;

    if (locationKey.startsWith(normalizedValue) || normalizedValue.startsWith(locationKey)) {
      score += 6;
    }

    if (locationKey.includes(normalizedValue) || normalizedValue.includes(locationKey)) {
      score += 4;
    }

    for (const token of inputTokens) {
      if (locationTokens.includes(token)) {
        score += 3;
      } else if (locationKey.includes(token)) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = location;
    }
  }

  return bestScore >= 3 ? bestMatch : null;
}

function getListingLocation(listing = {}) {
  const rawLabel = String(listing.ville || listing.city || "").trim();
  const preloadedLocation = getPreloadedLocation(rawLabel);
  const label = rawLabel || preloadedLocation?.label || "";

  return {
    label,
    zone: String(listing.zone || preloadedLocation?.zone || "").trim(),
    lat: parseCoordinate(listing.lat) ?? parseCoordinate(preloadedLocation?.lat),
    lng: parseCoordinate(listing.lng) ?? parseCoordinate(preloadedLocation?.lng)
  };
}

function getCandidatePreferredLocation(candidate = {}) {
  const rawLabel = String(candidate.preferred_location_label || "").trim();
  const preloadedLocation = getPreloadedLocation(rawLabel);
  const label = rawLabel || preloadedLocation?.label || "";

  return {
    label,
    zone: String(candidate.preferred_location_zone || preloadedLocation?.zone || "").trim(),
    lat: parseCoordinate(candidate.preferred_location_lat) ?? parseCoordinate(preloadedLocation?.lat),
    lng: parseCoordinate(candidate.preferred_location_lng) ?? parseCoordinate(preloadedLocation?.lng)
  };
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getFlexibleLocationRadiusKm(preferredLocation) {
  const locationKey = normalizeLocationText(preferredLocation?.label);

  if (["montreal", "laval", "longueuil", "brossard"].includes(locationKey)) {
    return 18;
  }

  if (["sherbrooke", "quebeccity", "gatineau", "troisrivieres"].includes(locationKey)) {
    return 30;
  }

  return 24;
}

function evaluateLocationCompatibility(listing, candidate) {
  const preferredLocation = getCandidatePreferredLocation(candidate);
  const listingLocation = getListingLocation(listing);
  const preferredLabel = normalizeLocationText(preferredLocation.label);
  const listingLabel = normalizeLocationText(listingLocation.label);

  if (!preferredLabel) {
    return {
      scoreDelta: 0,
      reasons: []
    };
  }

  if (preferredLabel && listingLabel && preferredLabel === listingLabel) {
    return {
      scoreDelta: 10,
      reasons: ["ville recherchée conforme"]
    };
  }

  if (!parseBoolean(candidate.location_flexible)) {
    return {
      scoreDelta: -55,
      forceReject: true,
      reasons: ["ville recherchée non respectée"]
    };
  }

  if (
    preferredLocation.lat !== null &&
    preferredLocation.lng !== null &&
    listingLocation.lat !== null &&
    listingLocation.lng !== null
  ) {
    const distanceKm = haversineDistanceKm(
      preferredLocation.lat,
      preferredLocation.lng,
      listingLocation.lat,
      listingLocation.lng
    );
    const acceptedRadiusKm = getFlexibleLocationRadiusKm(preferredLocation);

    if (distanceKm <= acceptedRadiusKm * 0.5) {
      return {
        scoreDelta: 4,
        reasons: ["secteur voisin acceptable"]
      };
    }

    if (distanceKm <= acceptedRadiusKm) {
      return {
        scoreDelta: -8,
        reasons: ["localisation acceptable avec flexibilité"]
      };
    }

    return {
      scoreDelta: -60,
      forceReject: true,
      reasons: ["localisation trop éloignée"]
    };
  }

  if (
    preferredLocation.zone &&
    listingLocation.zone &&
    normalizeLocationText(preferredLocation.zone) === normalizeLocationText(listingLocation.zone)
  ) {
    return {
      scoreDelta: -12,
      reasons: ["même zone géographique acceptable"]
    };
  }

  return {
    scoreDelta: -50,
    forceReject: true,
    reasons: ["zone géographique non compatible"]
  };
}

function resolveClientIdFromUser(user) {
  return String(
    user?.user_metadata?.client_id ||
    user?.user_metadata?.clientId ||
    user?.app_metadata?.client_id ||
    user?.app_metadata?.clientId ||
    ""
  ).trim();
}

function resolveRoleFromUser(user) {
  return String(
    user?.user_metadata?.role ||
    user?.app_metadata?.role ||
    ""
  ).trim().toLowerCase();
}

function toListingRecord(key, value) {
  const ref = normalizeRef(value?.ref || key);
  const preloadedLocation = getPreloadedLocation(value?.ville ?? value?.city);
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
    ville: value?.ville ?? value?.city ?? preloadedLocation?.label ?? "",
    zone: value?.zone ?? preloadedLocation?.zone ?? "",
    lat: parseCoordinate(value?.lat) ?? parseCoordinate(preloadedLocation?.lat),
    lng: parseCoordinate(value?.lng) ?? parseCoordinate(preloadedLocation?.lng),
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
    client_id: value?.client_id ?? null,
    address: value?.address ?? value?.adresse ?? "",
    city: value?.city ?? value?.ville ?? preloadedLocation?.label ?? "",
    rent: rentValue,
    bedrooms: bedroomsValue,
    availability: availabilityValue,
    status: statusValue,
    description: value?.description ?? ""
  };
}

const listingsService = createListingsService({
  readJsonFile,
  writeJsonFile,
  listingsPath: LISTINGS_PATH,
  toListingRecord
});

async function loadListingsMap() {
  return listingsService.loadListingsMap();
}

async function loadClientsMap() {
  return readJsonFile(CLIENTS_PATH, {});
}

async function loadClientInvitations() {
  const currentInvitations = await readJsonFile(CLIENT_INVITATIONS_PATH, null);

  if (Array.isArray(currentInvitations)) {
    return currentInvitations;
  }

  return readJsonFile(LEGACY_CLIENT_INVITATIONS_PATH, []);
}

function normalizeClientRecord(id, value = {}) {
  return {
    id: String(value.id || id || ""),
    nom: String(value.nom || "").trim(),
    contact_name: String(value.contact_name || "").trim(),
    company_name: String(value.company_name || value.nom || "").trim(),
    email: String(value.email || "").trim(),
    phone: String(value.phone || "").trim(),
    main_city: String(value.main_city || "").trim(),
    onboarding_user_id: value.onboarding_user_id || null,
    onboarding_completed_at: value.onboarding_completed_at || null,
    notification_preferences: {
      email_notifications: Boolean(value?.notification_preferences?.email_notifications),
      marketing_communications: Boolean(value?.notification_preferences?.marketing_communications)
    },
    criteres: {
      revenu_minimum: parseNumber(value?.criteres?.revenu_minimum),
      revenu_multiple: value?.criteres?.revenu_multiple ?? null,
      credit_min: value?.criteres?.credit_min ?? null,
      accepte_tal: Boolean(value?.criteres?.accepte_tal),
      tal_policy: value?.criteres?.tal_policy ?? null,
      max_occupants: parseNumber(value?.criteres?.max_occupants),
      animaux_acceptes: Boolean(value?.criteres?.animaux_acceptes),
      emplois_acceptes: Array.isArray(value?.criteres?.emplois_acceptes)
        ? value.criteres.emplois_acceptes.map((job) => String(job))
        : [],
      employment_requirement: value?.criteres?.employment_requirement ?? null,
      anciennete_min_mois: parseNumber(value?.criteres?.anciennete_min_mois)
    }
  };
}

function buildIncomeCriteriaFromRent(rentValue, incomeRule) {
  const rent = parseNumber(rentValue);
  const normalizedRule = String(incomeRule || "").trim().toLowerCase();

  if (rent === null || !rent || !normalizedRule || normalizedRule === "flexible") {
    return { revenu_minimum: null, revenu_multiple: normalizedRule || null };
  }

  const ratio = Number(normalizedRule.replace("x", ""));
  if (!Number.isFinite(ratio)) {
    return { revenu_minimum: null, revenu_multiple: normalizedRule };
  }

  return {
    revenu_minimum: Math.round(rent * ratio),
    revenu_multiple: normalizedRule
  };
}

function buildEmploymentCriteria(requirement) {
  const normalizedRequirement = String(requirement || "").trim().toLowerCase();

  if (normalizedRequirement === "temps plein requis") {
    return ["temps plein"];
  }

  if (normalizedRequirement === "stable requis") {
    return ["temps plein", "temps partiel", "autonome", "retraité"];
  }

  return [];
}

async function saveListingsMap(listingsMap) {
  await listingsService.saveListingsMap(
    Object.fromEntries(
      Object.entries(listingsMap).map(([ref, listing]) => [
        ref,
        {
          ...listing,
          lat: parseCoordinate(listing?.lat),
          lng: parseCoordinate(listing?.lng)
        }
      ])
    )
  );
}

async function saveClientsMap(clientsMap) {
  await writeJsonFile(CLIENTS_PATH, clientsMap);
}

async function saveClientInvitations(invitations) {
  await writeJsonFile(CLIENT_INVITATIONS_PATH, invitations);
}

function nextListingRef(listingsMap) {
  const refs = Object.keys(listingsMap).map((ref) => Number(ref)).filter(Number.isFinite);
  const nextRef = refs.length ? Math.max(...refs) + 1 : 1001;
  return String(nextRef);
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSecureToken() {
  return crypto.randomBytes(24).toString("hex");
}

function createClientId(clientsMap, companyName, invitations = []) {
  const baseSlug = slugifyText(companyName) || `client-${Date.now()}`;
  const reservedIds = new Set([
    ...Object.keys(clientsMap || {}),
    ...invitations.map((item) => String(item.client_id || "")).filter(Boolean)
  ]);
  let candidateId = `client_${baseSlug}`;
  let index = 1;

  while (reservedIds.has(candidateId)) {
    candidateId = `client_${baseSlug}_${index}`;
    index += 1;
  }

  return candidateId;
}

function buildOnboardingLink(req, token) {
  const baseUrl = PUBLIC_APP_URL || `${req.protocol}://${req.get("host")}`;
  return `${baseUrl}/client-onboarding.html?token=${encodeURIComponent(token)}`;
}

function isInvitationExpired(invitation) {
  if (!invitation?.expires_at) return true;
  return new Date(invitation.expires_at).getTime() <= Date.now();
}

function getInvitationStatus(invitation) {
  if (!invitation) return "invalid";
  if (invitation.status === "completed") return "completed";
  if (invitation.status === "expired" || isInvitationExpired(invitation)) return "expired";
  return "pending";
}

function sanitizeInvitation(invitation) {
  return {
    id: invitation.id,
    client_id: invitation.client_id,
    name: invitation.name || invitation.contact_name || "",
    contact_name: invitation.contact_name,
    company_name: invitation.company_name,
    email: invitation.email,
    phone: invitation.phone,
    main_city: invitation.main_city || "",
    status: getInvitationStatus(invitation),
    expires_at: invitation.expires_at,
    created_at: invitation.created_at,
    account_created_at: invitation.account_created_at || null,
    account_exists: Boolean(invitation.account_exists),
    existing_account_linked_at: invitation.existing_account_linked_at || null
  };
}

async function findSupabaseUserByEmail(email) {
  ensureSupabaseAdminAvailable();

  const targetEmail = String(email || "").trim().toLowerCase();
  if (!targetEmail) {
    return null;
  }

  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseServerClient.auth.admin.listUsers({
      page,
      perPage
    });

    if (error) {
      throw createHttpError(500, error.message || "Impossible de vérifier l’existence du compte.");
    }

    const users = Array.isArray(data?.users) ? data.users : [];
    const foundUser = users.find((user) => String(user.email || "").trim().toLowerCase() === targetEmail) || null;

    if (foundUser) {
      return foundUser;
    }

    if (users.length < perPage) {
      return null;
    }

    page += 1;
  }
}

async function createManualUserAccount({ role, fullName, email, password }) {
  ensureSupabaseAdminAvailable();

  const normalizedRole = String(role || "").trim().toLowerCase();
  if (!["admin", "employee"].includes(normalizedRole)) {
    throw createHttpError(400, "Rôle invalide.");
  }

  const { data, error } = await supabaseServerClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role: normalizedRole
    },
    app_metadata: {
      role: normalizedRole
    }
  });

  if (error || !data?.user) {
    throw createHttpError(400, error?.message || "Impossible de créer le compte utilisateur.");
  }

  return data.user;
}

async function loadAllSupabaseUsers() {
  ensureSupabaseAdminAvailable();

  const users = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseServerClient.auth.admin.listUsers({
      page,
      perPage
    });

    if (error) {
      throw createHttpError(500, error.message || "Impossible de charger les utilisateurs Supabase.");
    }

    const batch = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);

    if (batch.length < perPage) {
      break;
    }

    page += 1;
  }

  return users;
}

async function loadLegacyAdminUserIds() {
  try {
    const { data, error } = await supabaseServerClient
      .from("admin_users")
      .select("user_id");

    if (error) {
      throw error;
    }

    return new Set((data || []).map((row) => String(row.user_id || "").trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function loadWorkspaceMessages() {
  return readJsonFile(WORKSPACE_MESSAGES_PATH, []);
}

async function saveWorkspaceMessages(messages) {
  await writeJsonFile(WORKSPACE_MESSAGES_PATH, messages);
}

async function loadListingTasks() {
  return readJsonFile(LISTING_TASKS_PATH, []);
}

async function saveListingTasks(tasks) {
  await writeJsonFile(LISTING_TASKS_PATH, tasks);
}

async function loadNotifications() {
  return readJsonFile(NOTIFICATIONS_PATH, []);
}

async function saveNotifications(notifications) {
  await writeJsonFile(NOTIFICATIONS_PATH, notifications);
}

function createCallLogRecord({
  dealId = "",
  direction = "outbound",
  from = "",
  to = "",
  leadName = "",
  dealTitle = "",
  callSid = "",
  parentCallSid = "",
  status = "queued"
} = {}) {
  const nowIso = new Date().toISOString();
  return {
    id: createId("call"),
    deal_id: String(dealId || "").trim(),
    direction,
    from,
    to,
    lead_name: leadName,
    deal_title: dealTitle,
    call_sid: callSid || null,
    parent_call_sid: parentCallSid || null,
    status,
    duration_seconds: null,
    recording_sid: null,
    recording_url: null,
    transcript: null,
    transcript_status: "not_started",
    transcript_error: null,
    events: [{ at: nowIso, status }],
    created_at: nowIso,
    updated_at: nowIso
  };
}

function appendCallEvent(callLog, status, extra = {}) {
  const nowIso = new Date().toISOString();
  const nextEvents = Array.isArray(callLog.events) ? callLog.events : [];
  nextEvents.unshift({
    at: nowIso,
    status: String(status || "").trim() || "updated",
    ...extra
  });

  callLog.status = String(status || "").trim() || callLog.status || "updated";
  callLog.updated_at = nowIso;
  callLog.events = nextEvents.slice(0, 25);
  return callLog;
}

async function callTwilioApi(endpoint, payload) {
  const authHeader = getTwilioBasicAuthHeader();
  if (!authHeader) {
    throw createHttpError(500, "Les identifiants Twilio ne sont pas configurés.");
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(payload).toString()
  });

  const responseText = await response.text();
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = String(data?.message || responseText || "Erreur Twilio inconnue.");
    throw createHttpError(400, `Twilio API: ${message}`);
  }

  return data;
}

async function transcribeTwilioRecording(callLogId, recordingUrl, recordingSid) {
  if (!openai) {
    throw createHttpError(500, "OpenAI API non configurée pour la transcription.");
  }

  const authHeader = getTwilioBasicAuthHeader();
  if (!authHeader) {
    throw createHttpError(500, "Les identifiants Twilio ne sont pas configurés.");
  }

  const normalizedRecordingUrl = String(recordingUrl || "").trim();
  if (!normalizedRecordingUrl) {
    throw createHttpError(400, "URL d'enregistrement manquante.");
  }

  const recordingMediaUrl = /\.(mp3|wav)$/i.test(normalizedRecordingUrl)
    ? normalizedRecordingUrl
    : `${normalizedRecordingUrl}.mp3`;

  const audioResponse = await fetch(recordingMediaUrl, {
    headers: {
      Authorization: authHeader
    }
  });

  if (!audioResponse.ok) {
    throw createHttpError(400, `Impossible de télécharger l'enregistrement (${audioResponse.status}).`);
  }

  const buffer = Buffer.from(await audioResponse.arrayBuffer());
  const file = await toFile(buffer, `${recordingSid || callLogId || "call-recording"}.mp3`, {
    type: "audio/mpeg"
  });
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: OPENAI_TRANSCRIPTION_MODEL,
    language: "fr"
  });

  const transcriptText = String(transcription?.text || "").trim();
  const callLogs = await loadCallLogs();
  const callLog = callLogs.find((log) => String(log.id) === String(callLogId));

  if (!callLog) {
    return;
  }

  callLog.transcript = transcriptText || "(Aucune transcription retournée)";
  callLog.transcript_status = "completed";
  callLog.transcript_error = null;
  appendCallEvent(callLog, callLog.status || "completed", { note: "transcript_completed" });
  await saveCallLogs(callLogs);
}

async function appendNotification(notification) {
  const notifications = await loadNotifications();
  notifications.push(notification);
  await saveNotifications(notifications);
  return notification;
}

async function appendNotifications(notificationsToAppend = []) {
  if (!notificationsToAppend.length) return;
  const notifications = await loadNotifications();
  notifications.push(...notificationsToAppend);
  await saveNotifications(notifications);
}

function buildResolvedUserSummary(user, legacyAdminUserIds, summaryByUserId = new Map()) {
  const userSummary = summaryByUserId.get(user.id) || null;
  const explicitRole = resolveRoleFromUser(user);
  const resolvedRole = explicitRole || (
    legacyAdminUserIds.has(String(user.id || "").trim())
      ? "admin"
      : resolveClientIdFromUser(user)
        ? "client"
        : "employee"
  );

  return {
    user_id: user.id,
    email: user.email || "",
    full_name: user.user_metadata?.full_name || user.user_metadata?.name || "",
    role: resolvedRole,
    client_id: resolveClientIdFromUser(user) || null,
    created_at: user.created_at || null,
    last_sign_in_at: user.last_sign_in_at || null,
    is_deactivated: Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now()),
    banned_until: user.banned_until || null,
    today_heartbeat_count: userSummary?.heartbeat_count ?? 0,
    today_total_seconds: userSummary?.total_seconds ?? 0
  };
}

function formatListingTaskTitle(payload = {}) {
  const address = String(payload.address || "").trim();
  const city = String(payload.city || "").trim();
  const type = String(payload.type || "").trim();
  return [address, city, type].filter(Boolean).join(" · ") || "Nouvelle annonce";
}

function buildListingTaskText(payload = {}) {
  const address = String(payload.address || "").trim();
  const city = String(payload.city || "").trim();
  const type = String(payload.type || "").trim();
  const rent = String(payload.rent || "").trim();
  const inclusions = String(payload.inclusions || "").trim();
  const pets = String(payload.pets || "").trim();
  const parking = String(payload.parking || "").trim();
  const features = String(payload.features || "").trim();
  const conditions = String(payload.conditions || "").trim();

  return [
    `${type || "Logement"} à louer${city ? ` à ${city}` : ""}${address ? `, ${address}` : ""}.`,
    rent ? `Loyer : ${rent} $ par mois.` : "",
    inclusions ? `Inclusions : ${inclusions}.` : "",
    pets ? `Animaux : ${pets}.` : "",
    parking ? `Stationnement : ${parking}.` : "",
    features ? `Points forts : ${features}.` : "",
    conditions ? `Conditions : ${conditions}.` : "",
    "Veuillez adapter le ton final avant publication."
  ].filter(Boolean).join(" ");
}

async function loadAdminUsersSummary() {
  const users = await loadAllSupabaseUsers();
  const legacyAdminUserIds = await loadLegacyAdminUserIds();
  return users
    .map((user) => buildResolvedUserSummary(user, legacyAdminUserIds))
    .filter((user) => user.role === "admin");
}

async function loadEmployeeUsersSummary() {
  const users = await loadAllSupabaseUsers();
  const legacyAdminUserIds = await loadLegacyAdminUserIds();
  return users
    .map((user) => buildResolvedUserSummary(user, legacyAdminUserIds))
    .filter((user) => user.role === "employee");
}

function listConversationMessagesForEmployee(messages, employeeUserId) {
  return messages.filter((message) => String(message.employee_user_id) === String(employeeUserId));
}

function sortByCreatedAtDesc(items) {
  return [...items].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
}

function extractEmailAddress(value) {
  const rawValue = String(value || "").trim();
  const match = rawValue.match(/<([^>]+)>/);
  return String(match?.[1] || rawValue).trim().toLowerCase();
}

function isValidInvitationSenderEmail(value) {
  const email = extractEmailAddress(value);
  if (!email || !email.includes("@")) {
    return false;
  }

  const domain = email.split("@")[1] || "";
  return domain === "fluxlocatif.com";
}

async function sendClientInvitationEmail(invitation, onboardingLink) {
  if (!resendClient) {
    return {
      sent: false,
      error: "RESEND_API_KEY manquant ou client Resend non initialisé."
    };
  }

  if (!INVITATION_FROM_EMAIL) {
    return {
      sent: false,
      error: "INVITATION_FROM_EMAIL manquant."
    };
  }

  if (!isValidInvitationSenderEmail(INVITATION_FROM_EMAIL)) {
    return {
      sent: false,
      error: "INVITATION_FROM_EMAIL doit utiliser un expéditeur vérifié sur fluxlocatif.com, par exemple noreply@fluxlocatif.com."
    };
  }

  const clientName = String(invitation.name || invitation.contact_name || "Client").trim();
  const subject = "Bienvenue sur FluxLocatif — Accédez à votre espace";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto;">
      <h2 style="color: #111;">Bienvenue sur FluxLocatif</h2>

      <p>Bonjour ${clientName},</p>

      <p>
        Votre accès à votre espace client FluxLocatif est prêt.
        Vous pourrez suivre vos logements, vos candidats et gérer vos critères en temps réel.
      </p>

      <div style="margin: 30px 0; text-align: center;">
        <a href="${onboardingLink}" 
           style="background-color: #000; color: #fff; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">
           Accéder à mon espace
        </a>
      </div>

      <p style="font-size: 14px; color: #555;">
        Ce lien est sécurisé et valide pendant 7 jours.
      </p>

      <p style="font-size: 14px; color: #555;">
        Si vous avez des questions, vous pouvez répondre directement à ce courriel.
      </p>

      <p style="margin-top: 30px;">
        —<br>
        FluxLocatif
      </p>
    </div>
  `;
  const text = [
    `Bonjour ${clientName},`,
    "",
    "Bienvenue sur FluxLocatif.",
    "",
    "Votre accès est prêt.",
    "",
    "Accéder à votre espace :",
    onboardingLink,
    "",
    "Ce lien est valide pendant 7 jours.",
    "",
    "— FluxLocatif"
  ].join("\n");

  console.log("[client-invitation-email] send:start", {
    invitation_id: invitation.id || null,
    email: invitation.email || "",
    client_name: clientName
  });
  console.log("[client-invitation-email] payload", {
    to: invitation.email,
    link: onboardingLink
  });

  try {
    const response = await resendClient.emails.send({
      from: INVITATION_FROM_EMAIL,
      to: invitation.email,
      subject,
      html,
      text
    });

    console.log("[client-invitation-email] send:response", {
      id: response?.data?.id || response?.id || null,
      error: response?.error || null,
      response
    });

    if (response?.error) {
      return {
        sent: false,
        error: response.error.message || String(response.error)
      };
    }

    return {
      sent: true
    };
  } catch (error) {
    console.error("[client-invitation-email] send:error", {
      message: error?.message || "email_send_failed",
      error
    });
    return {
      sent: false,
      error: error?.message || "email_send_failed"
    };
  }
}

async function sendAdminClientActivatedEmail(payload) {
  if (!resendClient || !INVITATION_FROM_EMAIL || !ADMIN_NOTIFICATION_EMAIL) {
    return {
      sent: false,
      reason: "admin_email_not_configured"
    };
  }

  const subject = `Nouveau client activé — ${payload.company_name || payload.contact_name || payload.client_id}`;
  const html = `
    <p>Un nouveau client a activé son espace FluxLocatif.</p>
    <ul>
      <li><strong>Client / entreprise :</strong> ${payload.company_name || "-"}</li>
      <li><strong>Nom du contact :</strong> ${payload.contact_name || "-"}</li>
      <li><strong>Courriel :</strong> ${payload.email || "-"}</li>
      <li><strong>Téléphone :</strong> ${payload.phone || "-"}</li>
      <li><strong>Ville principale :</strong> ${payload.main_city || "-"}</li>
      <li><strong>client_id :</strong> ${payload.client_id || "-"}</li>
    </ul>
  `;

  await resendClient.emails.send({
    from: INVITATION_FROM_EMAIL,
    to: ADMIN_NOTIFICATION_EMAIL,
    subject,
    html,
    text: [
      "Un nouveau client a activé son espace FluxLocatif.",
      "",
      `Client / entreprise : ${payload.company_name || "-"}`,
      `Nom du contact : ${payload.contact_name || "-"}`,
      `Courriel : ${payload.email || "-"}`,
      `Téléphone : ${payload.phone || "-"}`,
      `Ville principale : ${payload.main_city || "-"}`,
      `client_id : ${payload.client_id || "-"}`
    ].join("\n")
  });

  return {
    sent: true
  };
}

async function resolveInvitationByToken(token, options = {}) {
  const invitations = await loadClientInvitations();
  const index = invitations.findIndex((item) => item.token === token);
  const invitation = index >= 0 ? invitations[index] : null;
  let changed = false;

  if (invitation && getInvitationStatus(invitation) === "expired" && invitation.status !== "expired") {
    invitation.status = "expired";
    invitation.expired_at = new Date().toISOString();
    changed = true;
  }

  if (changed && options.persist !== false) {
    await saveClientInvitations(invitations);
  }

  return {
    invitations,
    invitation,
    index,
    status: getInvitationStatus(invitation)
  };
}

function ensureInvitationUsable(status, invitation) {
  if (!invitation || status === "invalid") {
    throw createHttpError(404, "Invitation introuvable.");
  }

  if (status === "expired") {
    throw createHttpError(410, "Ce lien d’invitation est expiré.");
  }

  if (status === "completed") {
    throw createHttpError(409, "Cette invitation a déjà été utilisée.");
  }
}

function ensureSupabaseAdminAvailable() {
  if (!hasSupabaseAdminAccess || !supabaseServerClient?.auth?.admin) {
    throw createHttpError(503, "Configuration Supabase admin incomplète pour l’onboarding client.");
  }
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

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value).replace(/[^\d.,-]/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const normalized = String(value || "").trim().toLowerCase();
  return ["true", "oui", "yes", "1"].includes(normalized);
}

function parseEmploymentLengthMonths(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim().toLowerCase();
  if (!text) return null;

  const match = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;

  const amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount)) return null;

  if (text.includes("an")) {
    return Math.round(amount * 12);
  }

  if (text.includes("mois")) {
    return Math.round(amount);
  }

  return Math.round(amount);
}

function normalizeCreditLevel(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (["haut", "haute", "high", "eleve", "élevé", "élevée"].includes(normalized)) {
    return 3;
  }

  if (["moyen", "moyenne", "medium"].includes(normalized)) {
    return 2;
  }

  if (["bas", "basse", "low"].includes(normalized)) {
    return 1;
  }

  return 0;
}

function getDefaultCriteria(listing) {
  const rent = parseNumber(listing?.loyer ?? listing?.rent);

  return {
    revenu_minimum: rent !== null && rent > 0 ? rent * 3 : null,
    credit_min: listing?.credit_requis ?? listing?.required_credit ?? listing?.credit_minimum ?? null,
    accepte_tal: false,
    max_occupants: 3,
    animaux_acceptes: false,
    emplois_acceptes: ["temps plein"],
    anciennete_min_mois: 3
  };
}

function isListingRelevantForMatching(listing) {
  const status = String(listing?.statut ?? listing?.status ?? "").trim().toLowerCase();
  return !status || ["actif", "active", "disponible", "en attente"].includes(status);
}

function evaluateMatch(listing, candidate, criteria = null) {
  let score = 100;
  const reasons = [];
  const resolvedCriteria = {
    ...getDefaultCriteria(listing),
    ...(criteria || {})
  };

  const rent = parseNumber(listing?.loyer ?? listing?.rent);
  const monthlyIncome = parseNumber(candidate?.revenu_mensuel ?? candidate?.monthly_income);
  const minimumIncome = parseNumber(resolvedCriteria.revenu_minimum);
  const incomeRatio = rent !== null && rent > 0 && monthlyIncome !== null ? monthlyIncome / rent : null;

  if (incomeRatio !== null && incomeRatio < 2.5) {
    score -= 40;
    reasons.push("revenu très insuffisant");
  } else if (incomeRatio !== null && incomeRatio >= 3) {
    score += 10;
    reasons.push("revenu très solide");
  } else if (minimumIncome !== null && monthlyIncome !== null && monthlyIncome < minimumIncome) {
    score -= 20;
    reasons.push("revenu insuffisant");
  } else {
    reasons.push("revenu conforme");
  }

  const candidateCredit = normalizeCreditLevel(candidate?.credit ?? candidate?.credit_level);
  const requiredCredit = normalizeCreditLevel(resolvedCriteria.credit_min);

  if (requiredCredit > 0) {
    if (candidateCredit < requiredCredit) {
      score -= 18;
      reasons.push("crédit insuffisant");
    } else {
      reasons.push("crédit conforme");
    }
  }

  if (candidateCredit >= 3) {
    score += 8;
    reasons.push("bon crédit");
  } else if (candidateCredit === 1) {
    score -= 18;
    reasons.push("crédit faible");
  }

  if (!resolvedCriteria.accepte_tal && parseBoolean(candidate?.tal)) {
    score -= 55;
    reasons.push("dossier TAL défavorable");
  }

  const occupants = parseNumber(candidate?.nombre_personnes ?? candidate?.occupants_total);
  const maxOccupants = parseNumber(resolvedCriteria.max_occupants);
  if (occupants !== null && maxOccupants !== null && occupants > maxOccupants) {
    score -= 8;
    reasons.push("trop d’occupants");
  }

  if (!resolvedCriteria.animaux_acceptes && parseBoolean(candidate?.animaux ?? candidate?.pets)) {
    score -= 6;
    reasons.push("animaux non acceptés");
  }

  const employmentStatus = String(candidate?.statut_emploi ?? candidate?.employment_status ?? "").trim().toLowerCase();
  const acceptedJobs = Array.isArray(resolvedCriteria.emplois_acceptes)
    ? resolvedCriteria.emplois_acceptes.map((job) => String(job).trim().toLowerCase())
    : [];
  if (acceptedJobs.length && !acceptedJobs.includes(employmentStatus)) {
    score -= 6;
    reasons.push("emploi non accepté");
  }

  const seniorityMonths = parseNumber(candidate?.anciennete_mois ?? candidate?.employment_length_months);
  const minimumSeniority = parseNumber(resolvedCriteria.anciennete_min_mois);
  if (seniorityMonths !== null && minimumSeniority !== null && seniorityMonths < minimumSeniority) {
    score -= 6;
    reasons.push("ancienneté insuffisante");
  }

  const locationResult = evaluateLocationCompatibility(listing, candidate);
  score += locationResult.scoreDelta || 0;
  reasons.push(...(locationResult.reasons || []));

  score = Math.max(0, Math.min(100, score));

  let status = "refusé";
  if (locationResult.forceReject || (!resolvedCriteria.accepte_tal && parseBoolean(candidate?.tal))) {
    status = "refusé";
  } else if (score >= 85) {
    status = "accepté";
  } else if (score >= 70) {
    status = "à revoir";
  }

  return { score, status, reasons };
}

function normalizeCandidateForMatching(candidate) {
  return {
    ...candidate,
    revenu_mensuel: candidate?.revenu_mensuel ?? candidate?.monthly_income ?? candidate?.monthly_income,
    credit: candidate?.credit ?? candidate?.credit_level,
    tal: candidate?.tal ?? candidate?.tal_record,
    nombre_personnes: candidate?.nombre_personnes ?? candidate?.occupants_total,
    animaux: candidate?.animaux ?? candidate?.pets,
    statut_emploi: candidate?.statut_emploi ?? candidate?.employment_status,
    preferred_location_label: candidate?.preferred_location_label,
    preferred_location_zone: candidate?.preferred_location_zone,
    preferred_location_lat: candidate?.preferred_location_lat,
    preferred_location_lng: candidate?.preferred_location_lng,
    location_flexible: candidate?.location_flexible,
    anciennete_mois:
      candidate?.anciennete_mois ??
      candidate?.employment_length_months ??
      parseEmploymentLengthMonths(candidate?.employment_length)
  };
}

async function buildAlternativeListings(candidate, listingsMap = null, clientsMap = null, limit = 5) {
  const listings = listingsMap || await loadListingsMap();
  const clients = clientsMap || await loadClientsMap();
  const targetedRef = normalizeRef(candidate?.apartment_ref);
  const normalizedCandidate = normalizeCandidateForMatching(candidate);

  return Object.values(listings)
    .filter((listing) => normalizeRef(listing.ref) !== targetedRef)
    .filter((listing) => isListingRelevantForMatching(listing))
    .map((listing) => {
      const client = listing.client_id ? clients[String(listing.client_id)] || null : null;
      const criteria = client?.criteres || null;
      const result = evaluateMatch(listing, normalizedCandidate, criteria);

      return {
        ref: `L-${normalizeRef(listing.ref)}`,
        address: listing.adresse || listing.address || "",
        city: listing.ville || listing.city || "",
        client_id: listing.client_id ?? null,
        match_score: result.score,
        match_status: result.status,
        reasons: result.reasons
      };
    })
    .filter((listing) => listing.match_status !== "refusé" && listing.match_score >= 70)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, limit);
}

async function buildCandidateMatchFields(candidate, listingsMap = null, clientsMap = null) {
  const listings = listingsMap || await loadListingsMap();
  const normalizedRef = normalizeRef(candidate?.apartment_ref);
  const listing = listings[normalizedRef];
  const now = new Date().toISOString();

  if (!listing) {
    return {
      match_status: "refusé",
      match_score: 0,
      match_reasons: ["appartement introuvable"],
      alternative_listings: await buildAlternativeListings(candidate, listings, clientsMap),
      match_updated_at: now
    };
  }

  const clients = clientsMap || await loadClientsMap();
  const client = listing.client_id ? clients[String(listing.client_id)] || null : null;
  const criteria = client?.criteres || null;
  const result = evaluateMatch(listing, normalizeCandidateForMatching(candidate), criteria);

  return {
    match_status: result.status,
    match_score: result.score,
    match_reasons: result.reasons,
    alternative_listings: await buildAlternativeListings(candidate, listings, clients),
    match_updated_at: now
  };
}

function candidateNeedsMatch(candidate) {
  return (
    !candidate ||
    candidate.match_status === undefined ||
    candidate.match_score === undefined ||
    !Array.isArray(candidate.match_reasons) ||
    !Array.isArray(candidate.alternative_listings) ||
    !candidate.match_updated_at
  );
}

async function ensureCandidatesMatchFields(candidates, persist = false) {
  let changed = false;
  const listings = await loadListingsMap();
  const clients = await loadClientsMap();

  for (const candidate of candidates) {
    if (!candidateNeedsMatch(candidate)) continue;

    Object.assign(candidate, await buildCandidateMatchFields(candidate, listings, clients));
    changed = true;
  }

  if (changed && persist) {
    await writeJsonFile(CANDIDATES_PATH, candidates);
  }

  return { candidates, changed };
}

const qualificationService = createQualificationService({
  loadListingsMap,
  loadClientsMap,
  evaluateMatch,
  isListingRelevantForMatching,
  normalizeRef
});

function normalizeTranslatorText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/\bilectriciter\b|\bilectricite\b|\belectriciter\b|\belectricite\b|\blelectriciter\b|\blelectricite\b/g, " electricite ")
    .replace(/\blogi\b/g, " logement ")
    .replace(/\bchu\b|\bjsuis\b/g, " je suis ")
    .replace(/\byinke\b/g, " juste ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTranslatorOccupantsCount(message) {
  const normalized = normalizeTranslatorText(message);
  const patterns = [
    /\b(?:on va etre|on sera|nous serons|on est|nous sommes)\s+(\d{1,2})\b/,
    /\b(\d{1,2})\s*(?:personnes?|occupants?|adultes?|enfants?)\b/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function getTranslatorMessageSignals(message) {
  const normalized = normalizeTranslatorText(message);

  return {
    normalized,
    asksAvailability: /\b(?:dispo|disponible|vacant|available|encore dispo|encore disponible)\b/.test(normalized),
    asksRent: /\b(?:loyer|prix|combien|rent|cout|coute)\b/.test(normalized),
    asksElectricity: /\b(?:hydro|electricite|elec)\b/.test(normalized),
    asksHeating: /\b(?:chauffage|chauffe)\b/.test(normalized),
    asksInclusions: /\b(?:inclu|inclus|include|compris|avec quoi)\b/.test(normalized),
    asksAppliances: /\b(?:electro|electros|electromenager|electromenagers|electro menager|electros inclus)\b/.test(normalized),
    asksParking: /\b(?:parking|stationnement|stationnements|park)\b/.test(normalized),
    asksPets: /\b(?:chien|chiens|chat|chats|animal|animaux)\b/.test(normalized),
    asksVisit: /\b(?:visite|visiter|visit|tour|voir le logement|jpeux tu visiter)\b/.test(normalized),
    asksLocation: /\b(?:metro|loin|distance|secteur|quartier|ou cest|ou c est|ou est)\b/.test(normalized),
    asksMoveInTiming: /\b(?:quand|date|a partir|apartir|emmenag|move)\b/.test(normalized),
    mentionsOccupants: Boolean(extractTranslatorOccupantsCount(message)) || /\b(?:famille|enfant|avec mon conjoint|avec ma conjointe|avec ma femme|avec mon mari)\b/.test(normalized)
  };
}

function shouldIgnoreMoveInDate(listingQuestionType = "none") {
  return LISTING_QUESTION_TYPES_THAT_HIJACK_DEMAIN.includes(String(listingQuestionType || "").trim());
}

function detectTranslatorListingQuestionType(message) {
  const signals = getTranslatorMessageSignals(message);
  const normalized = signals.normalized;

  if (signals.asksAvailability) return "availability";
  if (signals.asksVisit) return "visit";
  if (signals.asksParking) return "parking";
  if (signals.asksAppliances) return "appliances";
  if (signals.asksElectricity) return "electricity";
  if (signals.asksHeating) return "heating";
  if (signals.asksPets) return "pets";
  if (signals.asksInclusions) return "inclusions";
  if (signals.asksRent) return "price";
  if (signals.asksLocation) return "location";
  if (normalized.includes("depot")) return "deposit";

  return "none";
}

function detectTranslatorContext(message) {
  const signals = getTranslatorMessageSignals(message);
  const text = signals.normalized;
  const listingQuestionType = detectTranslatorListingQuestionType(message);

  if (listingQuestionType === "availability") return "availability";
  if (["price", "electricity", "heating", "inclusions", "appliances", "parking"].includes(listingQuestionType)) {
    return "pricing";
  }
  if (listingQuestionType === "pets") return "pets";
  if (listingQuestionType === "deposit") return "deposit";
  if (listingQuestionType === "visit") return "visit";
  if (listingQuestionType === "location") return "location";

  if (signals.asksMoveInTiming || text.includes("disponible a partir")) {
    return "move-in timing";
  }

  if (
    text.includes("temps plein") ||
    text.includes("temps partiel") ||
    text.includes("travail") ||
    text.includes("emploi") ||
    text.includes("salaire")
  ) {
    return "qualification";
  }

  return "general inquiry";
}

function buildTranslatorFallbackTranslation(message, conversationEntries = [], threadState = null) {
  const text = normalizeTranslatorText(message);
  const signals = getTranslatorMessageSignals(message);
  const occupantsCount = extractTranslatorOccupantsCount(message);
  const listingQuestionType = detectTranslatorListingQuestionType(message);
  const inferredShortReplyContext = inferShortReplyContext(message, conversationEntries, threadState);
  const resolvedOccupantsCount = occupantsCount || inferredShortReplyContext.occupantsCountFromShortReply;
  const moveInDate = shouldIgnoreMoveInDate(listingQuestionType)
    ? null
    : extractMoveInDateValue(message) || inferredShortReplyContext.moveInDateFromShortReply;

  if (!text) {
    return "Le locataire souhaite obtenir des informations sur le logement.";
  }

  if (moveInDate && !signals.asksAvailability && !signals.asksVisit && !signals.asksRent && !signals.asksElectricity && !signals.asksHeating && !signals.asksInclusions && !signals.asksAppliances && !signals.asksParking && !signals.asksPets) {
    return `Le locataire souhaite emménager le ${moveInDate}.`;
  }

  if (signals.asksAvailability) {
    return "Est-ce que le logement est disponible ?";
  }

  if ((signals.asksElectricity || signals.asksHeating) && resolvedOccupantsCount) {
    return `Nous serons ${resolvedOccupantsCount} occupants et nous voulons savoir si l’électricité ou le chauffage sont inclus.`;
  }

  if (signals.asksElectricity || signals.asksHeating) {
    return "Quel est le loyer, et est-ce que l’électricité ou le chauffage sont inclus ?";
  }

  if (signals.asksAppliances && resolvedOccupantsCount) {
    return `Nous serons ${resolvedOccupantsCount} occupants et nous voulons savoir s’il y a des électroménagers inclus.`;
  }

  if (signals.asksAppliances) {
    return "Est-ce qu’il y a des électroménagers inclus avec le logement ?";
  }

  if (signals.asksParking && resolvedOccupantsCount) {
    return `Nous serons ${resolvedOccupantsCount} occupants et nous voulons savoir s’il y a du stationnement pour ce logement.`;
  }

  if (signals.asksParking) {
    return "Est-ce qu’il y a du stationnement pour ce logement ?";
  }

  if (signals.asksInclusions && occupantsCount) {
    return `Nous serons ${occupantsCount} occupants et nous voulons savoir quelles sont les inclusions du logement.`;
  }

  if (signals.asksInclusions) {
    return "Quelles sont les inclusions du logement ?";
  }

  if (signals.asksRent) {
    return "Quel est le loyer demandé pour ce logement ?";
  }

  if (
    text.includes("visit") ||
    text.includes("visite") ||
    text.includes("see it") ||
    text.includes("tour") ||
    text.includes("jpeux tu visiter")
  ) {
    return "Est-ce qu’il serait possible de visiter le logement ?";
  }

  if (signals.asksPets) {
    return "J’ai un animal et je voudrais savoir s’il est accepté.";
  }

  if (text.includes("depot") || text.includes("dépôt")) {
    return "Est-ce qu’un dépôt est requis pour louer le logement ?";
  }

  if (text.includes("temps plein") || text.includes("travail") || text.includes("emploi")) {
    return "J’ai un emploi à temps plein et je souhaite savoir si mon profil peut convenir.";
  }

  if (signals.asksLocation) {
    return "Est-ce que le logement est loin du métro ?";
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

function extractTranslatorHistoryEntries(history = []) {
  if (!Array.isArray(history)) return [];

  return history
    .map((entry) => {
      const sender = String(entry?.sender || "").trim().toLowerCase();
      const label = String(entry?.label || "").trim();
      const text = String(entry?.text || "").trim();
      const sections = Array.isArray(entry?.sections)
        ? entry.sections
            .map((section) => ({
              title: String(section?.title || "").trim(),
              text: String(section?.text || "").trim()
            }))
            .filter((section) => section.title || section.text)
        : [];

      if (!sender || (!text && !sections.length)) {
        return null;
      }

      return { sender, label, text, sections };
    })
    .filter(Boolean)
    .slice(-12);
}

function renderTranslatorHistoryEntry(entry) {
  const senderLabel = entry.sender === "user"
    ? "Message original du locataire"
    : entry.label || "Suggestion précédente";
  const parts = [];

  if (entry.text) {
    parts.push(entry.text);
  }

  if (entry.sections?.length) {
    entry.sections.forEach((section) => {
      const title = section.title ? `${section.title} : ` : "";
      parts.push(`${title}${section.text}`);
    });
  }

  return `${senderLabel}\n${parts.join("\n")}`.trim();
}

function getLatestTranslatorAssistantReply(conversationEntries = []) {
  if (!Array.isArray(conversationEntries) || !conversationEntries.length) {
    return "";
  }

  for (let index = conversationEntries.length - 1; index >= 0; index -= 1) {
    const entry = conversationEntries[index];
    const sender = String(entry?.sender || entry?.role || "").trim().toLowerCase();
    if (sender !== "assistant") {
      continue;
    }

    if (entry?.role === "assistant" && entry?.content) {
      try {
        const parsed = JSON.parse(String(entry.content));
        if (parsed?.reply) {
          return String(parsed.reply).trim();
        }
      } catch {
        return String(entry.content || "").trim();
      }
    }

    const replySection = Array.isArray(entry?.sections)
      ? entry.sections.find((section) => /réponse suggérée/i.test(String(section?.title || "")))
      : null;

    if (replySection?.text) {
      return String(replySection.text).trim();
    }

    if (entry?.text) {
      return String(entry.text).trim();
    }
  }

  return "";
}

function inferShortReplyContext(message, conversationEntries = [], threadState = null) {
  const rawMessage = String(message || "").trim();
  const normalizedMessage = normalizeTranslatorText(message);
  const latestAssistantReply = normalizeTranslatorText(getLatestTranslatorAssistantReply(conversationEntries));
  const lastAskedStep = String(threadState?.last_asked_step || "").trim();
  const isShortMessage = normalizedMessage.split(/\s+/).filter(Boolean).length <= 4;
  const leadingCountMatch = normalizedMessage.match(/^(\d{1,2})(?:\b|\s)/);
  const shortMoveInMatch = rawMessage.match(/\b(?:le\s+\d{1,2}|1er|\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)|maintenant|d[eè]s que|bient[oô]t|mois prochain|prochaine semaine)\b/i);
  const answersMoveInDate = Boolean(
    lastAskedStep === "move_in_date" &&
    isShortMessage &&
    shortMoveInMatch
  );
  const answersHasAnimals = Boolean(
    lastAskedStep === "has_animals" &&
    isShortMessage &&
    /\b(?:oui|non|pas d|aucun|pas)\b/.test(normalizedMessage)
  );
  const animalsInfo = answersHasAnimals ? extractAnimalsInfo(message) : { hasAnimals: null, animalType: null };
  const hasAnimalsFromShortReply = !answersHasAnimals
    ? null
    : /\b(?:non|pas d|aucun|pas)\b/.test(normalizedMessage)
      ? false
      : /\boui\b/.test(normalizedMessage)
        ? true
        : animalsInfo.hasAnimals;

  return {
    answersOccupantsQuestion: Boolean(
      leadingCountMatch &&
      /combien a habiter|combien a habiter le logement|combien a occuper|combien doccupants|combien a etre|vous seriez combien/.test(latestAssistantReply)
    ),
    occupantsCountFromShortReply: leadingCountMatch?.[1] || null,
    answersMoveInDate,
    moveInDateFromShortReply: answersMoveInDate ? shortMoveInMatch?.[0]?.trim() || null : null,
    answersHasAnimals,
    hasAnimalsFromShortReply
  };
}

function createTranslatorFieldUpdate(value, confidence = 0.7, source = "message") {
  return {
    value,
    confidence,
    source
  };
}

function getTranslatorFieldValue(threadState, fieldKey) {
  return threadState?.qualification?.[fieldKey]?.value ?? null;
}

function isTranslatorFieldKnown(threadState, fieldKey) {
  return Boolean(threadState?.qualification?.[fieldKey]?.known);
}

function extractMoveInDateValue(message) {
  const rawText = String(message || "").trim();
  const normalized = normalizeTranslatorText(message);
  const isoMatch = rawText.match(/\b\d{4}-\d{2}-\d{2}\b/);

  if (isoMatch?.[0]) {
    return isoMatch[0];
  }

  const monthMatch = rawText.match(/\b(1er|\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\b/i);
  if (monthMatch) {
    return monthMatch[0];
  }

  const relativeMatch = normalized.match(/\b(?:maintenant|immediat|immediatement|des maintenant|mois prochain|prochaine semaine)\b/);
  return relativeMatch?.[0] || null;
}

function isPreciseMoveInDateValue(value) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return false;
  }

  return (
    /\b\d{4}-\d{2}-\d{2}\b/.test(rawValue) ||
    /\b(1er|\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\b/i.test(rawValue)
  );
}

function extractEmploymentStatusValue(message) {
  const normalized = normalizeTranslatorText(message);

  if (/\btemps plein\b/.test(normalized)) return "temps plein";
  if (/\btemps partiel\b/.test(normalized)) return "temps partiel";
  if (/\btravailleur autonome\b|\bautonome\b/.test(normalized)) return "travailleur autonome";
  if (/\betudiant\b/.test(normalized)) return "étudiant";
  if (/\bretraite\b/.test(normalized)) return "retraité";
  if (/\bsans emploi\b/.test(normalized)) return "sans emploi";
  if (/\bpermanent\b/.test(normalized)) return "permanent";
  if (/\btemporaire\b/.test(normalized)) return "temporaire";

  return null;
}

function extractEmployerValue(message) {
  const rawText = String(message || "").trim();
  const employerMatch =
    rawText.match(/\b(?:je travaille chez|je suis chez|pour)\s+([A-Za-zÀ-ÿ0-9&'. -]{2,})/i) ||
    rawText.match(/\bemployeur\s*[:\-]?\s*([A-Za-zÀ-ÿ0-9&'. -]{2,})/i);

  return employerMatch?.[1]?.trim() || null;
}

function extractEmploymentDurationValue(message) {
  const rawText = String(message || "").trim();
  const match = rawText.match(/\b(?:depuis|ca fait|ça fait)\s+([A-Za-zÀ-ÿ0-9 .-]{1,20})/i) ||
    rawText.match(/\b(\d+\s*(?:an|ans|mois))\b/i);

  return match?.[1]?.trim() || null;
}

function extractIncomeValue(message) {
  const rawText = String(message || "").trim();
  const match = rawText.match(/\b\d{3,5}\s*\$?(?:\s*\/?\s*(?:mois|mensuel))?/i);
  return match?.[0]?.trim() || null;
}

function extractCreditValue(message) {
  const rawText = String(message || "").trim();
  const normalized = normalizeTranslatorText(message);
  const scoreMatch = rawText.match(/\b\d{3}\b/);

  if (/\bbon credit\b|\bexcellent credit\b/.test(normalized)) return "bon crédit";
  if (/\bmauvais credit\b|\bcredit faible\b/.test(normalized)) return "crédit faible";
  if (scoreMatch && normalized.includes("credit")) return scoreMatch[0];

  return null;
}

function extractTalValue(message) {
  const normalized = normalizeTranslatorText(message);

  if (/\bpas de tal\b|\baucun tal\b|\bpas de regie\b/.test(normalized)) return "aucun dossier";
  if (/\btal\b|\bregie\b/.test(normalized)) return "mentionné";

  return null;
}

function extractFullNameValue(message) {
  const rawText = String(message || "").trim();
  const match =
    rawText.match(/\b(?:je m['’]appelle|mon nom est|moi c['’]est)\s+([A-Za-zÀ-ÿ' -]{2,})/i);

  return match?.[1]?.trim() || null;
}

function extractPhoneValue(message) {
  const rawText = String(message || "").trim();
  const match = rawText.match(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/);
  return match?.[0]?.trim() || null;
}

function extractEmailValue(message) {
  const rawText = String(message || "").trim();
  const match = rawText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match?.[0]?.trim() || null;
}

function extractAnimalsInfo(message) {
  const normalized = normalizeTranslatorText(message);

  if (/\bpas d animaux\b|\bsans animaux\b|\baucun animal\b/.test(normalized)) {
    return { hasAnimals: false, animalType: null };
  }

  if (/\bchien\b/.test(normalized)) {
    return { hasAnimals: true, animalType: "chien" };
  }

  if (/\bchat\b/.test(normalized)) {
    return { hasAnimals: true, animalType: "chat" };
  }

  if (/\banimal|animaux\b/.test(normalized)) {
    return { hasAnimals: true, animalType: null };
  }

  return { hasAnimals: null, animalType: null };
}

function normalizeAiProvidedFields(providedFields = {}) {
  if (!providedFields || typeof providedFields !== "object" || Array.isArray(providedFields)) {
    return {};
  }

  const normalized = {};

  Object.entries(providedFields).forEach(([fieldKey, rawValue]) => {
    if (!TRANSLATOR_STEP_ORDER.includes(fieldKey)) return;
    if (rawValue === null || rawValue === undefined || rawValue === "") return;

    if (typeof rawValue === "object" && !Array.isArray(rawValue)) {
      const value = rawValue.value ?? null;
      if (value === null || value === undefined || value === "") return;
      normalized[fieldKey] = createTranslatorFieldUpdate(
        value,
        Number(rawValue.confidence || 0.7),
        String(rawValue.source || "ai").trim() || "ai"
      );
      return;
    }

    normalized[fieldKey] = createTranslatorFieldUpdate(rawValue, 0.7, "ai");
  });

  return normalized;
}

function buildDeterministicTranslatorExtraction(message, conversationEntries = [], threadState = null) {
  const listingQuestionType = detectTranslatorListingQuestionType(message);
  const translation = buildTranslatorFallbackTranslation(message, conversationEntries, threadState);
  const inferredShortReplyContext = inferShortReplyContext(message, conversationEntries, threadState);
  const occupantsCount = extractTranslatorOccupantsCount(message) || inferredShortReplyContext.occupantsCountFromShortReply;
  const fullName = extractFullNameValue(message);
  const phone = extractPhoneValue(message);
  const email = extractEmailValue(message);
  const providedFields = {};

  if (occupantsCount) {
    providedFields.occupants_total = createTranslatorFieldUpdate(Number(occupantsCount), 0.92, "deterministic");
  }

  if (fullName) {
    providedFields.full_name = createTranslatorFieldUpdate(fullName, 0.9, "deterministic");
  }

  if (phone) {
    providedFields.phone = createTranslatorFieldUpdate(phone, 0.95, "deterministic");
  }

  if (email) {
    providedFields.email = createTranslatorFieldUpdate(email, 0.95, "deterministic");
  }

  const answersPreviousStep = Boolean(
    threadState?.last_asked_step &&
    providedFields[threadState.last_asked_step]
  );
  const hasListingQuestion = listingQuestionType !== "none";
  const hasProvidedFields = Object.keys(providedFields).length > 0;

  return {
    translation,
    message_type: hasListingQuestion && hasProvidedFields
      ? "mixed"
      : hasListingQuestion
        ? "listing_question"
        : hasProvidedFields
          ? "qualification_answer"
          : "general",
    listing_question_type: listingQuestionType,
    provided_fields: providedFields,
    answers_previous_step: answersPreviousStep,
    confidence: hasProvidedFields || hasListingQuestion ? 0.82 : 0.55
  };
}

function shouldDeferTranslatorPendingQuestion(threadState, extraction) {
  const pendingStep = String(threadState?.last_asked_step || "").trim();

  if (!pendingStep) {
    return false;
  }

  if (Boolean(extraction?.answers_previous_step)) {
    return false;
  }

  const hasListingQuestion = String(extraction?.listing_question_type || "none").trim() !== "none";
  const answeredDifferentField = Object.keys(extraction?.provided_fields || {}).some((fieldKey) => fieldKey !== pendingStep);

  return hasListingQuestion || answeredDifferentField;
}

function resolveTranslatorDisplayedNextQuestion(threadState, extraction, listing = null) {
  const nextStep = getTranslatorNextStepForState(threadState, extraction, listing);

  if (!nextStep) {
    return "";
  }

  if (shouldDeferTranslatorPendingQuestion(threadState, extraction) && nextStep === threadState?.last_asked_step) {
    return "";
  }

  return buildTranslatorStepQuestion(nextStep, listing);
}

function mergeTranslatorExtraction(baseExtraction, aiExtraction = {}) {
  const resolvedListingQuestionType = TRANSLATOR_QUESTION_TYPES.includes(String(aiExtraction?.listing_question_type || "").trim())
    ? String(aiExtraction.listing_question_type).trim()
    : baseExtraction.listing_question_type;
  const mergedProvidedFields = {
    ...normalizeAiProvidedFields(aiExtraction?.provided_fields),
    ...(baseExtraction?.provided_fields || {})
  };

  if (
    shouldIgnoreMoveInDate(resolvedListingQuestionType) &&
    !isPreciseMoveInDateValue(mergedProvidedFields?.move_in_date?.value)
  ) {
    delete mergedProvidedFields.move_in_date;
  }

  return {
    translation: String(aiExtraction?.translation || "").trim() || baseExtraction.translation,
    message_type: String(aiExtraction?.message_type || "").trim() || baseExtraction.message_type,
    listing_question_type: resolvedListingQuestionType,
    provided_fields: mergedProvidedFields,
    answers_previous_step: Boolean(aiExtraction?.answers_previous_step) || Boolean(baseExtraction.answers_previous_step),
    confidence: Number(aiExtraction?.confidence || baseExtraction.confidence || 0.5)
  };
}

function normalizeTranslatorAiResponseFields(extractedFields = {}) {
  if (!extractedFields || typeof extractedFields !== "object" || Array.isArray(extractedFields)) {
    return {};
  }

  const normalized = {};

  Object.entries(extractedFields).forEach(([fieldKey, rawValue]) => {
    if (!TRANSLATOR_STEP_ORDER.includes(fieldKey)) return;
    if (rawValue === null || rawValue === undefined || rawValue === "") return;

    normalized[fieldKey] = createTranslatorFieldUpdate(rawValue, 0.78, "ai");
  });

  return normalized;
}

function listingRefusesAnimals(listing) {
  return Boolean(
    listing &&
    /\bnon\b|no\b|pas accept/i.test(String(listing?.animaux_acceptes || ""))
  );
}

function getNextTranslatorStateStep(threadState, listing = null) {
  for (const step of TRANSLATOR_STEP_ORDER) {
    if (step === "animal_type") {
      if (!isTranslatorFieldKnown(threadState, "has_animals")) {
        continue;
      }

      if (getTranslatorFieldValue(threadState, "has_animals") !== true) {
        continue;
      }

      if (listingRefusesAnimals(listing)) {
        continue;
      }
    }

    if (!isTranslatorFieldKnown(threadState, step)) {
      return step;
    }
  }

  return null;
}

function computeTranslatorVisitPrequalificationReady(threadState) {
  const requiredSteps = [
    "move_in_date",
    "occupants_total",
    "has_animals",
    "employment_status",
    "income",
    "credit",
    "tal"
  ];

  return requiredSteps.every((step) => isTranslatorFieldKnown(threadState, step));
}

function updateTranslatorThreadState(threadState, extraction, options = {}) {
  const now = new Date().toISOString();
  const updatedState = {
    ...threadState,
    employee_user_id: String(options?.employeeUserId || threadState.employee_user_id || "").trim(),
    listing_ref: options?.listingRef ? `L-${normalizeRef(options.listingRef)}` : threadState.listing_ref,
    last_detected_listing_question: extraction.listing_question_type !== "none"
      ? extraction.listing_question_type
      : threadState.last_detected_listing_question,
    last_message_at: now,
    qualification: {
      ...createTranslatorQualificationState(),
      ...(threadState?.qualification || {})
    },
    visit_prequalification: {
      required: true,
      ready: false,
      ...(threadState?.visit_prequalification || {})
    }
  };

  Object.entries(extraction.provided_fields || {}).forEach(([fieldKey, fieldUpdate]) => {
    if (!updatedState.qualification[fieldKey]) return;

    updatedState.qualification[fieldKey] = {
      value: fieldUpdate.value,
      known: true,
      confidence: Number(fieldUpdate.confidence || 0.7),
      source: String(fieldUpdate.source || "message").trim() || "message",
      updated_at: now
    };
  });

  if (
    listingRefusesAnimals(options?.listing) &&
    isTranslatorFieldKnown(updatedState, "has_animals") &&
    getTranslatorFieldValue(updatedState, "has_animals") === true
  ) {
    updatedState.qualification.animal_type = {
      value: null,
      known: true,
      confidence: 1,
      source: "system",
      updated_at: now
    };
  }

  updatedState.current_step = getNextTranslatorStateStep(updatedState, options?.listing || null);
  updatedState.visit_prequalification.ready = computeTranslatorVisitPrequalificationReady(updatedState);

  return updatedState;
}

function buildTranslatorStepQuestion(step, listing = null) {
  switch (step) {
    case "move_in_date":
      return "Quand seriez-vous prêt à emménager ?";
    case "occupants_total":
      return "Vous seriez combien à habiter le logement ?";
    case "has_animals":
      return "Avez-vous des animaux à considérer pour le dossier ?";
    case "animal_type":
      return "Quel type d’animal avez-vous ?";
    case "employment_status":
      return "Quel est votre statut d’emploi en ce moment ?";
    case "employer":
      return "Chez quel employeur travaillez-vous actuellement ?";
    case "employment_duration":
      return "Depuis combien de temps occupez-vous cet emploi ?";
    case "income":
      return "Quel est votre revenu mensuel approximatif ?";
    case "credit":
      return "Comment décririez-vous votre niveau de crédit ?";
    case "tal":
      return "Avez-vous un dossier au TAL ?";
    case "full_name":
      return "Quel est votre nom complet ?";
    case "phone":
      return "Quel est le meilleur numéro pour vous joindre ?";
    case "email":
      return "Quelle est la meilleure adresse courriel pour vous joindre ?";
    default:
      return listing?.ville
        ? `Est-ce que le secteur de ${listing.ville} vous convient toujours ?`
        : "Est-ce que ce logement pourrait vous convenir ?";
  }
}

function getTranslatorLocationLine(listing) {
  if (!listing) {
    return "Je peux vous donner plus de détails sur l’emplacement du logement.";
  }

  const address = String(listing?.adresse || listing?.address || "").trim();
  const city = String(listing?.ville || listing?.city || "").trim();

  if (address && city) {
    return `Le logement est situé au ${address}, à ${city}.`;
  }

  if (address) {
    return `Le logement est situé au ${address}.`;
  }

  if (city) {
    return `Le logement est situé à ${city}.`;
  }

  return "Je peux vous donner plus de détails sur l’emplacement du logement.";
}

function getListingParkingLine(listing) {
  const explicitParking = String(listing?.stationnement || listing?.parking || "").trim();
  const normalizedExplicit = normalizeTranslatorText(explicitParking);

  if (explicitParking) {
    if (
      parseBoolean(explicitParking) ||
      /\b(?:oui|inclus|inclu|compris|disponible|1 place|une place|stationnement disponible|parking disponible)\b/.test(normalizedExplicit)
    ) {
      return "Oui, il y a du stationnement disponible pour ce logement.";
    }

    if (
      /\b(?:non|aucun|pas de stationnement|pas de parking|sans stationnement|indisponible)\b/.test(normalizedExplicit)
    ) {
      return "Non, il n’y a pas de stationnement pour ce logement.";
    }

    return "Non, il n’y a pas de stationnement pour ce logement.";
  }

  const listingText = [
    listing?.notes,
    listing?.description,
    listing?.inclusions
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedListingText = normalizeTranslatorText(listingText);

  if (!normalizedListingText) {
    return "Non, il n’y a pas de stationnement pour ce logement.";
  }

  if (
    /\b(?:stationnement|parking)\b.*\b(?:non|aucun|pas de|sans)\b/.test(normalizedListingText) ||
    /\b(?:non|aucun|pas de|sans)\b.*\b(?:stationnement|parking)\b/.test(normalizedListingText)
  ) {
    return "Non, il n’y a pas de stationnement pour ce logement.";
  }

  if (
    /\b(?:stationnement|parking)\b.*\b(?:disponible|inclus|inclu|compris)\b/.test(normalizedListingText) ||
    /\b(?:disponible|inclus|inclu|compris)\b.*\b(?:stationnement|parking)\b/.test(normalizedListingText)
  ) {
    return "Oui, il y a du stationnement disponible pour ce logement.";
  }

  return "Non, il n’y a pas de stationnement pour ce logement.";
}

function resolveTranslatorListingAnswer(questionType, listing, message = "") {
  switch (questionType) {
    case "availability":
      return getListingAvailabilityLine(listing) || "Oui, le logement est encore disponible.";
    case "price":
    case "electricity":
    case "heating":
    case "inclusions":
    case "appliances":
      return getTranslatorPricingAnswerLine(message, listing);
    case "pets":
      return getListingPetsLine(listing) || "Non, les animaux ne sont pas acceptés pour ce logement.";
    case "parking":
      return getListingParkingLine(listing);
    case "location":
      return getTranslatorLocationLine(listing);
    case "deposit":
      return "En location résidentielle au Québec, ce n’est généralement pas un dépôt qui est demandé.";
    case "visit":
      return "Oui, c’est possible. J’ai d’abord besoin de quelques informations pour pouvoir planifier une visite avec la personne en charge.";
    default:
      return "";
  }
}

function getTranslatorNextStepForState(threadState, extraction, listing = null) {
  if (!threadState) {
    return null;
  }

  return getNextTranslatorStateStep(threadState, listing);
}

function buildTranslatorDeterministicReply({ extraction, threadState, listing, message }) {
  const answerLine = resolveTranslatorListingAnswer(
    extraction?.listing_question_type || "none",
    listing,
    message
  );
  const nextQuestion = resolveTranslatorDisplayedNextQuestion(threadState, extraction, listing);
  const hasProvidedFields = Object.keys(extraction?.provided_fields || {}).length > 0;

  if (answerLine) {
    return [answerLine, nextQuestion].filter(Boolean).join("\n\n");
  }

  if (hasProvidedFields && nextQuestion) {
    return nextQuestion;
  }

  if (nextQuestion) {
    return nextQuestion;
  }

  return listing
    ? "Est-ce que ce logement pourrait vous convenir ?"
    : "Comment souhaitez-vous poursuivre pour ce logement ?";
}

function trimCurrentTranslatorMessageFromHistory(history = [], currentMessage = "") {
  if (!Array.isArray(history) || !history.length) {
    return [];
  }

  const normalizedCurrentMessage = String(currentMessage || "").trim();

  if (!normalizedCurrentMessage) {
    return history.slice(-12);
  }

  const lastEntry = history[history.length - 1];
  const lastText = String(lastEntry?.text || "").trim();
  const isDuplicateCurrentUserMessage =
    String(lastEntry?.sender || "").trim().toLowerCase() === "user" &&
    lastText === normalizedCurrentMessage;

  return (isDuplicateCurrentUserMessage ? history.slice(0, -1) : history).slice(-12);
}

async function loadRecentTranslatorHistoryByThread(threadKey, limit = 10) {
  if (!threadKey) {
    return [];
  }

  const messages = await readJsonFile(CHAT_MESSAGES_PATH, []);

  return messages
    .filter((message) =>
      String(message.mode) === "translator" &&
      String(message.translator_thread_key || "") === String(threadKey)
    )
    .slice(-limit)
    .map((message) => {
      const sender = String(message.sender || "").trim().toLowerCase() === "user" ? "user" : "assistant";
      const text = String(message.text || "").trim();
      const sections = [];

      if (message.translation) {
        sections.push({
          title: "Français international",
          text: String(message.translation || "").trim()
        });
      }

      if (message.reply) {
        sections.push({
          title: "Réponse suggérée",
          text: String(message.reply || "").trim()
        });
      }

      if (!text && !sections.length) {
        return null;
      }

      return {
        sender,
        label: sender === "user" ? "Locataire" : "Traducteur",
        text,
        sections
      };
    })
    .filter(Boolean);
}

function trimTranslatorConversationMessages(messages = [], maxEntries = 40) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((entry) => ({
      role: String(entry?.role || "").trim().toLowerCase() === "assistant" ? "assistant" : "user",
      content: String(entry?.content || "").trim()
    }))
    .filter((entry) => entry.content)
    .slice(-maxEntries);
}

function buildNativeTranslatorAssistantPayload(entry = {}) {
  const translationSection = Array.isArray(entry?.sections)
    ? entry.sections.find((section) => /français international/i.test(String(section?.title || "")))
    : null;
  const replySection = Array.isArray(entry?.sections)
    ? entry.sections.find((section) => /réponse suggérée/i.test(String(section?.title || "")))
    : null;

  return JSON.stringify({
    translation: String(entry?.translation || translationSection?.text || "").trim(),
    reply: String(entry?.suggestedReply || replySection?.text || entry?.text || "").trim(),
    extracted_fields: {},
    next_step: null,
    visit_requested: false,
    listing_question: null
  });
}

function buildTranslatorConversationMessagesFromHistory(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }

  return trimTranslatorConversationMessages(history.map((entry) => {
    if (entry?.role && entry?.content) {
      return {
        role: String(entry.role).trim().toLowerCase() === "assistant" ? "assistant" : "user",
        content: String(entry.content).trim()
      };
    }

    const sender = String(entry?.sender || "").trim().toLowerCase();

    if (sender === "assistant" || sender === "bot") {
      return {
        role: "assistant",
        content: buildNativeTranslatorAssistantPayload(entry)
      };
    }

    const content = String(entry?.rawText || entry?.text || "").trim();
    return {
      role: "user",
      content
    };
  }));
}

function buildTranslatorConversationMessagesFromThreadState(threadState, fallbackHistory = []) {
  const threadMessages = trimTranslatorConversationMessages(threadState?.conversationMessages || []);
  if (threadMessages.length) {
    return threadMessages;
  }

  return buildTranslatorConversationMessagesFromHistory(fallbackHistory);
}

function buildTranslatorAssistantConversationEntry(payload = {}) {
  return {
    role: "assistant",
    content: JSON.stringify({
      translation: String(payload.translation || "").trim(),
      reply: String(payload.reply || "").trim(),
      extracted_fields: payload.extracted_fields || {},
      next_step: payload.next_step || null,
      visit_requested: Boolean(payload.visit_requested),
      listing_question: payload.listing_question || null
    })
  };
}

function buildTranslatorListingContext(listing) {
  if (!listing) return "";

  const formattedAvailability = formatTranslatorAvailabilityForContext(
    String(listing.disponibilite || listing.availability || "").trim()
  );

  const details = {
    ref: `L-${normalizeRef(listing.ref)}`,
    adresse: listing.adresse || listing.address || "",
    ville: listing.ville || listing.city || "",
    loyer: listing.loyer || listing.rent || "",
    disponibilite: formattedAvailability || listing.disponibilite || listing.availability || "",
    inclusions: listing.inclusions || "",
    animaux_acceptes: listing.animaux_acceptes || "",
    stationnement: listing.stationnement || "",
    electricite: listing.electricite || "",
    notes: listing.notes || "",
    description: listing.description || ""
  };

  return JSON.stringify(details, null, 2);
}

function formatTranslatorDate(value) {
  const text = String(value || "").trim();
  const isoDateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const normalizedDateText = isoDateMatch ? isoDateMatch[1] : text;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateText)) {
    return "";
  }

  const date = new Date(`${normalizedDateText}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat("fr-CA", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  const formatted = formatter.format(date);
  const [day, ...rest] = formatted.split(" ");

  if (day === "1" && rest.length) {
    return `1er ${rest.join(" ")}`;
  }

  return formatted;
}

function formatTranslatorAvailabilityForContext(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  const formattedDate = formatTranslatorDate(text);
  if (formattedDate) {
    return `disponible à partir du ${formattedDate}`;
  }

  return text;
}

function buildTranslatorSafeUnknownLine(subject) {
  return `Je n’ai pas l’information confirmée pour ${subject} dans cette fiche pour le moment.`;
}

function getListingAvailabilityLine(listing) {
  const availability = String(listing?.disponibilite || listing?.availability || "").trim();

  if (!availability) {
    return "";
  }

  const normalized = availability.toLowerCase();
  const formattedDate = formatTranslatorDate(availability);

  if (formattedDate) {
    return `Oui, le logement est disponible à partir du ${formattedDate}.`;
  }

  if (
    /plus disponible|n['’]est plus disponible|indisponible|lou[ée]|non disponible/.test(normalized)
  ) {
    return "Non, le logement n’est plus disponible.";
  }

  if (
    parseBoolean(availability) ||
    /\boui\b|disponible|maintenant|immédiat|immediat|available|still available/.test(normalized)
  ) {
    if (/maintenant|immédiat|immediat/.test(normalized)) {
      return "Oui, le logement est disponible maintenant.";
    }

    return "Oui, le logement est encore disponible.";
  }

  return `La disponibilité indiquée pour ce logement est : ${availability}.`;
}

function getListingElectricityLine(listing) {
  const explicitValue = String(listing?.electricite || "").trim();
  const normalizedExplicit = normalizeTranslatorText(explicitValue);

  if (explicitValue) {
    if (
      parseBoolean(explicitValue) ||
      /\b(?:inclu|inclus|compris|oui)\b/.test(normalizedExplicit)
    ) {
      return "Oui, l’électricité est incluse pour ce logement.";
    }

    if (
      /\b(?:non|pas incluse?|non incluse?|a la charge du locataire|aux frais du locataire)\b/.test(normalizedExplicit)
    ) {
      return "Non, l’électricité n’est pas incluse pour ce logement.";
    }

    return "Non, l’électricité n’est pas incluse pour ce logement.";
  }

  const listingText = [
    listing?.inclusions,
    listing?.notes,
    listing?.description
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedListingText = normalizeTranslatorText(listingText);

  if (!normalizedListingText) {
    return "Non, l’électricité n’est pas incluse pour ce logement.";
  }

  if (
    /\b(?:hydro|electricite)\b.*\b(?:non inclus?|pas inclus?|a la charge du locataire|aux frais du locataire)\b/.test(normalizedListingText) ||
    /\b(?:non inclus?|pas inclus?)\b.*\b(?:hydro|electricite)\b/.test(normalizedListingText)
  ) {
    return "Non, l’électricité n’est pas incluse pour ce logement.";
  }

  if (
    /\b(?:hydro|electricite)\b.*\b(?:inclu|inclus|compris)\b/.test(normalizedListingText) ||
    /\b(?:inclu|inclus|compris)\b.*\b(?:hydro|electricite)\b/.test(normalizedListingText)
  ) {
    return "Oui, l’électricité est incluse pour ce logement.";
  }

  return "Non, l’électricité n’est pas incluse pour ce logement.";
}

function getListingHeatingLine(listing) {
  const listingText = [
    listing?.notes,
    listing?.description,
    listing?.inclusions
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedListingText = normalizeTranslatorText(listingText);

  if (!normalizedListingText) {
    return "Non, le chauffage n’est pas inclus pour ce logement.";
  }

  if (
    /\bchauffage\b.*\b(?:non inclus?|pas inclus?)\b/.test(normalizedListingText) ||
    /\b(?:non inclus?|pas inclus?)\b.*\bchauffage\b/.test(normalizedListingText)
  ) {
    return "Non, le chauffage n’est pas inclus pour ce logement.";
  }

  if (
    /\bchauffage\b.*\b(?:inclu|inclus|compris)\b/.test(normalizedListingText) ||
    /\b(?:inclu|inclus|compris)\b.*\bchauffage\b/.test(normalizedListingText)
  ) {
    return "Oui, le chauffage est inclus pour ce logement.";
  }

  return "Non, le chauffage n’est pas inclus pour ce logement.";
}

function getListingInclusionsLine(listing) {
  const inclusions = String(listing?.inclusions || "").trim();

  if (!inclusions) {
    return "";
  }

  return `Les inclusions indiquées pour ce logement sont : ${inclusions}.`;
}

function getListingAppliancesLine(listing) {
  const explicitAppliances = String(listing?.electros_inclus || "").trim();
  const washerDryer = String(listing?.laveuse_secheuse || "").trim();
  const normalizedAppliances = normalizeTranslatorText(explicitAppliances);
  const normalizedWasherDryer = normalizeTranslatorText(washerDryer);

  if (explicitAppliances) {
    if (
      parseBoolean(explicitAppliances) ||
      /\b(?:oui|inclu|inclus|compris)\b/.test(normalizedAppliances)
    ) {
      return "Oui, il y a des électroménagers inclus avec ce logement.";
    }

    if (/\b(?:non|pas inclus?|aucun)\b/.test(normalizedAppliances)) {
      return "Non, il n’y a pas d’électroménagers inclus avec ce logement.";
    }
  }

  if (washerDryer) {
    if (
      parseBoolean(washerDryer) ||
      /\b(?:oui|inclu|inclus|compris)\b/.test(normalizedWasherDryer)
    ) {
      return "Oui, il y a au moins les entrées ou les appareils de laveuse-sécheuse indiqués pour ce logement.";
    }

    if (/\b(?:non|pas inclus?|aucun)\b/.test(normalizedWasherDryer)) {
      return "Non, il n’y a pas de laveuse-sécheuse incluse pour ce logement.";
    }
  }

  const listingText = [
    listing?.inclusions,
    listing?.notes,
    listing?.description
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedListingText = normalizeTranslatorText(listingText);

  if (
    /\bentrees?\s+laveuse[-\s]+secheuse\b/.test(normalizedListingText) ||
    /\bbranchements?\s+laveuse[-\s]+secheuse\b/.test(normalizedListingText)
  ) {
    return "La fiche mentionne des entrées laveuse-sécheuse, mais elle ne confirme pas que des électroménagers sont inclus.";
  }

  if (
    /\b(?:electro|electromenager|electromenagers|laveuse|secheuse)\b.*\b(?:inclu|inclus|compris)\b/.test(normalizedListingText) ||
    /\b(?:inclu|inclus|compris)\b.*\b(?:electro|electromenager|electromenagers|laveuse|secheuse)\b/.test(normalizedListingText)
  ) {
    return "Oui, il y a des électroménagers inclus avec ce logement.";
  }

  if (
    /\b(?:electro|electromenager|electromenagers|laveuse|secheuse)\b.*\b(?:non inclus?|pas inclus?|aucun)\b/.test(normalizedListingText) ||
    /\b(?:non inclus?|pas inclus?|aucun)\b.*\b(?:electro|electromenager|electromenagers|laveuse|secheuse)\b/.test(normalizedListingText)
  ) {
    return "Non, il n’y a pas d’électroménagers inclus avec ce logement.";
  }

  return buildTranslatorSafeUnknownLine("les électroménagers");
}

function getTranslatorPricingAnswerLine(message, listing) {
  const signals = getTranslatorMessageSignals(message);

  if (signals.asksElectricity) {
    return getListingElectricityLine(listing);
  }

  if (signals.asksHeating) {
    return getListingHeatingLine(listing);
  }

  if (signals.asksInclusions) {
    return getListingInclusionsLine(listing) || buildTranslatorSafeUnknownLine("les inclusions");
  }

  if (signals.asksAppliances) {
    return getListingAppliancesLine(listing);
  }

  if (signals.asksRent) {
    return listing?.loyer
      ? `Le loyer demandé est de ${listing.loyer}.`
      : buildTranslatorSafeUnknownLine("le loyer");
  }

  if (listing?.loyer) {
    return `Le loyer demandé est de ${listing.loyer}.`;
  }

  return buildTranslatorSafeUnknownLine("les informations du logement");
}

function getListingPetsLine(listing) {
  const explicitPolicy = String(listing?.animaux_acceptes || "").trim();

  if (explicitPolicy) {
    const normalized = normalizeTranslatorText(explicitPolicy);

    if (
      parseBoolean(explicitPolicy) ||
      /accept|autorise|permis|oui/.test(normalized)
    ) {
      return "Oui, les animaux sont acceptés pour ce logement.";
    }

    if (
      /non|interdit|refus|pas d['’ ]animaux|aucun animal|sans animaux/.test(normalized)
    ) {
      return "Non, les animaux ne sont pas acceptés pour ce logement.";
    }

    return "Non, les animaux ne sont pas acceptés pour ce logement.";
  }

  const listingNotes = [
    listing?.notes,
    listing?.description,
    listing?.inclusions
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const normalizedNotes = listingNotes.toLowerCase();

  if (!normalizedNotes) {
    return "Non, les animaux ne sont pas acceptés pour ce logement.";
  }

  if (/pas d['’ ]animaux|aucun animal|animaux? non accept|sans animaux/.test(normalizedNotes)) {
    return "Non, les animaux ne sont pas acceptés pour ce logement.";
  }

  if (/animaux? accept|chiens? accept|chats? accept/.test(normalizedNotes)) {
    return "Oui, les animaux sont acceptés pour ce logement.";
  }

  if (/restriction[s]? pour les animaux|restrictions? animaux|animaux? avec restrictions?/.test(normalizedNotes)) {
    return "Non, les animaux ne sont pas acceptés pour ce logement.";
  }

  return "Non, les animaux ne sont pas acceptés pour ce logement.";
}

function getListingPricingNotes(message, listing) {
  const notes = String(listing?.notes || "").trim();

  if (!notes) {
    return [];
  }

  const lowerMessage = String(message || "").toLowerCase();
  const lowerNotes = notes.toLowerCase();
  const details = [];

  if ((lowerMessage.includes("hydro") || lowerMessage.includes("électricité") || lowerMessage.includes("electricite")) && /hydro|électric|electric/.test(lowerNotes)) {
    details.push(notes);
    return details;
  }

  if ((lowerMessage.includes("chauff") || lowerMessage.includes("inclus")) && /chauff|inclus|non inclus/.test(lowerNotes)) {
    details.push(notes);
    return details;
  }

  if (/inclus|non inclus|stationnement|non-fumeur|fumeur|laveuse|sécheuse|secheuse/.test(lowerNotes)) {
    details.push(notes);
  }

  return details;
}

function buildTranslatorFieldQuestion(fieldKey, context, listing) {
  switch (fieldKey) {
    case "move_in_timing":
      if (context === "visit" || context === "availability") {
        return "Quand seriez-vous prêt à emménager ?";
      }
      if (context === "pricing" || context === "pets") {
        return "Si le logement vous convient, quand seriez-vous prêt à emménager ?";
      }
      return "Quand seriez-vous prêt à emménager ?";

    case "occupants_total":
      return context === "visit"
        ? "Avant d’aller plus loin, vous seriez combien à habiter le logement ?"
        : "Vous seriez combien à habiter le logement ?";

    case "animals":
      return "Avez-vous des animaux à considérer pour le dossier ?";

    case "search_area":
      return listing?.ville
        ? `Est-ce que le secteur de ${listing.ville} vous convient pour votre recherche ?`
        : "Quel secteur ou quelle ville recherchez-vous ?";

    case "nearby_area":
      return listing?.ville
        ? `Seriez-vous aussi ouvert à des secteurs voisins autour de ${listing.ville} ?`
        : "Seriez-vous aussi ouvert à des secteurs voisins dans un rayon d’environ 20 km ?";

    case "employment_status":
      return "Quel est votre statut d’emploi en ce moment ?";

    case "job":
      return "Quel type d’emploi occupez-vous actuellement ?";

    case "employer":
      return "Chez quel employeur travaillez-vous actuellement ?";

    case "employment_duration":
      return "Depuis combien de temps occupez-vous cet emploi ?";

    case "monthly_income":
      return "Quel est votre revenu mensuel approximatif ?";

    case "credit_level":
      return "Comment décririez-vous votre niveau de crédit ?";

    case "tal_record":
      return "Avez-vous un dossier au TAL ?";

    case "full_name":
      return "Quel est votre nom complet ?";

    case "phone":
      return "Quel est le meilleur numéro pour vous joindre ?";

    case "email":
      return "Quelle est la meilleure adresse courriel pour vous joindre ?";

    default:
      return "Quand seriez-vous prêt à emménager ?";
  }
}

function buildTranslatorNextStep(context, qualificationSnapshot = {}, listing = null, message = "") {
  const fields = qualificationSnapshot?.fields || {};
  const messageSignals = getTranslatorMessageSignals(message);
  const lowerMessage = String(message || "").toLowerCase();
  const mentionsSpecificAnimal = /chien|chat|dog|cat/.test(lowerMessage);

  if (context === "pets" && !mentionsSpecificAnimal) {
    return "Quel type d’animal avez-vous ?";
  }

  if (context === "pricing" && (messageSignals.asksElectricity || messageSignals.asksHeating || messageSignals.asksInclusions || messageSignals.asksAppliances)) {
    if (!fields.move_in_timing) {
      return "Quand seriez-vous prêt à emménager ?";
    }

    return "Est-ce que ce logement pourrait vous convenir ?";
  }

  const fieldOrderByContext = {
    availability: ["move_in_timing", "occupants_total", "animals", "employment_status", "job", "monthly_income", "credit_level", "tal_record", "full_name", "phone", "email"],
    pricing: ["move_in_timing", "occupants_total", "animals", "employment_status", "job", "monthly_income", "credit_level", "tal_record", "full_name", "phone", "email"],
    pets: ["move_in_timing", "occupants_total", "employment_status", "job", "monthly_income", "credit_level", "tal_record", "full_name", "phone", "email"],
    visit: ["move_in_timing", "occupants_total", "animals", "employment_status", "job", "monthly_income", "credit_level", "tal_record", "full_name", "phone", "email"],
    "move-in timing": ["occupants_total", "animals", "employment_status", "job", "monthly_income", "credit_level", "tal_record", "full_name", "phone", "email"],
    location: ["search_area", "nearby_area", "move_in_timing", "occupants_total", "animals", "employment_status", "job"],
    qualification: ["employment_status", "job", "employer", "employment_duration", "monthly_income", "credit_level", "tal_record", "full_name", "phone", "email"],
    "general inquiry": ["move_in_timing", "search_area", "occupants_total", "animals", "employment_status", "job", "full_name", "phone", "email"]
  };

  const orderedFields = fieldOrderByContext[context] || fieldOrderByContext["general inquiry"];
  const nextField = orderedFields.find((fieldKey) => !fields[fieldKey]);

  if (nextField) {
    return buildTranslatorFieldQuestion(nextField, context, listing);
  }

  if (context === "pricing") {
    return "Est-ce que ce logement correspond à ce que vous cherchez ?";
  }

  if (context === "visit") {
    return "Avant d’aller plus loin pour une visite, est-ce que ce logement correspond bien à ce que vous recherchez ?";
  }

  return "Est-ce que ce logement correspond à ce que vous recherchez ?";
}

function extractQualificationSnapshot(message, conversationEntries = []) {
  const rawJoinedText = [
    ...conversationEntries.map((entry) => renderTranslatorHistoryEntry(entry)),
    String(message || "").trim()
  ]
    .filter(Boolean)
    .join("\n");
  const joinedText = normalizeTranslatorText(rawJoinedText);
  const occupantsCount = extractTranslatorOccupantsCount(rawJoinedText);
  const inferredShortReplyContext = inferShortReplyContext(message, conversationEntries);

  const fields = {
    full_name: /je m['’]appelle|mon nom est|moi c['’]est/.test(joinedText),
    phone: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(rawJoinedText),
    email: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(rawJoinedText),
    search_area: /(?:je cherche|je cherche dans|dans le secteur de|je veux louer à|je cherche à|quartier|secteur|ville de)\s+[a-zà-ÿ-]{3,}/.test(joinedText),
    nearby_area: /20\s?km|secteurs? voisins?|secteurs? autour|ouvert à.*secteurs?|flexible sur le secteur|pas obligé.*secteur|proche secteur/.test(joinedText),
    move_in_timing: /emménag|emmenag|d[èe]s maintenant|maintenant|immédiat|immediat|mois prochain|prochaine semaine|1er|janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|\d{4}-\d{2}-\d{2}/.test(joinedText),
    job: /je travaille|je suis\s+(?:infirmi|serveur|serveuse|technicien|technicienne|enseignant|enseignante|employ|prépos|prepos|chauffeur|vendeur|vendeuse|gestionnaire|commis|mécanicien|mecanicien|ouvrier|journalier|étudiant|etudiant|autonome|retraité|retraite)|emploi|travail|job|poste/.test(joinedText),
    employer: /employeur|je travaille chez|je suis chez|compagnie|entreprise|pour\s+[a-z0-9&'. -]{3,}/.test(joinedText),
    employment_duration: /depuis\s+\d|ça fait\s+\d|ca fait\s+\d|\d+\s*(?:an|ans|mois)/.test(joinedText),
    employment_status: /temps plein|temps partiel|autonome|travailleur autonome|étudiant|etudiant|retraité|retraite|sans emploi|permanent|temporaire|contractuel/.test(joinedText),
    monthly_income: /\b\d{3,5}\s*\$|\brevenu|\bsalaire|\bpar mois|\bmensuel/.test(rawJoinedText.toLowerCase()),
    credit_level: /crédit|credit|cote|score/.test(joinedText),
    tal_record: /\btal\b|régie|regie/.test(joinedText),
    occupants_total:
      Boolean(occupantsCount) ||
      inferredShortReplyContext.answersOccupantsQuestion ||
      /occupant|personne|nous sommes|on est|famille|enfant|avec mon conjoint|avec ma conjointe|avec ma femme|avec mon mari/.test(joinedText),
    animals: /chien|chat|animal/.test(joinedText)
  };

  const fieldLabels = {
    full_name: "nom complet",
    phone: "téléphone",
    email: "courriel",
    search_area: "ville ou secteur recherché",
    nearby_area: "ouverture à un secteur voisin",
    move_in_timing: "date d’emménagement",
    job: "emploi",
    employer: "employeur",
    employment_duration: "ancienneté en emploi",
    employment_status: "statut d’emploi",
    monthly_income: "revenu mensuel",
    credit_level: "niveau de crédit",
    tal_record: "situation TAL",
    occupants_total: "nombre d’occupants",
    animals: "animaux"
  };

  const orderedFields = [
    "full_name",
    "phone",
    "email",
    "search_area",
    "nearby_area",
    "move_in_timing",
    "job",
    "employer",
    "employment_duration",
    "employment_status",
    "monthly_income",
    "credit_level",
    "tal_record",
    "occupants_total",
    "animals"
  ];

  return {
    fields,
    known: orderedFields.filter((fieldKey) => fields[fieldKey]).map((fieldKey) => fieldLabels[fieldKey]),
    missing: orderedFields.filter((fieldKey) => !fields[fieldKey]).map((fieldKey) => fieldLabels[fieldKey])
  };
}

function buildTranslatorFallbackReply(message, options = {}) {
  const context = detectTranslatorContext(message);
  const listing = options?.listing || null;
  const qualificationSnapshot = options?.qualificationSnapshot || { missing: [] };
  const signals = getTranslatorMessageSignals(message);
  const nextStep = buildTranslatorNextStep(context, qualificationSnapshot, listing, message);

  if (context === "availability") {
    const availabilityLine = getListingAvailabilityLine(listing);

    return [
      availabilityLine || buildTranslatorSafeUnknownLine("la disponibilité"),
      nextStep
    ].filter(Boolean).join("\n\n");
  }

  if (context === "pricing") {
    const pricingAnswerLine = getTranslatorPricingAnswerLine(message, listing);
    const pricingNotes =
      signals.asksElectricity || signals.asksHeating || signals.asksInclusions || signals.asksAppliances
        ? []
        : getListingPricingNotes(message, listing);

    return [
      pricingAnswerLine,
      ...pricingNotes,
      signals.asksInclusions ? "" : (listing?.inclusions ? `Les inclusions notées sont : ${listing.inclusions}.` : ""),
      nextStep
    ].filter(Boolean).join("\n\n");
  }

  if (context === "pets") {
    const petsLine = getListingPetsLine(listing);

    return [
      petsLine
        ? petsLine
        : "Je peux vérifier la politique concernant les animaux pour ce logement.",
      nextStep
    ].filter(Boolean).join("\n\n");
  }

  if (context === "visit") {
    return [
      "Oui, c’est possible. J’ai d’abord besoin de quelques informations pour pouvoir planifier une visite avec la personne en charge.",
      nextStep
    ].filter(Boolean).join("\n\n");
  }

  if (context === "deposit") {
    return [
      "En location résidentielle au Québec, ce n’est généralement pas un dépôt qui est demandé.",
      "Je peux vous préciser les conditions applicables au logement si vous voulez."
    ].join("\n\n");
  }

  if (context === "move-in timing") {
    const availabilityLine = getListingAvailabilityLine(listing);

    return [
      availabilityLine
        ? availabilityLine
        : "Je peux vous confirmer la date de disponibilité du logement.",
      nextStep
    ].filter(Boolean).join("\n\n");
  }

  if (context === "qualification") {
    return [
      "Merci pour les précisions.",
      nextStep
    ].join("\n\n");
  }

  if (context === "location") {
    return [
      listing?.adresse || listing?.ville
        ? `Le logement est situé ${listing?.adresse ? `au ${listing.adresse}` : ""}${listing?.ville ? `${listing?.adresse ? ", " : ""}${listing.ville}` : ""}.`
        : "Je peux vous donner plus de détails sur l’emplacement du logement.",
      nextStep
    ].join("\n\n");
  }

  return [
    listing?.loyer || listing?.disponibilite
      ? `Je peux vous confirmer les informations du logement${listing?.loyer ? `, notamment le loyer à ${listing.loyer}` : ""}${listing?.disponibilite ? ` et la disponibilité ${String(listing.disponibilite).toLowerCase()}` : ""}.`
      : "Je peux vous donner les informations utiles sur le logement.",
    nextStep
  ].join("\n\n");
}

function shouldPreferDeterministicTranslatorReply(context, reply, listing, qualificationSnapshot = {}) {
  const normalizedReply = String(reply || "").trim().toLowerCase();

  if (!normalizedReply) {
    return true;
  }

  const asksIdentityTooEarly = /(nom complet|votre nom|num[eé]ro|t[ée]l[ée]phone|courriel|email)/.test(normalizedReply);

  if (context === "availability") {
    const availability = String(listing?.disponibilite || listing?.availability || "").trim();
    if (availability) {
      if (normalizedReply.includes(availability.toLowerCase())) {
        return true;
      }

      if (!qualificationSnapshot?.fields?.move_in_timing && asksIdentityTooEarly) {
        return true;
      }
    }
  }

  if (context === "pets" && getListingPetsLine(listing) && /je peux v[ée]rifier|je peux verifier/.test(normalizedReply)) {
    return true;
  }

  return false;
}

function buildTranslatorFallbackPayload(message, options = {}) {
  return {
    translation: buildTranslatorFallbackTranslation(message, options?.conversationEntries || []),
    reply: buildTranslatorFallbackReply(message, options),
    context: detectTranslatorContext(message)
  };
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || "").trim();

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authorization.slice(7).trim();
}

async function resolveClientContext(req) {
  if (!supabaseServerClient) {
    throw createHttpError(503, "Authentification client backend non configurée.");
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    throw createHttpError(401, "Jeton d’authentification manquant.");
  }

  // Assumption: the backend can validate the Supabase access token by calling Supabase Auth.
  // If that verification is unavailable, these routes fail closed rather than exposing admin data.
  const { data, error } = await supabaseServerClient.auth.getUser(accessToken);

  if (error || !data?.user) {
    throw createHttpError(401, "Session client invalide.");
  }

  const user = data.user;
  const clientId = resolveClientIdFromUser(user);
  const role = resolveRoleFromUser(user);

  if (role && role !== "client") {
    throw createHttpError(403, "Accès client refusé.");
  }

  if (!clientId) {
    throw createHttpError(403, "Accès client refusé.");
  }

  return { user, clientId, role: role || "client" };
}

async function resolveAdminContext(req) {
  if (!supabaseServerClient) {
    throw createHttpError(503, "Authentification admin backend non configurée.");
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    throw createHttpError(401, "Jeton d’authentification manquant.");
  }

  const { data, error } = await supabaseServerClient.auth.getUser(accessToken);

  if (error || !data?.user) {
    throw createHttpError(401, "Session admin invalide.");
  }

  const user = data.user;
  const role = resolveRoleFromUser(user);

  if (role === "admin") {
    return { user, role };
  }

  const { data: adminRow, error: adminError } = await supabaseServerClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError) {
    throw createHttpError(500, "Erreur lecture admin_users.");
  }

  if (!adminRow) {
    throw createHttpError(403, "Accès administrateur refusé.");
  }

  return { user, role: "admin" };
}

async function handleAdminRoute(req, res, handler) {
  try {
    const context = await resolveAdminContext(req);
    return await handler(context);
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Erreur admin."
    });
  }
}

async function resolveEmployeeContext(req) {
  if (!supabaseServerClient) {
    throw createHttpError(503, "Authentification employé backend non configurée.");
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    throw createHttpError(401, "Jeton d’authentification manquant.");
  }

  const { data, error } = await supabaseServerClient.auth.getUser(accessToken);

  if (error || !data?.user) {
    throw createHttpError(401, "Session employé invalide.");
  }

  const user = data.user;
  const role = resolveRoleFromUser(user);

  if (role === "employee") {
    return { user, role };
  }

  if (role === "admin") {
    throw createHttpError(403, "Accès employé refusé.");
  }

  if (resolveClientIdFromUser(user)) {
    throw createHttpError(403, "Accès employé refusé.");
  }

  return { user, role: "employee" };
}

async function handleEmployeeRoute(req, res, handler) {
  try {
    const context = await resolveEmployeeContext(req);
    return await handler(context);
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Erreur employé."
    });
  }
}

async function handleClientRoute(req, res, handler) {
  try {
    const context = await resolveClientContext(req);
    return await handler(context);
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Erreur client."
    });
  }
}

async function generateTranslatorPayload(message, options = {}) {
  const listing = options?.listing || null;
  const threadState = options?.translatorThreadKey
    ? await getTranslatorThreadState(options.translatorThreadKey, {
        employeeUserId: options?.userId,
        listingRef: listing?.ref || ""
      })
    : createDefaultTranslatorThreadState("", options?.userId, listing?.ref || "");
  const requestConversationHistory = trimTranslatorConversationMessages(options?.conversationHistory || []);
  const nativeConversationHistory = buildTranslatorConversationMessagesFromThreadState(
    threadState,
    requestConversationHistory
  );
  const deterministicExtraction = buildDeterministicTranslatorExtraction(message, requestConversationHistory, threadState);
  const aiResponse = await openaiService.generateTranslatorResponse({
    message,
    conversationHistory: nativeConversationHistory,
    threadState,
    listing
  });
  const extraction = mergeTranslatorExtraction(deterministicExtraction, {
    translation: aiResponse?.translation,
    message_type: null,
    listing_question_type: aiResponse?.listing_question || deterministicExtraction.listing_question_type,
    provided_fields: normalizeTranslatorAiResponseFields(aiResponse?.extracted_fields),
    answers_previous_step: Boolean(
      threadState?.last_asked_step &&
      aiResponse?.extracted_fields &&
      aiResponse.extracted_fields[threadState.last_asked_step] !== null &&
      aiResponse.extracted_fields[threadState.last_asked_step] !== undefined &&
      aiResponse.extracted_fields[threadState.last_asked_step] !== ""
    ),
    confidence: 0.8
  });
  const hasAnimalsInMessage = /\b(chien|chat|animal|animaux|chiot|pitou|minou|perroquet|lapin|cochon d.inde)\b/i.test(message);
  const employmentInMessage = /\b(je travaille|cuisinier|cuisiniere|infirmier|infirmiere|comptable|electricien|plombier|professeur|chauffeur|employe|travail|temps plein|temps partiel|autonome|retraite|etudiant)\b/i.test(message);

  if (hasAnimalsInMessage && listingRefusesAnimals(listing)) {
    extraction.provided_fields.has_animals = extraction.provided_fields.has_animals || createTranslatorFieldUpdate(true, 0.88, "heuristic");
  }

  if (employmentInMessage && !extraction.provided_fields.employment_status) {
    extraction.provided_fields.employment_status = createTranslatorFieldUpdate("mentionné", 0.68, "heuristic");
  }

  const updatedThreadState = updateTranslatorThreadState(threadState, extraction, {
    employeeUserId: options?.userId,
    listingRef: listing?.ref || "",
    listing
  });
  const nextStep = getTranslatorNextStepForState(updatedThreadState, extraction, listing);
  const deterministicReply = buildTranslatorDeterministicReply({
    extraction,
    threadState: updatedThreadState,
    listing,
    message
  });
  updatedThreadState.current_step = nextStep;
  updatedThreadState.last_asked_step = nextStep;
  updatedThreadState.conversationMessages = trimTranslatorConversationMessages([
    ...nativeConversationHistory,
    { role: "user", content: String(message || "").trim() }
  ]);

  if (options?.translatorThreadKey) {
    // saved after assistant message is appended below
  }

  const context = extraction.listing_question_type === "none"
    ? (
        Object.keys(extraction.provided_fields || {}).length
          ? "qualification"
          : detectTranslatorContext(message)
      )
    : detectTranslatorContext(message);
  const translation = String(aiResponse?.translation || "").trim() || buildTranslatorFallbackTranslation(message, requestConversationHistory, threadState);
  const reply = String(aiResponse?.reply || "").trim() || deterministicReply;
  const visitRequested = Boolean(aiResponse?.visit_requested) || extraction.listing_question_type === "visit";
  const listingQuestion = String(aiResponse?.listing_question || extraction.listing_question_type || "none").trim() || null;

  updatedThreadState.conversationMessages = trimTranslatorConversationMessages([
    ...updatedThreadState.conversationMessages,
    buildTranslatorAssistantConversationEntry({
      translation,
      reply,
      extracted_fields: Object.fromEntries(
        Object.entries(extraction.provided_fields || {}).map(([fieldKey, value]) => [fieldKey, value?.value ?? null])
      ),
      next_step: nextStep,
      visit_requested: visitRequested,
      listing_question: listingQuestion
    })
  ]);

  if (options?.translatorThreadKey) {
    await saveTranslatorThreadState(updatedThreadState);
  }

  return {
    translation,
    reply,
    context,
    extracted_fields: Object.fromEntries(
      Object.entries(extraction.provided_fields || {}).map(([fieldKey, value]) => [fieldKey, value?.value ?? null])
    ),
    next_step: nextStep,
    visit_requested: visitRequested,
    listing_question: listingQuestion,
    thread_state: updatedThreadState
  };
}

async function generateListingReply(message, listing) {
  return openaiService.streamListingReply(message, listing);
}

async function buildTranslatorEvaluationPayload(threadKey, listingRef = "") {
  const normalizedListingRef = normalizeRef(listingRef || "");
  const listings = await loadListingsMap();
  const listing = normalizedListingRef ? listings[normalizedListingRef] || null : null;
  const threadState = threadKey
    ? await getTranslatorThreadState(threadKey, { listingRef: normalizedListingRef })
    : createDefaultTranslatorThreadState("", "", normalizedListingRef);

  if (threadKey) {
    await saveTranslatorThreadState(threadState);
  }

  const evaluation = await qualificationService.evaluateTenantEligibility(threadState, listing);
  const matches = evaluation.status === "refused"
    ? await qualificationService.findMatchingListings(threadState, {
        excludeRef: normalizedListingRef,
        limit: 3
      })
    : [];
  const visit = qualificationService.getVisitRequirements(threadState, evaluation);
  visit.requested = String(threadState?.last_detected_listing_question || "").trim() === "visit";

  return {
    listing_ref: normalizedListingRef ? `L-${normalizedListingRef}` : "",
    thread_state: threadState,
    evaluation,
    matches,
    visit
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

function splitToIdeaChunks(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[•●▪◦]/g, "\n- ")
    .replace(/\n\s*\d+[).]\s+/g, "\n- ")
    .split("\n")
    .flatMap((rawLine) => {
      const line = String(rawLine || "")
        .trim()
        .replace(/^[-*]\s*/, "")
        .replace(/^(\d+[).]\s*)+/, "")
        .replace(/^`|`$/g, "")
        .replace(/\*\*/g, "")
        .trim();
      if (!line) return [];
      const withoutHeading = line.replace(
        /^(opportunit[eé]s?|risques?|recommandations?|strat[eé]gie|analyse|synth[eè]se|r[eé]sum[eé])\s*:\s*/i,
        ""
      ).trim();
      if (!withoutHeading) return [];
      return withoutHeading
        .split(/(?<=[.;!?])\s+(?=[A-ZÀ-ÖØ-Ý0-9])/)
        .map(part => part.trim())
        .filter(Boolean);
    });
}

function formatAsCrmBulletNotes(modelText, sourceText = "") {
  const bannedStandalone = /^(opportunit[eé]s?|risques?|recommandations?|strat[eé]gie|analyse|synth[eè]se|r[eé]sum[eé])$/i;
  const seen = new Set();
  const bullets = [];
  for (const chunk of splitToIdeaChunks(modelText)) {
    const line = String(chunk || "").replace(/\s+/g, " ").trim();
    if (!line || bannedStandalone.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(`- ${line}`);
  }
  if (bullets.length > 0) return bullets.join("\n");

  const fallback = splitToIdeaChunks(sourceText)
    .slice(0, 14)
    .map(line => `- ${line}`);
  return fallback.length ? fallback.join("\n") : "- (aucune note exploitable)";
}

app.post("/api/ai/summarize", async (req, res) => {
  const type = String(req.body?.type || "deal").trim();
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ ok: false, error: "Texte manquant." });
  if (!openai) return res.status(503).json({ ok: false, error: "OPENAI_API_KEY non configurée." });
  const contextLabel = type === "vendeur" ? "Notes vendeur" : "Notes deal acquisition";
  const systemPrompt = [
    "Tu es un assistant administratif CRM pour une équipe d'acquisition immobilière.",
    "Tu NE FAIS PAS d'analyse stratégique et tu NE DONNES PAS de recommandations.",
    "Objectif unique: reformater les notes brutes en notes CRM internes claires.",
    "Règles strictes:",
    "- Sortie uniquement en bullet points commençant par '- '",
    "- Une idée par bullet, jamais de paragraphe",
    "- Conserver les nuances/incertitudes présentes (ex: semble, je pense, possiblement)",
    "- Préserver au maximum les mots et le sens d'origine",
    "- Enlever fillers, hésitations et répétitions inutiles",
    "- Interdiction de créer sections 'opportunités/risques/stratégie'",
    "- Interdiction d'ajouter des interprétations non explicites dans les notes",
    "- Interdiction d'analyse psychologique",
  ].join("\n");
  const userPrompt = `${contextLabel}\n\nTransforme ces notes en format CRM interne:\n${text}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.1,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]
    });
    const rawSummary = completion.choices?.[0]?.message?.content?.trim() || "";
    const summary = formatAsCrmBulletNotes(rawSummary, text);
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(502).json({ ok: false, error: err?.message || "Erreur API OpenAI." });
  }
});

// ─── Phone Number Finder ─────────────────────────────────────────────────────
const GOOGLE_PLACES_KEY = String(process.env.GOOGLE_PLACES_API_KEY || "").trim();

function strSim(a, b) {
  if (!a || !b) return 0;
  const clean = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  a = clean(a); b = clean(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tri = s => {
    const t = new Set();
    const w = ` ${s} `;
    for (let i = 0; i < w.length - 2; i++) t.add(w.slice(i, i + 3));
    return t;
  };
  const ta = tri(a), tb = tri(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

async function gPlacesSearch(query) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=fr&key=${GOOGLE_PLACES_KEY}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const d = await r.json();
  if (d.status === "REQUEST_DENIED") throw new Error(`Google Places: ${d.error_message || "REQUEST_DENIED"}`);
  return d?.results || [];
}

async function gPlaceDetails(placeId) {
  const fields = "name,formatted_address,formatted_phone_number,international_phone_number,website,business_status";
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&language=fr&key=${GOOGLE_PLACES_KEY}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const d = await r.json();
  return d?.result || {};
}

function normalizeLookupKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanLookupValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  return String(value).replace(/\s+/g, " ").trim();
}

const COMPANY_NAME_HINT_RE = /\b(?:inc|ltee|ltd|llc|corp|corporation|compagnie|company|co|groupe|group|entreprise|business|service|services|renovation|construction|immobilier|realty|property|properties|holdings|restaurant|cafe|garage|atelier|clinic|clinique|pharmacie|hotel|motel|association|centre|center|studio|consulting|solution|solutions|tech|technologie|technologies|bureau|cabinet|banque|bank|insurance|assurance)\b/;
const PERSON_JOINER_WORDS = new Set(["de", "du", "des", "la", "le", "les", "d", "st", "saint", "sainte", "van", "von"]);

function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = cleanLookupValue(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function looksLikePostalCode(value) {
  const txt = cleanLookupValue(value);
  if (!txt) return false;
  return /[a-z]\d[a-z][ -]?\d[a-z]\d/i.test(txt) || /\b\d{5}(?:-\d{4})?\b/.test(txt);
}

function looksLikeAddress(value) {
  const txt = cleanLookupValue(value);
  if (!txt) return false;
  return /\d/.test(txt) && /(rue|street|st\b|avenue|av\b|boulevard|blvd|road|rd\b|chemin|route|lane|ln\b|drive|dr\b|suite|bureau|unit|apt|appartement)/i.test(txt);
}

function looksLikePhone(value) {
  return /\+?\d[\d\s().-]{6,}\d/.test(cleanLookupValue(value));
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanLookupValue(value));
}

function hasCompanyNameHints(value) {
  const norm = normalizeLookupKey(value);
  if (!norm) return false;
  return COMPANY_NAME_HINT_RE.test(norm);
}

function isLikelyPersonalName(value) {
  const txt = cleanLookupValue(value);
  if (!txt) return false;
  if (looksLikeAddress(txt) || looksLikePostalCode(txt) || looksLikePhone(txt) || looksLikeEmail(txt)) return false;
  if (hasCompanyNameHints(txt) || /[&/@]/.test(txt)) return false;

  const norm = normalizeLookupKey(txt);
  if (!norm || /\d/.test(norm)) return false;
  const words = norm.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  const meaningful = words.filter(word => !PERSON_JOINER_WORDS.has(word));
  if (meaningful.length < 2) return false;
  return meaningful.every(word => word.length >= 2 && word.length <= 24);
}

function sanitizeBusinessName(value, { allowAmbiguous = true } = {}) {
  const txt = cleanLookupValue(value);
  if (!txt) return "";
  if (looksLikeAddress(txt) || looksLikePostalCode(txt) || looksLikePhone(txt) || looksLikeEmail(txt)) return "";
  if (!/[a-z\u00c0-\u017f]/i.test(txt)) return "";
  const hasHint = hasCompanyNameHints(txt);
  if (isLikelyPersonalName(txt) && !hasHint) return "";
  if (!allowAmbiguous && !hasHint) return "";
  return txt;
}

function extractPrimaryAddressNumbers(value) {
  const firstChunk = cleanLookupValue(value).split(",")[0] || "";
  const matches = firstChunk.match(/\b\d{1,6}\b/g) || [];
  return [...new Set(matches)];
}

function hasSharedAddressNumber(left, right) {
  const a = extractPrimaryAddressNumbers(left);
  const b = extractPrimaryAddressNumbers(right);
  if (!a.length || !b.length) return true;
  return a.some(num => b.includes(num));
}

function normalizeLookupPhoneKey(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function mergeLookupPhones(...sources) {
  const merged = [];
  const seen = new Set();
  const addOne = (value) => {
    const txt = cleanLookupValue(value);
    if (!txt) return;
    const key = normalizeLookupPhoneKey(txt);
    if (!key || key.length < 7 || seen.has(key)) return;
    seen.add(key);
    merged.push(txt);
  };
  for (const source of sources) {
    if (Array.isArray(source)) source.forEach(addOne);
    else addOne(source);
  }
  return merged;
}

function candidateIdentityKey(candidate = {}) {
  const byPlaceId = cleanLookupValue(candidate.placeId);
  if (byPlaceId) return `pid:${byPlaceId}`;
  const byName = normalizeLookupKey(candidate.name);
  const byAddress = normalizeLookupKey(candidate.address);
  const byPhone = normalizeLookupPhoneKey(candidate.phone);
  return `txt:${byName}|${byAddress}|${byPhone}`;
}

async function runPlacesQuery({ query, expectedName = "", expectedAddress = "", queryType = "generic" }) {
  const cleanQuery = cleanLookupValue(query);
  if (!cleanQuery) return [];
  const baseResults = await gPlacesSearch(cleanQuery);
  if (!Array.isArray(baseResults) || !baseResults.length) return [];

  const candidates = await Promise.all(baseResults.slice(0, 3).map(async result => {
    let details = {};
    try { details = await gPlaceDetails(result.place_id); } catch {}
    const placeName = cleanLookupValue(details.name || result.name);
    const placeAddress = cleanLookupValue(details.formatted_address || result.formatted_address);
    const phone = cleanLookupValue(details.formatted_phone_number || details.international_phone_number);
    const website = cleanLookupValue(details.website);

    const nameSim = expectedName ? strSim(expectedName, placeName) : null;
    const addrSim = expectedAddress ? strSim(expectedAddress, placeAddress) : null;
    let confidence;
    if (nameSim !== null && addrSim !== null) confidence = Math.round((nameSim * 0.6 + addrSim * 0.4) * 100);
    else if (nameSim !== null) confidence = Math.round(nameSim * 100);
    else if (addrSim !== null) confidence = Math.round(addrSim * 100);
    else confidence = 65;

    return {
      placeId: cleanLookupValue(result.place_id),
      name: placeName,
      address: placeAddress,
      phone,
      website,
      confidence,
      queryType
    };
  }));

  return candidates
    .filter(candidate => candidate.name || candidate.address || candidate.phone)
    .sort((a, b) => b.confidence - a.confidence);
}

function inferLookupFields(rawRow = {}) {
  const entries = Object.entries(rawRow || {})
    .map(([key, value]) => ({
      key,
      normKey: normalizeLookupKey(key),
      value: cleanLookupValue(value)
    }))
    .filter(entry => entry.value);

  const findByPatterns = (patterns) => {
    const hit = entries.find(entry => patterns.some(rx => rx.test(entry.normKey)));
    return hit ? hit.value : "";
  };
  const isContactKey = normKey => /\b(contact|proprietaire|owner|nom complet|full name|personne|prenom)\b/.test(normKey);
  const isCompanyKey = normKey => /\b(company|compagnie|entreprise|organisation|raison sociale|societe|business|trade)\b/.test(normKey);

  const byKey = {
    address: findByPatterns([
      /\badresse immeuble\b/,
      /\badresse postale\b/,
      /\badresse\b/,
      /\baddress\b/,
      /\bstreet\b/,
      /\brue\b/,
      /\bbuilding\b/,
      /\bimmeuble\b/,
    ]),
    city: findByPatterns([/\bville\b/, /\bcity\b/, /\bmunicipalite\b/, /\bmunicipality\b/, /\btown\b/]),
    province: findByPatterns([/\bprovince\b/, /\betat\b/, /\bstate\b/, /\bregion\b/]),
    postalCode: findByPatterns([/\bcode postal\b/, /\bpostal\b/, /\bzip\b/, /\bzipcode\b/, /\bcp\b/]),
    country: findByPatterns([/\bpays\b/, /\bcountry\b/]),
    companyName: findByPatterns([
      /\bcompany\b/,
      /\bcompagnie\b/,
      /\bentreprise\b/,
      /\borganisation\b/,
      /\braison sociale\b/,
      /\bsociete\b/,
      /\bbusiness\b/,
      /\bnom entreprise\b/,
      /\bnom compagnie\b/,
    ]),
    contactName: findByPatterns([
      /\bcontact\b/,
      /\bproprietaire\b/,
      /\bowner\b/,
      /\bnom complet\b/,
      /\bfull name\b/,
      /\bpersonne\b/,
      /\bprenom\b/,
      /\bnom\b/,
    ]),
    genericName: findByPatterns([/\bname\b/, /\bnom\b/, /\btitre\b/]),
  };

  if (!byKey.address) {
    const guessedAddress = entries.find(entry => looksLikeAddress(entry.value));
    byKey.address = guessedAddress ? guessedAddress.value : "";
  }

  if (!byKey.postalCode) {
    const guessedPostal = entries.find(entry => looksLikePostalCode(entry.value));
    byKey.postalCode = guessedPostal ? guessedPostal.value : "";
  }

  byKey.companyName = sanitizeBusinessName(byKey.companyName);

  if (!byKey.companyName && !byKey.contactName && byKey.genericName) {
    byKey.companyName = sanitizeBusinessName(byKey.genericName);
  }

  if (!byKey.companyName) {
    const explicitBusiness = entries.find(entry => isCompanyKey(entry.normKey) && sanitizeBusinessName(entry.value));
    byKey.companyName = explicitBusiness ? sanitizeBusinessName(explicitBusiness.value) : "";
  }

  if (!byKey.companyName) {
    const hintedBusiness = entries.find(entry => (
      !isContactKey(entry.normKey) &&
      hasCompanyNameHints(entry.value) &&
      sanitizeBusinessName(entry.value)
    ));
    byKey.companyName = hintedBusiness ? sanitizeBusinessName(hintedBusiness.value) : "";
  }

  if (!byKey.companyName) {
    const candidate = entries.find(entry => (
      !isContactKey(entry.normKey) &&
      !looksLikeAddress(entry.value) &&
      !looksLikePostalCode(entry.value) &&
      !looksLikePhone(entry.value) &&
      !looksLikeEmail(entry.value) &&
      !isLikelyPersonalName(entry.value) &&
      entry.value.length >= 3 &&
      entry.value.length <= 140
    ));
    byKey.companyName = candidate ? sanitizeBusinessName(candidate.value) : "";
  }

  return byKey;
}

function normalizeLookupRow(row = {}) {
  const safeRow = row && typeof row === "object" ? row : {};
  const rawRow = safeRow.rawRow && typeof safeRow.rawRow === "object" ? safeRow.rawRow : safeRow;
  const inferred = inferLookupFields(rawRow);

  const address = firstNonEmpty(safeRow.address, safeRow.buildingAddress, inferred.address);
  const city = firstNonEmpty(safeRow.city, inferred.city);
  const province = firstNonEmpty(safeRow.province, inferred.province);
  const postalCode = firstNonEmpty(safeRow.postalCode, inferred.postalCode);
  const country = firstNonEmpty(safeRow.country, inferred.country, "Canada");
  const companyName = firstNonEmpty(
    sanitizeBusinessName(safeRow.company),
    sanitizeBusinessName(safeRow.companyName),
    sanitizeBusinessName(safeRow.name),
    sanitizeBusinessName(safeRow.lookupName),
    sanitizeBusinessName(safeRow.rawName),
    sanitizeBusinessName(inferred.companyName)
  );
  const contactName = firstNonEmpty(safeRow.contactName, safeRow.leadContact, inferred.contactName);
  const name = companyName;
  const inputAddress = firstNonEmpty(
    safeRow.inputAddress,
    safeRow.buildingAddress,
    [address, city, province, postalCode].filter(Boolean).join(", ")
  );
  const inputName = firstNonEmpty(
    safeRow.inputName,
    safeRow.rawName,
    companyName,
    name,
    contactName
  );

  return {
    lookup: { name, address, city, province, postalCode, country },
    inputName,
    inputAddress,
    companyName,
    contactName,
  };
}

async function phoneLookupOne({ name, address, city, province, postalCode, country }) {
  const lookupName = sanitizeBusinessName(name);
  const lookupAddress = cleanLookupValue(address);
  const lookupCity = cleanLookupValue(city);
  const lookupProvince = cleanLookupValue(province);
  const lookupPostalCode = cleanLookupValue(postalCode);
  const lookupCountry = cleanLookupValue(country) || "Canada";

  const addressQuery = [lookupAddress, lookupCity, lookupProvince, lookupPostalCode, lookupCountry].filter(Boolean).join(", ");
  const companyQuery = [lookupName, lookupCity, lookupProvince, lookupPostalCode, lookupCountry].filter(Boolean).join(", ");

  if (!addressQuery && !companyQuery) {
    return { matchedName:"", matchedAddress:"", phone:"", inputPhones:[], website:"", source:"google_places", confidence:0, status:"not_found", candidates:[] };
  }

  const lookups = [];
  if (addressQuery) {
    lookups.push(runPlacesQuery({
      query: addressQuery,
      expectedName: "",
      expectedAddress: lookupAddress,
      queryType: "address"
    }));
  }
  if (companyQuery) {
    lookups.push(runPlacesQuery({
      query: companyQuery,
      expectedName: lookupName,
      expectedAddress: lookupAddress,
      queryType: "company"
    }));
  }

  const rawCandidates = (await Promise.all(lookups)).flat();
  if (!rawCandidates.length) {
    return { matchedName:"", matchedAddress:"", phone:"", inputPhones:[], website:"", source:"google_places", confidence:0, status:"not_found", candidates:[] };
  }

  const uniqueCandidates = [];
  const seenCandidates = new Set();
  for (const candidate of rawCandidates.sort((a, b) => b.confidence - a.confidence)) {
    const key = candidateIdentityKey(candidate);
    if (!key || seenCandidates.has(key)) continue;
    seenCandidates.add(key);
    uniqueCandidates.push(candidate);
  }

  const candidatesWithPhone = uniqueCandidates.filter(candidate => normalizeLookupPhoneKey(candidate.phone));
  const filteredPhoneCandidates = candidatesWithPhone.filter(candidate => {
    if (Number(candidate.confidence || 0) < 10) return false;
    if (candidate.queryType === "address" && lookupAddress) {
      return hasSharedAddressNumber(lookupAddress, candidate.address);
    }
    return true;
  });
  const allPhones = mergeLookupPhones(filteredPhoneCandidates.map(candidate => candidate.phone));
  const best = filteredPhoneCandidates[0] || uniqueCandidates[0] || null;
  const bestKey = best ? candidateIdentityKey(best) : "";

  return {
    matchedName: best?.name || "",
    matchedAddress: best?.address || "",
    phone: allPhones[0] || "",
    inputPhones: allPhones,
    website: best?.website || "",
    source: "google_places",
    confidence: Number(best?.confidence || 0),
    status: allPhones.length ? "found" : "not_found",
    candidates: uniqueCandidates
      .filter(candidate => candidateIdentityKey(candidate) !== bestKey)
      .map(candidate => ({
        name: candidate.name,
        address: candidate.address,
        phone: candidate.phone,
        website: candidate.website,
        confidence: candidate.confidence,
      }))
      .slice(0, 4),
  };
}

app.post("/api/phone-lookup", async (req, res) => {
  if (!GOOGLE_PLACES_KEY) {
    return res.status(503).json({ ok: false, error: "GOOGLE_PLACES_API_KEY manquante. Ajoutez-la dans Railway → Variables." });
  }
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ ok: false, error: "rows[] requis." });
  const results = [];
  for (const row of rows.slice(0, 50)) {
    const id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const normalized = normalizeLookupRow(row);
    try {
      const r = await phoneLookupOne(normalized.lookup);
      results.push({
        id,
        inputName: normalized.inputName,
        inputAddress: normalized.inputAddress,
        ...r,
        searchedAt: new Date().toISOString()
      });
    } catch (err) {
      results.push({
        id,
        inputName: normalized.inputName,
        inputAddress: normalized.inputAddress,
        matchedName:"",
        matchedAddress:"",
        phone:"",
        website:"",
        source:"google_places",
        confidence:0,
        status:"not_found",
        candidates:[],
        error: String(err?.message || err),
        searchedAt: new Date().toISOString()
      });
    }
    if (rows.length > 1) await new Promise(resolve => setTimeout(resolve, 100));
  }
  res.json({ ok: true, results });
});
// ─────────────────────────────────────────────────────────────────────────────

app.use("/api/listings", createListingsRouter({
  listingsService
}));

app.use("/api/chat", createChatRouter({
  chatLimiter,
  listingsService,
  openaiService,
  normalizeRef,
  extractListingReference,
  upsertChatSession,
  recordUserDailyTime,
  appendChatMessage,
  createId,
  generateTranslatorPayload
}));

app.post("/api/translator/evaluate", async (req, res) => handleEmployeeRoute(req, res, async () => {
  const threadKey = String(req.body?.threadKey || req.body?.thread_key || "").trim();
  const listingRef = String(req.body?.listingRef || req.body?.listing_ref || "").trim();
  const payload = await buildTranslatorEvaluationPayload(threadKey, listingRef);

  return res.json({
    ok: true,
    eligible: payload.evaluation.eligible,
    status: payload.evaluation.status,
    confidence: payload.evaluation.confidence,
    missing_fields: payload.evaluation.missing_fields,
    blocking_reasons: payload.evaluation.blocking_reasons,
    matches: payload.matches,
    visit: payload.visit,
    listing_ref: payload.listing_ref
  });
}));

app.post("/api/translator/schedule-visit", async (req, res) => handleEmployeeRoute(req, res, async () => {
  const threadKey = String(req.body?.threadKey || req.body?.thread_key || "").trim();
  const listingRef = String(req.body?.listingRef || req.body?.listing_ref || "").trim();
  const proposedDate = String(req.body?.proposedDate || req.body?.proposed_date || "").trim();

  if (!proposedDate) {
    throw createHttpError(400, "proposedDate est obligatoire.");
  }

  const payload = await buildTranslatorEvaluationPayload(threadKey, listingRef);

  if (!payload.evaluation.eligible || !payload.visit.ready) {
    throw createHttpError(400, "Le dossier n'est pas prêt pour planifier une visite.");
  }

  return res.json({
    ok: true,
    success: true,
    confirmationMessage: `Visite à planifier pour ${payload.listing_ref || "ce logement"} le ${proposedDate}. Un suivi peut maintenant être envoyé au locataire.`
  });
}));

app.post("/api/match", async (req, res) => {
  const listing = req.body?.listing;
  const candidate = req.body?.candidate;

  if (!listing || !candidate) {
    return res.status(400).json({
      ok: false,
      error: "listing et candidate sont obligatoires."
    });
  }

  let criteria = null;

  if (listing.client_id) {
    const clientsMap = await loadClientsMap();
    const client = clientsMap[String(listing.client_id)] || null;
    criteria = client?.criteres || null;
  }

  return res.json(evaluateMatch(listing, candidate, criteria));
});

app.post("/api/twilio/calls/start", async (req, res) => {
  try {
    if (!PUBLIC_APP_URL) {
      throw createHttpError(400, "PUBLIC_APP_URL est requis pour lancer les appels.");
    }
    if (!TWILIO_PHONE_NUMBER) {
      throw createHttpError(400, "TWILIO_PHONE_NUMBER est requis.");
    }
    if (!TWILIO_FORWARD_TO) {
      throw createHttpError(400, "TWILIO_FORWARD_TO est requis.");
    }

    const dealId = String(req.body?.dealId || "").trim();
    const contactPhoneRaw = String(req.body?.contactPhone || "").trim();
    const contactName = String(req.body?.contactName || "").trim();
    const dealTitle = String(req.body?.dealTitle || "").trim();
    const normalizedLeadPhone = normalizeDialPhone(contactPhoneRaw);

    if (!dealId) {
      throw createHttpError(400, "dealId est obligatoire.");
    }
    if (!normalizedLeadPhone) {
      throw createHttpError(400, "Numéro du contact invalide.");
    }

    const callLog = createCallLogRecord({
      dealId,
      direction: "outbound",
      from: TWILIO_PHONE_NUMBER,
      to: normalizedLeadPhone,
      leadName: contactName,
      dealTitle,
      status: "initiated"
    });
    callLog.transcript_status = TWILIO_RECORD_CALLS ? (openai ? "pending_recording" : "recording_only") : "disabled";

    const statusCallback = `${toPublicUrl("/api/twilio/voice/status")}?callLogId=${encodeURIComponent(callLog.id)}&dealId=${encodeURIComponent(dealId)}`;
    const bridgeUrl = `${toPublicUrl("/api/twilio/voice/outbound-bridge")}?callLogId=${encodeURIComponent(callLog.id)}&dealId=${encodeURIComponent(dealId)}&leadPhone=${encodeURIComponent(normalizedLeadPhone)}&leadName=${encodeURIComponent(contactName)}`;

    const createdCall = await callTwilioApi("/Calls.json", {
      To: TWILIO_FORWARD_TO,
      From: TWILIO_PHONE_NUMBER,
      Url: bridgeUrl,
      Method: "POST",
      StatusCallback: statusCallback,
      StatusCallbackMethod: "POST",
      StatusCallbackEvent: "initiated ringing answered completed"
    });

    callLog.call_sid = createdCall.sid || null;
    callLog.status = String(createdCall.status || "queued").trim() || "queued";
    appendCallEvent(callLog, callLog.status, { note: "outbound_call_created" });
    const callLogs = await loadCallLogs();
    callLogs.unshift(callLog);
    await saveCallLogs(callLogs);

    return res.status(201).json({
      ok: true,
      call: callLog
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Impossible de lancer l'appel."
    });
  }
});

app.post("/api/twilio/voice/outbound-bridge", express.urlencoded({ extended: false }), async (req, res) => {
  const callLogId = String(req.query?.callLogId || req.body?.callLogId || "").trim();
  const dealId = String(req.query?.dealId || req.body?.dealId || "").trim();
  const leadPhone = normalizeDialPhone(String(req.query?.leadPhone || req.body?.leadPhone || "").trim());
  const leadName = String(req.query?.leadName || req.body?.leadName || "").trim();

  if (!leadPhone) {
    return sendTwiml(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say language="fr-CA" voice="alice">Numéro du contact invalide.</Say>\n</Response>`
    );
  }

  const statusCallbackUrl = `${toPublicUrl("/api/twilio/voice/status")}?callLogId=${encodeURIComponent(callLogId)}&dealId=${encodeURIComponent(dealId)}`;
  const recordingCallbackUrl = `${toPublicUrl("/api/twilio/voice/recording")}?callLogId=${encodeURIComponent(callLogId)}&dealId=${encodeURIComponent(dealId)}`;
  const dialAttributes = [
    "answerOnBridge=\"true\"",
    "timeout=\"20\"",
    `statusCallback=\"${escapeXml(statusCallbackUrl)}\"`,
    "statusCallbackMethod=\"POST\"",
    "statusCallbackEvent=\"initiated ringing answered completed\""
  ];

  if (TWILIO_RECORD_CALLS) {
    dialAttributes.push("record=\"record-from-answer-dual\"");
    dialAttributes.push(`recordingStatusCallback=\"${escapeXml(recordingCallbackUrl)}\"`);
    dialAttributes.push("recordingStatusCallbackMethod=\"POST\"");
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial ${dialAttributes.join(" ")}>${escapeXml(leadPhone)}</Dial>\n</Response>`;
  return sendTwiml(res, twiml);
});

app.post("/api/twilio/voice/inbound", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    if (!TWILIO_FORWARD_TO) {
      return sendTwiml(
        res,
        `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say language="fr-CA" voice="alice">Le service d'appel n'est pas encore configuré.</Say>\n</Response>`
      );
    }

    const from = normalizeDialPhone(req.body?.From || "");
    const to = normalizeDialPhone(req.body?.To || "");
    const callSid = String(req.body?.CallSid || "").trim();
    const callLog = createCallLogRecord({
      direction: "inbound",
      from,
      to,
      callSid,
      status: String(req.body?.CallStatus || "incoming").trim() || "incoming"
    });
    callLog.transcript_status = TWILIO_RECORD_CALLS ? (openai ? "pending_recording" : "recording_only") : "disabled";

    const callLogs = await loadCallLogs();
    callLogs.unshift(callLog);
    await saveCallLogs(callLogs);

    const statusCallbackUrl = `${toPublicUrl("/api/twilio/voice/status")}?callLogId=${encodeURIComponent(callLog.id)}`;
    const recordingCallbackUrl = `${toPublicUrl("/api/twilio/voice/recording")}?callLogId=${encodeURIComponent(callLog.id)}`;
    const dialAttributes = [
      "answerOnBridge=\"true\"",
      "timeout=\"20\""
    ];

    if (statusCallbackUrl) {
      dialAttributes.push(`statusCallback=\"${escapeXml(statusCallbackUrl)}\"`);
      dialAttributes.push("statusCallbackMethod=\"POST\"");
      dialAttributes.push("statusCallbackEvent=\"initiated ringing answered completed\"");
    }

    if (TWILIO_RECORD_CALLS) {
      dialAttributes.push("record=\"record-from-answer-dual\"");
      if (recordingCallbackUrl) {
        dialAttributes.push(`recordingStatusCallback=\"${escapeXml(recordingCallbackUrl)}\"`);
        dialAttributes.push("recordingStatusCallbackMethod=\"POST\"");
      }
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial ${dialAttributes.join(" ")}>${escapeXml(TWILIO_FORWARD_TO)}</Dial>\n</Response>`;
    return sendTwiml(res, twiml);
  } catch (error) {
    return sendTwiml(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say language="fr-CA" voice="alice">Une erreur temporaire est survenue.</Say>\n</Response>`
    );
  }
});

app.post("/api/twilio/voice/status", express.urlencoded({ extended: false }), async (req, res) => {
  const callLogId = String(req.query?.callLogId || req.body?.callLogId || "").trim();
  const dealId = String(req.query?.dealId || req.body?.dealId || "").trim();
  const callbackCallSid = String(req.body?.CallSid || "").trim();
  const callbackParentCallSid = String(req.body?.ParentCallSid || "").trim();
  const callbackStatus = String(req.body?.CallStatus || "").trim() || "updated";
  const callbackDuration = Number(req.body?.CallDuration || 0);
  const callbackFrom = normalizeDialPhone(req.body?.From || "");
  const callbackTo = normalizeDialPhone(req.body?.To || "");

  const callLogs = await loadCallLogs();
  let callLog = null;

  if (callLogId) {
    callLog = callLogs.find((log) => String(log.id) === callLogId) || null;
  }
  if (!callLog && callbackCallSid) {
    callLog = callLogs.find((log) => String(log.call_sid) === callbackCallSid) || null;
  }
  if (!callLog && callbackParentCallSid) {
    callLog = callLogs.find((log) => String(log.call_sid) === callbackParentCallSid) || null;
  }

  if (!callLog) {
    callLog = createCallLogRecord({
      dealId,
      direction: String(req.body?.Direction || "unknown").trim() || "unknown",
      from: callbackFrom,
      to: callbackTo,
      callSid: callbackParentCallSid || callbackCallSid,
      parentCallSid: callbackParentCallSid || null,
      status: callbackStatus
    });
    callLogs.unshift(callLog);
  }

  if (!callLog.call_sid) {
    callLog.call_sid = callbackParentCallSid || callbackCallSid || callLog.call_sid;
  }
  if (callbackParentCallSid && callbackCallSid && callbackParentCallSid !== callbackCallSid) {
    callLog.parent_call_sid = callbackParentCallSid;
  }
  if (Number.isFinite(callbackDuration) && callbackDuration > 0) {
    callLog.duration_seconds = callbackDuration;
  }
  if (!callLog.from && callbackFrom) {
    callLog.from = callbackFrom;
  }
  if (!callLog.to && callbackTo) {
    callLog.to = callbackTo;
  }
  if (!callLog.deal_id && dealId) {
    callLog.deal_id = dealId;
  }

  appendCallEvent(callLog, callbackStatus, {
    call_sid: callbackCallSid || null,
    parent_call_sid: callbackParentCallSid || null
  });
  await saveCallLogs(callLogs);

  const payload = {
    type: "call_status",
    at: new Date().toISOString(),
    callSid: callbackCallSid,
    parentCallSid: callbackParentCallSid,
    callStatus: callbackStatus,
    from: String(req.body?.From || ""),
    to: String(req.body?.To || ""),
    direction: String(req.body?.Direction || ""),
    callLogId: callLog.id
  };

  console.log("[twilio:status]", JSON.stringify(payload));
  return res.status(204).send();
});

app.post("/api/twilio/voice/recording", express.urlencoded({ extended: false }), async (req, res) => {
  const callLogId = String(req.query?.callLogId || req.body?.callLogId || "").trim();
  const recordingStatus = String(req.body?.RecordingStatus || "").trim();
  const recordingSid = String(req.body?.RecordingSid || "").trim();
  const recordingUrl = String(req.body?.RecordingUrl || "").trim();
  const callSid = String(req.body?.CallSid || "").trim();
  const recordingDuration = Number(req.body?.RecordingDuration || 0);

  const callLogs = await loadCallLogs();
  let callLog = null;

  if (callLogId) {
    callLog = callLogs.find((log) => String(log.id) === callLogId) || null;
  }
  if (!callLog && callSid) {
    callLog = callLogs.find((log) => String(log.call_sid) === callSid || String(log.parent_call_sid) === callSid) || null;
  }

  if (callLog) {
    callLog.recording_sid = recordingSid || callLog.recording_sid;
    callLog.recording_url = recordingUrl || callLog.recording_url;
    if (Number.isFinite(recordingDuration) && recordingDuration > 0) {
      callLog.duration_seconds = recordingDuration;
    }
    if (recordingStatus === "completed") {
      callLog.transcript_status = openai ? "processing" : "recording_only";
      callLog.transcript_error = openai ? null : "Transcription indisponible: OPENAI_API_KEY manquant.";
    }
    appendCallEvent(callLog, callLog.status || "updated", { note: `recording_${recordingStatus || "updated"}` });
    await saveCallLogs(callLogs);
  }

  const payload = {
    type: "recording_status",
    at: new Date().toISOString(),
    callSid,
    recordingSid,
    recordingStatus,
    recordingUrl,
    recordingDuration: String(req.body?.RecordingDuration || ""),
    callLogId: callLog?.id || callLogId || null
  };

  console.log("[twilio:recording]", JSON.stringify(payload));

  if (callLog && recordingStatus === "completed" && callLog.recording_url && openai) {
    setImmediate(() => {
      transcribeTwilioRecording(callLog.id, callLog.recording_url, callLog.recording_sid).catch(async (error) => {
        const currentCallLogs = await loadCallLogs();
        const failedLog = currentCallLogs.find((log) => String(log.id) === String(callLog.id));
        if (!failedLog) return;
        failedLog.transcript_status = "failed";
        failedLog.transcript_error = error.message || "Échec de transcription.";
        appendCallEvent(failedLog, failedLog.status || "updated", { note: "transcript_failed" });
        await saveCallLogs(currentCallLogs);
      });
    });
  }

  return res.status(204).send();
});

app.get("/api/deals/:dealId/calls", async (req, res) => {
  const dealId = String(req.params?.dealId || "").trim();
  if (!dealId) {
    return res.status(400).json({ ok: false, error: "dealId est obligatoire." });
  }

  const callLogs = await loadCallLogs();
  const calls = callLogs
    .filter((log) => String(log.deal_id || "") === dealId)
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

  return res.json({ ok: true, calls });
});

app.get("/api/calls/:callId/recording", async (req, res) => {
  try {
    const callId = String(req.params?.callId || "").trim();
    const callLogs = await loadCallLogs();
    const callLog = callLogs.find((log) => String(log.id) === callId);

    if (!callLog || !callLog.recording_url) {
      throw createHttpError(404, "Enregistrement introuvable.");
    }

    const authHeader = getTwilioBasicAuthHeader();
    if (!authHeader) {
      throw createHttpError(500, "Les identifiants Twilio ne sont pas configurés.");
    }

    const recordingMediaUrl = /\.(mp3|wav)$/i.test(callLog.recording_url)
      ? callLog.recording_url
      : `${callLog.recording_url}.mp3`;
    const recordingResponse = await fetch(recordingMediaUrl, {
      headers: {
        Authorization: authHeader
      }
    });

    if (!recordingResponse.ok) {
      throw createHttpError(400, `Impossible de charger l'audio (${recordingResponse.status}).`);
    }

    const arrayBuffer = await recordingResponse.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    res.setHeader("Content-Type", recordingResponse.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Content-Length", String(audioBuffer.length));
    return res.status(200).send(audioBuffer);
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Impossible de lire l'enregistrement."
    });
  }
});

app.post("/api/calls/:callId/transcribe/retry", async (req, res) => {
  try {
    const callId = String(req.params?.callId || "").trim();
    const callLogs = await loadCallLogs();
    const callLog = callLogs.find((log) => String(log.id) === callId);

    if (!callLog) {
      throw createHttpError(404, "Appel introuvable.");
    }
    if (!callLog.recording_url) {
      throw createHttpError(400, "Aucun enregistrement disponible pour cet appel.");
    }

    callLog.transcript_status = "processing";
    callLog.transcript_error = null;
    appendCallEvent(callLog, callLog.status || "updated", { note: "transcript_retry" });
    await saveCallLogs(callLogs);

    setImmediate(() => {
      transcribeTwilioRecording(callId, callLog.recording_url, callLog.recording_sid).catch(async (error) => {
        const refreshedLogs = await loadCallLogs();
        const failedLog = refreshedLogs.find((log) => String(log.id) === callId);
        if (!failedLog) return;
        failedLog.transcript_status = "failed";
        failedLog.transcript_error = error.message || "Échec de transcription.";
        appendCallEvent(failedLog, failedLog.status || "updated", { note: "transcript_failed" });
        await saveCallLogs(refreshedLogs);
      });
    });

    return res.json({ ok: true, callId });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Impossible de relancer la transcription."
    });
  }
});

app.get("/api/client/me", async (req, res) =>
  handleClientRoute(req, res, async ({ clientId }) => {
    const clientsMap = await loadClientsMap();
    const client = clientsMap[String(clientId)] || null;

    if (!client) {
      throw createHttpError(404, "Client introuvable.");
    }

    return res.json({
      ok: true,
      client_id: clientId,
      client: normalizeClientRecord(clientId, client)
    });
  })
);

app.get("/api/client/apartments", async (req, res) =>
  handleClientRoute(req, res, async ({ clientId }) => {
    const listings = await loadListingsMap();
    const apartments = Object.values(listings).filter((listing) => String(listing.client_id) === String(clientId));

    return res.json({
      ok: true,
      apartments
    });
  })
);

app.get("/api/client/candidates", async (req, res) =>
  handleClientRoute(req, res, async ({ clientId }) => {
    const listings = await loadListingsMap();
    const apartmentRefs = new Set(
      Object.values(listings)
        .filter((listing) => String(listing.client_id) === String(clientId))
        .map((listing) => normalizeRef(listing.ref))
    );

    const storedCandidates = await readJsonFile(CANDIDATES_PATH, []);
    const { candidates, changed } = await ensureCandidatesMatchFields(storedCandidates, false);
    const filtered = candidates.filter((candidate) => apartmentRefs.has(normalizeRef(candidate.apartment_ref)));

    if (changed) {
      await writeJsonFile(CANDIDATES_PATH, candidates);
    }

    return res.json({
      ok: true,
      candidates: filtered
    });
  })
);

app.put("/api/client/criteria", async (req, res) =>
  handleClientRoute(req, res, async ({ clientId }) => {
    const clientsMap = await loadClientsMap();
    const existingClient = clientsMap[String(clientId)] || null;

    if (!existingClient) {
      throw createHttpError(404, "Client introuvable.");
    }

    const client = normalizeClientRecord(clientId, {
      ...existingClient,
      criteres: {
        ...(existingClient?.criteres || {}),
        ...(req.body?.criteres || {})
      }
    });

    clientsMap[String(clientId)] = client;
    await saveClientsMap(clientsMap);

    return res.json({
      ok: true,
      client
    });
  })
);

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

app.get("/api/admin/users", async (req, res) => handleAdminRoute(req, res, async () => {
    const users = await loadAllSupabaseUsers();
    const legacyAdminUserIds = await loadLegacyAdminUserIds();
    const today = getTodayString();
    const summary = await readJsonFile(USER_DAILY_TIME_PATH, []);
    const summaryByUserId = new Map(
      summary
        .filter((row) => row.day === today)
        .map((row) => [row.user_id, row])
    );

    return res.json({
      ok: true,
      users: users.map((user) => buildResolvedUserSummary(user, legacyAdminUserIds, summaryByUserId))
    });
}));

app.post("/api/admin/users", async (req, res) => handleAdminRoute(req, res, async () => {
    const role = String(req.body?.role || "").trim().toLowerCase();
    const fullName = String(req.body?.full_name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!fullName || !email || !password || !role) {
      return res.status(400).json({
        ok: false,
        error: "full_name, email, password et role sont obligatoires."
      });
    }

    const user = await createManualUserAccount({
      role,
      fullName,
      email,
      password
    });

    return res.status(201).json({
      ok: true,
      user: {
        user_id: user.id,
        email: user.email || "",
        full_name: user.user_metadata?.full_name || "",
        role: resolveRoleFromUser(user)
      }
    });
}));

app.post("/api/admin/users/:id/deactivate", async (req, res) => handleAdminRoute(req, res, async () => {
    ensureSupabaseAdminAvailable();
    const userId = String(req.params.id || "").trim();

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: "Identifiant utilisateur manquant."
      });
    }

    const { data, error } = await supabaseServerClient.auth.admin.updateUserById(userId, {
      ban_duration: "876000h"
    });

    if (error || !data?.user) {
      throw createHttpError(400, error?.message || "Impossible de désactiver cet utilisateur.");
    }

    return res.json({
      ok: true,
      user_id: userId,
      status: "deactivated"
    });
}));

app.delete("/api/admin/users/:id", async (req, res) => handleAdminRoute(req, res, async () => {
    ensureSupabaseAdminAvailable();
    const userId = String(req.params.id || "").trim();

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: "Identifiant utilisateur manquant."
      });
    }

    const { error } = await supabaseServerClient.auth.admin.deleteUser(userId);

    if (error) {
      throw createHttpError(400, error.message || "Impossible de supprimer cet utilisateur.");
    }

    return res.json({
      ok: true,
      user_id: userId,
      status: "deleted"
    });
}));

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

app.get("/api/admin/clients", async (req, res) => handleAdminRoute(req, res, async () => {
    const clientsMap = await loadClientsMap();
    const invitations = await loadClientInvitations();
    const users = await loadAllSupabaseUsers();
    const legacyAdminUserIds = await loadLegacyAdminUserIds();
    const clientUsers = users
      .map((user) => buildResolvedUserSummary(user, legacyAdminUserIds))
      .filter((user) => user.role === "client" && user.client_id);

    const clientUserByClientId = new Map(clientUsers.map((user) => [String(user.client_id), user]));
    const latestInvitationByClientId = new Map();

    invitations.forEach((invitation) => {
      const clientId = String(invitation.client_id || "").trim();
      if (!clientId) return;

      const current = latestInvitationByClientId.get(clientId);
      const invitationCreatedAt = new Date(invitation.created_at || 0).getTime();
      const currentCreatedAt = new Date(current?.created_at || 0).getTime();

      if (!current || invitationCreatedAt >= currentCreatedAt) {
        latestInvitationByClientId.set(clientId, invitation);
      }
    });

    const clients = Object.entries(clientsMap).map(([id, client]) => {
      const normalizedClient = normalizeClientRecord(id, client);
      const portalUser = clientUserByClientId.get(String(id)) || null;
      const invitation = latestInvitationByClientId.get(String(id)) || null;
      const invitationStatus = invitation ? getInvitationStatus(invitation) : null;
      const onboardingLink = invitation && invitationStatus === "pending"
        ? buildOnboardingLink(req, invitation.token)
        : null;

      return {
        ...normalizedClient,
        portal_user_id: portalUser?.user_id || normalizedClient.onboarding_user_id || null,
        portal_email: portalUser?.email || normalizedClient.email || invitation?.email || "",
        portal_access_status: portalUser
          ? (portalUser.is_deactivated ? "deactivated" : "active")
          : invitationStatus === "pending"
            ? "invited"
            : "none",
        invitation_status: invitationStatus,
        invitation_expires_at: invitation?.expires_at || null,
        onboarding_link: onboardingLink
      };
    });

    return res.json({ ok: true, clients });
}));

app.post("/api/admin/clients", async (req, res) => {
  try {
    const clientsMap = await loadClientsMap();
    const id = String(req.body?.id || `client_${Date.now()}`);
    const client = normalizeClientRecord(id, { ...req.body, id });

    clientsMap[id] = client;
    await saveClientsMap(clientsMap);

    res.status(201).json({
      ok: true,
      client
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Impossible de créer le client."
    });
  }
});

app.post("/api/admin/client-invitations", async (req, res) => {
  try {
    const name = String(req.body?.name || req.body?.contact_name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = String(req.body?.phone || "").trim();
    const mainCity = String(req.body?.main_city || "").trim();

    if (!name || !email) {
      return res.status(400).json({
        ok: false,
        error: "name et email sont obligatoires."
      });
    }

    const clientsMap = await loadClientsMap();
    const invitations = await loadClientInvitations();
    const clientId = createClientId(clientsMap, name, invitations);
    const token = createSecureToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const existingUser = await findSupabaseUserByEmail(email).catch(() => null);

    const invitation = {
      id: createId("invite"),
      token,
      client_id: clientId,
      name,
      contact_name: name,
      company_name: "",
      email,
      phone,
      main_city: mainCity,
      account_exists: Boolean(existingUser),
      existing_supabase_user_id: existingUser?.id || null,
      status: "pending",
      expires_at: expiresAt,
      created_at: now.toISOString()
    };

    invitations.push(invitation);
    await saveClientInvitations(invitations);
    const onboardingLink = buildOnboardingLink(req, token);
    const emailDelivery = await sendClientInvitationEmail(invitation, onboardingLink);

    return res.status(201).json({
      ok: true,
      invitation: sanitizeInvitation(invitation),
      onboarding_link: onboardingLink,
      invitation_email_sent: emailDelivery.sent,
      invitation_email_error: emailDelivery.sent ? null : emailDelivery.error
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Impossible de créer l’invitation client."
    });
  }
});

app.get("/api/client-onboarding/invitation", async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();

    if (!token) {
      return res.status(400).json({
        ok: false,
        error: "Token manquant."
      });
    }

    const { invitation, status } = await resolveInvitationByToken(token);
    ensureInvitationUsable(status, invitation);

    return res.json({
      ok: true,
      invitation: sanitizeInvitation(invitation),
      current_step: invitation.account_created_at ? 2 : 1
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Impossible de valider l’invitation."
    });
  }
});

app.post("/api/client-onboarding/account", async (req, res) => {
  try {
    ensureSupabaseAdminAvailable();

    const token = String(req.body?.token || "").trim();
    const fullName = String(req.body?.full_name || "").trim();
    const companyName = String(req.body?.company_name || "").trim();
    const password = String(req.body?.password || "");
    const phone = String(req.body?.phone || "").trim();
    const mainCity = String(req.body?.main_city || "").trim();
    const emailNotifications = Boolean(req.body?.email_notifications);
    const marketingCommunications = Boolean(req.body?.marketing_communications);

    if (!token || !fullName || !companyName || !password || !mainCity) {
      return res.status(400).json({
        ok: false,
        error: "Les champs requis du compte client sont incomplets."
      });
    }

    const { invitations, invitation, index, status } = await resolveInvitationByToken(token);
    ensureInvitationUsable(status, invitation);

    if (invitation.account_created_at) {
      return res.status(409).json({
        ok: false,
        error: "Le compte lié à cette invitation a déjà été créé."
      });
    }

    if (invitation.account_exists) {
      return res.status(409).json({
        ok: false,
        code: "existing_account_requires_login",
        error: "Un compte existe déjà pour ce courriel. Connectez-vous pour continuer l’activation de votre invitation."
      });
    }

    const { data, error } = await supabaseServerClient.auth.admin.createUser({
      email: invitation.email,
      password,
      email_confirm: true,
      user_metadata: {
        role: "client",
        client_id: invitation.client_id,
        full_name: fullName,
        company_name: companyName,
        phone,
        main_city: mainCity
      },
      app_metadata: {
        role: "client",
        client_id: invitation.client_id
      }
    });

    if (error || !data?.user) {
      throw createHttpError(400, error?.message || "Impossible de créer le compte client.");
    }

    const clientsMap = await loadClientsMap();
    const existingClient = clientsMap[invitation.client_id] || {};
    const client = normalizeClientRecord(invitation.client_id, {
      ...existingClient,
      id: invitation.client_id,
      nom: companyName,
      company_name: companyName,
      contact_name: fullName,
      email: invitation.email,
      phone,
      main_city: mainCity,
      onboarding_user_id: data.user.id,
      notification_preferences: {
        email_notifications: emailNotifications,
        marketing_communications: marketingCommunications
      },
      criteres: existingClient.criteres || {}
    });

    clientsMap[invitation.client_id] = client;
    await saveClientsMap(clientsMap);

    invitations[index] = {
      ...invitation,
      contact_name: fullName,
      company_name: companyName,
      phone,
      account_created_at: new Date().toISOString(),
      supabase_user_id: data.user.id
    };
    await saveClientInvitations(invitations);
    await sendAdminClientActivatedEmail({
      client_id: invitation.client_id,
      company_name: companyName,
      contact_name: fullName,
      email: invitation.email,
      phone,
      main_city: mainCity
    }).catch(() => null);

    return res.json({
      ok: true,
      invitation: sanitizeInvitation(invitations[index]),
      client
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Impossible de créer le compte client."
    });
  }
});

app.post("/api/client-onboarding/link-existing-account", async (req, res) => {
  try {
    ensureSupabaseAdminAvailable();

    const token = String(req.body?.token || "").trim();
    const fullName = String(req.body?.full_name || "").trim();
    const companyName = String(req.body?.company_name || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const mainCity = String(req.body?.main_city || "").trim();
    const emailNotifications = Boolean(req.body?.email_notifications);
    const marketingCommunications = Boolean(req.body?.marketing_communications);

    if (!token || !fullName || !companyName || !mainCity) {
      return res.status(400).json({
        ok: false,
        error: "Les champs requis du compte client sont incomplets."
      });
    }

    const { invitations, invitation, index, status } = await resolveInvitationByToken(token);
    ensureInvitationUsable(status, invitation);

    const accessToken = getBearerToken(req);
    if (!accessToken) {
      throw createHttpError(401, "Session requise pour relier cette invitation à un compte existant.");
    }

    const { data: authData, error: authError } = await supabaseServerClient.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      throw createHttpError(401, "Session invalide.");
    }

    const sessionUser = authData.user;
    const invitedEmail = String(invitation.email || "").trim().toLowerCase();
    const sessionEmail = String(sessionUser.email || "").trim().toLowerCase();

    if (!invitedEmail || invitedEmail !== sessionEmail) {
      throw createHttpError(403, "Le compte connecté ne correspond pas à l’adresse invitée.");
    }

    const currentUserMetadata = sessionUser.user_metadata || {};
    const currentAppMetadata = sessionUser.app_metadata || {};
    const { data: updatedUserData, error: updateError } = await supabaseServerClient.auth.admin.updateUserById(sessionUser.id, {
      user_metadata: {
        ...currentUserMetadata,
        role: "client",
        client_id: invitation.client_id,
        full_name: fullName,
        company_name: companyName,
        phone,
        main_city: mainCity
      },
      app_metadata: {
        ...currentAppMetadata,
        role: "client",
        client_id: invitation.client_id
      }
    });

    if (updateError || !updatedUserData?.user) {
      throw createHttpError(400, updateError?.message || "Impossible de relier le compte existant à l’invitation.");
    }

    const clientsMap = await loadClientsMap();
    const existingClient = clientsMap[invitation.client_id] || {};
    const client = normalizeClientRecord(invitation.client_id, {
      ...existingClient,
      id: invitation.client_id,
      nom: companyName,
      company_name: companyName,
      contact_name: fullName,
      email: invitation.email,
      phone,
      main_city: mainCity,
      onboarding_user_id: sessionUser.id,
      notification_preferences: {
        email_notifications: emailNotifications,
        marketing_communications: marketingCommunications
      },
      criteres: existingClient.criteres || {}
    });

    clientsMap[invitation.client_id] = client;
    await saveClientsMap(clientsMap);

    invitations[index] = {
      ...invitation,
      contact_name: fullName,
      company_name: companyName,
      phone,
      account_created_at: new Date().toISOString(),
      supabase_user_id: sessionUser.id,
      existing_account_linked_at: new Date().toISOString()
    };
    await saveClientInvitations(invitations);
    await sendAdminClientActivatedEmail({
      client_id: invitation.client_id,
      company_name: companyName,
      contact_name: fullName,
      email: invitation.email,
      phone,
      main_city: mainCity
    }).catch(() => null);

    return res.json({
      ok: true,
      invitation: sanitizeInvitation(invitations[index]),
      client
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Impossible de relier le compte existant."
    });
  }
});

app.post("/api/client-onboarding/listing", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();

    if (!token) {
      return res.status(400).json({
        ok: false,
        error: "Token manquant."
      });
    }

    const { invitations, invitation, index, status } = await resolveInvitationByToken(token);
    ensureInvitationUsable(status, invitation);

    if (!invitation.account_created_at) {
      return res.status(409).json({
        ok: false,
        error: "Le compte client doit être créé avant d’ajouter le premier logement."
      });
    }

    const payload = req.body || {};
    if (
      !String(payload.adresse || "").trim() ||
      !String(payload.ville || "").trim() ||
      !String(payload.type_logement || "").trim() ||
      !String(payload.loyer || "").trim() ||
      !String(payload.disponibilite || "").trim()
    ) {
      return res.status(400).json({
        ok: false,
        error: "Les champs requis du premier logement sont incomplets."
      });
    }

    const listings = await loadListingsMap();
    const matchedLocation = resolveClosestQuebecLocation(payload.ville);
    const ref = nextListingRef(listings);

    listings[ref] = toListingRecord(`L-${ref}`, {
      ref: `L-${ref}`,
      adresse: payload.adresse,
      ville: matchedLocation?.label || String(payload.ville || "").trim(),
      zone: matchedLocation?.zone || "",
      lat: parseCoordinate(matchedLocation?.lat),
      lng: parseCoordinate(matchedLocation?.lng),
      type_logement: payload.type_logement,
      chambres: payload.type_logement,
      loyer: payload.loyer,
      disponibilite: payload.disponibilite,
      inclusions: payload.inclusions,
      animaux_acceptes: payload.animaux_acceptes,
      meuble: payload.meuble,
      notes: payload.notes,
      client_id: invitation.client_id,
      statut: "actif"
    });

    await saveListingsMap(listings);

    invitations[index] = {
      ...invitation,
      status: "completed",
      completed_at: new Date().toISOString(),
      first_listing_ref: `L-${ref}`
    };
    await saveClientInvitations(invitations);

    const clientsMap = await loadClientsMap();
    const existingClient = clientsMap[invitation.client_id] || {};
    const talPolicy = String(payload.tal_policy || "").trim().toLowerCase();
    const occupantValue = String(payload.occupants_limit || "").trim();
    const normalizedMaxOccupants = parseNumber(occupantValue);
    const employmentRequirement = String(payload.employment_requirement || "").trim();
    const minimumIncome = parseNumber(payload.minimum_income);
    clientsMap[invitation.client_id] = normalizeClientRecord(invitation.client_id, {
      ...existingClient,
      id: invitation.client_id,
      nom: existingClient.nom || invitation.company_name,
      company_name: existingClient.company_name || invitation.company_name,
      contact_name: existingClient.contact_name || invitation.contact_name,
      email: existingClient.email || invitation.email,
      phone: existingClient.phone || invitation.phone,
      onboarding_user_id: existingClient.onboarding_user_id || invitation.supabase_user_id || null,
      onboarding_completed_at: invitations[index].completed_at,
      notification_preferences: existingClient.notification_preferences || {},
      criteres: {
        ...(existingClient.criteres || {}),
        revenu_minimum: minimumIncome,
        revenu_multiple: null,
        credit_min:
          payload.credit_requirement === "Bon crédit requis"
            ? "haut"
            : payload.credit_requirement === "Acceptable"
              ? "moyen"
              : null,
        accepte_tal: talPolicy !== "refusé",
        tal_policy: talPolicy || null,
        max_occupants: normalizedMaxOccupants,
        emplois_acceptes: buildEmploymentCriteria(employmentRequirement),
        employment_requirement: employmentRequirement || null
      }
    });
    await saveClientsMap(clientsMap);

    return res.status(201).json({
      ok: true,
      listing: listings[ref],
      invitation: sanitizeInvitation(invitations[index])
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Impossible d’enregistrer le premier logement."
    });
  }
});

app.put("/api/admin/clients/:id", async (req, res) => {
  try {
    const clientsMap = await loadClientsMap();
    const id = String(req.params.id);

    if (!clientsMap[id]) {
      return res.status(404).json({
        ok: false,
        error: "Client introuvable."
      });
    }

    const client = normalizeClientRecord(id, {
      ...clientsMap[id],
      ...req.body,
      criteres: {
        ...(clientsMap[id]?.criteres || {}),
        ...(req.body?.criteres || {})
      }
    });

    clientsMap[id] = client;
    await saveClientsMap(clientsMap);

    return res.json({
      ok: true,
      client
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Impossible de modifier le client."
    });
  }
});

app.get("/api/admin/workspace/employees", async (req, res) => handleAdminRoute(req, res, async () => {
  const employees = await loadEmployeeUsersSummary();
  return res.json({ ok: true, employees });
}));

app.get("/api/admin/workspace/conversations", async (req, res) => handleAdminRoute(req, res, async () => {
  const employees = await loadEmployeeUsersSummary();
  const messages = await loadWorkspaceMessages();

  const conversations = employees.map((employee) => {
    const conversationMessages = listConversationMessagesForEmployee(messages, employee.user_id);
    const lastMessage = sortByCreatedAtDesc(conversationMessages)[0] || null;
    const unreadCount = conversationMessages.filter(
      (message) => String(message.to_user_id) !== String(employee.user_id) && message.read !== true
    ).length;

    return {
      employee,
      unread_count: unreadCount,
      last_message: lastMessage
    };
  });

  return res.json({ ok: true, conversations });
}));

app.get("/api/admin/workspace/messages/:employeeUserId", async (req, res) => handleAdminRoute(req, res, async () => {
  const employeeUserId = String(req.params.employeeUserId || "").trim();
  const messages = await loadWorkspaceMessages();
  const notifications = await loadNotifications();
  let changedMessages = false;
  let changedNotifications = false;

  const conversation = messages
    .filter((message) => String(message.employee_user_id) === employeeUserId)
    .map((message) => {
      if (String(message.to_user_id) !== employeeUserId && message.read !== true) {
        message.read = true;
        changedMessages = true;
      }
      return message;
    })
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());

  notifications.forEach((notification) => {
    if (
      notification.type === "message" &&
      String(notification.reference_id) === employeeUserId &&
      notification.read !== true
    ) {
      notification.read = true;
      changedNotifications = true;
    }
  });

  if (changedMessages) {
    await saveWorkspaceMessages(messages);
  }

  if (changedNotifications) {
    await saveNotifications(notifications);
  }

  return res.json({ ok: true, messages: conversation });
}));

app.post("/api/admin/workspace/messages", async (req, res) => handleAdminRoute(req, res, async ({ user }) => {
  const employeeUserId = String(req.body?.employee_user_id || "").trim();
  const content = String(req.body?.content || "").trim();

  if (!employeeUserId || !content) {
    throw createHttpError(400, "employee_user_id et content sont obligatoires.");
  }

  const messages = await loadWorkspaceMessages();
  const message = {
    id: createId("workspace_msg"),
    employee_user_id: employeeUserId,
    from_user_id: user.id,
    to_user_id: employeeUserId,
    content,
    created_at: new Date().toISOString(),
    read: false
  };

  messages.push(message);
  await saveWorkspaceMessages(messages);
  await appendNotification({
    id: createId("notif"),
    user_id: employeeUserId,
    type: "message",
    reference_id: message.id,
    read: false,
    created_at: new Date().toISOString()
  });

  return res.status(201).json({ ok: true, message });
}));

app.post("/api/admin/workspace/listing-tasks", async (req, res) => handleAdminRoute(req, res, async ({ user }) => {
  const assignedToUserId = String(req.body?.assigned_to_user_id || "").trim();

  if (!assignedToUserId) {
    throw createHttpError(400, "assigned_to_user_id est obligatoire.");
  }

  const payload = {
    address: String(req.body?.address || "").trim(),
    city: String(req.body?.city || "").trim(),
    type: String(req.body?.type || "").trim(),
    rent: String(req.body?.rent || "").trim(),
    inclusions: String(req.body?.inclusions || "").trim(),
    pets: String(req.body?.pets || "").trim(),
    parking: String(req.body?.parking || "").trim(),
    features: String(req.body?.features || "").trim(),
    conditions: String(req.body?.conditions || "").trim()
  };

  const task = {
    id: createId("listing_task"),
    assigned_to_user_id: assignedToUserId,
    created_by_admin_id: user.id,
    title: formatListingTaskTitle(payload),
    listing_text: buildListingTaskText(payload),
    status: "assigned",
    created_at: new Date().toISOString(),
    payload
  };

  const tasks = await loadListingTasks();
  tasks.push(task);
  await saveListingTasks(tasks);
  await appendNotification({
    id: createId("notif"),
    user_id: assignedToUserId,
    type: "listing",
    reference_id: task.id,
    read: false,
    created_at: new Date().toISOString()
  });

  return res.status(201).json({ ok: true, task });
}));

app.get("/api/admin/workspace/listing-tasks", async (req, res) => handleAdminRoute(req, res, async () => {
  const tasks = sortByCreatedAtDesc(await loadListingTasks());
  return res.json({ ok: true, tasks });
}));

app.get("/api/admin/translator-reports", async (req, res) => handleAdminRoute(req, res, async () => {
  const [reports, employees] = await Promise.all([
    readJsonFile(TRANSLATOR_REPORTS_PATH, []),
    loadEmployeeUsersSummary().catch(() => [])
  ]);
  const employeeMap = new Map(
    (employees || []).map((employee) => [String(employee.user_id), employee])
  );

  return res.json({
    ok: true,
    reports: sortByCreatedAtDesc(reports).map((report) => ({
      ...report,
      employee: employeeMap.get(String(report.employee_user_id || "")) || null
    }))
  });
}));

app.put("/api/admin/translator-reports/:id", async (req, res) => handleAdminRoute(req, res, async () => {
  const reportId = String(req.params.id || "").trim();
  const nextStatus = String(req.body?.status || "").trim().toLowerCase();

  if (!["open", "reviewed"].includes(nextStatus)) {
    throw createHttpError(400, "Statut de signalement invalide.");
  }

  const reports = await readJsonFile(TRANSLATOR_REPORTS_PATH, []);
  const report = reports.find((item) => String(item.id) === reportId);

  if (!report) {
    throw createHttpError(404, "Signalement Traducteur introuvable.");
  }

  report.status = nextStatus;
  report.reviewed_at = nextStatus === "reviewed" ? new Date().toISOString() : null;
  await writeJsonFile(TRANSLATOR_REPORTS_PATH, reports);

  return res.json({ ok: true, report });
}));

app.get("/api/employee/workspace/conversation", async (req, res) => handleEmployeeRoute(req, res, async ({ user }) => {
  const messages = await loadWorkspaceMessages();
  let changedMessages = false;

  const conversation = messages
    .filter((message) => String(message.employee_user_id) === String(user.id))
    .map((message) => {
      if (String(message.to_user_id) === String(user.id) && message.read !== true) {
        message.read = true;
        changedMessages = true;
      }
      return message;
    })
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());

  if (changedMessages) {
    await saveWorkspaceMessages(messages);
  }

  return res.json({ ok: true, messages: conversation });
}));

app.post("/api/employee/workspace/messages", async (req, res) => handleEmployeeRoute(req, res, async ({ user }) => {
  const content = String(req.body?.content || "").trim();

  if (!content) {
    throw createHttpError(400, "content est obligatoire.");
  }

  const admins = await loadAdminUsersSummary();
  const messages = await loadWorkspaceMessages();
  const message = {
    id: createId("workspace_msg"),
    employee_user_id: user.id,
    from_user_id: user.id,
    to_user_id: "admin",
    content,
    created_at: new Date().toISOString(),
    read: false
  };

  messages.push(message);
  await saveWorkspaceMessages(messages);
  await appendNotifications(admins.map((admin) => ({
    id: createId("notif"),
    user_id: admin.user_id,
    type: "message",
    reference_id: user.id,
    read: false,
    created_at: new Date().toISOString()
  })));

  return res.status(201).json({ ok: true, message });
}));

app.get("/api/employee/workspace/listing-tasks", async (req, res) => handleEmployeeRoute(req, res, async ({ user }) => {
  const tasks = sortByCreatedAtDesc(
    (await loadListingTasks()).filter((task) => String(task.assigned_to_user_id) === String(user.id))
  );
  return res.json({ ok: true, tasks });
}));

app.put("/api/employee/workspace/listing-tasks/:id", async (req, res) => handleEmployeeRoute(req, res, async ({ user }) => {
  const taskId = String(req.params.id || "").trim();
  const nextStatus = String(req.body?.status || "").trim();
  const tasks = await loadListingTasks();
  const task = tasks.find((item) => String(item.id) === taskId && String(item.assigned_to_user_id) === String(user.id));

  if (!task) {
    throw createHttpError(404, "Mission introuvable.");
  }

  if (!["assigned", "in_progress", "completed"].includes(nextStatus)) {
    throw createHttpError(400, "Statut invalide.");
  }

  task.status = nextStatus;
  task.updated_at = new Date().toISOString();
  await saveListingTasks(tasks);

  const admins = await loadAdminUsersSummary();
  if (nextStatus === "completed") {
    await appendNotifications(admins.map((admin) => ({
      id: createId("notif"),
      user_id: admin.user_id,
      type: "listing",
      reference_id: task.id,
      read: false,
      created_at: new Date().toISOString()
    })));
  }

  return res.json({ ok: true, task });
}));

app.get("/api/employee/workspace/notifications", async (req, res) => handleEmployeeRoute(req, res, async ({ user }) => {
  const notifications = sortByCreatedAtDesc(
    (await loadNotifications()).filter((notification) => String(notification.user_id) === String(user.id))
  ).slice(0, 12);

  return res.json({ ok: true, notifications });
}));

app.post("/api/employee/translator-reports", async (req, res) => handleEmployeeRoute(req, res, async ({ user }) => {
  const reason = String(req.body?.reason || "").trim();
  const translatorThreadKey = String(req.body?.translator_thread_key || "").trim();
  const listingRef = normalizeRef(req.body?.listing_ref || "");
  const rawTenantMessage = String(req.body?.raw_tenant_message || "").trim();
  const translation = String(req.body?.translation || "").trim();
  const suggestedReply = String(req.body?.suggested_reply || "").trim();
  const assistantMessageId = String(req.body?.assistant_message_id || "").trim();
  const tenantMessageId = String(req.body?.tenant_message_id || "").trim();
  const recentContext = Array.isArray(req.body?.recent_context)
    ? req.body.recent_context
        .slice(-6)
        .map((entry) => ({
          sender: String(entry?.sender || "").trim(),
          label: String(entry?.label || "").trim(),
          text: String(entry?.text || "").trim(),
          sections: Array.isArray(entry?.sections)
            ? entry.sections
                .slice(0, 4)
                .map((section) => ({
                  title: String(section?.title || "").trim(),
                  text: String(section?.text || "").trim()
                }))
                .filter((section) => section.title || section.text)
            : []
        }))
        .filter((entry) => entry.sender || entry.text || entry.sections.length)
    : [];

  if (!TRANSLATOR_REPORT_REASONS.includes(reason)) {
    throw createHttpError(400, "Raison de signalement invalide.");
  }

  const reports = await readJsonFile(TRANSLATOR_REPORTS_PATH, []);
  const threadStateSnapshot = translatorThreadKey
    ? await getTranslatorThreadState(translatorThreadKey, {
        employeeUserId: user.id,
        listingRef
      })
    : null;

  const report = {
    id: createId("translator_report"),
    created_at: new Date().toISOString(),
    employee_user_id: user.id,
    translator_thread_key: translatorThreadKey || null,
    listing_ref: listingRef ? `L-${listingRef}` : null,
    reason,
    note: null,
    status: "open",
    assistant_message_id: assistantMessageId || null,
    tenant_message_id: tenantMessageId || null,
    raw_tenant_message: rawTenantMessage,
    translation,
    suggested_reply: suggestedReply,
    recent_context: recentContext,
    thread_state_snapshot: threadStateSnapshot
      ? {
          current_step: threadStateSnapshot.current_step || null,
          last_asked_step: threadStateSnapshot.last_asked_step || null,
          last_detected_listing_question: threadStateSnapshot.last_detected_listing_question || null
        }
      : null
  };

  reports.push(report);
  await writeJsonFile(TRANSLATOR_REPORTS_PATH, reports);

  return res.json({ ok: true, report_id: report.id });
}));

app.post("/api/employee/workspace/notifications/:id/read", async (req, res) => handleEmployeeRoute(req, res, async ({ user }) => {
  const notificationId = String(req.params.id || "").trim();
  const notifications = await loadNotifications();
  const notification = notifications.find(
    (item) => String(item.id) === notificationId && String(item.user_id) === String(user.id)
  );

  if (!notification) {
    throw createHttpError(404, "Notification introuvable.");
  }

  notification.read = true;
  notification.read_at = new Date().toISOString();
  await saveNotifications(notifications);

  return res.json({ ok: true, notification });
}));

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
    const storedCandidates = await readJsonFile(CANDIDATES_PATH, []);
    const { candidates } = await ensureCandidatesMatchFields(storedCandidates, true);
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
    const baseCandidate = {
      id: createId("candidate"),
      created_at: new Date().toISOString(),
      admin_notes: "",
      ...req.body
    };
    const candidate = {
      ...baseCandidate,
      ...(await buildCandidateMatchFields(baseCandidate))
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

    const payload = { ...(req.body || {}) };
    const shouldReevaluate =
      Boolean(payload.reevaluate_match) ||
      [
        "apartment_ref",
        "monthly_income",
        "credit_level",
        "tal_record",
        "occupants_total",
        "pets",
        "employment_status",
        "employment_length",
        "revenu_mensuel",
        "credit",
        "tal",
        "nombre_personnes",
        "animaux",
        "statut_emploi",
        "anciennete_mois",
        "employment_length_months",
        "preferred_location_label",
        "preferred_location_zone",
        "preferred_location_lat",
        "preferred_location_lng",
        "location_flexible"
      ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));

    delete payload.reevaluate_match;

    Object.assign(candidate, payload, {
      updated_at: new Date().toISOString()
    });

    if (shouldReevaluate || candidateNeedsMatch(candidate)) {
      Object.assign(candidate, await buildCandidateMatchFields(candidate));
    }

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

  const staticPages = {
    "/login.html": "login.html",
    "/admin.html": "admin.html",
    "/employee.html": "index.html",
    "/client.html": "client.html",
    "/client-onboarding.html": "client-onboarding.html"
  };

  const page = staticPages[req.path];

  if (!page) {
    return next();
  }

  return res.sendFile(path.join(__dirname, page));
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
