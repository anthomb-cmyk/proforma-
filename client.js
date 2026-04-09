const SUPABASE_URL = "https://nuuzkvgyolxbawvqyugu.supabase.co";
const SUPABASE_KEY = "sb_publishable_103-rw3MwM7k2xUeMMUodg_fRr9vUD4";
const EMPLOYEE_APP_URL = "https://fluxlocatif.up.railway.app";
const CLIENT_APP_URL = "https://client.fluxlocatif.com";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const tabs = {
  dashboard: document.getElementById("dashboardTab"),
  apartments: document.getElementById("apartmentsTab"),
  candidates: document.getElementById("candidatesTab"),
  criteria: document.getElementById("criteriaTab")
};

const clientAuthShell = document.getElementById("clientAuthShell");
const clientLoginForm = document.getElementById("clientLoginForm");
const clientLoginEmail = document.getElementById("clientLoginEmail");
const clientLoginPassword = document.getElementById("clientLoginPassword");
const clientLoginSubmit = document.getElementById("clientLoginSubmit");
const clientLoginStatus = document.getElementById("clientLoginStatus");
const clientShell = document.getElementById("clientShell");
const pageTitle = document.getElementById("pageTitle");
const clientMeta = document.getElementById("clientMeta");
const refreshBtn = document.getElementById("refreshBtn");
const apartmentsSupervisionSummary = document.getElementById("apartmentsSupervisionSummary");
const apartmentsBody = document.getElementById("apartmentsBody");
const candidatesReviewSummary = document.getElementById("candidatesReviewSummary");
const candidatesBody = document.getElementById("candidatesBody");
const criteriaForm = document.getElementById("criteriaForm");
const criteriaStatus = document.getElementById("criteriaStatus");

const statTotalApartments = document.getElementById("statTotalApartments");
const statAvailableApartments = document.getElementById("statAvailableApartments");
const statCandidates = document.getElementById("statCandidates");
const statDecisionSplit = document.getElementById("statDecisionSplit");
const statTotalApartmentsTrend = document.getElementById("statTotalApartmentsTrend");
const statAvailableApartmentsTrend = document.getElementById("statAvailableApartmentsTrend");
const statCandidatesTrend = document.getElementById("statCandidatesTrend");
const statDecisionSplitTrend = document.getElementById("statDecisionSplitTrend");
const dashboardDecisionQueue = document.getElementById("dashboardDecisionQueue");
const dashboardApartmentOverview = document.getElementById("dashboardApartmentOverview");
const dashboardCriteriaSummary = document.getElementById("dashboardCriteriaSummary");
const dashboardWatchlist = document.getElementById("dashboardWatchlist");

const candidateModal = document.getElementById("candidateModal");
const closeCandidateModalBtn = document.getElementById("closeCandidateModalBtn");
const candidateModalTitle = document.getElementById("candidateModalTitle");
const candidateDetailGrid = document.getElementById("candidateDetailGrid");
const candidatePassReasons = document.getElementById("candidatePassReasons");
const candidateFailReasons = document.getElementById("candidateFailReasons");

const state = {
  currentTab: "dashboard",
  currentUser: null,
  currentSession: null,
  clientId: "",
  client: null,
  apartments: [],
  candidates: [],
  dashboardTableState: {
    query: "",
    status: "Tous",
    sortKey: "score",
    sortDirection: "desc"
  },
  candidatesTableState: {
    query: "",
    status: "Tous",
    sortKey: "score",
    sortDirection: "desc"
  },
  activeCandidateMenuId: ""
};

function isClientDomain() {
  return String(window.location.hostname || "").trim().toLowerCase() === "client.fluxlocatif.com";
}

function isPreviewSafeClientHost() {
  const hostname = String(window.location.hostname || "").trim().toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".up.railway.app")
  );
}

function redirectToClientPortalEntry() {
  const targetPath = "/client.html";
  if (isPreviewSafeClientHost()) {
    return false;
  }

  const targetUrl = `${CLIENT_APP_URL}${targetPath}`;
  const currentPath = String(window.location.pathname || "").trim() || "/";

  if (isClientDomain() && currentPath === targetPath) {
    return false;
  }

  window.location.href = targetUrl;
  return true;
}

function showClientLoginScreen(message = "", type = "") {
  if (clientAuthShell) {
    clientAuthShell.classList.remove("hidden");
  }

  if (clientShell) {
    clientShell.classList.add("client-shell-hidden");
  }

  if (clientLoginStatus) {
    clientLoginStatus.textContent = message;
    clientLoginStatus.style.color = type === "error" ? "#991b1b" : type === "success" ? "#166534" : "";
  }
}

function showClientPortalScreen() {
  if (clientAuthShell) {
    clientAuthShell.classList.add("hidden");
  }

  if (clientShell) {
    clientShell.classList.remove("client-shell-hidden");
  }

  if (clientLoginStatus) {
    clientLoginStatus.textContent = "";
    clientLoginStatus.style.color = "";
  }
}

function setCriteriaStatus(message = "", type = "") {
  if (!criteriaStatus) return;
  criteriaStatus.textContent = message;
  criteriaStatus.style.color = type === "error" ? "#991b1b" : type === "success" ? "#166534" : "";
}

function parseOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toYesNo(value) {
  if (value === true) return "oui";
  if (value === false) return "non";
  return "";
}

function fromYesNo(value) {
  if (value === "oui") return true;
  if (value === "non") return false;
  return null;
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `${value} $`;
}

function formatDisplayDate(value) {
  if (!value) return "";
  const normalized = String(value).trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return "";
  }

  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("fr-CA", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(parsed);
}

function getAvailabilityMeta(value) {
  if (value === null || value === undefined || value === "") {
    return {
      label: "Non précisé",
      tone: "neutral"
    };
  }

  const rawValue = String(value).trim();
  const normalized = rawValue.toLowerCase();
  const formattedDate = formatDisplayDate(rawValue);

  if (formattedDate) {
    return {
      label: `Dès le ${formattedDate}`,
      tone: "info"
    };
  }

  if (/immédiat|immediat/.test(normalized)) {
    return {
      label: "Disponible maintenant",
      tone: "positive"
    };
  }

  if (/disponible/.test(normalized)) {
    return {
      label: "Disponible",
      tone: "positive"
    };
  }

  if (/loué|loue|indisponible|occupé|occupe/.test(normalized)) {
    return {
      label: "Non disponible",
      tone: "danger"
    };
  }

  return {
    label: rawValue,
    tone: "neutral"
  };
}

function getScoreMeta(score) {
  if (score === null || score === undefined || String(score).trim() === "") {
    return {
      label: "-",
      className: "score-mid"
    };
  }

  const numericScore = Number(score);

  if (!Number.isFinite(numericScore)) {
    return {
      label: "-",
      className: "score-mid"
    };
  }

  if (numericScore >= 85) {
    return {
      label: String(numericScore),
      className: ""
    };
  }

  if (numericScore >= 70) {
    return {
      label: String(numericScore),
      className: "score-mid"
    };
  }

  return {
    label: String(numericScore),
    className: "score-low"
  };
}

function getMatchMeta(matchStatus) {
  const normalized = String(matchStatus || "").trim().toLowerCase();

  if (!normalized || normalized === "refusé" || normalized === "refuse") {
    return {
      label: "À confirmer",
      tone: "neutral"
    };
  }

  return {
    label: "Aligné",
    tone: "positive"
  };
}

function getCandidateStatusMeta(status) {
  const normalized = String(status || "").trim().toLowerCase();

  if (/approuv/.test(normalized)) {
    return {
      label: "Approuvé",
      tone: "positive"
    };
  }

  if (/refus/.test(normalized)) {
    return {
      label: "Refusé",
      tone: "danger"
    };
  }

  if (/attente/.test(normalized)) {
    return {
      label: "En attente",
      tone: "warning"
    };
  }

  if (/visite/.test(normalized)) {
    return {
      label: "Visite",
      tone: "info"
    };
  }

  return {
    label: status || "En revue",
    tone: "neutral"
  };
}

function getCandidateScoreValue(candidate) {
  const rawScore = candidate?.match_score;

  if (rawScore === null || rawScore === undefined || String(rawScore).trim() === "") {
    return -1;
  }

  const value = Number(rawScore);
  return Number.isFinite(value) ? value : -1;
}

function getCandidateRevenueValue(candidate) {
  const rawIncome = candidate?.revenu || candidate?.monthly_income;

  if (rawIncome === null || rawIncome === undefined || String(rawIncome).trim() === "") {
    return -1;
  }

  const rawString = String(rawIncome).trim().toLowerCase();
  const numericValue = Number(rawString.replace(/[^\d.-]/g, ""));

  if (!Number.isFinite(numericValue)) {
    return -1;
  }

  return /k\b/.test(rawString) ? numericValue * 1000 : numericValue;
}

function formatCandidateRevenue(candidate) {
  const revenue = getCandidateRevenueValue(candidate);
  if (revenue < 0) return "—";
  const thousands = Math.round(revenue / 1000);
  return `${thousands}k$`;
}

function getCandidateInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return "CA";
  }

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getDashboardCandidateStatusMeta(candidate) {
  const normalized = String(candidate?.status || "").trim().toLowerCase();

  if (/refus/.test(normalized)) {
    return { label: "Refusé", tone: "danger" };
  }

  if (/approuv|accept/.test(normalized)) {
    return { label: "Vérifié", tone: "positive" };
  }

  if (/attente/.test(normalized)) {
    return { label: "Attente", tone: "warning" };
  }

  return { label: "En cours", tone: "info" };
}

function getCandidateScoreDisplayMeta(candidate) {
  const score = getCandidateScoreValue(candidate);

  if (score < 0) {
    return {
      value: 0,
      label: "—",
      className: "low"
    };
  }

  if (score >= 80) {
    return {
      value: Math.max(0, Math.min(100, score)),
      label: String(score),
      className: "high"
    };
  }

  if (score >= 60) {
    return {
      value: Math.max(0, Math.min(100, score)),
      label: String(score),
      className: "mid"
    };
  }

  return {
    value: Math.max(0, Math.min(100, score)),
    label: String(score),
    className: "low"
  };
}

function getCandidateTableStatusOptions() {
  return ["Tous", "En cours", "Attente", "Vérifié", "Refusé"];
}

function matchesCandidateTableStatus(candidate, statusFilter) {
  if (!statusFilter || statusFilter === "Tous") {
    return true;
  }

  return getDashboardCandidateStatusMeta(candidate).label === statusFilter;
}

function filterCandidateRows(candidates = [], tableState) {
  const query = String(tableState?.query || "").trim().toLowerCase();
  const status = String(tableState?.status || "Tous").trim();

  return candidates.filter((candidate) => {
    const apartment = getApartmentByRef(candidate.apartment_ref);
    const apartmentLabel = (apartment?.adresse || formatApartmentLabel(candidate.apartment_ref)).toLowerCase();
    const candidateName = String(candidate?.candidate_name || "").toLowerCase();
    const queryMatches = !query || candidateName.includes(query) || apartmentLabel.includes(query);

    return queryMatches && matchesCandidateTableStatus(candidate, status);
  });
}

function sortCandidateRows(candidates = [], tableState) {
  const sortKey = tableState?.sortKey || "score";
  const direction = tableState?.sortDirection === "asc" ? 1 : -1;

  return candidates.slice().sort((left, right) => {
    if (sortKey === "income") {
      return (getCandidateRevenueValue(left) - getCandidateRevenueValue(right)) * direction;
    }

    if (sortKey === "score") {
      return (getCandidateScoreValue(left) - getCandidateScoreValue(right)) * direction;
    }

    return String(left?.candidate_name || "").localeCompare(String(right?.candidate_name || ""), "fr") * direction;
  });
}

function updateCandidateTableState(key, patch = {}) {
  state[key] = {
    ...state[key],
    ...patch
  };
}

function getCandidateTableSortIndicator(tableState, key) {
  if (tableState?.sortKey !== key) {
    return "↑↓";
  }

  return tableState.sortDirection === "asc" ? "↑" : "↓";
}

function setStatTrend(element, value, percentHint = null) {
  if (!element) return;

  if (!value) {
    element.className = "stat-trend neutral";
    element.innerHTML = "—";
    return;
  }

  const percent = Number.isFinite(percentHint)
    ? percentHint
    : Math.min(48, Math.max(8, Math.round(Math.abs(value) * 7)));

  element.className = "stat-trend positive";
  element.innerHTML = `<span class="stat-trend-arrow">↑</span><span>+${percent}%</span>`;
}

function getCandidateTableRows(candidates = [], tableState, limit = null) {
  const filteredRows = filterCandidateRows(candidates, tableState);
  const sortedRows = sortCandidateRows(filteredRows, tableState);

  if (Number.isFinite(limit) && limit > 0) {
    return sortedRows.slice(0, limit);
  }

  return sortedRows;
}

function closeCandidateActionMenus() {
  state.activeCandidateMenuId = "";
  document.querySelectorAll("[data-candidate-action-menu]").forEach((menu) => {
    menu.classList.add("hidden");
  });
}

function handleCandidateTableAction(action, candidateId, rerender) {
  const candidate = state.candidates.find((item) => item.id === candidateId);
  if (!candidate) return;

  if (action === "view") {
    openCandidateModal(candidate);
    closeCandidateActionMenus();
    return;
  }

  if (action === "approve") {
    candidate.status = "approuvé";
  }

  if (action === "reject") {
    candidate.status = "refusé";
  }

  closeCandidateActionMenus();

  renderDashboard();
  renderApartments();
  renderCandidates();
}

function bindCandidateTableInteractions(container, stateKey, rerender) {
  if (!container) return;

  const searchInput = container.querySelector("[data-candidate-table-search]");
  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      updateCandidateTableState(stateKey, { query: event.target.value || "" });
      rerender();
    });
  }

  container.querySelectorAll("[data-candidate-status-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      updateCandidateTableState(stateKey, { status: button.dataset.candidateStatusFilter || "Tous" });
      rerender();
    });
  });

  container.querySelectorAll("[data-candidate-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextSortKey = button.dataset.candidateSort || "score";
      const currentState = state[stateKey] || {};
      const nextDirection =
        currentState.sortKey === nextSortKey && currentState.sortDirection === "desc" ? "asc" : "desc";

      updateCandidateTableState(stateKey, {
        sortKey: nextSortKey,
        sortDirection: nextDirection
      });
      rerender();
    });
  });

  container.querySelectorAll("[data-candidate-menu-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const menuId = button.dataset.candidateMenuToggle || "";
      const nextId = state.activeCandidateMenuId === menuId ? "" : menuId;

      state.activeCandidateMenuId = nextId;
      container.querySelectorAll("[data-candidate-action-menu]").forEach((menu) => {
        menu.classList.toggle("hidden", menu.dataset.candidateActionMenu !== nextId);
      });
    });
  });

  container.querySelectorAll("[data-candidate-action]").forEach((button) => {
    button.addEventListener("click", () => {
      handleCandidateTableAction(button.dataset.candidateAction, button.dataset.id, rerender);
    });
  });
}

function renderCandidateTable(container, candidates = [], options = {}) {
  if (!container) return;

  const {
    stateKey = "candidatesTableState",
    title = "Dossiers récents",
    limit = null,
    emptyMessage = "Aucun dossier à afficher pour le moment."
  } = options;

  const tableState = state[stateKey] || state.candidatesTableState;
  const visibleRows = getCandidateTableRows(candidates, tableState, limit);
  const totalFilteredCount = filterCandidateRows(candidates, tableState).length;
  const dashboardLimitApplied = Number.isFinite(limit) && limit > 0 && totalFilteredCount > visibleRows.length;

  container.innerHTML = `
    <div class="candidate-table-shell">
      <div class="candidate-table-toolbar">
        <div class="panel-kicker">${title}</div>
        <div class="candidate-table-search-row">
          <label class="candidate-table-search">
            <input
              type="text"
              value="${escapeHtml(tableState.query || "")}"
              placeholder="Rechercher un candidat ou une propriété..."
              data-candidate-table-search="${stateKey}"
            />
          </label>
          <button type="button" class="candidate-table-filter-btn">
            <span>Filtrer</span>
            <span aria-hidden="true">⌕</span>
          </button>
        </div>
        <div class="candidate-status-filters">
          ${getCandidateTableStatusOptions().map((status) => `
            <button
              type="button"
              class="candidate-filter-pill${tableState.status === status ? " active" : ""}"
              data-candidate-status-filter="${status}"
            >
              ${status}
            </button>
          `).join("")}
        </div>
      </div>

      <div class="candidate-table-wrap">
        <table class="candidate-table">
          <thead>
            <tr>
              <th>Candidat</th>
              <th>Propriété</th>
              <th>
                <button type="button" class="candidate-sort-btn" data-candidate-sort="income">
                  <span>Revenu</span>
                  <span class="candidate-sort-indicator${tableState.sortKey === "income" ? " active" : ""}">${getCandidateTableSortIndicator(tableState, "income")}</span>
                </button>
              </th>
              <th>Statut</th>
              <th>
                <button type="button" class="candidate-sort-btn" data-candidate-sort="score">
                  <span>Score</span>
                  <span class="candidate-sort-indicator${tableState.sortKey === "score" ? " active" : ""}">${getCandidateTableSortIndicator(tableState, "score")}</span>
                </button>
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              visibleRows.length
                ? visibleRows.map((candidate) => {
                    const apartment = getApartmentByRef(candidate.apartment_ref);
                    const apartmentLabel = apartment?.adresse || formatApartmentLabel(candidate.apartment_ref);
                    const statusMeta = getDashboardCandidateStatusMeta(candidate);
                    const scoreMeta = getCandidateScoreDisplayMeta(candidate);

                    return `
                      <tr>
                        <td>
                          <div class="candidate-identity">
                            <div class="candidate-initials">${getCandidateInitials(candidate.candidate_name)}</div>
                            <div class="candidate-identity-copy">
                              <div class="candidate-identity-name">${candidate.candidate_name || "Dossier candidat"}</div>
                              <div class="candidate-identity-subtitle">Dossier structuré</div>
                            </div>
                          </div>
                        </td>
                        <td class="candidate-property-cell">${apartmentLabel}</td>
                        <td class="candidate-income-cell">${formatCandidateRevenue(candidate)}</td>
                        <td><span class="status-pill ${statusMeta.tone}">${statusMeta.label}</span></td>
                        <td class="candidate-score-cell">
                          <div class="candidate-score-display">
                            <div class="candidate-score-track">
                              <div class="candidate-score-fill ${scoreMeta.className}" style="width:${scoreMeta.value}%"></div>
                            </div>
                            <div class="candidate-score-number">${scoreMeta.label}</div>
                          </div>
                        </td>
                        <td class="candidate-action-cell">
                          <div class="candidate-action-menu-shell">
                            <button
                              type="button"
                              class="candidate-action-btn"
                              data-candidate-menu-toggle="${candidate.id}"
                              aria-label="Actions pour ${escapeHtml(candidate.candidate_name || "ce dossier")}"
                            >
                              ···
                            </button>
                            <div
                              class="candidate-action-menu${state.activeCandidateMenuId === candidate.id ? "" : " hidden"}"
                              data-candidate-action-menu="${candidate.id}"
                            >
                              <button type="button" class="candidate-action-option" data-candidate-action="view" data-id="${candidate.id}">Voir le dossier</button>
                              <button type="button" class="candidate-action-option" data-candidate-action="approve" data-id="${candidate.id}">Approuver</button>
                              <button type="button" class="candidate-action-option" data-candidate-action="reject" data-id="${candidate.id}">Refuser</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join("")
                : `
                  <tr>
                    <td colspan="6" class="candidate-table-empty">${emptyMessage}</td>
                  </tr>
                `
            }
          </tbody>
        </table>
      </div>
      ${
        dashboardLimitApplied
          ? `<div class="candidate-identity-subtitle">Aperçu limité aux ${visibleRows.length} premiers dossiers correspondant aux filtres.</div>`
          : ""
      }
    </div>
  `;

  bindCandidateTableInteractions(container, stateKey, () => renderCandidateTable(container, candidates, options));

  if (container._candidateOutsideClickHandler) {
    document.removeEventListener("click", container._candidateOutsideClickHandler);
  }

  const outsideClickHandler = (event) => {
    if (!container.contains(event.target)) {
      closeCandidateActionMenus();
      document.removeEventListener("click", outsideClickHandler);
      container._candidateOutsideClickHandler = null;
    }
  };

  container._candidateOutsideClickHandler = outsideClickHandler;
  document.addEventListener("click", outsideClickHandler);
}

function getApartmentCandidates(apartmentRef) {
  return state.candidates.filter(
    (candidate) => normalizeRef(candidate.apartment_ref) === normalizeRef(apartmentRef)
  );
}

function getApartmentByRef(apartmentRef) {
  return state.apartments.find((apartment) => normalizeRef(apartment.ref) === normalizeRef(apartmentRef)) || null;
}

function getBestCandidateForApartment(apartmentRef) {
  return getApartmentCandidates(apartmentRef)
    .slice()
    .sort((a, b) => getCandidateScoreValue(b) - getCandidateScoreValue(a))[0] || null;
}

function deriveApartmentStage(apartment, candidates = []) {
  const availabilityMeta = getAvailabilityMeta(apartment?.disponibilite);
  const bestScore = candidates.reduce((max, candidate) => {
    return Math.max(max, getCandidateScoreValue(candidate));
  }, -1);

  if (availabilityMeta.tone === "danger") {
    return {
      label: "Non disponible",
      tone: "neutral"
    };
  }

  if (!candidates.length) {
    return {
      label: "Demandes à venir",
      tone: "neutral"
    };
  }

  if (bestScore >= 85) {
    return {
      label: "Dossiers à revoir",
      tone: "info"
    };
  }

  return {
    label: "Présélection en cours",
    tone: "warning"
  };
}

function getSafeStageMeta(stage) {
  return {
    label: stage?.label || "Statut à confirmer",
    tone: stage?.tone || "neutral"
  };
}

function deriveApartmentNextStep(apartment, candidates = []) {
  const availabilityMeta = getAvailabilityMeta(apartment?.disponibilite);
  const bestCandidate = getBestCandidateForApartment(apartment?.ref);

  if (availabilityMeta.tone === "danger") {
    return "Aucune action immédiate pour cette unité.";
  }

  if (!candidates.length) {
    return "Nous continuons la réception des demandes.";
  }

  if (bestCandidate && getCandidateScoreValue(bestCandidate) >= 85) {
    return "Des dossiers méritent votre attention.";
  }

  return "Le tri des dossiers se poursuit avant revue.";
}

function deriveApartmentNeedsAttention(apartment, candidates = []) {
  const availabilityMeta = getAvailabilityMeta(apartment?.disponibilite);
  const bestCandidate = getBestCandidateForApartment(apartment?.ref);
  const bestScore = bestCandidate ? getCandidateScoreValue(bestCandidate) : -1;

  if (availabilityMeta.tone === "danger") {
    return false;
  }

  if (!candidates.length) {
    return true;
  }

  return bestScore < 70;
}

function deriveCandidatePriority(candidate) {
  const score = getCandidateScoreValue(candidate);
  const statusMeta = getCandidateStatusMeta(candidate?.status);

  if (statusMeta.tone === "danger" || statusMeta.tone === "positive") {
    return "low";
  }

  if (score >= 85) {
    return "high";
  }

  if (score >= 70) {
    return "medium";
  }

  return "low";
}

function deriveCandidateRecommendation(candidate) {
  const priority = deriveCandidatePriority(candidate);

  if (priority === "high") {
    return {
      label: "À revoir",
      tone: "info"
    };
  }

  if (priority === "medium") {
    return {
      label: "Bon potentiel",
      tone: "positive"
    };
  }

  return {
    label: "À surveiller",
    tone: "neutral"
  };
}

const RESPONSIBILITY_LABELS = {
  CLIENT: "En attente du client",
  TEAM: "Pris en charge par l’équipe",
  WATCH: "À surveiller",
  DONE: "Complété"
};

function getResponsibilityVisual(label) {
  switch (label) {
    case RESPONSIBILITY_LABELS.CLIENT:
      return { tone: "info", className: "client" };
    case RESPONSIBILITY_LABELS.TEAM:
      return { tone: "positive", className: "team" };
    case RESPONSIBILITY_LABELS.WATCH:
      return { tone: "warning", className: "watch" };
    case RESPONSIBILITY_LABELS.DONE:
    default:
      return { tone: "neutral", className: "done" };
  }
}

function hasCompletedCandidateStatus(candidate) {
  const tone = getCandidateStatusMeta(candidate?.status).tone;
  return tone === "positive" || tone === "danger";
}

function getOpenCandidates(candidates = []) {
  return candidates.filter((candidate) => !hasCompletedCandidateStatus(candidate));
}

function hasMaterialNegativeReasons(candidate) {
  const riskReasons = getCandidateReasonGroups(candidate).risks.map((reason) => String(reason || "").toLowerCase());
  return riskReasons.some((reason) =>
    /crédit faible|credit faible|tal défavorable|tal defavorable|revenu insuffisant|refus|défavorable|defavorable|faible/.test(reason)
  );
}

function deriveApartmentResponsibility(apartment, candidates = []) {
  const availabilityMeta = getAvailabilityMeta(apartment?.disponibilite);
  const openCandidates = getOpenCandidates(candidates);
  const bestCandidate = openCandidates
    .slice()
    .sort((a, b) => getCandidateScoreValue(b) - getCandidateScoreValue(a))[0] || null;
  const bestScore = bestCandidate ? getCandidateScoreValue(bestCandidate) : -1;

  if (availabilityMeta.tone === "danger") {
    return RESPONSIBILITY_LABELS.DONE;
  }

  if (candidates.length > 0 && !openCandidates.length) {
    return RESPONSIBILITY_LABELS.DONE;
  }

  if (bestScore >= 85 && bestCandidate && !hasMaterialNegativeReasons(bestCandidate)) {
    return RESPONSIBILITY_LABELS.CLIENT;
  }

  if (!openCandidates.length || bestScore < 70) {
    return RESPONSIBILITY_LABELS.WATCH;
  }

  return RESPONSIBILITY_LABELS.TEAM;
}

function deriveApartmentResponsibilityReason(apartment, candidates = []) {
  const responsibility = deriveApartmentResponsibility(apartment, candidates);

  if (responsibility === RESPONSIBILITY_LABELS.DONE) {
    return candidates.length > 0 && !getOpenCandidates(candidates).length
      ? "Tous les dossiers liés sont déjà traités."
      : "Le logement n’est plus actif dans le cycle de relocation.";
  }

  if (responsibility === RESPONSIBILITY_LABELS.CLIENT) {
    return "Des dossiers solides sont prêts à être revus.";
  }

  if (responsibility === RESPONSIBILITY_LABELS.TEAM) {
    return "L’équipe poursuit encore le tri et la présélection.";
  }

  if (!candidates.length) {
    return "Aucun dossier n’est encore visible pour cette unité.";
  }

  return "Les dossiers reçus restent encore faibles ou peu alignés.";
}

function deriveApartmentNextAction(apartment, candidates = []) {
  const responsibility = deriveApartmentResponsibility(apartment, candidates);

  if (responsibility === RESPONSIBILITY_LABELS.DONE) {
    return "Aucune action requise.";
  }

  if (responsibility === RESPONSIBILITY_LABELS.CLIENT) {
    return "Revoir les meilleurs dossiers reçus.";
  }

  if (responsibility === RESPONSIBILITY_LABELS.TEAM) {
    return "Nous poursuivons la présélection avant de vous solliciter.";
  }

  if (!candidates.length) {
    return "Surveiller l’arrivée de nouvelles candidatures.";
  }

  return "Surveiller la qualité des prochains dossiers.";
}

function getApartmentResponsibilityMeta(apartment, candidates = []) {
  const label = deriveApartmentResponsibility(apartment, candidates);
  const visual = getResponsibilityVisual(label);

  return {
    label,
    tone: visual.tone,
    className: visual.className,
    reason: deriveApartmentResponsibilityReason(apartment, candidates),
    nextStep: deriveApartmentNextAction(apartment, candidates)
  };
}

function deriveCandidateResponsibility(candidate) {
  const statusMeta = getCandidateStatusMeta(candidate?.status);
  const score = getCandidateScoreValue(candidate);
  const matchMeta = getMatchMeta(candidate?.match_status);
  const hasNegativeReasons = hasMaterialNegativeReasons(candidate);

  if (statusMeta.tone === "positive" || statusMeta.tone === "danger") {
    return RESPONSIBILITY_LABELS.DONE;
  }

  if (score < 0) {
    return RESPONSIBILITY_LABELS.WATCH;
  }

  if (score >= 85 && !hasNegativeReasons) {
    return RESPONSIBILITY_LABELS.CLIENT;
  }

  if ((score >= 70 || matchMeta.tone === "positive") && !hasNegativeReasons) {
    return RESPONSIBILITY_LABELS.TEAM;
  }

  return RESPONSIBILITY_LABELS.WATCH;
}

function deriveCandidateResponsibilityReason(candidate) {
  const responsibility = deriveCandidateResponsibility(candidate);
  const statusMeta = getCandidateStatusMeta(candidate?.status);

  if (responsibility === RESPONSIBILITY_LABELS.DONE) {
    return statusMeta.tone === "positive"
      ? "Le dossier a déjà été validé."
      : "Le dossier a déjà été traité.";
  }

  if (responsibility === RESPONSIBILITY_LABELS.CLIENT) {
    return "Le dossier ressort suffisamment pour une revue de votre part.";
  }

  if (responsibility === RESPONSIBILITY_LABELS.TEAM) {
    return "L’équipe poursuit encore l’analyse de ce dossier.";
  }

  if (getCandidateScoreValue(candidate) < 0) {
    return "Le dossier reste incomplet pour le moment.";
  }

  if (hasMaterialNegativeReasons(candidate)) {
    return "Le dossier comporte encore des points sensibles à clarifier.";
  }

  return "Le dossier reste secondaire à ce stade.";
}

function deriveCandidateNextAction(candidate) {
  const responsibility = deriveCandidateResponsibility(candidate);

  if (responsibility === RESPONSIBILITY_LABELS.DONE) {
    return "Aucune action requise.";
  }

  if (responsibility === RESPONSIBILITY_LABELS.CLIENT) {
    return "Revoir ce dossier plus en détail.";
  }

  if (responsibility === RESPONSIBILITY_LABELS.TEAM) {
    return "Nous poursuivons l’analyse avant de vous solliciter.";
  }

  if (getCandidateScoreValue(candidate) < 0) {
    return "Attendre davantage d’éléments avant revue.";
  }

  return "Conserver ce dossier en suivi secondaire.";
}

function getCandidateResponsibilityMeta(candidate) {
  const label = deriveCandidateResponsibility(candidate);
  const visual = getResponsibilityVisual(label);

  return {
    label,
    tone: visual.tone,
    className: visual.className,
    reason: deriveCandidateResponsibilityReason(candidate),
    nextStep: deriveCandidateNextAction(candidate)
  };
}

function getCandidateReasonGroups(candidate) {
  const reasons = Array.isArray(candidate?.match_reasons) ? candidate.match_reasons.filter(Boolean) : [];
  return {
    strengths: reasons.filter(isPositiveReason),
    risks: reasons.filter((reason) => !isPositiveReason(reason))
  };
}

function deriveCandidateReviewSection(candidate) {
  const priority = deriveCandidatePriority(candidate);

  if (priority === "high") {
    return "review";
  }

  if (priority === "medium") {
    return "recommended";
  }

  return "other";
}

function deriveCandidateFocusNote(candidate) {
  const statusMeta = getCandidateStatusMeta(candidate?.status);
  const section = deriveCandidateReviewSection(candidate);
  const score = getCandidateScoreValue(candidate);

  if (statusMeta.tone === "positive") {
    return "Dossier déjà validé, conservé pour suivi.";
  }

  if (statusMeta.tone === "danger") {
    return "Dossier conservé pour référence, sans priorité immédiate.";
  }

  if (section === "review") {
    return "Ce dossier mérite une revue prioritaire.";
  }

  if (section === "recommended") {
    return score >= 80
      ? "Profil solide, proche d’un dossier prioritaire."
      : "Profil prometteur, avec quelques points à confirmer.";
  }

  if (score < 0) {
    return "Évaluation encore en cours.";
  }

  return "À garder en suivi secondaire pour le moment.";
}

function groupCandidatesForWorkspace(candidates = []) {
  const groups = {
    review: [],
    recommended: [],
    other: []
  };

  candidates
    .slice()
    .sort((a, b) => {
      const sectionOrder = { review: 0, recommended: 1, other: 2 };
      const sectionCompare =
        (sectionOrder[deriveCandidateReviewSection(a)] ?? 3) - (sectionOrder[deriveCandidateReviewSection(b)] ?? 3);

      if (sectionCompare !== 0) {
        return sectionCompare;
      }

      return getCandidateScoreValue(b) - getCandidateScoreValue(a);
    })
    .forEach((candidate) => {
      groups[deriveCandidateReviewSection(candidate)].push(candidate);
    });

  return groups;
}

function deriveDecisionQueue(candidates = []) {
  return candidates
    .filter((candidate) => deriveCandidateResponsibility(candidate) === RESPONSIBILITY_LABELS.CLIENT)
    .sort((a, b) => getCandidateScoreValue(b) - getCandidateScoreValue(a))
    .slice(0, 3);
}

function deriveWatchlist(apartments = []) {
  return apartments
    .map((apartment) => {
      const candidates = getApartmentCandidates(apartment.ref);
      const responsibility = getApartmentResponsibilityMeta(apartment, candidates);
      const stage = getSafeStageMeta(deriveApartmentStage(apartment, candidates));

      return {
        apartment,
        candidates,
        responsibility,
        stage
      };
    })
    .filter((item) => item.responsibility.label === RESPONSIBILITY_LABELS.WATCH)
    .slice(0, 3);
}

function countStrongCandidates(candidates = []) {
  return candidates.filter((candidate) => getCandidateScoreValue(candidate) >= 85).length;
}

function getApartmentStrengthSummary(candidates = []) {
  if (!candidates.length) {
    return "Aucun dossier reçu pour le moment";
  }

  const strongCount = countStrongCandidates(candidates);
  const promisingCount = candidates.filter((candidate) => {
    const score = getCandidateScoreValue(candidate);
    return score >= 70 && score < 85;
  }).length;

  if (strongCount > 0) {
    return `${strongCount} dossier${strongCount > 1 ? "s" : ""} fort${strongCount > 1 ? "s" : ""} actuellement`;
  }

  if (promisingCount > 0) {
    return `${promisingCount} dossier${promisingCount > 1 ? "s" : ""} prometteur${promisingCount > 1 ? "s" : ""}`;
  }

  return "Aucun dossier fort actuellement";
}

function deriveApartmentAttentionMeta(apartment, candidates = []) {
  const availabilityMeta = getAvailabilityMeta(apartment?.disponibilite);
  const bestCandidate = getBestCandidateForApartment(apartment?.ref);
  const bestScore = bestCandidate ? getCandidateScoreValue(bestCandidate) : -1;

  if (availabilityMeta.tone === "danger") {
    return {
      label: "Aucune attention requise",
      tone: "low",
      note: "Le logement n’est pas actuellement à relouer."
    };
  }

  if (!candidates.length) {
    return {
      label: "À surveiller",
      tone: "high",
      note: "Aucun dossier n’a encore été reçu pour cette unité."
    };
  }

  if (bestScore >= 85) {
    return {
      label: "Attention utile",
      tone: "medium",
      note: "Des dossiers ressortent et pourront bientôt mériter votre avis."
    };
  }

  if (bestScore >= 70) {
    return {
      label: "Suivi en cours",
      tone: "medium",
      note: "La présélection avance, mais aucun dossier fort n’est encore confirmé."
    };
  }

  return {
    label: "À renforcer",
    tone: "high",
    note: "Les dossiers reçus restent encore faibles ou peu alignés."
  };
}

function normalizeRef(value) {
  return String(value || "").replace(/^L-/i, "").trim();
}

function formatApartmentLabel(apartmentRef) {
  const normalizedRef = normalizeRef(apartmentRef);
  const apartment = state.apartments.find((item) => normalizeRef(item.ref) === normalizedRef);
  if (!apartment) return `L-${apartmentRef || "-"}`;
  return `${apartment.adresse || `L-${apartment.ref}`}`;
}

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

function isPositiveReason(reason) {
  return /conforme|accepté|permis|autorisé/i.test(reason || "");
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
    const error = new Error(data.error || "Erreur");
    error.status = response.status;
    throw error;
  }

  return data;
}

async function fetchClientJSON(url, options = {}) {
  const session = state.currentSession || await waitForActiveSession(1, 0);

  if (!session?.access_token) {
    throw new Error("Session client introuvable.");
  }

  return fetchJSON(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${session.access_token}`
    }
  });
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
    if (redirectToClientPortalEntry()) {
      throw new Error("Redirection vers le portail client.");
    }

    state.currentSession = null;
    state.currentUser = null;
    state.clientId = "";
    return null;
  }

  const user = session.user;
  state.currentSession = session;
  state.currentUser = user;
  state.clientId = resolveClientId(user);
  const role = resolveUserRole(user);

  if (role && role !== "client") {
    window.location.href = role === "admin" ? `${EMPLOYEE_APP_URL}/admin.html` : `${EMPLOYEE_APP_URL}/`;
    throw new Error("Ce rôle ne peut pas utiliser le portail client.");
  }

  if (!state.clientId) {
    window.location.href = `${EMPLOYEE_APP_URL}/`;
    throw new Error("Employee users must use employee platform.");
  }

  return user;
}

function handleClientRouteFailure(error) {
  if (error?.status === 401) {
    if (redirectToClientPortalEntry()) {
      return;
    }

    showClientLoginScreen("Connexion client requise.", "error");
    return;
  }

  window.location.href = `${EMPLOYEE_APP_URL}/`;
}

async function signInClient(event) {
  event.preventDefault();

  if (!clientLoginSubmit) return;

  clientLoginSubmit.disabled = true;
  showClientLoginScreen("", "");

  try {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: String(clientLoginEmail?.value || "").trim(),
      password: String(clientLoginPassword?.value || "")
    });

    if (error) {
      throw error;
    }

    const user = await requireLogin();

    if (!user) {
      throw new Error("Session client introuvable.");
    }

    await loadClientData();
    showClientPortalScreen();
    switchTab("dashboard");
  } catch (error) {
    showClientLoginScreen(error.message || "Impossible de se connecter.", "error");
  } finally {
    clientLoginSubmit.disabled = false;
  }
}

function switchTab(tabName) {
  state.currentTab = tabName;

  Object.entries(tabs).forEach(([key, element]) => {
    if (!element) return;
    const isHidden = key !== tabName;
    element.classList.toggle("hidden", isHidden);
    element.hidden = isHidden;
  });

  document.querySelectorAll(".menu-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });

  const titles = {
    dashboard: "Tableau de bord",
    apartments: "Appartements",
    candidates: "Dossiers",
    criteria: "Critères"
  };

  pageTitle.textContent = titles[tabName] || "Client";
}

function renderDashboard() {
  const totalApartments = state.apartments.length;
  const availableApartments = state.apartments.filter((item) => item.disponibilite === "disponible").length;
  const totalCandidates = state.candidates.length;
  const approvedCount = state.candidates.filter((item) => item.status === "approuvé").length;
  const refusedCount = state.candidates.filter((item) => item.status === "refusé").length;

  statTotalApartments.textContent = String(totalApartments);
  statAvailableApartments.textContent = String(availableApartments);
  statCandidates.textContent = String(totalCandidates);
  statDecisionSplit.textContent = `${approvedCount} / ${refusedCount}`;

  setStatTrend(statTotalApartmentsTrend, totalApartments);
  setStatTrend(statAvailableApartmentsTrend, availableApartments);
  setStatTrend(statCandidatesTrend, totalCandidates);
  setStatTrend(statDecisionSplitTrend, approvedCount + refusedCount, approvedCount || refusedCount ? 12 : 0);

  renderDashboardDecisionQueue();
  renderDashboardApartmentOverview();
  renderDashboardCriteriaSummary();
  renderDashboardWatchlist();
}

function renderDashboardDecisionQueue() {
  if (!dashboardDecisionQueue) return;

  const prioritizedCandidates = deriveDecisionQueue(state.candidates);
  const dashboardCandidates = (prioritizedCandidates.length
    ? prioritizedCandidates
    : state.candidates.slice().sort((a, b) => getCandidateScoreValue(b) - getCandidateScoreValue(a))
  ).slice(0, 5);

  renderCandidateTable(dashboardDecisionQueue, dashboardCandidates, {
    stateKey: "dashboardTableState",
    title: "Dossiers à prioriser",
    limit: 5,
    emptyMessage: "Aucun dossier prioritaire pour le moment."
  });
}

function renderDashboardApartmentOverview() {
  if (!dashboardApartmentOverview) return;

  if (!state.apartments.length) {
    dashboardApartmentOverview.innerHTML = `
      <div class="dashboard-empty-state">
        Aucun logement actif pour le moment.
      </div>
    `;
    return;
  }

  const apartmentItems = state.apartments
    .map((apartment) => {
      const candidates = getApartmentCandidates(apartment.ref);
      const stage = getSafeStageMeta(deriveApartmentStage(apartment, candidates));
      const responsibility = getApartmentResponsibilityMeta(apartment, candidates);
      const bestCandidate = getBestCandidateForApartment(apartment.ref);
      const scoreMeta = getScoreMeta(bestCandidate?.match_score);

      return {
        apartment,
        candidates,
        stage,
        responsibility,
        bestCandidate,
        scoreMeta
      };
    })
    .sort((a, b) => {
      const responsibilityOrder = {
        [RESPONSIBILITY_LABELS.CLIENT]: 0,
        [RESPONSIBILITY_LABELS.TEAM]: 1,
        [RESPONSIBILITY_LABELS.WATCH]: 2,
        [RESPONSIBILITY_LABELS.DONE]: 3
      };
      const responsibilityCompare =
        (responsibilityOrder[a.responsibility.label] ?? 4) - (responsibilityOrder[b.responsibility.label] ?? 4);

      if (responsibilityCompare !== 0) {
        return responsibilityCompare;
      }

      return b.candidates.length - a.candidates.length;
    })
    .slice(0, 4);

  dashboardApartmentOverview.innerHTML = apartmentItems.map((item) => `
    <div class="dashboard-item">
      <div class="dashboard-item-top">
        <div class="dashboard-item-main">
          <div class="dashboard-item-title">${item.apartment.adresse || `Appartement L-${item.apartment.ref || "-"}`}</div>
          <div class="dashboard-item-meta">${item.apartment.ville || "Ville à confirmer"} · ${formatCurrency(item.apartment.loyer)}</div>
        </div>
        <span class="responsibility-pill ${item.responsibility.className}">${item.responsibility.label}</span>
      </div>
      <div class="dashboard-item-summary">
        <span class="status-pill ${item.stage.tone}">${item.stage.label}</span>
        <span class="status-pill ${getAvailabilityMeta(item.apartment.disponibilite).tone}">${getAvailabilityMeta(item.apartment.disponibilite).label}</span>
        <span class="data-pill">${item.candidates.length} dossier${item.candidates.length > 1 ? "s" : ""}</span>
        <span class="score-pill ${item.scoreMeta.className}">${item.scoreMeta.label}</span>
      </div>
      <div class="next-step-note">
        <div class="next-step-label">Prochaine étape</div>
        <div class="next-step-copy">${item.responsibility.nextStep}</div>
      </div>
      <div class="responsibility-note">${item.responsibility.reason}</div>
    </div>
  `).join("");
}

function renderDashboardCriteriaSummary() {
  if (!dashboardCriteriaSummary) return;

  if (!state.client) {
    dashboardCriteriaSummary.innerHTML = `
      <div class="dashboard-empty-state">
        Vos critères actifs apparaîtront ici.
      </div>
    `;
    return;
  }

  const criteria = state.client?.criteres || {};
  const jobs = Array.isArray(criteria.emplois_acceptes) && criteria.emplois_acceptes.length
    ? criteria.emplois_acceptes.join(", ")
    : "Non précisé";

  const previewItems = [
    {
      label: "Revenu minimum",
      value: criteria.revenu_minimum ? formatCurrency(criteria.revenu_minimum) : "Non précisé",
      note: "Seuil"
    },
    {
      label: "Crédit",
      value: criteria.credit_min || "Non précisé",
      note: "Niveau"
    },
    {
      label: "Animaux / TAL",
      value: `${criteria.animaux_acceptes === true ? "Animaux oui" : criteria.animaux_acceptes === false ? "Animaux non" : "Animaux n.c."} · ${criteria.accepte_tal === true ? "TAL oui" : criteria.accepte_tal === false ? "TAL non" : "TAL n.c."}`,
      note: "Règles"
    },
    {
      label: "Occupants / emplois",
      value: `${criteria.max_occupants ? `${criteria.max_occupants} max` : "Occupants n.c."} · ${jobs}`,
      note: "Cadre"
    }
  ];

  dashboardCriteriaSummary.innerHTML = previewItems.map((item) => `
    <div class="criteria-preview-item">
      <div class="criteria-preview-label">${item.label}</div>
      <div class="criteria-preview-value">${item.value}</div>
      <div class="criteria-preview-note">${item.note}</div>
    </div>
  `).join("");
}

function renderDashboardWatchlist() {
  if (!dashboardWatchlist) return;

  const watchlistItems = deriveWatchlist(state.apartments);

  if (!watchlistItems.length) {
    dashboardWatchlist.innerHTML = `
      <div class="dashboard-empty-state">
        Aucun point de vigilance pour le moment.
      </div>
    `;
    return;
  }

  dashboardWatchlist.innerHTML = watchlistItems.map((item) => {
    const availabilityMeta = getAvailabilityMeta(item.apartment.disponibilite);
    const responsibility = item.responsibility;

    return `
      <div class="dashboard-item">
        <div class="dashboard-item-top">
          <div class="dashboard-item-main">
            <div class="dashboard-item-title">${item.apartment.adresse || `Appartement L-${item.apartment.ref || "-"}`}</div>
            <div class="dashboard-item-meta">${item.apartment.ville || "Ville à confirmer"}</div>
          </div>
          <span class="responsibility-pill ${responsibility.className}">${responsibility.label}</span>
        </div>
        <div class="dashboard-item-summary">
          <span class="status-pill ${availabilityMeta.tone}">${availabilityMeta.label}</span>
          <span class="data-pill">${item.candidates.length} dossier${item.candidates.length > 1 ? "s" : ""}</span>
        </div>
        <div class="next-step-note">
          <div class="next-step-label">Prochaine étape</div>
          <div class="next-step-copy">${responsibility.nextStep}</div>
        </div>
        <div class="responsibility-note">${responsibility.reason}</div>
      </div>
    `;
  }).join("");
}

function renderApartments() {
  if (!apartmentsBody) return;

  apartmentsBody.innerHTML = "";

  if (apartmentsSupervisionSummary) {
    const responsibilityCounts = state.apartments.reduce((accumulator, apartment) => {
      const label = deriveApartmentResponsibility(apartment, getApartmentCandidates(apartment.ref));
      accumulator[label] = (accumulator[label] || 0) + 1;
      return accumulator;
    }, {});

    apartmentsSupervisionSummary.innerHTML = `
      <div class="apartments-supervision-metric">
        <div class="apartments-supervision-label">En attente du client</div>
        <div class="apartments-supervision-value">${responsibilityCounts[RESPONSIBILITY_LABELS.CLIENT] || 0}</div>
        <div class="apartments-supervision-note">Unités à revoir.</div>
      </div>
      <div class="apartments-supervision-metric">
        <div class="apartments-supervision-label">Pris en charge par l’équipe</div>
        <div class="apartments-supervision-value">${responsibilityCounts[RESPONSIBILITY_LABELS.TEAM] || 0}</div>
        <div class="apartments-supervision-note">Unités en cours de tri.</div>
      </div>
      <div class="apartments-supervision-metric">
        <div class="apartments-supervision-label">À surveiller</div>
        <div class="apartments-supervision-value">${responsibilityCounts[RESPONSIBILITY_LABELS.WATCH] || 0}</div>
        <div class="apartments-supervision-note">Unités à suivre de près.</div>
      </div>
    `;
  }

  if (!state.apartments.length) {
    apartmentsBody.innerHTML = `
      <div class="dashboard-empty-state">
        Aucun appartement lié à ce client.
      </div>
    `;
    return;
  }

  const apartmentItems = state.apartments
    .map((apartment) => {
      const apartmentCandidates = getApartmentCandidates(apartment.ref);
      const availabilityMeta = getAvailabilityMeta(apartment.disponibilite);
      const stage = getSafeStageMeta(deriveApartmentStage(apartment, apartmentCandidates));
      const responsibility = getApartmentResponsibilityMeta(apartment, apartmentCandidates);
      const bestCandidate = getBestCandidateForApartment(apartment.ref);
      const strongSummary = getApartmentStrengthSummary(apartmentCandidates);

      return {
        apartment,
        apartmentCandidates,
        availabilityMeta,
        stage,
        responsibility,
        bestCandidate,
        strongSummary
      };
    })
    .sort((a, b) => {
      const responsibilityOrder = {
        [RESPONSIBILITY_LABELS.CLIENT]: 0,
        [RESPONSIBILITY_LABELS.WATCH]: 1,
        [RESPONSIBILITY_LABELS.TEAM]: 2,
        [RESPONSIBILITY_LABELS.DONE]: 3
      };
      const responsibilityCompare =
        (responsibilityOrder[a.responsibility.label] ?? 4) - (responsibilityOrder[b.responsibility.label] ?? 4);

      if (responsibilityCompare !== 0) {
        return responsibilityCompare;
      }

      return b.apartmentCandidates.length - a.apartmentCandidates.length;
    });

  apartmentsBody.innerHTML = apartmentItems.map((item) => `
    <article class="apartment-pipeline-card">
      <div class="apartment-pipeline-header">
        <div class="apartment-pipeline-main">
          <div class="apartment-pipeline-title">${item.apartment.adresse || `Appartement L-${item.apartment.ref || "-"}`}</div>
          <div class="apartment-pipeline-meta">
            ${item.apartment.ville || "Ville à confirmer"} · Réf. L-${item.apartment.ref || "-"} · ${formatCurrency(item.apartment.loyer)}
          </div>
        </div>
        <div class="apartment-pipeline-statuses">
          <span class="status-pill ${item.stage.tone}">${item.stage.label}</span>
          <span class="responsibility-pill ${item.responsibility.className}">${item.responsibility.label}</span>
        </div>
      </div>

      <div class="apartment-pipeline-grid">
        <div class="apartment-pipeline-panel">
          <div class="apartment-pipeline-panel-label">Responsabilité</div>
          <div class="apartment-pipeline-summary">
            <span class="status-pill ${item.availabilityMeta.tone}">${item.availabilityMeta.label}</span>
            <span class="data-pill">${item.apartmentCandidates.length} dossier${item.apartmentCandidates.length > 1 ? "s" : ""} reçu${item.apartmentCandidates.length > 1 ? "s" : ""}</span>
            <span class="data-pill">${item.strongSummary}</span>
          </div>
          <div class="responsibility-note">${item.responsibility.reason}</div>
        </div>

        <div class="apartment-pipeline-next-step">
          <div class="apartment-pipeline-next-step-title">Prochaine étape</div>
          <div class="apartment-pipeline-next-step-copy">${item.responsibility.nextStep}</div>
          <div class="apartment-pipeline-panel-copy">
            ${item.bestCandidate
              ? `Dossier le plus avancé actuellement : ${item.bestCandidate.candidate_name || "Candidat"}`
              : "Aucun dossier fort actuellement pour cette unité."}
          </div>
        </div>
      </div>

      <div class="apartment-pipeline-actions">
        <button type="button" class="secondary-btn compact-action apartment-review-btn">Voir les dossiers liés</button>
      </div>
    </article>
  `).join("");

  document.querySelectorAll(".apartment-review-btn").forEach((button) => {
    button.addEventListener("click", () => switchTab("candidates"));
  });
}

function renderCandidates() {
  if (!candidatesBody) return;

  candidatesBody.innerHTML = "";

  const clientCount = state.candidates.filter(
    (candidate) => deriveCandidateResponsibility(candidate) === RESPONSIBILITY_LABELS.CLIENT
  ).length;
  const teamCount = state.candidates.filter(
    (candidate) => deriveCandidateResponsibility(candidate) === RESPONSIBILITY_LABELS.TEAM
  ).length;
  const isSparseState = state.candidates.length > 0 && state.candidates.length < 3;

  if (candidatesReviewSummary) {
    candidatesReviewSummary.innerHTML = `
      <div class="candidates-review-metric">
        <div class="candidates-review-label">Dossiers reçus</div>
        <div class="candidates-review-value">${state.candidates.length}</div>
        <div class="candidates-review-note">Dossiers visibles.</div>
      </div>
      <div class="candidates-review-metric">
        <div class="candidates-review-label">En attente du client</div>
        <div class="candidates-review-value">${clientCount}</div>
        <div class="candidates-review-note">À revoir.</div>
      </div>
      <div class="candidates-review-metric">
        <div class="candidates-review-label">Pris en charge par l’équipe</div>
        <div class="candidates-review-value">${teamCount}</div>
        <div class="candidates-review-note">Encore suivis.</div>
      </div>
      ${
        isSparseState
          ? `
            <div class="candidates-review-note-card">
              <div class="candidates-review-label">Portefeuille en constitution</div>
              <div class="candidates-review-note">Peu de dossiers pour le moment. La vue se remplira au fil des réceptions.</div>
            </div>
          `
          : ""
      }
    `;
  }

  if (!state.candidates.length) {
    renderCandidateTable(candidatesBody, [], {
      stateKey: "candidatesTableState",
      title: "Tous les dossiers",
      emptyMessage: "Aucun dossier à afficher pour le moment."
    });
    return;
  }

  renderCandidateTable(candidatesBody, state.candidates, {
    stateKey: "candidatesTableState",
    title: "Tous les dossiers",
    emptyMessage: "Aucun dossier ne correspond aux filtres actuels."
  });
}

function populateCriteriaForm() {
  const criteria = state.client?.criteres || {};
  document.getElementById("criteriaIncome").value =
    criteria.revenu_minimum === null || criteria.revenu_minimum === undefined ? "" : String(criteria.revenu_minimum);
  document.getElementById("criteriaCredit").value = criteria.credit_min || "";
  document.getElementById("criteriaTal").value = toYesNo(criteria.accepte_tal);
  document.getElementById("criteriaAnimals").value = toYesNo(criteria.animaux_acceptes);
  document.getElementById("criteriaOccupants").value =
    criteria.max_occupants === null || criteria.max_occupants === undefined ? "" : String(criteria.max_occupants);
  document.getElementById("criteriaJobs").value = Array.isArray(criteria.emplois_acceptes)
    ? criteria.emplois_acceptes.join(", ")
    : "";
  document.getElementById("criteriaSeniority").value =
    criteria.anciennete_min_mois === null || criteria.anciennete_min_mois === undefined
      ? ""
      : String(criteria.anciennete_min_mois);
}

function openCandidateModal(candidate) {
  candidateModalTitle.textContent = candidate.candidate_name || "Détails candidat";

  const detailItems = [
    ["Revenu", candidate.revenu || candidate.monthly_income || "-"],
    ["Cote de crédit", candidate.credit_level || "-"],
    ["TAL", candidate.tal_record || "-"],
    ["Emploi", candidate.job_title || candidate.employment_status || "-"],
    ["Ancienneté", candidate.employment_length || "-"],
    ["Animaux", candidate.pets || "-"],
    ["Occupants", candidate.occupants_total || "-"],
    ["Appartement", formatApartmentLabel(candidate.apartment_ref)]
  ];

  candidateDetailGrid.innerHTML = detailItems
    .map(([label, value]) => `<div class="detail-item"><strong>${label}</strong><span>${value}</span></div>`)
    .join("");

  const reasons = Array.isArray(candidate.match_reasons) ? candidate.match_reasons : [];
  const passed = reasons.filter(isPositiveReason);
  const failed = reasons.filter((reason) => !isPositiveReason(reason));

  candidatePassReasons.innerHTML = (passed.length ? passed : ["Aucun critère validé explicitement."])
    .map((reason) => `<li>${reason}</li>`)
    .join("");

  candidateFailReasons.innerHTML = (failed.length ? failed : ["Aucun point bloquant relevé."])
    .map((reason) => `<li>${reason}</li>`)
    .join("");

  candidateModal.classList.add("open");
}

function closeCandidateModal() {
  candidateModal.classList.remove("open");
}

async function loadClientData() {
  const [clientData, apartmentsData, candidatesData] = await Promise.all([
    fetchClientJSON("/api/client/me"),
    fetchClientJSON("/api/client/apartments"),
    fetchClientJSON("/api/client/candidates")
  ]);

  const currentClient = clientData.client || null;

  if (!currentClient) {
    throw new Error(`Client introuvable pour client_id=${state.clientId}.`);
  }

  state.client = currentClient;
  state.apartments = apartmentsData.apartments || [];
  state.candidates = candidatesData.candidates || [];

  clientMeta.textContent = `${state.client.nom || state.clientId} · client_id: ${state.clientId}`;
  renderDashboard();
  renderApartments();
  renderCandidates();
  populateCriteriaForm();
}

async function saveCriteria(event) {
  event.preventDefault();
  setCriteriaStatus("", "");

  const payload = {
    criteres: {
      revenu_minimum: parseOptionalNumber(document.getElementById("criteriaIncome").value),
      credit_min: document.getElementById("criteriaCredit").value || null,
      accepte_tal: fromYesNo(document.getElementById("criteriaTal").value),
      animaux_acceptes: fromYesNo(document.getElementById("criteriaAnimals").value),
      max_occupants: parseOptionalNumber(document.getElementById("criteriaOccupants").value),
      anciennete_min_mois: parseOptionalNumber(document.getElementById("criteriaSeniority").value),
      emplois_acceptes: String(document.getElementById("criteriaJobs").value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    }
  };

  try {
    const result = await fetchClientJSON("/api/client/criteria", {
      method: "PUT",
      body: JSON.stringify(payload)
    });

    state.client = result.client || state.client;
    populateCriteriaForm();
    setCriteriaStatus("Critères enregistrés.", "success");
  } catch (error) {
    setCriteriaStatus(error.message || "Impossible d’enregistrer les critères.", "error");
  }
}

document.querySelectorAll(".menu-btn").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

document.querySelectorAll("[data-dashboard-tab]").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.dashboardTab));
});

if (refreshBtn) {
  refreshBtn.addEventListener("click", loadClientData);
}

if (criteriaForm) {
  criteriaForm.addEventListener("submit", saveCriteria);
}

if (closeCandidateModalBtn) {
  closeCandidateModalBtn.addEventListener("click", closeCandidateModal);
}

if (candidateModal) {
  candidateModal.addEventListener("click", (event) => {
    if (event.target === candidateModal) {
      closeCandidateModal();
    }
  });
}

if (clientLoginForm) {
  clientLoginForm.addEventListener("submit", signInClient);
}

supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    if (redirectToClientPortalEntry()) {
      return;
    }

    state.currentSession = null;
    state.currentUser = null;
    state.clientId = "";
    state.client = null;
    state.apartments = [];
    state.candidates = [];
    showClientLoginScreen("Veuillez vous connecter pour accéder à votre espace client.", "success");
    return;
  }

  if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
    supabaseClient.auth.getSession().then(({ data }) => {
      state.currentSession = data?.session || null;
    }).catch(() => {});
  }
});

(async function init() {
  try {
    const user = await requireLogin();

    if (!user) {
      showClientLoginScreen();
      return;
    }

    await loadClientData();
    showClientPortalScreen();
    switchTab("dashboard");
  } catch (error) {
    if (state.currentUser) {
      handleClientRouteFailure(error);
      return;
    }

    showClientLoginScreen(error.message || "Connexion client requise.", "error");
  }
})();
