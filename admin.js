const SUPABASE_URL = "https://nuuzkvgyolxbawvqyugu.supabase.co";
const SUPABASE_KEY = "sb_publishable_103-rw3MwM7k2xUeMMUodg_fRr9vUD4";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const tabs = {
  users: document.getElementById("usersTab"),
  sessions: document.getElementById("sessionsTab"),
  messages: document.getElementById("messagesTab"),
  apartments: document.getElementById("apartmentsTab"),
  candidates: document.getElementById("candidatesTab")
};

const pageTitle = document.getElementById("pageTitle");
const refreshBtn = document.getElementById("refreshBtn");
const usersBody = document.getElementById("usersBody");
const sessionsBody = document.getElementById("sessionsBody");
const messagesBody = document.getElementById("messagesBody");
const apartmentsBody = document.getElementById("apartmentsBody");
const candidatesBody = document.getElementById("candidatesBody");

const messageUserId = document.getElementById("messageUserId");
const loadMessagesBtn = document.getElementById("loadMessagesBtn");

const apartmentForm = document.getElementById("apartmentForm");
const apartmentFormStatus = document.getElementById("apartmentFormStatus");
const apartmentFormTitle = document.getElementById("apartmentFormTitle");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const editingRefBadge = document.getElementById("editingRefBadge");
const submitApartmentBtn = document.getElementById("submitApartmentBtn");
const editingApartmentRefInput = document.getElementById("editingApartmentRef");

const apartmentSearch = document.getElementById("apartmentSearch");
const apartmentCityFilter = document.getElementById("apartmentCityFilter");
const apartmentDisponibiliteFilter = document.getElementById("apartmentDisponibiliteFilter");
const clearApartmentFiltersBtn = document.getElementById("clearApartmentFiltersBtn");

const candidateStatusFilter = document.getElementById("candidateStatusFilter");
const candidateSearch = document.getElementById("candidateSearch");
const clearCandidateFiltersBtn = document.getElementById("clearCandidateFiltersBtn");

let currentTab = "users";
let allApartments = [];
let allCandidates = [];
let lastPendingCandidatesCount = 0;

function showFatalError(message) {
  document.body.innerHTML = `
    <div style="font-family: Inter, Arial, sans-serif; padding: 40px; max-width: 900px; margin: 0 auto;">
      <h1 style="margin-bottom: 12px;">Accès admin bloqué</h1>
      <div style="padding:16px 18px;border-radius:14px;background:#fee2e2;color:#991b1b;font-weight:700;">
        ${message}
      </div>
    </div>
  `;
}

async function requireAdmin() {
  const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();

  if (sessionError) {
    throw new Error("Session error: " + sessionError.message);
  }

  if (!sessionData?.session) {
    window.location.href = "/login.html";
    throw new Error("No active session. You must log in first.");
  }

  const userId = sessionData.session.user.id;

  const { data: adminRow, error: adminError } = await supabaseClient
    .from("admin_users")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (adminError) {
    throw new Error("Erreur lecture admin_users: " + adminError.message);
  }

  if (!adminRow) {
    throw new Error(`Votre compte est connecté, mais n'existe pas dans admin_users. UUID actuel: ${userId}`);
  }

  return sessionData.session.user;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-CA");
}

function parseOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Erreur");
  }

  return data;
}

function switchTab(tabName) {
  currentTab = tabName;

  Object.entries(tabs).forEach(([key, el]) => {
    if (!el) return;
    el.classList.toggle("hidden", key !== tabName);
  });

  document.querySelectorAll(".menu-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  const titles = {
    users: "Utilisateurs",
    sessions: "Sessions",
    messages: "Conversations",
    apartments: "Appartements",
    candidates: "Candidats"
  };

  pageTitle.textContent = titles[tabName] || "Admin";
}

async function loadUsers() {
  const today = new Date().toISOString().split("T")[0];
  const data = await fetchJSON(`/api/admin/user-daily-time?day=${today}`);

  usersBody.innerHTML = "";
  const rows = data.summary || [];

  if (!rows.length) {
    usersBody.innerHTML = `<tr><td colspan="5">Aucune donnée aujourd’hui.</td></tr>`;
    return;
  }

  for (const row of rows) {
    const minutes = (row.total_seconds || 0) / 60;
    const hours = (row.total_seconds || 0) / 3600;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.full_name || row.user_id || "-"}</td>
      <td>${row.day || "-"}</td>
      <td>${row.heartbeat_count ?? 0}</td>
      <td>${minutes.toFixed(2)} min</td>
      <td>${hours.toFixed(2)} h</td>
    `;
    usersBody.appendChild(tr);
  }
}

async function loadSessions() {
  const data = await fetchJSON("/api/admin/chat-sessions");
  sessionsBody.innerHTML = "";

  for (const row of data.sessions || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.id || "-"}</td>
      <td>${row.user_id || "-"}</td>
      <td>${formatDate(row.started_at)}</td>
      <td>${formatDate(row.ended_at)}</td>
      <td>${formatDate(row.last_seen_at)}</td>
    `;
    sessionsBody.appendChild(tr);
  }
}

async function loadMessages() {
  let url = "/api/admin/chat-messages";
  const userId = messageUserId?.value?.trim() || "";

  if (userId) {
    url += `?user_id=${encodeURIComponent(userId)}`;
  }

  const data = await fetchJSON(url);
  messagesBody.innerHTML = "";

  for (const row of data.messages || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(row.created_at)}</td>
      <td>${row.user_id || "-"}</td>
      <td>${row.mode || "-"}</td>
      <td>${row.sender || "-"}</td>
      <td>${row.text || ""}</td>
    `;
    messagesBody.appendChild(tr);
  }
}

function resetApartmentForm() {
  if (!editingApartmentRefInput) return;

  editingApartmentRefInput.value = "";
  apartmentForm.reset();
  apartmentFormTitle.textContent = "Ajouter un appartement";
  submitApartmentBtn.textContent = "Ajouter l’appartement";
  cancelEditBtn.style.display = "none";
  editingRefBadge.style.display = "none";
  editingRefBadge.textContent = "";
}

function fillApartmentForm(row) {
  editingApartmentRefInput.value = row.ref || "";

  document.getElementById("aptAdresse").value = row.adresse || "";
  document.getElementById("aptVille").value = row.ville || "";
  document.getElementById("aptType").value = row.type_logement || "";
  document.getElementById("aptChambres").value =
    row.chambres === null || row.chambres === undefined ? "" : String(row.chambres);
  document.getElementById("aptSuperficie").value = row.superficie || "";
  document.getElementById("aptLoyer").value =
    row.loyer === null || row.loyer === undefined ? "" : String(row.loyer);
  document.getElementById("aptInclusions").value = row.inclusions || "";
  document.getElementById("aptStatut").value = row.statut || "";
  document.getElementById("aptElectricite").value = row.electricite || "";
  document.getElementById("aptLaveuseSecheuse").value = row.laveuse_secheuse || "";
  document.getElementById("aptElectrosInclus").value = row.electros_inclus || "";
  document.getElementById("aptRangement").value = row.rangement || "";
  document.getElementById("aptBalcon").value = row.balcon || "";
  document.getElementById("aptWifi").value = row.wifi || "";
  document.getElementById("aptAccesTerrain").value = row.acces_au_terrain || "";
  document.getElementById("aptStationnementsGratuits").value =
    row.nombre_stationnements_gratuits === null || row.nombre_stationnements_gratuits === undefined
      ? ""
      : String(row.nombre_stationnements_gratuits);
  document.getElementById("aptStationnementsPayants").value =
    row.nombre_stationnements_payants === null || row.nombre_stationnements_payants === undefined
      ? ""
      : String(row.nombre_stationnements_payants);
  document.getElementById("aptPrixStationnementPayant").value =
    row.prix_stationnement_payant === null || row.prix_stationnement_payant === undefined
      ? ""
      : String(row.prix_stationnement_payant);
  document.getElementById("aptNombreLogementsBatiment").value =
    row.nombre_logements_batisse === null || row.nombre_logements_batisse === undefined
      ? ""
      : String(row.nombre_logements_batisse);
  document.getElementById("aptAnimaux").value = row.animaux_acceptes || "";
  document.getElementById("aptMeuble").value = row.meuble || "";
  document.getElementById("aptDisponibilite").value = row.disponibilite || "";
  document.getElementById("aptNotes").value = row.notes || "";

  apartmentFormTitle.textContent = "Modifier un appartement";
  submitApartmentBtn.textContent = "Sauvegarder les modifications";
  cancelEditBtn.style.display = "inline-flex";
  editingRefBadge.style.display = "inline-flex";
  editingRefBadge.textContent = `Modification : L-${row.ref}`;
  apartmentFormStatus.textContent = "";
  apartmentFormStatus.style.color = "";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function populateCityFilter(rows) {
  if (!apartmentCityFilter) return;

  const currentValue = apartmentCityFilter.value;
  const cities = [...new Set(rows.map((r) => (r.ville || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );

  apartmentCityFilter.innerHTML = `<option value="">Toutes les villes</option>`;
  cities.forEach((city) => {
    const option = document.createElement("option");
    option.value = city;
    option.textContent = city;
    apartmentCityFilter.appendChild(option);
  });

  if (cities.includes(currentValue)) {
    apartmentCityFilter.value = currentValue;
  }
}

function getFilteredApartments() {
  const search = (apartmentSearch?.value || "").trim().toLowerCase();
  const city = apartmentCityFilter?.value || "";
  const dispo = apartmentDisponibiliteFilter?.value || "";

  return allApartments.filter((row) => {
    const matchesCity = !city || (row.ville || "") === city;
    const matchesDispo = !dispo || (row.disponibilite || "") === dispo;

    const blob = [
      row.ref,
      row.adresse,
      row.ville,
      row.type_logement,
      row.chambres,
      row.superficie,
      row.loyer,
      row.inclusions,
      row.laveuse_secheuse,
      row.electros_inclus,
      row.balcon,
      row.wifi,
      row.acces_au_terrain,
      row.nombre_stationnements_gratuits,
      row.nombre_stationnements_payants,
      row.prix_stationnement_payant,
      row.nombre_logements_batisse,
      row.rangement,
      row.animaux_acceptes,
      row.meuble,
      row.electricite,
      row.disponibilite,
      row.statut,
      row.notes
    ]
      .join(" ")
      .toLowerCase();

    const matchesSearch = !search || blob.includes(search);

    return matchesCity && matchesDispo && matchesSearch;
  });
}

function renderApartmentsTable(rows) {
  apartmentsBody.innerHTML = "";

  if (!rows.length) {
    apartmentsBody.innerHTML = `<tr><td colspan="24">Aucun appartement trouvé.</td></tr>`;
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>L-${row.ref || "-"}</td>
      <td>${row.adresse || "-"}</td>
      <td>${row.ville || "-"}</td>
      <td>${row.type_logement || "-"}</td>
      <td>${row.chambres ?? "-"}</td>
      <td>${row.superficie || "-"}</td>
      <td>${row.loyer ?? "-"}</td>
      <td>${row.inclusions || "-"}</td>
      <td>${row.electricite || "-"}</td>
      <td>${row.laveuse_secheuse || "-"}</td>
      <td>${row.electros_inclus || "-"}</td>
      <td>${row.balcon || "-"}</td>
      <td>${row.wifi || "-"}</td>
      <td>${row.acces_au_terrain || "-"}</td>
      <td>${row.nombre_stationnements_gratuits ?? "-"}</td>
      <td>${row.nombre_stationnements_payants ?? "-"}</td>
      <td>${row.prix_stationnement_payant ?? "-"}</td>
      <td>${row.nombre_logements_batisse ?? "-"}</td>
      <td>${row.rangement || "-"}</td>
      <td>${row.animaux_acceptes || "-"}</td>
      <td>${row.meuble || "-"}</td>
      <td>${row.disponibilite || "-"}</td>
      <td>${row.statut || "-"}</td>
      <td>${row.notes || "-"}</td>
      <td style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="secondary-btn edit-apartment-btn" data-ref="${row.ref}">Modifier</button>
        <button type="button" class="secondary-btn delete-apartment-btn" data-ref="${row.ref}" style="background:#fee2e2;color:#991b1b;">Supprimer</button>
      </td>
    `;

    apartmentsBody.appendChild(tr);
  });

  document.querySelectorAll(".edit-apartment-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ref = String(btn.dataset.ref);
      const listing = allApartments.find((r) => String(r.ref) === ref);
      if (listing) fillApartmentForm(listing);
    });
  });

  document.querySelectorAll(".delete-apartment-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ref = String(btn.dataset.ref);
      const confirmDelete = window.confirm(`Supprimer définitivement L-${ref} ?`);
      if (!confirmDelete) return;

      try {
        await fetchJSON(`/api/admin/apartments/L-${ref}`, { method: "DELETE" });

        if (editingApartmentRefInput.value === ref) {
          resetApartmentForm();
        }

        apartmentFormStatus.textContent = `Appartement L-${ref} supprimé avec succès.`;
        apartmentFormStatus.style.color = "green";

        await loadApartments();
      } catch (error) {
        apartmentFormStatus.textContent = error.message || "Erreur suppression appartement.";
        apartmentFormStatus.style.color = "red";
      }
    });
  });
}

function applyApartmentFilters() {
  renderApartmentsTable(getFilteredApartments());
}

async function loadApartments() {
  const data = await fetchJSON("/api/listings");
  allApartments = Object.values(data.listings || {}).sort((a, b) => Number(a.ref) - Number(b.ref));
  populateCityFilter(allApartments);
  applyApartmentFilters();
}

async function createOrUpdateApartment(event) {
  event.preventDefault();

  apartmentFormStatus.textContent = "";
  apartmentFormStatus.style.color = "";

  const editingRef = editingApartmentRefInput.value.trim();

  const payload = {
    adresse: document.getElementById("aptAdresse").value.trim(),
    ville: document.getElementById("aptVille").value.trim(),
    type_logement: document.getElementById("aptType").value,
    chambres: document.getElementById("aptChambres").value,
    superficie: document.getElementById("aptSuperficie").value.trim(),
    loyer: document.getElementById("aptLoyer").value,
    inclusions: document.getElementById("aptInclusions").value,
    statut: document.getElementById("aptStatut").value,
    electricite: document.getElementById("aptElectricite").value,
    laveuse_secheuse: document.getElementById("aptLaveuseSecheuse").value,
    electros_inclus: document.getElementById("aptElectrosInclus").value,
    balcon: document.getElementById("aptBalcon").value,
    wifi: document.getElementById("aptWifi").value,
    acces_au_terrain: document.getElementById("aptAccesTerrain").value,
    nombre_stationnements_gratuits: parseOptionalNumber(document.getElementById("aptStationnementsGratuits").value),
    nombre_stationnements_payants: parseOptionalNumber(document.getElementById("aptStationnementsPayants").value),
    prix_stationnement_payant: parseOptionalNumber(document.getElementById("aptPrixStationnementPayant").value),
    nombre_logements_batisse: parseOptionalNumber(document.getElementById("aptNombreLogementsBatiment").value),
    rangement: document.getElementById("aptRangement").value,
    animaux_acceptes: document.getElementById("aptAnimaux").value,
    meuble: document.getElementById("aptMeuble").value,
    disponibilite: document.getElementById("aptDisponibilite").value,
    notes: document.getElementById("aptNotes").value.trim()
  };

  try {
    if (editingRef) {
      await fetchJSON(`/api/admin/apartments/L-${editingRef}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });

      apartmentFormStatus.textContent = `Appartement L-${editingRef} modifié avec succès.`;
      apartmentFormStatus.style.color = "green";
    } else {
      const result = await fetchJSON("/api/admin/apartments", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      apartmentFormStatus.textContent = `Appartement ajouté avec succès. Référence générée : ${result.generated_ref}`;
      apartmentFormStatus.style.color = "green";
    }

    resetApartmentForm();
    await loadApartments();
  } catch (error) {
    apartmentFormStatus.textContent = error.message || "Erreur lors de l’opération.";
    apartmentFormStatus.style.color = "red";
  }
}

function getFilteredCandidates() {
  const status = candidateStatusFilter?.value || "";
  const search = (candidateSearch?.value || "").trim().toLowerCase();

  return allCandidates.filter((candidate) => {
    const matchesStatus = !status || candidate.status === status;

    const blob = [
      candidate.apartment_ref,
      candidate.candidate_name,
      candidate.phone,
      candidate.email,
      candidate.job_title,
      candidate.employer_name,
      candidate.employment_length,
      candidate.employment_status,
      candidate.monthly_income,
      candidate.credit_level,
      candidate.tal_record,
      candidate.occupants_total,
      candidate.pets,
      candidate.employee_notes,
      candidate.admin_notes,
      candidate.status
    ]
      .join(" ")
      .toLowerCase();

    const matchesSearch = !search || blob.includes(search);

    return matchesStatus && matchesSearch;
  });
}

async function updateCandidateStatus(id, status) {
  await fetchJSON(`/api/admin/candidates/${id}`, {
    method: "PUT",
    body: JSON.stringify({ status })
  });

  await loadCandidates();
}

function renderCandidatesTable(rows) {
  if (!candidatesBody) return;

  candidatesBody.innerHTML = "";

  if (!rows.length) {
    candidatesBody.innerHTML = `<tr><td colspan="17">Aucun candidat trouvé.</td></tr>`;
    return;
  }

  rows.forEach((candidate) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>L-${candidate.apartment_ref || "-"}</td>
      <td>${candidate.candidate_name || "-"}</td>
      <td>${candidate.phone || "-"}</td>
      <td>${candidate.email || "-"}</td>
      <td>${candidate.job_title || "-"}</td>
      <td>${candidate.employer_name || "-"}</td>
      <td>${candidate.employment_length || "-"}</td>
      <td>${candidate.employment_status || "-"}</td>
      <td>${candidate.monthly_income || "-"}</td>
      <td>${candidate.credit_level || "-"}</td>
      <td>${candidate.tal_record || "-"}</td>
      <td>${candidate.occupants_total || "-"}</td>
      <td>${candidate.pets || "-"}</td>
      <td>${candidate.employee_notes || "-"}</td>
      <td>${candidate.admin_notes || "-"}</td>
      <td>${candidate.status || "-"}</td>
      <td style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="secondary-btn approve-candidate-btn" data-id="${candidate.id}" style="background:#dcfce7;color:#166534;">Approuver</button>
        <button type="button" class="secondary-btn reject-candidate-btn" data-id="${candidate.id}" style="background:#fee2e2;color:#991b1b;">Refuser</button>
      </td>
    `;

    candidatesBody.appendChild(tr);
  });

  document.querySelectorAll(".approve-candidate-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await updateCandidateStatus(btn.dataset.id, "approuvé");
    });
  });

  document.querySelectorAll(".reject-candidate-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await updateCandidateStatus(btn.dataset.id, "refusé");
    });
  });
}

function applyCandidateFilters() {
  renderCandidatesTable(getFilteredCandidates());
}

async function loadCandidates() {
  const data = await fetchJSON("/api/admin/candidates");
  allCandidates = data.candidates || [];
  applyCandidateFilters();
}

async function checkNewCandidates() {
  try {
    const data = await fetchJSON("/api/admin/candidates?status=en attente");
    const pendingCount = (data.candidates || []).length;

    if (lastPendingCandidatesCount !== 0 && pendingCount > lastPendingCandidatesCount) {
      alert("Nouveau candidat reçu");
    }

    lastPendingCandidatesCount = pendingCount;
  } catch (error) {
    console.error("Erreur notification candidats:", error);
  }
}

async function refreshCurrentTab() {
  if (currentTab === "users") await loadUsers();
  if (currentTab === "sessions") await loadSessions();
  if (currentTab === "messages") await loadMessages();
  if (currentTab === "apartments") await loadApartments();
  if (currentTab === "candidates") await loadCandidates();
}

document.querySelectorAll(".menu-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    switchTab(btn.dataset.tab);
    await refreshCurrentTab();
  });
});

if (refreshBtn) {
  refreshBtn.addEventListener("click", refreshCurrentTab);
}

if (loadMessagesBtn) {
  loadMessagesBtn.addEventListener("click", loadMessages);
}

if (apartmentForm) {
  apartmentForm.addEventListener("submit", createOrUpdateApartment);
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", resetApartmentForm);
}

if (apartmentSearch) {
  apartmentSearch.addEventListener("input", applyApartmentFilters);
}

if (apartmentCityFilter) {
  apartmentCityFilter.addEventListener("change", applyApartmentFilters);
}

if (apartmentDisponibiliteFilter) {
  apartmentDisponibiliteFilter.addEventListener("change", applyApartmentFilters);
}

if (clearApartmentFiltersBtn) {
  clearApartmentFiltersBtn.addEventListener("click", () => {
    apartmentSearch.value = "";
    apartmentCityFilter.value = "";
    apartmentDisponibiliteFilter.value = "";
    applyApartmentFilters();
  });
}

if (candidateStatusFilter) {
  candidateStatusFilter.addEventListener("change", applyCandidateFilters);
}

if (candidateSearch) {
  candidateSearch.addEventListener("input", applyCandidateFilters);
}

if (clearCandidateFiltersBtn) {
  clearCandidateFiltersBtn.addEventListener("click", () => {
    candidateStatusFilter.value = "";
    candidateSearch.value = "";
    applyCandidateFilters();
  });
}

supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.href = "/login.html";
  }
});

(async function init() {
  try {
    await requireAdmin();
    switchTab("users");
    await loadUsers();
    await checkNewCandidates();
    setInterval(checkNewCandidates, 10000);
  } catch (error) {
    console.error("ADMIN INIT ERROR:", error);
    showFatalError(error.message || "Erreur admin inconnue.");
  }
})();
