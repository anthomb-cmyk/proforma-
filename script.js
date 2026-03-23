const SUPABASE_URL = "https://nuuzkvgyolxbawvqyugu.supabase.co";
const SUPABASE_KEY = "sb_publishable_103-rw3MwM7k2xUeMMUodg_fRr9vUD4";
const EMPLOYEE_APP_URL = "https://fluxlocatif.up.railway.app";
const CLIENT_APP_URL = "https://client.fluxlocatif.com";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const chatState = {
  currentMode: "listing",
  listingHistory: [
    {
      sender: "bot",
      label: "Système",
      text: "Le mode Assistant des immeubles est actif. Sélectionnez un appartement puis posez votre question."
    }
  ],
  translatorHistory: [
    {
      sender: "bot",
      label: "Traducteur",
      text: "Collez un message et je vais proposer une reformulation en français international ainsi qu’une réponse suggérée en français canadien."
    }
  ],
  listings: {},
  serverReady: false,
  pending: false,
  currentUser: null
};

const sampleRefs = document.getElementById("sampleRefs");
const listingPreview = document.getElementById("listingPreview");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const clearChatBtn = document.getElementById("clearChatBtn");
const modeStatus = document.getElementById("modeStatus");
const listingModeBtn = document.getElementById("listingModeBtn");
const translatorModeBtn = document.getElementById("translatorModeBtn");
const modePill = document.getElementById("modePill");
const serverStatus = document.getElementById("serverStatus");
const sendBtn = document.getElementById("sendBtn");
const listingSelect = document.getElementById("listingSelect");
const listingSelectorCard = document.getElementById("listingSelectorCard");

const candidateForm = document.getElementById("candidateForm");
const candidateStatus = document.getElementById("candidateStatus");
const preferredLocationInput = document.getElementById("preferredLocationInput");
const preferredLocationList = document.getElementById("preferredLocationList");
const preferredLocationHint = document.getElementById("preferredLocationHint");
const preferredLocationLabel = document.getElementById("preferredLocationLabel");
const preferredLocationZone = document.getElementById("preferredLocationZone");
const preferredLocationLat = document.getElementById("preferredLocationLat");
const preferredLocationLng = document.getElementById("preferredLocationLng");
const locationFlexible = document.getElementById("locationFlexible");

const locationState = {
  options: [],
  selected: null
};

function resolveClientId(user) {
  return String(
    user?.user_metadata?.client_id ||
    user?.user_metadata?.clientId ||
    user?.app_metadata?.client_id ||
    user?.app_metadata?.clientId ||
    ""
  ).trim();
}

function resolveUserRole(user) {
  return String(
    user?.user_metadata?.role ||
    user?.app_metadata?.role ||
    ""
  ).trim().toLowerCase();
}

async function isAdminUser(userId) {
  if (!userId) return false;

  const { data, error } = await supabaseClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

async function waitForActiveSession(maxAttempts = 10, delayMs = 150) {
  for (let index = 0; index < maxAttempts; index += 1) {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
      throw error;
    }

    if (data?.session) {
      return data.session;
    }

    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
  }

  return null;
}

async function requireLogin() {
  const session = await waitForActiveSession();

  if (!session) {
    window.location.href = `/login.html?next=${encodeURIComponent(window.location.pathname || "/")}`;
    throw new Error("Not logged in");
  }

  const user = session.user;
  const userId = user?.id;
  const role = resolveUserRole(user);

  if (role === "admin") {
    window.location.href = `${EMPLOYEE_APP_URL}/admin.html`;
    throw new Error("Admin users must use admin platform");
  }

  if (role === "client") {
    window.location.href = `${CLIENT_APP_URL}/client.html`;
    throw new Error("Client users must use client platform");
  }

  if (role === "employee") {
    chatState.currentUser = user;
    return session.user;
  }

  if (await isAdminUser(userId)) {
    window.location.href = `${EMPLOYEE_APP_URL}/admin.html`;
    throw new Error("Admin users must use admin platform");
  }

  if (resolveClientId(user)) {
    window.location.href = `${CLIENT_APP_URL}/client.html`;
    throw new Error("Client users must use client platform");
  }

  chatState.currentUser = user;
  return session.user;
}

function currentHistory() {
  return chatState.currentMode === "listing"
    ? chatState.listingHistory
    : chatState.translatorHistory;
}

function formatDisplayRef(ref) {
  const value = String(ref ?? "").trim();
  if (!value) return "";
  return value.startsWith("L-") ? value : `L-${value}`;
}

function normalizeRefKey(ref) {
  const value = String(ref ?? "").trim();
  if (!value) return "";
  return value.replace(/^L-/i, "");
}

function normalizeLocationText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function setPending(isPending) {
  chatState.pending = isPending;

  if (sendBtn) sendBtn.disabled = isPending;
  if (clearChatBtn) clearChatBtn.disabled = isPending;
  if (listingModeBtn) listingModeBtn.disabled = isPending;
  if (translatorModeBtn) translatorModeBtn.disabled = isPending;
  if (listingSelect) listingSelect.disabled = isPending;
}

function setServerStatus(text, variant = "") {
  if (!serverStatus) return;
  serverStatus.textContent = text;
  serverStatus.className = "server-pill";
  if (variant) {
    serverStatus.classList.add(variant);
  }
}

function initSampleRefs() {
  if (!sampleRefs) return;

  sampleRefs.innerHTML = "";

  Object.keys(chatState.listings).forEach((refKey) => {
    const chip = document.createElement("button");
    chip.className = "sample-chip";
    chip.type = "button";
    chip.textContent = formatDisplayRef(refKey);

    chip.addEventListener("click", () => {
      if (chatState.currentMode !== "listing") {
        switchMode("listing");
      }

      if (listingSelect) {
        listingSelect.value = normalizeRefKey(refKey);
      }

      updateListingPreview(refKey);

      if (chatInput) {
        chatInput.focus();
      }
    });

    sampleRefs.appendChild(chip);
  });
}

function initListingDropdown() {
  if (!listingSelect) return;

  listingSelect.innerHTML = `<option value="">Sélectionnez un appartement</option>`;

  Object.keys(chatState.listings).forEach((refKey) => {
    const listing = chatState.listings[refKey];
    const normalizedRef = normalizeRefKey(refKey);

    const option = document.createElement("option");
    option.value = normalizedRef;
    option.textContent = `${formatDisplayRef(normalizedRef)}${listing?.adresse ? " — " + listing.adresse : ""}`;
    listingSelect.appendChild(option);
  });
}

function addMessageToDOM(message) {
  if (!chatMessages) return;

  const wrapper = document.createElement("div");
  wrapper.className = `message ${message.sender}`;

  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = message.label;

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  if (message.variant) {
    bubble.classList.add(message.variant);
  }

  if (Array.isArray(message.sections) && message.sections.length) {
    message.sections.forEach((section) => {
      const sectionEl = document.createElement("div");
      sectionEl.className = "message-section";

      const titleEl = document.createElement("div");
      titleEl.className = "message-section-title";
      titleEl.textContent = section.title;

      const bodyEl = document.createElement("div");
      bodyEl.className = "message-section-body";
      bodyEl.textContent = section.text;

      sectionEl.appendChild(titleEl);
      sectionEl.appendChild(bodyEl);
      bubble.appendChild(sectionEl);
    });
  } else {
    bubble.textContent = message.text;
  }

  wrapper.appendChild(label);
  wrapper.appendChild(bubble);
  chatMessages.appendChild(wrapper);
}

function renderMessages() {
  if (!chatMessages) return;

  const history = currentHistory();
  chatMessages.innerHTML = "";

  history.forEach((message) => addMessageToDOM(message));
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function pushMessage(sender, label, text, variant = "", sections = []) {
  const message = { sender, label, text, variant, sections };
  currentHistory().push(message);
  addMessageToDOM(message);

  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  return message;
}

function replaceLastLoading(text, variant = "success", label = "Assistant", sections = []) {
  const history = currentHistory();
  const last = history[history.length - 1];

  if (!last || last.variant !== "loading") {
    pushMessage("bot", label, text, variant, sections);
    return;
  }

  last.text = text;
  last.variant = variant;
  last.label = label;
  last.sections = sections;
  renderMessages();
}

function switchMode(mode) {
  chatState.currentMode = mode;

  if (listingModeBtn) {
    listingModeBtn.classList.toggle("active", mode === "listing");
  }

  if (translatorModeBtn) {
    translatorModeBtn.classList.toggle("active", mode === "translator");
  }

  if (mode === "listing") {
    if (modeStatus) {
      modeStatus.textContent =
        "Le mode Assistant des immeubles est actif. Sélectionnez un appartement puis posez votre question.";
    }

    if (chatInput) {
      chatInput.placeholder = "Entrez votre question ici...";
    }

    if (modePill) {
      modePill.textContent = "Mode actif : Assistant des immeubles";
    }

    if (listingSelectorCard) {
      listingSelectorCard.style.display = "block";
    }
  } else {
    if (modeStatus) {
      modeStatus.textContent =
        "Le mode Traducteur est actif. Collez un message et obtenez une reformulation en français international ainsi qu’une réponse suggérée en français canadien.";
    }

    if (chatInput) {
      chatInput.placeholder = "Collez le message ici pour générer une réponse...";
    }

    if (modePill) {
      modePill.textContent = "Mode actif : Traducteur";
    }

    if (listingSelectorCard) {
      listingSelectorCard.style.display = "none";
    }
  }

  renderMessages();
}

function updateListingPreview(ref) {
  if (!listingPreview) return;

  const normalizedRef = normalizeRefKey(ref);
  const listing = chatState.listings[normalizedRef];

  if (!listing) {
    listingPreview.textContent = "Numéro de référence introuvable.";
    listingPreview.classList.remove("muted");
    return;
  }

  const adresse = listing.adresse ?? "Non précisée";
  const ville = listing.ville ?? "Non précisée";
  const typeLogement = listing.type_logement ?? "Non précisé";
  const chambres = listing.chambres ?? "Non précisé";
  const superficie = listing.superficie ?? "Non précisée";
  const loyer = listing.loyer ?? "Non précisé";
  const disponibilite = listing.disponibilite ?? "Non précisée";
  const statut = listing.statut ?? "Non précisé";
  const notes = listing.notes ?? "Aucune note";
  const electricite = listing.electricite ?? "Non précisée";
  const laveuseSecheuse = listing.laveuse_secheuse ?? "Non précisée";
  const electrosInclus = listing.electros_inclus ?? "Non précisé";
  const balcon = listing.balcon ?? "Non précisé";
  const wifi = listing.wifi ?? "Non précisé";
  const accesTerrain = listing.acces_au_terrain ?? "Non précisé";
  const stationnementsGratuits = listing.nombre_stationnements_gratuits ?? "0";
  const stationnementsPayants = listing.nombre_stationnements_payants ?? "0";
  const prixStationnementPayant =
    listing.prix_stationnement_payant === null || listing.prix_stationnement_payant === undefined || listing.prix_stationnement_payant === ""
      ? "Non précisé"
      : `${listing.prix_stationnement_payant} $`;
  const nombreLogementsBatiment = listing.nombre_logements_batisse ?? "Non précisé";
  const rangement = listing.rangement ?? "Non précisé";

  listingPreview.innerHTML = `
    <strong>${formatDisplayRef(normalizedRef)}</strong><br>
    ${adresse}<br>
    ${ville}<br><br>
    Type : ${typeLogement}<br>
    Chambres : ${chambres}<br>
    Superficie : ${superficie}<br>
    Loyer : ${loyer}${loyer === "Non précisé" ? "" : " $"}<br>
    Disponibilité : ${disponibilite}<br>
    Statut : ${statut}<br>
    Électricité : ${electricite}<br>
    Laveuse / sécheuse : ${laveuseSecheuse}<br>
    Électros inclus : ${electrosInclus}<br>
    Balcon : ${balcon}<br>
    Wifi : ${wifi}<br>
    Accès au terrain : ${accesTerrain}<br>
    Stationnements gratuits : ${stationnementsGratuits}<br>
    Stationnements payants : ${stationnementsPayants}<br>
    Prix stationnement payant : ${prixStationnementPayant}<br>
    Logements dans la bâtisse : ${nombreLogementsBatiment}<br>
    Rangement : ${rangement}<br>
    Notes : ${notes}
  `;

  listingPreview.classList.remove("muted");
}

function prevalidateListing() {
  const ref = listingSelect ? normalizeRefKey(listingSelect.value) : "";

  if (!ref) {
    return {
      ok: false,
      error: "Veuillez sélectionner un appartement."
    };
  }

  if (!chatState.listings[ref]) {
    return {
      ok: false,
      error: "Appartement introuvable."
    };
  }

  return { ok: true, ref };
}

async function fetchJSON(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      throw new Error("Le serveur n’a pas retourné une réponse JSON.");
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Une erreur est survenue.");
    }

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkServer() {
  setServerStatus("Connexion serveur en cours...");

  try {
    const data = await fetchJSON("/api/health", {}, 8000);

    if (data.ok) {
      chatState.serverReady = true;
      setServerStatus("Serveur connecté", "ok");
      return true;
    }

    throw new Error("Health check failed");
  } catch (error) {
    console.error("Health check error:", error);
    chatState.serverReady = false;
    setServerStatus("Serveur non connecté", "error");
    return false;
  }
}

async function loadListings() {
  try {
    const data = await fetchJSON("/api/listings", {}, 10000);
    const rawListings = data.listings || {};
    const normalizedListings = {};

    Object.entries(rawListings).forEach(([key, value]) => {
      const normalizedKey = normalizeRefKey(key || value?.ref);
      if (!normalizedKey) return;

      normalizedListings[normalizedKey] = {
        ...value,
        ref: normalizedKey
      };
    });

    chatState.listings = normalizedListings;
    initSampleRefs();
    initListingDropdown();
    return true;
  } catch (error) {
    console.error("Load listings error:", error);
    return false;
  }
}

async function sendToAI(input, ref = "") {
  let message = input;

  if (chatState.currentMode === "listing" && ref) {
    message = `${formatDisplayRef(ref)} - ${input}`;
  }

  return fetchJSON(
    "/api/chat",
    {
      method: "POST",
      body: JSON.stringify({
        mode: chatState.currentMode,
        message
      })
    },
    25000
  );
}

function setCandidateStatus(message = "", type = "") {
  if (!candidateStatus) return;

  candidateStatus.textContent = message;
  candidateStatus.className = "candidate-status";

  if (type) {
    candidateStatus.classList.add(type);
  }
}

function setPreferredLocationHint(message, type = "") {
  if (!preferredLocationHint) return;
  preferredLocationHint.textContent = message;
  preferredLocationHint.className = "candidate-helper";

  if (type) {
    preferredLocationHint.classList.add(type);
  }
}

function clearSelectedPreferredLocation() {
  locationState.selected = null;

  if (preferredLocationLabel) preferredLocationLabel.value = "";
  if (preferredLocationZone) preferredLocationZone.value = "";
  if (preferredLocationLat) preferredLocationLat.value = "";
  if (preferredLocationLng) preferredLocationLng.value = "";
}

function applySelectedPreferredLocation(location) {
  locationState.selected = location;

  if (preferredLocationInput) preferredLocationInput.value = location.label;
  if (preferredLocationLabel) preferredLocationLabel.value = location.label;
  if (preferredLocationZone) preferredLocationZone.value = location.zone;
  if (preferredLocationLat) preferredLocationLat.value = String(location.lat);
  if (preferredLocationLng) preferredLocationLng.value = String(location.lng);

  setPreferredLocationHint(`Zone enregistrée : ${location.zone}.`, "");
}

function resolveSelectedPreferredLocation() {
  const typedValue = preferredLocationInput?.value || "";
  const normalizedTypedValue = normalizeLocationText(typedValue);

  if (!normalizedTypedValue) {
    clearSelectedPreferredLocation();
    setPreferredLocationHint("Sélectionnez la ville ou le secteur recherché dans la liste.", "");
    return null;
  }

  const matchedLocation = locationState.options.find(
    (location) => normalizeLocationText(location.label) === normalizedTypedValue
  ) || null;

  if (!matchedLocation) {
    clearSelectedPreferredLocation();
    setPreferredLocationHint("Choisissez une option existante dans la liste de villes.", "error");
    return null;
  }

  applySelectedPreferredLocation(matchedLocation);
  return matchedLocation;
}

async function loadPreferredLocations() {
  const locations = await fetchJSON("/locations-quebec.json", {}, 8000);
  locationState.options = Array.isArray(locations) ? locations : [];

  if (preferredLocationList) {
    preferredLocationList.innerHTML = "";

    locationState.options.forEach((location) => {
      const option = document.createElement("option");
      option.value = location.label;
      option.label = `${location.label} — ${location.zone}`;
      preferredLocationList.appendChild(option);
    });
  }
}

async function handleCandidateSubmit(event) {
  event.preventDefault();

  setCandidateStatus("", "");

  const submitBtn = candidateForm.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Envoi en cours...";
  }

  const apartmentRef = normalizeRefKey(document.getElementById("aptRef").value.trim());
  const selectedLocation = resolveSelectedPreferredLocation();

  const payload = {
    apartment_ref: apartmentRef ? Number(apartmentRef) : null,
    candidate_name: document.getElementById("name").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    email: document.getElementById("email").value.trim(),
    job_title: document.getElementById("job").value.trim(),
    employer_name: document.getElementById("employer").value.trim(),
    employment_length: document.getElementById("employmentLength").value.trim(),
    employment_status: document.getElementById("employmentStatus").value,
    monthly_income: document.getElementById("income").value || null,
    credit_level: document.getElementById("credit").value,
    occupants_total: document.getElementById("occupants").value || null,
    tal_record: document.getElementById("tal").value,
    pets: document.getElementById("pets").value,
    preferred_location_label: selectedLocation?.label || "",
    preferred_location_zone: selectedLocation?.zone || "",
    preferred_location_lat: selectedLocation?.lat ?? null,
    preferred_location_lng: selectedLocation?.lng ?? null,
    location_flexible: locationFlexible?.value || "",
    employee_notes: document.getElementById("notes").value.trim(),
    status: "en attente",
    employee_user_id: chatState.currentUser?.id || "employee-manuel"
  };

  if (!payload.apartment_ref) {
    setCandidateStatus("Veuillez entrer un appartement visé valide.", "error");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Envoyer la fiche";
    }
    return;
  }

  if (!selectedLocation) {
    setCandidateStatus("Veuillez sélectionner une ville ou un secteur valide dans la liste.", "error");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Envoyer la fiche";
    }
    return;
  }

  if (!payload.location_flexible) {
    setCandidateStatus("Veuillez préciser si des secteurs voisins sont acceptés.", "error");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Envoyer la fiche";
    }
    return;
  }

  try {
    const result = await fetchJSON(
      "/api/admin/candidates",
      {
        method: "POST",
        body: JSON.stringify(payload)
      },
      20000
    );

    const warning = result.emailWarning ? ` ${result.emailWarning}` : "";

    setCandidateStatus(
      `Fiche envoyée avec succès pour L-${result.candidate?.apartment_ref || apartmentRef}.${warning}`,
      "success"
    );

    candidateForm.reset();
    clearSelectedPreferredLocation();
    setPreferredLocationHint("Sélectionnez la ville ou le secteur recherché dans la liste.", "");
  } catch (error) {
    console.error("Candidate submit error:", error);
    setCandidateStatus(
      error.message || "Erreur envoi fiche locataire.",
      "error"
    );
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Envoyer la fiche";
    }
  }
}

if (listingSelect) {
  listingSelect.addEventListener("change", () => {
    const selectedRef = normalizeRefKey(listingSelect.value);
    if (selectedRef) {
      updateListingPreview(selectedRef);
    }
  });
}

if (chatForm) {
  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const input = chatInput.value.trim();
    if (!input || chatState.pending) return;

    if (!chatState.serverReady) {
      pushMessage(
        "bot",
        "Système",
        "Le serveur n'est pas connecté pour le moment. Réessayez dans un instant.",
        "error"
      );
      return;
    }

    let selectedRef = "";

    if (chatState.currentMode === "listing") {
      const validation = prevalidateListing();

      if (!validation.ok) {
        pushMessage("bot", "Système", validation.error, "error");
        return;
      }

      selectedRef = validation.ref;
      updateListingPreview(selectedRef);
    }

    const userText =
      chatState.currentMode === "listing" && selectedRef
        ? `${formatDisplayRef(selectedRef)} - ${input}`
        : input;

    pushMessage("user", "Employé", userText);

    chatInput.value = "";
    setPending(true);
    pushMessage("bot", "Système", "Traitement en cours...", "loading");

    try {
      const result = await sendToAI(input, selectedRef);

      if (chatState.currentMode === "listing") {
        const resultRef = normalizeRefKey(result.reference || selectedRef);

        if (resultRef && chatState.listings[resultRef]) {
          updateListingPreview(resultRef);

          if (listingSelect) {
            listingSelect.value = resultRef;
          }
        }
      }

      replaceLastLoading(
        chatState.currentMode === "translator" && result.translation && result.reply
          ? ""
          : result.reply || "Aucune réponse reçue.",
        result.variant || "success",
        result.label ||
          (chatState.currentMode === "listing"
            ? "Assistant des immeubles"
            : "Traducteur"),
        chatState.currentMode === "translator" && result.translation && result.reply
          ? [
              {
                title: "Français international",
                text: result.translation
              },
              {
                title: "Réponse suggérée (à adapter)",
                text: result.reply
              },
              {
                title: "Contexte",
                text: result.context || "demande générale"
              }
            ]
          : []
      );
    } catch (error) {
      console.error("Chat error:", error);
      replaceLastLoading(
        error.message || "Une erreur est survenue.",
        "error",
        "Système"
      );
    } finally {
      setPending(false);
    }
  });
}

if (chatInput) {
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (chatForm) chatForm.requestSubmit();
    }
  });
}

if (clearChatBtn) {
  clearChatBtn.addEventListener("click", () => {
    if (chatState.currentMode === "listing") {
      chatState.listingHistory = [
        {
          sender: "bot",
          label: "Système",
          text: "Le mode Assistant des immeubles est actif. Sélectionnez un appartement puis posez votre question."
        }
      ];
    } else {
      chatState.translatorHistory = [
        {
          sender: "bot",
          label: "Traducteur",
          text: "Collez un message et je vais proposer une reformulation en français international ainsi qu’une réponse suggérée en français canadien."
        }
      ];
    }

    renderMessages();
  });
}

if (listingModeBtn) {
  listingModeBtn.addEventListener("click", () => switchMode("listing"));
}

if (translatorModeBtn) {
  translatorModeBtn.addEventListener("click", () => switchMode("translator"));
}

if (candidateForm) {
  candidateForm.addEventListener("submit", handleCandidateSubmit);
}

if (preferredLocationInput) {
  preferredLocationInput.addEventListener("change", resolveSelectedPreferredLocation);
  preferredLocationInput.addEventListener("blur", resolveSelectedPreferredLocation);
}

supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.href = `/login.html?next=${encodeURIComponent(window.location.pathname || "/")}`;
  }
});

(async function init() {
  switchMode("listing");
  renderMessages();

  try {
    await requireLogin();
  } catch (error) {
    console.error("Login init error:", error);
    return;
  }

  const [serverOk, listingsOk] = await Promise.all([
    checkServer(),
    loadListings()
  ]);

  try {
    await loadPreferredLocations();
  } catch (error) {
    console.error("Load preferred locations error:", error);
    setPreferredLocationHint("La liste des villes n’a pas pu être chargée pour le moment.", "error");
  }

  if (!serverOk) {
    setServerStatus("Serveur non connecté", "error");
  } else if (!listingsOk) {
    setServerStatus("Serveur connecté", "ok");
  }
})();
