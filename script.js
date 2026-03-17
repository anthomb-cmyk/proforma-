const chatState = {
  currentMode: "listing",
  listingHistory: [
    {
      sender: "bot",
      label: "Système",
      text: "Le mode Assistant des immeubles est actif. Entrez une demande comme :\nL-1001 - Quel est le loyer ?"
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
  pending: false
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

function currentHistory() {
  return chatState.currentMode === "listing"
    ? chatState.listingHistory
    : chatState.translatorHistory;
}

function setPending(isPending) {
  chatState.pending = isPending;
  if (sendBtn) sendBtn.disabled = isPending;
  if (clearChatBtn) clearChatBtn.disabled = isPending;
  if (listingModeBtn) listingModeBtn.disabled = isPending;
  if (translatorModeBtn) translatorModeBtn.disabled = isPending;
}

function initSampleRefs() {
  if (!sampleRefs) return;

  sampleRefs.innerHTML = "";

  Object.keys(chatState.listings).forEach((ref) => {
    const chip = document.createElement("button");
    chip.className = "sample-chip";
    chip.type = "button";
    chip.textContent = ref;

    chip.addEventListener("click", () => {
      if (chatState.currentMode !== "listing") {
        switchMode("listing");
      }
      chatInput.value = `${ref} - `;
      chatInput.focus();
      updateListingPreview(ref);
    });

    sampleRefs.appendChild(chip);
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

  if (message.variant) bubble.classList.add(message.variant);
  bubble.textContent = message.text;

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

function pushMessage(sender, label, text, variant = "") {
  const message = { sender, label, text, variant };
  currentHistory().push(message);
  addMessageToDOM(message);

  chatMessages.scrollTop = chatMessages.scrollHeight;
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

  listingModeBtn.classList.toggle("active", mode === "listing");
  translatorModeBtn.classList.toggle("active", mode === "translator");

  renderMessages();
}

/* 🔥 FIX ICI */
function updateListingPreview(ref) {
  if (!listingPreview) return;

  const listing = chatState.listings[ref];

  if (!listing) {
    listingPreview.textContent = "Numéro de référence introuvable.";
    return;
  }

  const adresse = listing.adresse ?? listing.address ?? "Non précisée";
  const ville = listing.ville ?? listing.city ?? "Non précisée";
  const typeLogement = listing.type_logement ?? "Non précisé";
  const chambres = listing.chambres ?? listing.bedrooms ?? "Non précisé";
  const superficie = listing.superficie ?? "Non précisée";
  const loyer = listing.loyer ?? listing.rent ?? "Non précisé";
  const disponibilite = listing.disponibilite ?? listing.availability ?? "Non précisée";
  const statut = listing.statut ?? listing.status ?? "Non précisé";
  const notes = listing.notes ?? "Aucune note";

  listingPreview.innerHTML = `
    <strong>${listing.ref}</strong><br>
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
}

function extractListingRef(text) {
  const match = text.match(/\bL-\d{4}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function prevalidateListing(input) {
  const ref = extractListingRef(input);

  if (!ref) {
    return { ok: false, error: "Format invalide (ex: L-1001)" };
  }

  if (!chatState.listings[ref]) {
    return { ok: false, error: "Référence introuvable." };
  }

  return { ok: true, ref };
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json" }
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Erreur");

  return data;
}

async function checkServer() {
  try {
    const res = await fetchJSON("/api/health");
    chatState.serverReady = res.ok;
    serverStatus.textContent = "Serveur connecté";
  } catch {
    chatState.serverReady = false;
    serverStatus.textContent = "Serveur non connecté";
  }
}

async function loadListings() {
  const data = await fetchJSON("/api/listings");
  chatState.listings = data.listings || {};
  initSampleRefs();
}

async function sendToAI(input) {
  return fetchJSON("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      mode: chatState.currentMode,
      message: input
    })
  });
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const input = chatInput.value.trim();
  if (!input) return;

  pushMessage("user", "Employé", input);
  chatInput.value = "";

  const validation = prevalidateListing(input);

  if (!validation.ok) {
    pushMessage("bot", "Erreur", validation.error, "error");
    return;
  }

  updateListingPreview(validation.ref);

  pushMessage("bot", "Système", "Chargement...", "loading");

  try {
    const result = await sendToAI(input);
    replaceLastLoading(result.reply);
  } catch (error) {
    replaceLastLoading(error.message, "error");
  }
});

(async function init() {
  await Promise.all([checkServer(), loadListings()]);
  renderMessages();
})();
