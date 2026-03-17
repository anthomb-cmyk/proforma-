const chatState = {
  currentMode: "listing",
  listingHistory: [
    {
      sender: "bot",
      label: "Système",
      text: "Le mode Assistant des immeubles est actif. Entrez une demande comme :\nL-1001 - Quel est le loyer ?"
    }
  ],
  translatorHistory: [],
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
  return chatState.currentMode === "listing" ? chatState.listingHistory : chatState.translatorHistory;
}

function setPending(isPending) {
  chatState.pending = isPending;
  sendBtn.disabled = isPending;
  clearChatBtn.disabled = isPending;
  listingModeBtn.disabled = isPending;
  translatorModeBtn.disabled = isPending;
}

function initSampleRefs() {
  sampleRefs.innerHTML = "";
  Object.keys(chatState.listings).forEach((ref) => {
    const chip = document.createElement("button");
    chip.className = "sample-chip";
    chip.type = "button";
    chip.textContent = ref;
    chip.addEventListener("click", () => {
      if (chatState.currentMode !== "listing") switchMode("listing");
      chatInput.value = `${ref} - `;
      chatInput.focus();
      updateListingPreview(ref);
    });
    sampleRefs.appendChild(chip);
  });
}

function addMessageToDOM(message) {
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
  const history = currentHistory();
  chatMessages.innerHTML = "";

  if (!history.length) {
    const emptyText = chatState.currentMode === "listing"
      ? "Le mode Assistant des immeubles est actif. Entrez une demande comme :\nL-1001 - Quel est le loyer ?"
      : "Le mode Traducteur est actif. Collez un texte à traduire ou à expliquer.";

    history.push({ sender: "bot", label: "Système", text: emptyText });
  }

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

  if (mode === "listing") {
    modeStatus.textContent = "Le mode Assistant des immeubles est actif. Incluez un numéro de référence valide.";
    chatInput.placeholder = "Exemple : L-1001 - Quel est le loyer ?";
    modePill.textContent = "Mode actif : Assistant des immeubles";
  } else {
    modeStatus.textContent = "Le mode Traducteur est actif. Collez un texte à traduire ou posez une question uniquement sur le texte fourni.";
    chatInput.placeholder = "Exemple : Traduis en anglais : Bonjour, le logement est disponible.";
    modePill.textContent = "Mode actif : Traducteur";
  }

  renderMessages();
}

function updateListingPreview(ref) {
  const listing = chatState.listings[ref];
  if (!listing) {
    listingPreview.textContent = "Numéro de référence introuvable.";
    listingPreview.classList.remove("muted");
    return;
  }

  listingPreview.innerHTML = `
    <strong>${listing.ref}</strong><br>
    ${listing.address}<br>
    ${listing.city}<br><br>
    Loyer : ${listing.rent}<br>
    Chambres : ${listing.bedrooms}<br>
    Disponibilité : ${listing.availability}<br>
    Statut : ${listing.status}<br>
    Notes : ${listing.notes}
  `;
  listingPreview.classList.remove("muted");
}

function extractListingRef(text) {
  const match = text.match(/\bL-\d{4}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function prevalidateListing(input) {
  const ref = extractListingRef(input);
  if (!ref) return { ok: false, error: "Veuillez entrer un numéro de référence valide au format L-1001" };
  if (!chatState.listings[ref]) return { ok: false, error: "Numéro de référence introuvable. Veuillez vérifier le numéro de l'immeuble et réessayer." };
  return { ok: true, ref };
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Une erreur est survenue.");
  }
  return data;
}

async function checkServer() {
  try {
    const data = await fetchJSON("/api/health");
    chatState.serverReady = true;
    serverStatus.textContent = data.message || "Serveur connecté";
    serverStatus.className = "server-pill ok";
  } catch (error) {
    chatState.serverReady = false;
    serverStatus.textContent = "Serveur non connecté";
    serverStatus.className = "server-pill error";
  }
}

async function loadListings() {
  const data = await fetchJSON("/api/listings");
  chatState.listings = data.listings || {};
  initSampleRefs();
}

async function sendToAI(input) {
  const data = await fetchJSON("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: chatState.currentMode,
      message: input
    })
  });
  return data;
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = chatInput.value.trim();
  if (!input || chatState.pending) return;

  if (!chatState.serverReady) {
    pushMessage("bot", "Système", "Le serveur n'est pas connecté. Lancez le backend puis réessayez.", "error");
    return;
  }

  pushMessage("user", "Employé", input);
  chatInput.value = "";

  if (chatState.currentMode === "listing") {
    const validation = prevalidateListing(input);
    if (!validation.ok) {
      pushMessage("bot", "Système", validation.error, "error");
      return;
    }
    updateListingPreview(validation.ref);
  }

  setPending(true);
  pushMessage("bot", "Système", "Traitement en cours…", "loading");

  try {
    const result = await sendToAI(input);
    if (chatState.currentMode === "listing" && result.reference && chatState.listings[result.reference]) {
      updateListingPreview(result.reference);
    }
    replaceLastLoading(result.reply || "Aucune réponse reçue.", result.variant || "success", result.label || (chatState.currentMode === "listing" ? "Assistant des immeubles" : "Traducteur"));
  } catch (error) {
    replaceLastLoading(error.message || "Une erreur est survenue.", "error", "Système");
  } finally {
    setPending(false);
  }
});

clearChatBtn.addEventListener("click", () => {
  if (chatState.currentMode === "listing") {
    chatState.listingHistory = [];
  } else {
    chatState.translatorHistory = [];
  }
  renderMessages();
});

listingModeBtn.addEventListener("click", () => switchMode("listing"));
translatorModeBtn.addEventListener("click", () => switchMode("translator"));

(async function init() {
  try {
    await Promise.all([checkServer(), loadListings()]);
  } catch (error) {
    serverStatus.textContent = "Serveur non connecté";
    serverStatus.className = "server-pill error";
  }
  renderMessages();
})();