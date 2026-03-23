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

const clientShell = document.getElementById("clientShell");
const pageTitle = document.getElementById("pageTitle");
const clientMeta = document.getElementById("clientMeta");
const refreshBtn = document.getElementById("refreshBtn");
const apartmentsBody = document.getElementById("apartmentsBody");
const candidatesBody = document.getElementById("candidatesBody");
const criteriaForm = document.getElementById("criteriaForm");
const criteriaStatus = document.getElementById("criteriaStatus");

const statTotalApartments = document.getElementById("statTotalApartments");
const statAvailableApartments = document.getElementById("statAvailableApartments");
const statCandidates = document.getElementById("statCandidates");
const statDecisionSplit = document.getElementById("statDecisionSplit");

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
  candidates: []
};

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
    window.location.href = `/login.html?next=${encodeURIComponent("/client.html")}`;
    throw new Error("No active session.");
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
    window.location.href = `/login.html?next=${encodeURIComponent("/client.html")}`;
    return;
  }

  window.location.href = `${EMPLOYEE_APP_URL}/`;
}

function switchTab(tabName) {
  state.currentTab = tabName;

  Object.entries(tabs).forEach(([key, element]) => {
    if (!element) return;
    element.classList.toggle("hidden", key !== tabName);
  });

  document.querySelectorAll(".menu-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });

  const titles = {
    dashboard: "Tableau de bord",
    apartments: "Appartements",
    candidates: "Candidats",
    criteria: "Critères"
  };

  pageTitle.textContent = titles[tabName] || "Client";
}

function renderDashboard() {
  statTotalApartments.textContent = String(state.apartments.length);
  statAvailableApartments.textContent = String(
    state.apartments.filter((item) => item.disponibilite === "disponible").length
  );
  statCandidates.textContent = String(state.candidates.length);

  const approvedCount = state.candidates.filter((item) => item.status === "approuvé").length;
  const refusedCount = state.candidates.filter((item) => item.status === "refusé").length;
  statDecisionSplit.textContent = `${approvedCount} / ${refusedCount}`;
}

function renderApartments() {
  apartmentsBody.innerHTML = "";

  if (!state.apartments.length) {
    apartmentsBody.innerHTML = `<tr><td colspan="6">Aucun appartement lié à ce client.</td></tr>`;
    return;
  }

  state.apartments.forEach((apartment) => {
    const apartmentCandidates = state.candidates.filter(
      (candidate) => normalizeRef(candidate.apartment_ref) === normalizeRef(apartment.ref)
    );
    const bestScore = apartmentCandidates.reduce((max, candidate) => {
      const score = Number(candidate.match_score ?? -1);
      return score > max ? score : max;
    }, -1);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${apartment.adresse || "-"}</td>
      <td>${apartment.ville || "-"}</td>
      <td>${formatCurrency(apartment.loyer)}</td>
      <td>${apartment.disponibilite || "-"}</td>
      <td>${apartmentCandidates.length}</td>
      <td>${bestScore >= 0 ? bestScore : "-"}</td>
    `;
    apartmentsBody.appendChild(row);
  });
}

function renderCandidates() {
  candidatesBody.innerHTML = "";

  if (!state.candidates.length) {
    candidatesBody.innerHTML = `<tr><td colspan="6">Aucun candidat lié à vos appartements.</td></tr>`;
    return;
  }

  state.candidates.forEach((candidate) => {
    const row = document.createElement("tr");
    const matchValue = candidate.match_status && candidate.match_status !== "refusé" ? "Oui" : "Non";

    row.innerHTML = `
      <td>${candidate.candidate_name || "-"}</td>
      <td>${formatApartmentLabel(candidate.apartment_ref)}</td>
      <td>${candidate.match_score ?? "-"}</td>
      <td>${matchValue}</td>
      <td>${candidate.status || "-"}</td>
      <td><button type="button" class="secondary-btn candidate-details-btn" data-id="${candidate.id}">Voir</button></td>
    `;

    candidatesBody.appendChild(row);
  });

  document.querySelectorAll(".candidate-details-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const candidate = state.candidates.find((item) => item.id === button.dataset.id);
      if (candidate) {
        openCandidateModal(candidate);
      }
    });
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
    ["Revenu", candidate.monthly_income || "-"],
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

supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.href = `/login.html?next=${encodeURIComponent("/client.html")}`;
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
    await requireLogin();
    await loadClientData();
    clientShell.classList.remove("client-shell-hidden");
    switchTab("dashboard");
  } catch (error) {
    if (state.currentUser) {
      handleClientRouteFailure(error);
      return;
    }

    document.body.innerHTML = `
      <div style="font-family: Inter, Arial, sans-serif; padding: 40px; max-width: 900px; margin: 0 auto;">
        <h1 style="margin-bottom: 12px;">Accès client bloqué</h1>
        <div style="padding:16px 18px;border-radius:14px;background:#fee2e2;color:#991b1b;font-weight:700;">
          ${error.message || "Erreur client inconnue."}
        </div>
      </div>
    `;
  }
})();
