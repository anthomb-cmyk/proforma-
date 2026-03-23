import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import { Resend } from "resend";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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

const DATA_DIR = path.join(__dirname, ".data");
const LISTINGS_PATH = path.join(__dirname, "listings.json");
const LOCATIONS_PATH = path.join(__dirname, "locations-quebec.json");
const CLIENTS_PATH = path.join(__dirname, "clients.json");
const CLIENT_INVITATIONS_PATH = path.join(DATA_DIR, "client_invitations.json");
const LEGACY_CLIENT_INVITATIONS_PATH = path.join(DATA_DIR, "client-invitations.json");
const CANDIDATES_PATH = path.join(DATA_DIR, "candidates.json");
const CHAT_MESSAGES_PATH = path.join(DATA_DIR, "chat-messages.json");
const CHAT_SESSIONS_PATH = path.join(DATA_DIR, "chat-sessions.json");
const USER_DAILY_TIME_PATH = path.join(DATA_DIR, "user-daily-time.json");

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const resendClient = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
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

async function loadListingsMap() {
  const raw = await readJsonFile(LISTINGS_PATH, {});
  const normalized = {};

  Object.entries(raw).forEach(([key, value]) => {
    const record = toListingRecord(key, value);
    normalized[record.ref] = record;
  });

  return normalized;
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
        zone: listing.zone || "",
        lat: parseCoordinate(listing.lat),
        lng: parseCoordinate(listing.lng),
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
        rangement: listing.rangement || "",
        client_id: listing.client_id ?? null
      };
    });

  await writeJsonFile(LISTINGS_PATH, output);
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

async function sendClientInvitationEmail(invitation, onboardingLink) {
  if (!resendClient || !INVITATION_FROM_EMAIL) {
    return {
      sent: false,
      reason: "email_not_configured"
    };
  }

  const recipientName = invitation.name || invitation.contact_name || "Client";
  const subject = "Bienvenue chez FluxLocatif — activez votre espace client";
  const html = `
    <p>Bonjour ${recipientName},</p>
    <p>Merci de nous avoir choisis.</p>
    <p>Votre espace client est prêt. Pour commencer, veuillez utiliser le lien sécurisé ci-dessous afin d’activer votre compte et ajouter votre premier logement :</p>
    <p><a href="${onboardingLink}">${onboardingLink}</a></p>
    <p>Ce lien est valide pendant 7 jours.</p>
    <p>Si vous avez des questions, vous pouvez répondre directement à ce courriel.</p>
    <p>L’équipe FluxLocatif</p>
  `;

  await resendClient.emails.send({
    from: INVITATION_FROM_EMAIL,
    to: invitation.email,
    subject,
    html,
    text: [
      `Bonjour ${recipientName},`,
      "",
      "Merci de nous avoir choisis.",
      "",
      "Votre espace client est prêt. Pour commencer, veuillez utiliser le lien sécurisé ci-dessous afin d’activer votre compte et ajouter votre premier logement :",
      "",
      onboardingLink,
      "",
      "Ce lien est valide pendant 7 jours.",
      "",
      "Si vous avez des questions, vous pouvez répondre directement à ce courriel.",
      "",
      "L’équipe FluxLocatif"
    ].join("\n")
  });

  return {
    sent: true
  };
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

function detectTranslatorContext(message) {
  const text = String(message || "").trim().toLowerCase();

  if (
    text.includes("dispo") ||
    text.includes("disponible") ||
    text.includes("available") ||
    text.includes("vacant")
  ) {
    return "availability";
  }

  if (
    text.includes("loyer") ||
    text.includes("prix") ||
    text.includes("combien") ||
    text.includes("hydro") ||
    text.includes("chauffé") ||
    text.includes("chauffe") ||
    text.includes("chauffage")
  ) {
    return "pricing";
  }

  if (
    text.includes("chien") ||
    text.includes("chat") ||
    text.includes("animal")
  ) {
    return "pets";
  }

  if (
    text.includes("depot") ||
    text.includes("dépôt")
  ) {
    return "deposit";
  }

  if (
    text.includes("visite") ||
    text.includes("visiter") ||
    text.includes("jpeux tu visiter") ||
    text.includes("see it") ||
    text.includes("tour")
  ) {
    return "visit";
  }

  if (
    text.includes("metro") ||
    text.includes("métro") ||
    text.includes("loin") ||
    text.includes("distance")
  ) {
    return "location";
  }

  if (
    text.includes("quand") ||
    text.includes("date") ||
    text.includes("emm") ||
    text.includes("move") ||
    text.includes("disponible a partir")
  ) {
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

function buildTranslatorFallbackReply(message) {
  const context = detectTranslatorContext(message);

  if (context === "availability") {
    return [
      "Bonjour,",
      "",
      "Oui, le logement est toujours disponible pour le moment.",
      "",
      "Souhaitez-vous que je vous confirme les principaux détails du logement ?"
    ].join("\n");
  }

  if (context === "pricing") {
    return [
      "Bonjour,",
      "",
      "Le loyer demandé est celui affiché pour le logement.",
      "",
      "Si vous voulez, je peux aussi vous préciser ce qui est inclus."
    ].join("\n");
  }

  if (context === "pets") {
    return [
      "Bonjour,",
      "",
      "Merci pour l’information.",
      "",
      "Je peux vérifier la politique concernant les animaux pour ce logement. Quel type d’animal avez-vous ?"
    ].join("\n");
  }

  if (context === "deposit") {
    return [
      "Bonjour,",
      "",
      "En location résidentielle au Québec, ce n’est généralement pas un dépôt qui est demandé.",
      "",
      "Je peux vous préciser les conditions applicables au logement si vous voulez."
    ].join("\n");
  }

  if (context === "move-in timing") {
    return [
      "Bonjour,",
      "",
      "Je peux vous confirmer la date de disponibilité du logement.",
      "",
      "Quelle date d’emménagement recherchez-vous ?"
    ].join("\n");
  }

  if (context === "qualification") {
    return [
      "Bonjour,",
      "",
      "Merci pour les précisions.",
      "",
      "Je peux vous indiquer les critères de base pour ce logement si vous voulez."
    ].join("\n");
  }

  if (context === "location") {
    return [
      "Bonjour,",
      "",
      "Je peux vous donner plus de détails sur l’emplacement du logement.",
      "",
      "Quel point de repère ou quel secteur vous intéresse ?"
    ].join("\n");
  }

  return [
    "Bonjour,",
    "",
    "Merci pour votre message.",
    "",
    "Merci pour votre message.",
    "",
    "Je peux vous donner les informations utiles sur le logement.",
    "",
    "Qu’aimeriez-vous confirmer en priorité ?"
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

  if (
    text.includes("hydro") ||
    text.includes("chauffé") ||
    text.includes("chauffe")
  ) {
    return "Quel est le loyer, et est-ce que l’électricité ou le chauffage sont inclus ?";
  }

  if (text.includes("prix") || text.includes("loyer") || text.includes("rent") || text.includes("combien")) {
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

  if (text.includes("chien") || text.includes("chat") || text.includes("animal")) {
    return "J’ai un animal et je voudrais savoir s’il est accepté.";
  }

  if (text.includes("depot") || text.includes("dépôt")) {
    return "Est-ce qu’un dépôt est requis pour louer le logement ?";
  }

  if (text.includes("temps plein") || text.includes("travail") || text.includes("emploi")) {
    return "J’ai un emploi à temps plein et je souhaite savoir si mon profil peut convenir.";
  }

  if (text.includes("metro") || text.includes("métro") || text.includes("loin")) {
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

function buildTranslatorFallbackPayload(message) {
  return {
    translation: buildTranslatorFallbackTranslation(message),
    reply: buildTranslatorFallbackReply(message),
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

  if (!clientId) {
    throw createHttpError(403, "Accès client refusé.");
  }

  return { user, clientId };
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
          "Tu es un assistant de correction locative specialise en messages de locataires ecrits en francais quebecois oral, familier, abrege, phonétique ou mal ponctue. Tu dois bien comprendre le francais quebecois parle, y compris le slang, les abreviations, les raccourcis oraux, l'ecriture phonétique, les fautes d'orthographe, les phrases tres sales et les expressions locales. Suppose toujours un contexte d'appartement ou de location sauf si c'est clairement impossible. Ton travail n'est pas de traduire mot a mot, mais d'interpreter correctement l'intention reelle du locataire et de la reformuler clairement.\n\nRetourne uniquement un objet JSON avec trois champs string: translation, reply, context.\n\ntranslation: reformulation en francais international, propre, naturelle, courte, bien ponctuee et fidele au sens reel du message.\nreply: reponse suggeree en francais canadien, humaine, breve, professionnelle, naturelle pour un contexte locatif au Quebec. Cette reponse est seulement une suggestion. L'employe doit utiliser son jugement et peut l'adapter avant envoi.\ncontext: etiquette courte en anglais, par exemple availability, pricing, pets, qualification, move-in timing, location, deposit, visit ou general inquiry.\n\nRegles:\n- aucun emoji\n- aucun ton robotique\n- aucun ton excessivement formel\n- ne traduis jamais mot a mot si le sens est clair dans le contexte locatif\n- n'invente pas d'information\n- ne propose pas une visite trop tot\n- pose au maximum une seule question naturelle a la fois si une relance est utile\n- la reponse doit faire avancer la conversation de facon naturelle dans un contexte de location\n- si le locataire ecrit en francais quebecois tres familier, corrige le sens vers un francais international normal, pas vers un calque litteral\n\nExemples:\nMessage: stu dispo big\ntranslation: Est-ce que le logement est disponible ?\nreply: Bonjour, oui, le logement est toujours disponible pour le moment. Souhaitez-vous que je vous confirme les principaux details ?\ncontext: availability\n\nMessage: c tu loin du metro\ntranslation: Est-ce que le logement est loin du metro ?\nreply: Bonjour, je peux vous donner plus de details sur l'emplacement. Quel secteur ou quel point de repere vous interesse ?\ncontext: location\n\nMessage: jai un chien pis chu temp plein\ntranslation: J'ai un chien et je travaille a temps plein.\nreply: Bonjour, merci pour les precisions. Je peux verifier la politique pour les animaux et vous confirmer les criteres de base du logement.\ncontext: qualification\n\nMessage: combien le loyer ak hydro\ntranslation: Quel est le loyer, et est-ce que l'electricite est incluse ?\nreply: Bonjour, je peux vous confirmer le loyer ainsi que ce qui est inclus. Voulez-vous que je vous precise les inclusions ?\ncontext: pricing\n\nMessage: jpeux tu visiter sa\ntranslation: Est-ce qu'il serait possible de visiter le logement ?\nreply: Bonjour, je peux d'abord vous confirmer les principaux details du logement et sa disponibilite. Souhaitez-vous que je vous les resume ?\ncontext: visit\n\nMessage: allo jai tu besoin dun depot\ntranslation: Est-ce qu'un depot est requis pour louer le logement ?\nreply: Bonjour, en location residentielle au Quebec, ce n'est generalement pas un depot qui est demande. Je peux vous preciser les conditions applicables au logement.\ncontext: deposit\n\nMessage: chu interesser mais jme demandais si ces chauffé\ntranslation: Je suis interesse, mais je me demandais si le logement est chauffe.\nreply: Bonjour, je peux vous confirmer ce qui est inclus avec le logement. Voulez-vous que je vous precise le chauffage et les autres inclusions ?\ncontext: pricing"
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
        reply: parsed.reply.trim(),
        context: typeof parsed?.context === "string" && parsed.context.trim()
          ? parsed.context.trim()
          : detectTranslatorContext(message)
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
        `Réponse suggérée : ${translatorPayload.reply}`,
        `Contexte : ${translatorPayload.context}`
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
        reply: translatorPayload.reply,
        context: translatorPayload.context
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

app.get("/api/admin/users", async (_req, res) => {
  try {
    const users = await loadAllSupabaseUsers();
    const today = getTodayString();
    const summary = await readJsonFile(USER_DAILY_TIME_PATH, []);
    const summaryByUserId = new Map(
      summary
        .filter((row) => row.day === today)
        .map((row) => [row.user_id, row])
    );

    res.json({
      ok: true,
      users: users.map((user) => {
        const userSummary = summaryByUserId.get(user.id) || null;
        return {
          user_id: user.id,
          email: user.email || "",
          full_name: user.user_metadata?.full_name || user.user_metadata?.name || "",
          created_at: user.created_at || null,
          last_sign_in_at: user.last_sign_in_at || null,
          is_deactivated: Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now()),
          banned_until: user.banned_until || null,
          today_heartbeat_count: userSummary?.heartbeat_count ?? 0,
          today_total_seconds: userSummary?.total_seconds ?? 0
        };
      })
    });
  } catch (error) {
    res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Impossible de charger les utilisateurs."
    });
  }
});

app.post("/api/admin/users/:id/deactivate", async (req, res) => {
  try {
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
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Impossible de désactiver cet utilisateur."
    });
  }
});

app.delete("/api/admin/users/:id", async (req, res) => {
  try {
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
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "Impossible de supprimer cet utilisateur."
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

app.get("/api/admin/clients", async (_req, res) => {
  try {
    const clientsMap = await loadClientsMap();
    const clients = Object.entries(clientsMap).map(([id, client]) => normalizeClientRecord(id, client));
    res.json({ ok: true, clients });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Impossible de charger les clients."
    });
  }
});

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
    const emailDelivery = await sendClientInvitationEmail(invitation, onboardingLink).catch((error) => ({
      sent: false,
      reason: error?.message || "email_send_failed"
    }));

    return res.status(201).json({
      ok: true,
      invitation: sanitizeInvitation(invitation),
      onboarding_link: onboardingLink,
      invitation_email_sent: emailDelivery.sent,
      invitation_email_error: emailDelivery.sent ? null : emailDelivery.reason
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
        client_id: invitation.client_id,
        full_name: fullName,
        company_name: companyName,
        phone,
        main_city: mainCity
      },
      app_metadata: {
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
        client_id: invitation.client_id,
        full_name: fullName,
        company_name: companyName,
        phone,
        main_city: mainCity
      },
      app_metadata: {
        ...currentAppMetadata,
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
    "/": "index.html",
    "/index.html": "index.html",
    "/admin.html": "admin.html",
    "/login.html": "login.html",
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
