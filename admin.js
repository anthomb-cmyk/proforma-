const SUPABASE_URL = "https://nuuzkvgyolxbawvqyugu.supabase.co";
const SUPABASE_KEY = "sb_publishable_103-rw3MwM7k2xUeMMUodg_fRr9vUD4";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const tabs = {
  users: document.getElementById("usersTab"),
  sessions: document.getElementById("sessionsTab"),
  messages: document.getElementById("messagesTab"),
  clients: document.getElementById("clientsTab"),
  apartments: document.getElementById("apartmentsTab"),
  candidates: document.getElementById("candidatesTab")
};

const pageTitle = document.getElementById("pageTitle");
const refreshBtn = document.getElementById("refreshBtn");
const usersBody = document.getElementById("usersBody");
const sessionsBody = document.getElementById("sessionsBody");
const messagesBody = document.getElementById("messagesBody");
const clientsBody = document.getElementById("clientsBody");
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

const clientForm = document.getElementById("clientForm");
const clientFormStatus = document.getElementById("clientFormStatus");
const clientFormTitle = document.getElementById("clientFormTitle");
const editingClientIdInput = document.getElementById("editingClientId");
const editingClientBadge = document.getElementById("editingClientBadge");
const cancelClientEditBtn = document.getElementById("cancelClientEditBtn");
const submitClientBtn = document.getElementById("submitClientBtn");
const openInviteClientBtn = document.getElementById("openInviteClientBtn");

const candidateStatusFilter = document.getElementById("candidateStatusFilter");
const candidateSearch = document.getElementById("candidateSearch");
const clearCandidateFiltersBtn = document.getElementById("clearCandidateFiltersBtn");

let currentTab = "users";
let allApartments = [];
let allCandidates = [];
let lastPendingCandidatesCount = 0;
let allClients = [];

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

async function waitForActiveSession(maxAttempts = 10, delayMs = 150) {
  for (let index = 0; index < maxAttempts; index += 1) {
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    if (sessionData?.session) {
      return sessionData.session;
    }

    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
  }

  return null;
}

async function requireAdmin() {
  const session = await waitForActiveSession();

  if (!session) {
    window.location.href = `/login.html?next=${encodeURIComponent("/admin.html")}`;
    throw new Error("No active session. You must log in first.");
  }

  const userId = session.user.id;

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

  return session.user;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-CA");
}

function clientLabel(clientId) {
  if (!clientId) return "-";
  const client = allClients.find((item) => item.id === clientId);
  return client?.nom || clientId;
}

function clientBooleanToSelectValue(value) {
  return value === true ? "oui" : value === false ? "non" : "";
}

function formatClientCreditLabel(value) {
  if (value === "bas") return "Bas (0–599)";
  if (value === "moyen") return "Moyen (600–699)";
  if (value === "haut") return "Haut (700+)";
  return value || "-";
}

function clientSelectValueToBoolean(value) {
  if (value === "oui") return true;
  if (value === "non") return false;
  return null;
}

function parseCommaSeparatedList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatMatchStatus(value) {
  if (value === "accepté") return "Accepté";
  if (value === "à revoir") return "À revoir";
  if (value === "refusé") return "Refusé";
  return "-";
}

function matchStatusClass(value) {
  if (value === "accepté") return "match-badge accepted";
  if (value === "à revoir") return "match-badge review";
  if (value === "refusé") return "match-badge refused";
  return "";
}

function populateClientSelect(selectedValue = "") {
  const clientSelect = document.getElementById("aptClientId");
  if (!clientSelect) return;

  clientSelect.innerHTML = `<option value="">Aucun client lié</option>`;

  allClients.forEach((client) => {
    const option = document.createElement("option");
    option.value = client.id;
    option.textContent = client.nom || client.id;
    clientSelect.appendChild(option);
  });

  clientSelect.value = selectedValue;
}

async function reloadClients() {
  const clientsData = await fetchJSON("/api/admin/clients");
  allClients = clientsData.clients || [];
  return allClients;
}

async function loadListingsCollection() {
  const listingsData = await fetchJSON("/api/listings");
  allApartments = Object.values(listingsData.listings || {}).sort((a, b) => Number(a.ref) - Number(b.ref));
  return allApartments;
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
    clients: "Clients",
    apartments: "Appartements",
    candidates: "Candidats"
  };

  pageTitle.textContent = titles[tabName] || "Admin";
}

async function loadUsers() {
  const data = await fetchJSON("/api/admin/users");

  usersBody.innerHTML = "";
  const rows = data.users || [];

  if (!rows.length) {
    usersBody.innerHTML = `<tr><td colspan="5">Aucun utilisateur trouvé.</td></tr>`;
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    const activityLabel = row.today_total_seconds
      ? `${(row.today_total_seconds / 60).toFixed(1)} min · ${row.today_heartbeat_count ?? 0} heartbeat(s)`
      : "Aucune activité aujourd’hui";
    tr.innerHTML = `
      <td>${row.full_name || row.email || row.user_id || "-"}</td>
      <td>${row.email || "-"}</td>
      <td>${row.is_deactivated ? "Désactivé" : "Actif"}</td>
      <td>${formatDate(row.created_at)}</td>
      <td>${activityLabel}</td>
      <td style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="secondary-btn deactivate-user-btn" data-id="${row.user_id}" data-email="${row.email || ""}" ${row.is_deactivated ? "disabled" : ""}>
          Désactiver
        </button>
        <button type="button" class="secondary-btn delete-user-btn" data-id="${row.user_id}" data-email="${row.email || ""}" style="background:#fee2e2;color:#991b1b;">
          Supprimer définitivement
        </button>
      </td>
    `;
    usersBody.appendChild(tr);
  }

  document.querySelectorAll(".deactivate-user-btn").forEach((button) => {
    button.addEventListener("click", () => {
      openUserActionModal({
        action: "deactivate",
        userId: button.dataset.id,
        email: button.dataset.email
      });
    });
  });

  document.querySelectorAll(".delete-user-btn").forEach((button) => {
    button.addEventListener("click", () => {
      openUserActionModal({
        action: "delete",
        userId: button.dataset.id,
        email: button.dataset.email
      });
    });
  });
}

function openUserActionModal({ action, userId, email }) {
  const existingModal = document.getElementById("userActionModal");
  if (existingModal) {
    existingModal.remove();
  }

  const isDelete = action === "delete";
  const modal = document.createElement("div");
  modal.id = "userActionModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
  modal.innerHTML = `
    <div style="width:min(560px,100%);max-height:85vh;overflow:auto;background:#fff;border-radius:24px;padding:24px;box-shadow:0 24px 60px rgba(15,23,42,.22);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px;">
        <div>
          <div style="font-size:.85rem;font-weight:800;color:${isDelete ? "#991b1b" : "#1e90ff"};text-transform:uppercase;letter-spacing:.05em;">
            ${isDelete ? "Suppression permanente" : "Désactivation utilisateur"}
          </div>
          <h3 style="margin:6px 0 0;color:#191d45;">${isDelete ? "Confirmer la suppression" : "Confirmer la désactivation"}</h3>
          <div style="margin-top:8px;color:#6b7280;">${email || userId}</div>
        </div>
        <button type="button" id="closeUserActionModal" class="secondary-btn">Fermer</button>
      </div>
      <div style="display:grid;gap:14px;">
        <div style="padding:14px 16px;border-radius:16px;background:${isDelete ? "#fff1f2" : "#eff6ff"};color:${isDelete ? "#9f1239" : "#1d4ed8"};">
          ${isDelete
            ? "Cette action supprime définitivement l’accès Supabase de cet utilisateur. Les données métier liées seront conservées."
            : "Cette action bloque les futures connexions de cet utilisateur sans supprimer ses données métier."}
        </div>
        ${isDelete ? `
          <label style="display:grid;gap:8px;font-weight:700;">
            Tapez SUPPRIMER pour confirmer
            <input id="deleteUserConfirmInput" type="text" placeholder="SUPPRIMER" style="border:1px solid rgba(79,70,229,.14);border-radius:14px;padding:12px 14px;font:inherit;" />
          </label>
        ` : ""}
        <div id="userActionStatus" style="font-weight:700;"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
          <button type="button" id="confirmUserActionBtn" class="primary-btn" style="${isDelete ? "background:#991b1b;" : ""}">
            ${isDelete ? "Supprimer définitivement" : "Désactiver l’utilisateur"}
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
  document.getElementById("closeUserActionModal")?.addEventListener("click", closeModal);

  document.getElementById("confirmUserActionBtn")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("userActionStatus");
    const confirmInput = document.getElementById("deleteUserConfirmInput");
    const confirmBtn = document.getElementById("confirmUserActionBtn");

    if (isDelete && String(confirmInput?.value || "").trim() !== "SUPPRIMER") {
      statusEl.textContent = "Tapez SUPPRIMER pour confirmer la suppression permanente.";
      statusEl.style.color = "#991b1b";
      return;
    }

    confirmBtn.disabled = true;
    statusEl.textContent = "";

    try {
      if (isDelete) {
        await fetchJSON(`/api/admin/users/${encodeURIComponent(userId)}`, {
          method: "DELETE"
        });
      } else {
        await fetchJSON(`/api/admin/users/${encodeURIComponent(userId)}/deactivate`, {
          method: "POST"
        });
      }

      closeModal();
      await loadUsers();
    } catch (error) {
      statusEl.textContent = error.message || "Impossible de traiter cette action.";
      statusEl.style.color = "#991b1b";
      confirmBtn.disabled = false;
    }
  });
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

function resetClientForm() {
  if (!clientForm) return;

  clientForm.reset();
  if (editingClientIdInput) editingClientIdInput.value = "";
  clientFormTitle.textContent = "Créer un client manuellement (option avancée)";
  submitClientBtn.textContent = "Ajouter le client";
  cancelClientEditBtn.style.display = "none";
  editingClientBadge.style.display = "none";
  editingClientBadge.textContent = "";
  clientFormStatus.textContent = "";
  clientFormStatus.style.color = "";
}

function openInviteClientModal() {
  const existingModal = document.getElementById("inviteClientModal");
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement("div");
  modal.id = "inviteClientModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
  modal.innerHTML = `
    <div style="width:min(640px,100%);max-height:85vh;overflow:auto;background:#fff;border-radius:24px;padding:24px;box-shadow:0 24px 60px rgba(15,23,42,.22);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px;">
        <div>
          <div style="font-size:.85rem;font-weight:800;color:#1e90ff;text-transform:uppercase;letter-spacing:.05em;">Invitation client</div>
          <h3 style="margin:6px 0 0;color:#191d45;">Créer un lien d’onboarding</h3>
        </div>
        <button type="button" id="closeInviteClientModal" class="secondary-btn">Fermer</button>
      </div>

      <form id="inviteClientForm" class="admin-form">
        <div class="form-grid">
          <input id="inviteName" type="text" placeholder="Nom" required />
          <input id="inviteEmail" type="email" placeholder="Courriel" required />
          <input id="invitePhone" type="text" placeholder="Téléphone (optionnel)" />
          <input id="inviteMainCity" type="text" placeholder="Ville principale (optionnel)" />
        </div>

        <div class="form-actions">
          <button type="submit" id="submitInviteClientBtn" class="primary-btn">Générer le lien</button>
        </div>
      </form>

      <div id="inviteClientStatus" style="margin-top:14px;font-weight:700;"></div>
      <div id="inviteClientLinkWrap" style="display:none;margin-top:14px;">
        <div style="font-size:.9rem;color:#6b7280;margin-bottom:8px;">Lien unique valable 7 jours</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input id="inviteClientLink" type="text" readonly style="flex:1 1 360px;border:1px solid rgba(79,70,229,.14);border-radius:14px;padding:12px 14px;font:inherit;" />
          <button type="button" id="copyInviteClientLinkBtn" class="secondary-btn">Copy link</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
  document.getElementById("closeInviteClientModal")?.addEventListener("click", closeModal);
  document.getElementById("copyInviteClientLinkBtn")?.addEventListener("click", async () => {
    const linkInput = document.getElementById("inviteClientLink");
    const statusEl = document.getElementById("inviteClientStatus");

    if (!linkInput?.value) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(linkInput.value);
      } else {
        linkInput.select();
        document.execCommand("copy");
      }
      statusEl.textContent = "Lien copié.";
      statusEl.style.color = "#166534";
    } catch {
      statusEl.textContent = "Impossible de copier le lien.";
      statusEl.style.color = "#991b1b";
    }
  });

  document.getElementById("inviteClientForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitBtn = document.getElementById("submitInviteClientBtn");
    const statusEl = document.getElementById("inviteClientStatus");
    const linkWrap = document.getElementById("inviteClientLinkWrap");
    const linkInput = document.getElementById("inviteClientLink");

    submitBtn.disabled = true;
    submitBtn.textContent = "Création...";
    statusEl.textContent = "";
    linkWrap.style.display = "none";

    try {
      const result = await fetchJSON("/api/admin/client-invitations", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("inviteName").value.trim(),
          email: document.getElementById("inviteEmail").value.trim(),
          phone: document.getElementById("invitePhone").value.trim(),
          main_city: document.getElementById("inviteMainCity").value.trim()
        })
      });

      statusEl.textContent = "Invitation créée avec succès.";
      statusEl.style.color = "#166534";
      linkInput.value = result.onboarding_link || "";
      linkWrap.style.display = "block";
      linkInput.select();
      if (!result.invitation_email_sent) {
        statusEl.textContent = result.invitation_email_error
          ? `Invitation créée. Envoi email non configuré: ${result.invitation_email_error}.`
          : "Invitation créée. Envoi email non configuré.";
        statusEl.style.color = "#b45309";
      }
    } catch (error) {
      statusEl.textContent = error.message || "Impossible de créer l’invitation.";
      statusEl.style.color = "#991b1b";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Générer le lien";
    }
  });
}

function fillClientForm(client) {
  if (!clientForm) return;

  const criteria = client.criteres || {};

  editingClientIdInput.value = client.id || "";
  document.getElementById("clientNom").value = client.nom || "";
  document.getElementById("clientRevenuMinimum").value =
    criteria.revenu_minimum === null || criteria.revenu_minimum === undefined ? "" : String(criteria.revenu_minimum);
  document.getElementById("clientCreditMin").value = criteria.credit_min || "";
  document.getElementById("clientAccepteTal").value = clientBooleanToSelectValue(criteria.accepte_tal);
  document.getElementById("clientMaxOccupants").value =
    criteria.max_occupants === null || criteria.max_occupants === undefined ? "" : String(criteria.max_occupants);
  document.getElementById("clientAnimauxAcceptes").value = clientBooleanToSelectValue(criteria.animaux_acceptes);
  document.getElementById("clientEmploisAcceptes").value = Array.isArray(criteria.emplois_acceptes)
    ? criteria.emplois_acceptes.join(", ")
    : "";
  document.getElementById("clientAncienneteMinMois").value =
    criteria.anciennete_min_mois === null || criteria.anciennete_min_mois === undefined
      ? ""
      : String(criteria.anciennete_min_mois);

  clientFormTitle.textContent = "Modifier un client";
  submitClientBtn.textContent = "Sauvegarder les modifications";
  cancelClientEditBtn.style.display = "inline-flex";
  editingClientBadge.style.display = "inline-flex";
  editingClientBadge.textContent = `Modification : ${client.nom || client.id}`;
  clientFormStatus.textContent = "";
  clientFormStatus.style.color = "";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function fillApartmentForm(row) {
  editingApartmentRefInput.value = row.ref || "";

  document.getElementById("aptAdresse").value = row.adresse || "";
  document.getElementById("aptVille").value = row.ville || "";
  populateClientSelect(row.client_id || "");
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

function countLinkedApartments(clientId) {
  return allApartments.filter((apartment) => apartment.client_id === clientId).length;
}

function renderClientsTable(rows) {
  if (!clientsBody) return;

  clientsBody.innerHTML = "";

  if (!rows.length) {
    clientsBody.innerHTML = `<tr><td colspan="10">Aucun client trouvé.</td></tr>`;
    return;
  }

  rows.forEach((client) => {
    const criteria = client.criteres || {};
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${client.nom || "-"}</td>
      <td>${criteria.revenu_minimum ?? "-"}</td>
      <td>${formatClientCreditLabel(criteria.credit_min)}</td>
      <td>${criteria.accepte_tal ? "Oui" : "Non"}</td>
      <td>${criteria.max_occupants ?? "-"}</td>
      <td>${criteria.animaux_acceptes ? "Oui" : "Non"}</td>
      <td>${Array.isArray(criteria.emplois_acceptes) && criteria.emplois_acceptes.length ? criteria.emplois_acceptes.join(", ") : "-"}</td>
      <td>${criteria.anciennete_min_mois ?? "-"}</td>
      <td>${countLinkedApartments(client.id)}</td>
      <td><button type="button" class="secondary-btn edit-client-btn" data-id="${client.id}">Modifier</button></td>
    `;

    clientsBody.appendChild(tr);
  });

  document.querySelectorAll(".edit-client-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const client = allClients.find((item) => item.id === btn.dataset.id);
      if (client) fillClientForm(client);
    });
  });
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
      <td>${clientLabel(row.client_id)}</td>
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

async function loadClients() {
  const [clients, apartments] = await Promise.all([
    reloadClients(),
    loadListingsCollection()
  ]);

  allClients = clients;
  allApartments = apartments;
  populateClientSelect();
  renderClientsTable(allClients);
}

async function loadApartments() {
  const [clients, apartments] = await Promise.all([
    reloadClients(),
    loadListingsCollection()
  ]);

  allClients = clients;
  allApartments = apartments;
  populateClientSelect();
  populateCityFilter(allApartments);
  applyApartmentFilters();
}

async function createOrUpdateClient(event) {
  event.preventDefault();

  if (!clientForm) return;

  clientFormStatus.textContent = "";
  clientFormStatus.style.color = "";

  const editingId = editingClientIdInput.value.trim();
  const payload = {
    nom: document.getElementById("clientNom").value.trim(),
    criteres: {
      revenu_minimum: parseOptionalNumber(document.getElementById("clientRevenuMinimum").value),
      credit_min: document.getElementById("clientCreditMin").value || null,
      accepte_tal: clientSelectValueToBoolean(document.getElementById("clientAccepteTal").value),
      max_occupants: parseOptionalNumber(document.getElementById("clientMaxOccupants").value),
      animaux_acceptes: clientSelectValueToBoolean(document.getElementById("clientAnimauxAcceptes").value),
      emplois_acceptes: parseCommaSeparatedList(document.getElementById("clientEmploisAcceptes").value),
      anciennete_min_mois: parseOptionalNumber(document.getElementById("clientAncienneteMinMois").value)
    }
  };

  try {
    if (editingId) {
      await fetchJSON(`/api/admin/clients/${encodeURIComponent(editingId)}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });

      clientFormStatus.textContent = "Client modifié avec succès.";
    } else {
      await fetchJSON("/api/admin/clients", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      clientFormStatus.textContent = "Client ajouté avec succès.";
    }

    clientFormStatus.style.color = "green";
    resetClientForm();
    await loadClients();
    applyApartmentFilters();
  } catch (error) {
    clientFormStatus.textContent = error.message || "Erreur lors de l’opération.";
    clientFormStatus.style.color = "red";
  }
}

async function createOrUpdateApartment(event) {
  event.preventDefault();

  apartmentFormStatus.textContent = "";
  apartmentFormStatus.style.color = "";

  const editingRef = editingApartmentRefInput.value.trim();

  const payload = {
    adresse: document.getElementById("aptAdresse").value.trim(),
    ville: document.getElementById("aptVille").value.trim(),
    client_id: document.getElementById("aptClientId").value || null,
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

async function evaluateCandidate(candidate) {
  if (!candidate?.id) return;
  await fetchJSON(`/api/admin/candidates/${candidate.id}`, {
    method: "PUT",
    body: JSON.stringify({
      reevaluate_match: true
    })
  });

  await loadCandidates();
}

function normalizeRef(value) {
  return String(value || "").replace(/^L-/i, "").trim();
}

async function reassignCandidateToListing(candidateId, listingRef) {
  await fetchJSON(`/api/admin/candidates/${candidateId}`, {
    method: "PUT",
    body: JSON.stringify({
      apartment_ref: Number(normalizeRef(listingRef)),
      reevaluate_match: true
    })
  });

  await loadCandidates();
}

function formatAlternativeListings(alternatives = []) {
  if (!Array.isArray(alternatives) || !alternatives.length) {
    return `<div style="color:#6b7280;">Aucune alternative compatible trouvée.</div>`;
  }

  return alternatives.map((listing) => `
    <div style="border:1px solid #e5e7eb;border-radius:14px;padding:12px 14px;background:#fff;">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
        <div>
          <div style="font-weight:800;color:#191d45;">${listing.ref}</div>
          <div>${listing.address || "-"}</div>
          <div style="color:#6b7280;">${listing.city || "-"} · client_id: ${listing.client_id || "-"}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px;">
          <div style="font-weight:800;color:#4f46e5;">Score ${listing.match_score ?? "-"}</div>
          <button type="button" class="secondary-btn reassign-candidate-btn" data-ref="${listing.ref}">Réassigner</button>
        </div>
      </div>
      <div style="margin-top:10px;color:#374151;">${Array.isArray(listing.reasons) && listing.reasons.length ? listing.reasons.join(", ") : "-"}</div>
    </div>
  `).join("");
}

function openAlternativeListingsModal(candidate) {
  const existingModal = document.getElementById("alternativeListingsModal");
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement("div");
  modal.id = "alternativeListingsModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
  modal.innerHTML = `
    <div style="width:min(780px,100%);max-height:85vh;overflow:auto;background:#fff;border-radius:24px;padding:24px;box-shadow:0 24px 60px rgba(15,23,42,.22);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px;">
        <div>
          <div style="font-size:.85rem;font-weight:800;color:#1e90ff;text-transform:uppercase;letter-spacing:.05em;">Suggestions</div>
          <h3 style="margin:6px 0 0;color:#191d45;">Autres logements compatibles</h3>
          <div style="margin-top:6px;color:#6b7280;">${candidate.candidate_name || "Candidat"} · logement initial L-${candidate.apartment_ref || "-"}</div>
        </div>
        <button type="button" id="closeAlternativeListingsModal" class="secondary-btn">Fermer</button>
      </div>
      <div style="display:grid;gap:12px;">
        ${formatAlternativeListings(candidate.alternative_listings || [])}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.getElementById("closeAlternativeListingsModal")?.addEventListener("click", closeModal);

  modal.querySelectorAll(".reassign-candidate-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Réassignation...";

      try {
        await reassignCandidateToListing(candidate.id, button.dataset.ref);
        closeModal();
      } catch (error) {
        button.disabled = false;
        button.textContent = "Réassigner";
        alert(error.message || "Impossible de réassigner le candidat.");
      }
    });
  });
}

function renderCandidatesTable(rows) {
  if (!candidatesBody) return;

  candidatesBody.innerHTML = "";

  if (!rows.length) {
    candidatesBody.innerHTML = `<tr><td colspan="20">Aucun candidat trouvé.</td></tr>`;
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
      <td>${candidate.match_status ? `<span class="${matchStatusClass(candidate.match_status)}">${formatMatchStatus(candidate.match_status)}</span>` : "-"}</td>
      <td>${candidate.match_score ?? "-"}</td>
      <td>${Array.isArray(candidate.match_reasons) && candidate.match_reasons.length ? candidate.match_reasons.join(", ") : "-"}</td>
      <td style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="secondary-btn evaluate-candidate-btn" data-id="${candidate.id}">Évaluer</button>
        <button type="button" class="secondary-btn alternatives-candidate-btn" data-id="${candidate.id}">Suggestions</button>
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

  document.querySelectorAll(".evaluate-candidate-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const candidate = allCandidates.find((item) => item.id === btn.dataset.id);
      if (candidate) {
        await evaluateCandidate(candidate);
      }
    });
  });

  document.querySelectorAll(".alternatives-candidate-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const candidate = allCandidates.find((item) => item.id === btn.dataset.id);
      if (candidate) {
        openAlternativeListingsModal(candidate);
      }
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
  const [data] = await Promise.all([
    fetchJSON("/api/admin/candidates"),
    loadListingsCollection()
  ]);
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
  if (currentTab === "clients") await loadClients();
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

if (clientForm) {
  clientForm.addEventListener("submit", createOrUpdateClient);
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", resetApartmentForm);
}

if (cancelClientEditBtn) {
  cancelClientEditBtn.addEventListener("click", resetClientForm);
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

if (openInviteClientBtn) {
  openInviteClientBtn.addEventListener("click", openInviteClientModal);
}

supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.href = `/login.html?next=${encodeURIComponent("/admin.html")}`;
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
