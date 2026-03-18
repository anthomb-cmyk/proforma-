const SUPABASE_URL = "https://nuuzkvgyolxbawvqyugu.supabase.co";
const SUPABASE_KEY = "sb_publishable_103-rw3MwM7k2xUeMMUodg_fRr9vUD4";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
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
      label: "Système",
      text: "Le mode Traducteur est actif. Collez un texte à traduire ou à expliquer."
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

async function requireLogin() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("Erreur session :", error);
  }

  if (!data?.session) {
    window.location.href = "/login.html";
    throw new Error("Not logged in");
  }

  chatState.currentUser = data.session.user;
  return data.session.user;
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

function setPending(isPending) {
  chatState.pending = isPending;

  if (sendBtn) sendBtn.disabled = isPending;
  if (clearChatBtn) clearChatBtn.disabled = isPending;
  if (listingModeBtn) listingModeBtn.disabled = isPending;
  if (translatorModeBtn) translatorModeBtn.disabled = isPending;
  if (listingSelect) listingSelect.disabled = isPending;
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

  bubble.textContent = message.text;

  wrapper.appendChild(label);
  wrapper.appendChild(bubble);
  chatMessages.appendChild(wrapper);
}

function renderMessages() {
  if (!chatMessages) return;

  const history = currentHistory();
  chatMessages.innerHTML = "";

  if (!history.length) {
    history.push({
      sender: "bot",
      label: "Système",
      text:
        chatState.currentMode === "listing"
          ? "Le mode Assistant des immeubles est actif. Sélectionnez un appartement puis posez votre question."
          : "Le mode Traducteur est actif. Collez un texte à traduire ou à expliquer."
    });
  }

  history.forEach((message) => addMessageToDOM(message));
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function pushMessage(sender, label, text, variant = "") {
  const message = { sender, label, text, variant };
  currentHistory().push(message);
  addMessageToDOM(message);

  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  return message;
}

function replaceLastLoading(text, variant = "success", label = "Assistant") {
  const history = currentHistory();
  const last = history[history.length - 1];

  if (!last || last.variant !== "loading") {
    pushMessage("bot", label, text, variant);
    return;
  }

  last.text = text;
  last.variant = variant;
  last.label = label;
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
        "Le mode Traducteur est actif. Collez un texte à traduire ou à expliquer.";
    }

    if (chatInput) {
      chatInput.placeholder = "Exemple : yer tu dispo le logi";
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

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Une erreur est survenue.");
  }

  return data;
}

async function checkServer() {
  try {
    const data = await fetchJSON("/api/health");

    if (data.ok) {
      chatState.serverReady = true;

      if (serverStatus) {
        serverStatus.textContent = "Serveur connecté";
        serverStatus.className = "server-pill ok";
      }
    } else {
      throw new Error("Health check failed");
    }
  } catch (error) {
    chatState.serverReady = false;

    if (serverStatus) {
      serverStatus.textContent = "Serveur non connecté";
      serverStatus.className = "server-pill error";
    }
  }
}

async function loadListings() {
  const data = await fetchJSON("/api/listings");
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
}

async function sendToAI(input, ref = "") {
  let message = input;

  if (chatState.currentMode === "listing" && ref) {
    message = `${formatDisplayRef(ref)} - ${input}`;
  }

  return fetchJSON("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      mode: chatState.currentMode,
      message
    })
  });
}

function setCandidateStatus(message = "", type = "") {
  if (!candidateStatus) return;

  candidateStatus.textContent = message;
  candidateStatus.className = "candidate-status";

  if (type) {
    candidateStatus.classList.add(type);
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

  try {
    const result = await fetchJSON("/api/admin/candidates", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    const warning = result.emailWarning
      ? ` ${result.emailWarning}`
      : "";

    setCandidateStatus(
      `Fiche envoyée avec succès pour L-${result.candidate?.apartment_ref || apartmentRef}.${warning}`,
      "success"
    );

    candidateForm.reset();
  } catch (error) {
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
        "Le serveur n'est pas connecté. Lancez le backend puis réessayez.",
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
    pushMessage("bot", "Système", "Traitement en cours…", "loading");

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
        result.reply || "Aucune réponse reçue.",
        result.variant || "success",
        result.label ||
          (chatState.currentMode === "listing"
            ? "Assistant des immeubles"
            : "Traducteur")
      );
    } catch (error) {
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
      if (chatForm) {
        chatForm.requestSubmit();
      }
    }
  });
}

if (clearChatBtn) {
  clearChatBtn.addEventListener("click", () => {
    if (chatState.currentMode === "listing") {
      chatState.listingHistory = [];
    } else {
      chatState.translatorHistory = [];
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

supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.href = "/login.html";
  }
});

(async function init() {
  try {
    await requireLogin();
    await Promise.all([checkServer(), loadListings()]);
  } catch (error) {
    console.error(error);

    if (serverStatus) {
      serverStatus.textContent = "Serveur non connecté";
      serverStatus.className = "server-pill error";
    }
  }

  switchMode("listing");
  renderMessages();
})();
