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

  if (!history.length) {
    history.push({
      sender: "bot",
      label: "Système",
      text:
        chatState.currentMode === "listing"
          ? "Le mode Assistant des immeubles est actif. Entrez une demande comme :\nL-1001 - Quel est le loyer ?"
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

  if (listingModeBtn) listingModeBtn.classList.toggle("active", mode === "listing");
  if (translatorModeBtn) translatorModeBtn.classList.toggle("active", mode === "translator");

  if (mode === "listing") {
    if (modeStatus) {
      modeStatus.textContent =
        "Le mode Assistant des immeubles est actif. Incluez un numéro de référence valide.";
    }
    if (chatInput) {
      chatInput.placeholder = "Exemple : L-1001 - Quel est le loyer ?";
    }
    if (modePill) {
      modePill.textContent = "Mode actif : Assistant des immeubles";
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
  }

  renderMessages();
}

function updateListingPreview(ref) {
  if (!listingPreview) return;

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

  if (!ref) {
    return {
      ok: false,
      error: "Veuillez entrer un numéro de référence valide au format L-1001"
    };
  }

  if (!chatState.listings[ref]) {
    return {
      ok: false,
      error: "Numéro de référence introuvable. Veuillez vérifier le numéro de l'immeuble et réessayer."
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
    const res = await fetch("/api/health");

    if (res.ok) {
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

      if (
        chatState.currentMode === "listing" &&
        result.reference &&
        chatState.listings[result.reference]
      ) {
        updateListingPreview(result.reference);
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
      if (chatForm) chatForm.requestSubmit();
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

(async function init() {
  try {
    await Promise.all([checkServer(), loadListings()]);
  } catch (error) {
    if (serverStatus) {
      serverStatus.textContent = "Serveur non connecté";
      serverStatus.className = "server-pill error";
    }
  }

  renderMessages();
})();
