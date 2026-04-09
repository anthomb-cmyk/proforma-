const SUPABASE_URL = "https://nuuzkvgyolxbawvqyugu.supabase.co";
const SUPABASE_KEY = "sb_publishable_103-rw3MwM7k2xUeMMUodg_fRr9vUD4";
const EMPLOYEE_APP_URL = "https://fluxlocatif.up.railway.app";
const CLIENT_APP_URL = "https://client.fluxlocatif.com";
const CHAT_STORAGE_KEY = "fluxlocatif.employee.chat.v1";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const chatState = {
  currentMode: "listing",
  currentWorkspaceTab: "dashboard",
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
  listingsLoaded: false,
  listingsLoadingPromise: null,
  serverReady: false,
  pending: false,
  abortController: null,
  currentUser: null,
  currentSession: null,
  activeTranslatorThreadKey: "",
  selectedListingRef: "",
  workspaceMessages: [],
  workspaceTasks: [],
  notifications: [],
  highlightedWorkspaceTaskId: ""
};

const dashboardWorkspaceTab = document.getElementById("dashboardWorkspaceTab");
const messagesWorkspaceTab = document.getElementById("messagesWorkspaceTab");
const listingsWorkspaceTab = document.getElementById("listingsWorkspaceTab");
const workspaceMessagesBadge = document.getElementById("workspaceMessagesBadge");
const workspaceListingsBadge = document.getElementById("workspaceListingsBadge");
const employeeNotificationBanner = document.getElementById("employeeNotificationBanner");
const employeeConversationList = document.getElementById("employeeConversationList");
const employeeConversationTitle = document.getElementById("employeeConversationTitle");
const employeeConversationMeta = document.getElementById("employeeConversationMeta");
const employeeMessageThread = document.getElementById("employeeMessageThread");
const employeeMessageForm = document.getElementById("employeeMessageForm");
const employeeMessageInput = document.getElementById("employeeMessageInput");
const employeeListingTasks = document.getElementById("employeeListingTasks");

const sampleRefs = document.getElementById("sampleRefs");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const clearChatBtn = document.getElementById("clearChatBtn");
const cancelRequestBtn = document.getElementById("cancelRequestBtn");
const loadListingsBtn = document.getElementById("loadListingsBtn");
const chatErrorBanner = document.getElementById("chatErrorBanner");
const modeStatus = document.getElementById("modeStatus");
const listingModeBtn = document.getElementById("listingModeBtn");
const translatorModeBtn = document.getElementById("translatorModeBtn");
const modePill = document.getElementById("modePill");
const serverStatus = document.getElementById("serverStatus");
const sendBtn = document.getElementById("sendBtn");
const listingSelect = document.getElementById("listingSelect");
const listingSelectorCard = document.getElementById("listingSelectorCard");
const translatorContextBar = document.getElementById("translatorContextBar");
const translatorContextValue = document.getElementById("translatorContextValue");
const translatorListingValue = document.getElementById("translatorListingValue");
const newTranslatorConversationBtn = document.getElementById("newTranslatorConversationBtn");

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

const TRANSLATOR_REPORT_OPTIONS = [
  { value: "off_topic", label: "Pas rapport" },
  { value: "misunderstood_message", label: "Mauvaise compréhension" },
  { value: "wrong_listing_info", label: "Mauvaises infos sur le logement" },
  { value: "wrong_next_question", label: "Mauvaises prochaines questions" },
  { value: "other", label: "Autres" }
];

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

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-CA");
}

function getSerializableHistory(history = []) {
  return history
    .filter((message) => message && message.variant !== "loading")
    .map((message) => ({
      sender: message.sender || "",
      label: message.label || "",
      text: message.text || "",
      variant: message.variant || "",
      sections: Array.isArray(message.sections) ? message.sections : [],
      rawText: message.rawText || "",
      listingRef: message.listingRef || "",
      translatorThreadKey: message.translatorThreadKey || "",
      messageId: message.messageId || "",
      reportable: Boolean(message.reportable),
      translation: message.translation || "",
      suggestedReply: message.suggestedReply || "",
      assistantMessageId: message.assistantMessageId || "",
      reported: Boolean(message.reported),
      reportReason: message.reportReason || ""
    }));
}

function persistChatState() {
  try {
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        currentMode: chatState.currentMode,
        activeTranslatorThreadKey: chatState.activeTranslatorThreadKey,
        selectedListingRef: chatState.selectedListingRef || getSelectedListingRef() || "",
        listingHistory: getSerializableHistory(chatState.listingHistory),
        translatorHistory: getSerializableHistory(chatState.translatorHistory)
      })
    );
  } catch (error) {
    console.warn("Unable to persist chat state:", error);
  }
}

function restoreChatState() {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed.listingHistory) && parsed.listingHistory.length) {
      chatState.listingHistory = parsed.listingHistory;
    }

    if (Array.isArray(parsed.translatorHistory) && parsed.translatorHistory.length) {
      chatState.translatorHistory = parsed.translatorHistory;
    }

    if (parsed.activeTranslatorThreadKey) {
      chatState.activeTranslatorThreadKey = String(parsed.activeTranslatorThreadKey);
    }

    if (parsed.selectedListingRef) {
      chatState.selectedListingRef = normalizeRefKey(parsed.selectedListingRef);
    }

    if (parsed.currentMode === "translator" || parsed.currentMode === "listing") {
      chatState.currentMode = parsed.currentMode;
    }
  } catch (error) {
    console.warn("Unable to restore chat state:", error);
  }
}

function setChatError(message = "") {
  if (!chatErrorBanner) return;

  chatErrorBanner.textContent = message;
  chatErrorBanner.classList.toggle("hidden", !message);
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
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname || "/employee")}`;
    throw new Error("Not logged in");
  }

  const user = session.user;
  const userId = user?.id;
  const role = resolveUserRole(user);
  chatState.currentSession = session;

  if (role === "admin") {
    window.location.href = `${EMPLOYEE_APP_URL}/admin`;
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
    window.location.href = `${EMPLOYEE_APP_URL}/admin`;
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

function getSelectedListingRef() {
  const ref = listingSelect ? normalizeRefKey(listingSelect.value) : "";
  const fallbackRef = normalizeRefKey(chatState.selectedListingRef);
  const resolvedRef = ref || fallbackRef;
  if (!resolvedRef || !chatState.listings[resolvedRef]) return "";
  chatState.selectedListingRef = resolvedRef;
  return resolvedRef;
}

function buildTranslatorConversationHistory() {
  return chatState.translatorHistory
    .filter((message) => message && message.variant !== "loading")
    .map((message) => ({
      sender: message.sender || "",
      label: message.label || "",
      text: message.text || "",
      sections: Array.isArray(message.sections)
        ? message.sections.map((section) => ({
            title: section?.title || "",
            text: section?.text || ""
          }))
        : []
    }));
}

function generateTranslatorThreadKey() {
  if (window.crypto?.randomUUID) {
    return `translator_thread_${window.crypto.randomUUID()}`;
  }

  return `translator_thread_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getTranslatorThreadSummary() {
  const threadKey = chatState.activeTranslatorThreadKey || "";

  if (!threadKey) {
    return "Aucune conversation active";
  }

  const shortKey = threadKey.replace(/^translator_thread_/, "").slice(0, 8).toUpperCase();
  return `Fil ${shortKey}`;
}

function getTranslatorListingSummary() {
  const listingRef = getSelectedListingRef();

  if (!listingRef) {
    return "Aucun appartement sélectionné";
  }

  const listing = chatState.listings[listingRef] || null;
  const address = String(listing?.adresse || listing?.address || "").trim();
  const city = String(listing?.ville || listing?.city || "").trim();
  const location = [address, city].filter(Boolean).join(", ");

  return location
    ? `${formatDisplayRef(listingRef)} · ${location}`
    : formatDisplayRef(listingRef);
}

function renderTranslatorContext() {
  if (!translatorContextBar || !translatorContextValue || !translatorListingValue) return;

  const isTranslatorMode = chatState.currentMode === "translator";
  translatorContextBar.classList.toggle("hidden", !isTranslatorMode);

  if (!isTranslatorMode) {
    return;
  }

  translatorContextValue.textContent = getTranslatorThreadSummary();
  translatorListingValue.textContent = getTranslatorListingSummary();
}

function createNewTranslatorConversation() {
  chatState.activeTranslatorThreadKey = generateTranslatorThreadKey();
  chatState.translatorHistory = [
    {
      sender: "bot",
      label: "Traducteur",
      text: "Collez un message et je vais proposer une reformulation en français international ainsi qu’une réponse suggérée en français canadien."
    }
  ];
  renderTranslatorContext();

  if (chatState.currentMode === "translator") {
    renderMessages();
    if (chatInput) {
      chatInput.focus();
    }
  }

  persistChatState();
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
  if (cancelRequestBtn) cancelRequestBtn.classList.toggle("hidden", !isPending);
  if (cancelRequestBtn) cancelRequestBtn.disabled = !isPending;
  if (listingModeBtn) listingModeBtn.disabled = isPending;
  if (translatorModeBtn) translatorModeBtn.disabled = isPending;
  if (listingSelect) listingSelect.disabled = isPending;
  if (loadListingsBtn) loadListingsBtn.disabled = isPending;
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

  if (!chatState.listingsLoaded) {
    sampleRefs.classList.remove("is-loading");
    sampleRefs.innerHTML = `<div class="muted">Chargez les appartements pour voir les références disponibles.</div>`;
    return;
  }

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

      if (chatInput) {
        chatInput.focus();
      }
    });

    sampleRefs.appendChild(chip);
  });
}

function initListingDropdown() {
  if (!listingSelect) return;

  if (!chatState.listingsLoaded) {
    listingSelect.innerHTML = `<option value="">Chargez les appartements</option>`;
    return;
  }

  listingSelect.innerHTML = `<option value="">Sélectionnez un appartement</option>`;

  Object.keys(chatState.listings).forEach((refKey) => {
    const listing = chatState.listings[refKey];
    const normalizedRef = normalizeRefKey(refKey);

    const option = document.createElement("option");
    option.value = normalizedRef;
    option.textContent = `${formatDisplayRef(normalizedRef)}${listing?.adresse ? " — " + listing.adresse : ""}`;
    listingSelect.appendChild(option);
  });

  if (chatState.selectedListingRef && chatState.listings[chatState.selectedListingRef]) {
    listingSelect.value = chatState.selectedListingRef;
  }
}

function setListingsLoadingState(isLoading) {
  if (sampleRefs) {
    sampleRefs.classList.toggle("is-loading", isLoading);
    if (isLoading) {
      sampleRefs.innerHTML = "";
    }
  }

  if (loadListingsBtn) {
    loadListingsBtn.textContent = isLoading ? "Chargement..." : "Charger les appartements";
    loadListingsBtn.classList.toggle("hidden", chatState.listingsLoaded);
  }

  if (listingSelect) {
    listingSelect.disabled = isLoading || chatState.pending;
  }
}

async function ensureListingsLoaded() {
  if (chatState.listingsLoaded) {
    return true;
  }

  if (chatState.listingsLoadingPromise) {
    return chatState.listingsLoadingPromise;
  }

  setListingsLoadingState(true);

  chatState.listingsLoadingPromise = (async () => {
    try {
      const ok = await loadListings();
      if (!ok) {
        setChatError("Impossible de charger les appartements pour le moment.");
      }
      return ok;
    } finally {
      setListingsLoadingState(false);
      chatState.listingsLoadingPromise = null;
    }
  })();

  return chatState.listingsLoadingPromise;
}

function buildMessageSectionsText(message) {
  if (Array.isArray(message?.sections) && message.sections.length) {
    return message.sections
      .map((section) => `${section.title || ""}${section.title ? " : " : ""}${section.text || ""}`.trim())
      .filter(Boolean)
      .join("\n");
  }

  return String(message?.text || "").trim();
}

function closeTranslatorReportMenus() {
  chatState.translatorHistory.forEach((message) => {
    if (message) {
      message.reportMenuOpen = false;
    }
  });
}

function getTranslatorRecentContext(messageIndex) {
  const startIndex = Math.max(0, messageIndex - 5);

  return chatState.translatorHistory
    .slice(startIndex, messageIndex + 1)
    .filter((entry) => entry && entry.variant !== "loading")
    .map((entry) => ({
      sender: entry.sender || "",
      label: entry.label || "",
      text: String(entry.text || "").trim(),
      sections: Array.isArray(entry.sections)
        ? entry.sections.map((section) => ({
            title: section?.title || "",
            text: section?.text || ""
          }))
        : []
    }));
}

function getRelatedTenantMessageForReport(messageIndex) {
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const entry = chatState.translatorHistory[index];
    if (entry?.sender === "user") {
      return entry;
    }
  }

  return null;
}

async function submitTranslatorReport(messageIndex, reason) {
  const targetMessage = chatState.translatorHistory[messageIndex];

  if (!targetMessage || targetMessage.reportSubmitting || targetMessage.reported) {
    return;
  }

  const relatedTenantMessage = getRelatedTenantMessageForReport(messageIndex);
  targetMessage.reportSubmitting = true;
  renderMessages();

  try {
    await fetchEmployeeJSON("/api/employee/translator-reports", {
      method: "POST",
      body: JSON.stringify({
        reason,
        assistant_message_id: targetMessage.assistantMessageId || null,
        tenant_message_id: relatedTenantMessage?.messageId || null,
        translator_thread_key: targetMessage.translatorThreadKey || chatState.activeTranslatorThreadKey || "",
        listing_ref: targetMessage.listingRef || getSelectedListingRef() || "",
        raw_tenant_message: relatedTenantMessage?.rawText || relatedTenantMessage?.text || "",
        translation: targetMessage.translation || "",
        suggested_reply: targetMessage.suggestedReply || "",
        recent_context: getTranslatorRecentContext(messageIndex)
      })
    });

    targetMessage.reported = true;
    targetMessage.reportReason = reason;
    targetMessage.reportMenuOpen = false;
  } catch (error) {
    console.error("Translator report error:", error);
    window.alert(error.message || "Impossible d’enregistrer le signalement pour le moment.");
  } finally {
    targetMessage.reportSubmitting = false;
    renderMessages();
  }
}

function addMessageToDOM(message) {
  if (!chatMessages) return;

  const messageIndex = currentHistory().indexOf(message);

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

  if (message.variant === "loading") {
    bubble.classList.add("typing");
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

  if (message.reportable) {
    const actions = document.createElement("div");
    actions.className = "message-report-actions";

    if (message.reported) {
      const reportedText = document.createElement("div");
      reportedText.className = "message-report-confirmation";
      reportedText.textContent = "Signalé";
      actions.appendChild(reportedText);
    } else {
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "message-report-link";
      trigger.textContent = message.reportSubmitting ? "Signalement..." : "Signaler";
      trigger.disabled = Boolean(message.reportSubmitting);
      trigger.addEventListener("click", () => {
        const nextState = !message.reportMenuOpen;
        closeTranslatorReportMenus();
        message.reportMenuOpen = nextState;
        renderMessages();
      });
      actions.appendChild(trigger);

      if (message.reportMenuOpen) {
        const menu = document.createElement("div");
        menu.className = "message-report-menu";

        TRANSLATOR_REPORT_OPTIONS.forEach((option) => {
          const optionButton = document.createElement("button");
          optionButton.type = "button";
          optionButton.className = "message-report-option";
          optionButton.textContent = option.label;
          optionButton.disabled = Boolean(message.reportSubmitting);
          optionButton.addEventListener("click", async () => {
            await submitTranslatorReport(messageIndex, option.value);
          });
          menu.appendChild(optionButton);
        });

        actions.appendChild(menu);
      }
    }

    wrapper.appendChild(actions);
  }

  chatMessages.appendChild(wrapper);
}

function renderMessages() {
  if (!chatMessages) return;

  const history = currentHistory();
  chatMessages.innerHTML = "";

  history.forEach((message) => addMessageToDOM(message));
  chatMessages.scrollTop = chatMessages.scrollHeight;
  persistChatState();
}

function pushMessage(sender, label, text, variant = "", sections = [], metadata = {}) {
  const message = { sender, label, text, variant, sections, ...metadata };
  currentHistory().push(message);
  addMessageToDOM(message);

  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  persistChatState();

  return message;
}

function replaceLastLoading(text, variant = "success", label = "Assistant", sections = [], metadata = {}) {
  const history = currentHistory();
  const last = history[history.length - 1];

  if (!last || last.variant !== "loading") {
    pushMessage("bot", label, text, variant, sections, metadata);
    return;
  }

  last.text = text;
  last.variant = variant;
  last.label = label;
  last.sections = sections;
  Object.assign(last, metadata);
  renderMessages();
}

function updateLastLoadingMessage(text, label = "Assistant") {
  const history = currentHistory();
  const last = history[history.length - 1];

  if (!last || last.variant !== "loading") {
    pushMessage("bot", label, text, "loading");
    return;
  }

  last.text = text;
  last.label = label;
  renderMessages();
}

function switchMode(mode) {
  chatState.currentMode = mode;
  setChatError("");

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
    if (!chatState.activeTranslatorThreadKey) {
      createNewTranslatorConversation();
    }

    if (modeStatus) {
      modeStatus.textContent =
        "Le mode Traducteur est actif. Le logement sélectionné reste utilisé comme contexte pour la réponse suggérée.";
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

  renderTranslatorContext();
  renderMessages();
  persistChatState();
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

async function fetchEmployeeJSON(url, options = {}, timeoutMs = 10000) {
  const session = chatState.currentSession || await waitForActiveSession(1, 0);

  if (!session?.access_token) {
    throw new Error("Session employé introuvable.");
  }

  return fetchJSON(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${session.access_token}`
    }
  }, timeoutMs);
}

function switchWorkspaceTab(tabName) {
  chatState.currentWorkspaceTab = tabName;

  dashboardWorkspaceTab?.classList.toggle("hidden", tabName !== "dashboard");
  dashboardWorkspaceTab?.classList.toggle("active", tabName === "dashboard");
  messagesWorkspaceTab?.classList.toggle("hidden", tabName !== "messages");
  messagesWorkspaceTab?.classList.toggle("active", tabName === "messages");
  listingsWorkspaceTab?.classList.toggle("hidden", tabName !== "listings");
  listingsWorkspaceTab?.classList.toggle("active", tabName === "listings");

  document.querySelectorAll(".workspace-nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.workspaceTab === tabName);
  });
}

function renderNotifications() {
  if (!employeeNotificationBanner) return;

  const unreadNotifications = chatState.notifications.filter((notification) => notification.read !== true);

  if (!unreadNotifications.length) {
    employeeNotificationBanner.innerHTML = "";
    employeeNotificationBanner.classList.add("hidden");
    return;
  }

  employeeNotificationBanner.classList.remove("hidden");
  employeeNotificationBanner.innerHTML = unreadNotifications.map((notification) => `
    <button type="button" class="workspace-alert-banner" data-id="${notification.id}" data-type="${notification.type}" data-reference="${notification.reference_id || ""}">
      <div>
        <div class="workspace-alert-title">${notification.type === "message" ? "Nouveau message de l’administration" : "Nouveau listing assigné"}</div>
        <div class="workspace-alert-meta">${formatDate(notification.created_at)}</div>
      </div>
      <span class="workspace-alert-action">Ouvrir</span>
    </button>
  `).join("");

  document.querySelectorAll(".workspace-alert-banner").forEach((button) => {
    button.addEventListener("click", async () => {
      const notificationId = button.dataset.id || "";
      const notificationType = button.dataset.type || "";

      if (notificationType === "message") {
        await openEmployeeMessages(notificationId ? [notificationId] : []);
        return;
      }

      if (notificationType === "listing") {
        chatState.highlightedWorkspaceTaskId = button.dataset.reference || "";
        switchWorkspaceTab("listings");
        await loadEmployeeListingTasks();
        await markEmployeeNotificationRead(notificationId);
        await loadEmployeeNotifications();
      }
    });
  });
}

function renderEmployeeConversationList() {
  if (!employeeConversationList) return;

  const unreadCount = chatState.notifications.filter(
    (notification) => notification.type === "message" && notification.read !== true
  ).length;

  if (workspaceMessagesBadge) {
    workspaceMessagesBadge.textContent = String(unreadCount);
    workspaceMessagesBadge.classList.toggle("hidden", unreadCount === 0);
  }

  employeeConversationList.innerHTML = `
    <button type="button" class="workspace-conversation-item active">
      <div style="font-weight:800;">Administration</div>
      <div class="workspace-task-meta">${unreadCount ? `${unreadCount} non lu(s)` : "Conversation interne"}</div>
    </button>
  `;

  if (employeeConversationTitle) {
    employeeConversationTitle.textContent = "Messagerie interne";
  }

  if (employeeConversationMeta) {
    employeeConversationMeta.textContent = "Échange direct avec l’administration.";
  }
}

function renderEmployeeMessageThread() {
  if (!employeeMessageThread) return;

  if (!chatState.workspaceMessages.length) {
    employeeMessageThread.innerHTML = `<div class="workspace-list-empty">Aucun message pour le moment.</div>`;
    return;
  }

  employeeMessageThread.innerHTML = chatState.workspaceMessages.map((message) => {
    const isSelf = String(message.from_user_id) === String(chatState.currentUser?.id);
    return `
      <div class="workspace-message-row ${isSelf ? "from-self" : ""}">
        <div class="workspace-message-bubble">
          <div style="font-weight:800;margin-bottom:4px;">${isSelf ? "Vous" : "Administration"}</div>
          <div>${message.content || ""}</div>
          <div class="workspace-task-meta">${formatDate(message.created_at)}</div>
        </div>
      </div>
    `;
  }).join("");

  employeeMessageThread.scrollTop = employeeMessageThread.scrollHeight;
}

async function markEmployeeNotificationRead(notificationId) {
  if (!notificationId) return;

  await fetchEmployeeJSON(`/api/employee/workspace/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "POST"
  });
}

async function markEmployeeMessageNotificationsRead(notificationIds = []) {
  const unreadMessageNotifications = chatState.notifications.filter(
    (notification) => notification.type === "message" && notification.read !== true
  );

  const idsToMark = notificationIds.length
    ? unreadMessageNotifications
        .filter((notification) => notificationIds.includes(notification.id))
        .map((notification) => notification.id)
    : unreadMessageNotifications.map((notification) => notification.id);

  if (!idsToMark.length) return;

  await Promise.all(idsToMark.map((notificationId) => markEmployeeNotificationRead(notificationId)));
}

async function loadEmployeeConversation() {
  const conversationData = await fetchEmployeeJSON("/api/employee/workspace/conversation");
  chatState.workspaceMessages = conversationData.messages || [];
  renderEmployeeConversationList();
  renderEmployeeMessageThread();
  await loadEmployeeNotifications();
}

async function openEmployeeMessages(notificationIds = []) {
  switchWorkspaceTab("messages");
  await loadEmployeeConversation();
  await markEmployeeMessageNotificationsRead(notificationIds);
  await loadEmployeeNotifications();
}

function renderEmployeeListingTasks() {
  if (!employeeListingTasks) return;

  const activeTaskCount = chatState.workspaceTasks.filter((task) => task.status !== "completed").length;
  if (workspaceListingsBadge) {
    workspaceListingsBadge.textContent = String(activeTaskCount);
    workspaceListingsBadge.classList.toggle("hidden", activeTaskCount === 0);
  }

  if (!chatState.workspaceTasks.length) {
    employeeListingTasks.innerHTML = `<div class="workspace-list-empty">Aucun mandat assigné.</div>`;
    return;
  }

  employeeListingTasks.innerHTML = chatState.workspaceTasks.map((task) => `
    <div class="workspace-task-card ${chatState.highlightedWorkspaceTaskId === task.id ? "highlighted" : ""}" data-task-id="${task.id}">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
        <div>
          <div style="font-weight:800;">${task.title || "Mandat"}</div>
          <div class="workspace-task-meta">Statut : ${task.status || "assigned"} · ${formatDate(task.created_at)}</div>
        </div>
      </div>
      <div style="margin-top:12px;line-height:1.6;white-space:pre-wrap;">${task.listing_text || ""}</div>
      <div class="workspace-task-actions">
        <button type="button" class="secondary-btn copy-task-text-btn" data-text="${encodeURIComponent(task.listing_text || "")}">Copier le texte</button>
        ${task.status !== "in_progress" ? `<button type="button" class="secondary-btn task-status-btn" data-id="${task.id}" data-status="in_progress">Marquer en cours</button>` : ""}
        ${task.status !== "completed" ? `<button type="button" class="secondary-btn task-status-btn" data-id="${task.id}" data-status="completed">Marquer complété</button>` : ""}
        <button type="button" class="secondary-btn ask-task-question-btn" data-title="${encodeURIComponent(task.title || "Mandat")}">Poser une question</button>
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".copy-task-text-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const text = decodeURIComponent(button.dataset.text || "");
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    });
  });

  document.querySelectorAll(".task-status-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      await fetchEmployeeJSON(`/api/employee/workspace/listing-tasks/${encodeURIComponent(button.dataset.id)}`, {
        method: "PUT",
        body: JSON.stringify({ status: button.dataset.status })
      });
      await loadEmployeeWorkspace();
    });
  });

  document.querySelectorAll(".ask-task-question-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      await openEmployeeMessages();
      if (employeeMessageInput) {
        employeeMessageInput.value = `Question sur le mandat: ${decodeURIComponent(button.dataset.title || "Mandat")} — `;
        employeeMessageInput.focus();
      }
    });
  });

  if (chatState.highlightedWorkspaceTaskId) {
    const highlightedTask = employeeListingTasks.querySelector(`[data-task-id="${chatState.highlightedWorkspaceTaskId}"]`);
    highlightedTask?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

async function loadEmployeeListingTasks() {
  const tasksData = await fetchEmployeeJSON("/api/employee/workspace/listing-tasks");
  chatState.workspaceTasks = tasksData.tasks || [];
  renderEmployeeListingTasks();
}

async function loadEmployeeNotifications() {
  const notificationsData = await fetchEmployeeJSON("/api/employee/workspace/notifications");
  chatState.notifications = notificationsData.notifications || [];
  renderNotifications();
}

async function loadEmployeeWorkspace() {
  await Promise.all([
    loadEmployeeNotifications(),
    loadEmployeeListingTasks()
  ]);
  renderEmployeeConversationList();
}

async function sendEmployeeWorkspaceMessage(event) {
  event.preventDefault();
  const content = employeeMessageInput?.value?.trim() || "";

  if (!content) return;

  await fetchEmployeeJSON("/api/employee/workspace/messages", {
    method: "POST",
    body: JSON.stringify({ content })
  });

  employeeMessageInput.value = "";
  await loadEmployeeWorkspace();
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
    chatState.listingsLoaded = true;
    if (loadListingsBtn) {
      loadListingsBtn.classList.add("hidden");
    }
    initSampleRefs();
    initListingDropdown();
    setChatError("");
    return true;
  } catch (error) {
    console.error("Load listings error:", error);
    chatState.listingsLoaded = false;
    if (loadListingsBtn) {
      loadListingsBtn.classList.remove("hidden");
    }
    initSampleRefs();
    initListingDropdown();
    return false;
  }
}

async function sendToAI(input, ref = "") {
  let message = input;

  if (chatState.currentMode === "listing" && ref) {
    message = `${formatDisplayRef(ref)} - ${input}`;
  }

  const selectedListingRef = ref || getSelectedListingRef();
  const controller = new AbortController();
  chatState.abortController = controller;

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    signal: controller.signal,
    body: JSON.stringify({
      mode: chatState.currentMode,
      message,
      user_id: chatState.currentUser?.id || "employee-manuel",
      listing_ref: selectedListingRef || "",
      translator_thread_key: chatState.currentMode === "translator"
        ? (chatState.activeTranslatorThreadKey || "")
        : "",
      conversation_history: chatState.currentMode === "translator"
        ? buildTranslatorConversationHistory()
        : []
    })
  });

  if (!response.ok || !response.body) {
    let errorMessage = "Une erreur est survenue.";

    try {
      const data = await response.json();
      errorMessage = data.error || errorMessage;
    } catch {
      try {
        errorMessage = await response.text() || errorMessage;
      } catch {
        // ignore secondary parse errors
      }
    }

    throw new Error(errorMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamedText = "";
  let finalPayload = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      const event = JSON.parse(trimmedLine);

      if (event.type === "chunk") {
        streamedText += String(event.delta || "");
        updateLastLoadingMessage(streamedText || "L’assistant rédige", chatState.currentMode === "translator" ? "Traducteur" : "Assistant des immeubles");
      } else if (event.type === "error") {
        throw new Error(event.error || "Une erreur est survenue.");
      } else if (event.type === "done") {
        finalPayload = event.payload || null;
      }
    }

    if (done) {
      break;
    }
  }

  if (!finalPayload) {
    throw new Error("Le serveur n’a pas retourné de réponse finale.");
  }

  return finalPayload;
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

if (chatForm) {
  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const input = chatInput.value.trim();
    if (!input || chatState.pending) return;
    setChatError("");

    if (!chatState.serverReady) {
      setChatError("Le serveur ne répond pas pour le moment.");
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
      const listingsReady = await ensureListingsLoaded();
      if (!listingsReady) {
        pushMessage("bot", "Système", "Impossible de charger les appartements pour le moment.", "error");
        return;
      }

      const validation = prevalidateListing();

      if (!validation.ok) {
        setChatError(validation.error);
        pushMessage("bot", "Système", validation.error, "error");
        return;
      }

      selectedRef = validation.ref;
    }

    const userText =
      chatState.currentMode === "listing" && selectedRef
        ? `${formatDisplayRef(selectedRef)} - ${input}`
        : input;

    const userMessage = pushMessage("user", "Employé", userText, "", [], {
      rawText: input,
      listingRef: selectedRef || getSelectedListingRef() || "",
      translatorThreadKey: chatState.currentMode === "translator"
        ? (chatState.activeTranslatorThreadKey || "")
        : ""
    });

    chatInput.value = "";
    setPending(true);
    pushMessage("bot", chatState.currentMode === "translator" ? "Traducteur" : "Assistant des immeubles", "L’assistant rédige", "loading");

    try {
      const result = await sendToAI(input, selectedRef);

      if (chatState.currentMode === "listing") {
        const resultRef = normalizeRefKey(result.reference || selectedRef);

      if (resultRef && chatState.listings[resultRef]) {
        chatState.selectedListingRef = resultRef;
        if (listingSelect) {
          listingSelect.value = resultRef;
        }
        persistChatState();
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
              }
            ]
          : [],
        chatState.currentMode === "translator" && result.translation && result.reply
          ? {
              reportable: true,
              translation: result.translation,
              suggestedReply: result.reply,
              assistantMessageId: result.assistant_message_id || "",
              translatorThreadKey: result.translator_thread_key || chatState.activeTranslatorThreadKey || "",
              listingRef: result.listing_ref || selectedRef || getSelectedListingRef() || "",
              reportMenuOpen: false,
              reported: false
            }
          : {}
      );

      if (chatState.currentMode === "translator" && userMessage) {
        userMessage.messageId = result.user_message_id || userMessage.messageId || "";
      }
    } catch (error) {
      console.error("Chat error:", error);
      const resolvedErrorMessage = error?.name === "AbortError"
        ? "Requête annulée."
        : (error.message || "Une erreur est survenue.");

      if (resolvedErrorMessage !== "Requête annulée.") {
        setChatError(resolvedErrorMessage);
      }
      replaceLastLoading(
        resolvedErrorMessage,
        "error",
        "Système"
      );
    } finally {
      chatState.abortController = null;
      setPending(false);
    }
  });
}

if (chatInput) {
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (chatForm) chatForm.requestSubmit();
    }
  });
}

if (clearChatBtn) {
  clearChatBtn.addEventListener("click", () => {
    setChatError("");
    if (chatState.currentMode === "listing") {
      chatState.listingHistory = [
        {
          sender: "bot",
          label: "Système",
          text: "Le mode Assistant des immeubles est actif. Sélectionnez un appartement puis posez votre question."
        }
      ];
    } else {
      createNewTranslatorConversation();
    }

    renderTranslatorContext();
    renderMessages();
  });
}

if (cancelRequestBtn) {
  cancelRequestBtn.addEventListener("click", () => {
    chatState.abortController?.abort();
    chatState.abortController = null;
    setChatError("Requête annulée.");
  });
}

if (listingModeBtn) {
  listingModeBtn.addEventListener("click", () => switchMode("listing"));
}

if (translatorModeBtn) {
  translatorModeBtn.addEventListener("click", () => switchMode("translator"));
}

if (listingSelect) {
  listingSelect.addEventListener("focus", async () => {
    if (!chatState.listingsLoaded) {
      await ensureListingsLoaded();
    }
  });

  listingSelect.addEventListener("change", () => {
    chatState.selectedListingRef = normalizeRefKey(listingSelect.value);
    persistChatState();
    renderTranslatorContext();
  });
}

if (loadListingsBtn) {
  loadListingsBtn.addEventListener("click", async () => {
    await ensureListingsLoaded();
  });
}

if (newTranslatorConversationBtn) {
  newTranslatorConversationBtn.addEventListener("click", () => {
    createNewTranslatorConversation();
  });
}

if (candidateForm) {
  candidateForm.addEventListener("submit", handleCandidateSubmit);
}

if (preferredLocationInput) {
  preferredLocationInput.addEventListener("change", resolveSelectedPreferredLocation);
  preferredLocationInput.addEventListener("blur", resolveSelectedPreferredLocation);
}

document.querySelectorAll(".workspace-nav-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    const targetTab = button.dataset.workspaceTab || "dashboard";

    if (targetTab === "messages") {
      await openEmployeeMessages();
      return;
    }

    switchWorkspaceTab(targetTab);

    if (targetTab === "listings") {
      await loadEmployeeListingTasks();
    }
  });
});

if (employeeMessageForm) {
  employeeMessageForm.addEventListener("submit", sendEmployeeWorkspaceMessage);
}

supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname || "/employee")}`;
    return;
  }

  if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
    waitForActiveSession(1, 0)
      .then((session) => {
        if (session) {
          chatState.currentSession = session;
          chatState.currentUser = session.user;
        }
      })
      .catch((error) => {
        console.error("Session refresh error:", error);
      });
  }
});

(async function init() {
  restoreChatState();
  if (!Array.isArray(chatState.translatorHistory) || !chatState.translatorHistory.length) {
    createNewTranslatorConversation();
  }
  if (!Array.isArray(chatState.listingHistory) || !chatState.listingHistory.length) {
    chatState.listingHistory = [
      {
        sender: "bot",
        label: "Système",
        text: "Le mode Assistant des immeubles est actif. Sélectionnez un appartement puis posez votre question."
      }
    ];
  }
  switchWorkspaceTab("dashboard");
  switchMode(chatState.currentMode === "translator" ? "translator" : "listing");
  initSampleRefs();
  initListingDropdown();
  renderMessages();

  try {
    await requireLogin();
  } catch (error) {
    console.error("Login init error:", error);
    return;
  }

  const serverOk = await checkServer();

  try {
    await loadPreferredLocations();
  } catch (error) {
    console.error("Load preferred locations error:", error);
    setPreferredLocationHint("La liste des villes n’a pas pu être chargée pour le moment.", "error");
  }

  if (!serverOk) {
    setServerStatus("Serveur non connecté", "error");
  }

  try {
    await loadEmployeeWorkspace();
  } catch (error) {
    console.error("Load employee workspace error:", error);
    renderNotifications();
    renderEmployeeConversationList();
    renderEmployeeMessageThread();
    renderEmployeeListingTasks();
  }
})();
