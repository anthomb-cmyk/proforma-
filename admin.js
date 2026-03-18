const SUPABASE_URL = "https://nuuzkvgyolxbawvqyugu.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51dXprdmd5b2x4YmF3dnF5dWd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3Njc1NzYsImV4cCI6MjA4OTM0MzU3Nn0.zjltrYd38fypIAm1DIr0wj69eS9T7xpi_4p2aWsNYyw";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const tabs = {
  users: document.getElementById("usersTab"),
  sessions: document.getElementById("sessionsTab"),
  messages: document.getElementById("messagesTab"),
  apartments: document.getElementById("apartmentsTab")
};

const pageTitle = document.getElementById("pageTitle");
const refreshBtn = document.getElementById("refreshBtn");
const usersBody = document.getElementById("usersBody");
const sessionsBody = document.getElementById("sessionsBody");
const messagesBody = document.getElementById("messagesBody");
const apartmentsBody = document.getElementById("apartmentsBody");
const messageUserId = document.getElementById("messageUserId");
const loadMessagesBtn = document.getElementById("loadMessagesBtn");

const apartmentForm = document.getElementById("apartmentForm");
const apartmentFormStatus = document.getElementById("apartmentFormStatus");

let currentTab = "users";

async function requireAdmin() {
  const { data: userData, error: userError } = await supabaseClient.auth.getUser();

  if (userError || !userData?.user) {
    window.location.href = "/login.html";
    throw new Error("Not logged in");
  }

  const userId = userData.user.id;

  const { data: adminRow, error: adminError } = await supabaseClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (adminError || !adminRow) {
    alert("Accès refusé. Vous n’êtes pas administrateur.");
    window.location.href = "/";
    throw new Error("Not admin");
  }
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-CA");
}

function formatMinutes(value) {
  return `${Number(value || 0).toFixed(2)} min`;
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
    el.classList.toggle("hidden", key !== tabName);
  });

  document.querySelectorAll(".menu-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  const titles = {
    users: "Utilisateurs",
    sessions: "Sessions",
    messages: "Conversations",
    apartments: "Appartements"
  };

  pageTitle.textContent = titles[tabName] || "Admin";
}

async function loadUsers() {
  const today = new Date().toISOString().split("T")[0];
  const data = await fetchJSON(`/api/admin/user-daily-time?day=${today}`);

  usersBody.innerHTML = "";
  const rows = data.summary || [];

  if (!rows.length) {
    usersBody.innerHTML = `
      <tr>
        <td colspan="5">Aucune donnée aujourd’hui.</td>
      </tr>
    `;
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.full_name || row.user_id || "-"}</td>
      <td>${row.day || "-"}</td>
      <td>${row.heartbeat_count ?? 0}</td>
      <td>${row.total_seconds ?? 0} s</td>
      <td>${formatMinutes(row.total_minutes)}</td>
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
      <td>${row.id}</td>
      <td>${row.user_id}</td>
      <td>${formatDate(row.started_at)}</td>
      <td>${formatDate(row.ended_at)}</td>
      <td>${formatDate(row.last_seen_at)}</td>
    `;
    sessionsBody.appendChild(tr);
  }
}

async function loadMessages() {
  let url = "/api/admin/chat-messages";
  const userId = messageUserId.value.trim();

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
      <td class="long">${row.text || ""}</td>
    `;
    messagesBody.appendChild(tr);
  }
}

async function loadApartments() {
  const data = await fetchJSON("/api/listings");
  apartmentsBody.innerHTML = "";

  Object.values(data.listings || {}).forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>L-${row.ref || "-"}</td>
      <td>${row.adresse || "-"}</td>
      <td>${row.ville || "-"}</td>
      <td>${row.type_logement || "-"}</td>
      <td>${row.loyer ?? "-"}</td>
      <td>${row.disponibilite || "-"}</td>
      <td>${row.statut || "-"}</td>
    `;
    apartmentsBody.appendChild(tr);
  });
}

async function createApartment(event) {
  event.preventDefault();

  apartmentFormStatus.textContent = "";

  const payload = {
    adresse: document.getElementById("aptAdresse").value.trim(),
    ville: document.getElementById("aptVille").value.trim(),
    type_logement: document.getElementById("aptType").value,
    chambres: document.getElementById("aptChambres").value,
    superficie: document.getElementById("aptSuperficie").value.trim(),
    loyer: document.getElementById("aptLoyer").value,
    inclusions: document.getElementById("aptInclusions").value,
    statut: document.getElementById("aptStatut").value,
    stationnement: document.getElementById("aptStationnement").value,
    animaux_acceptes: document.getElementById("aptAnimaux").value,
    meuble: document.getElementById("aptMeuble").value,
    disponibilite: document.getElementById("aptDisponibilite").value.trim(),
    notes: document.getElementById("aptNotes").value.trim(),
    electricite: document.getElementById("aptElectricite").value
  };

  try {
    const result = await fetchJSON("/api/admin/apartments", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    apartmentFormStatus.textContent = `Appartement ajouté avec succès. Référence générée : ${result.generated_ref}`;
    apartmentFormStatus.style.color = "green";

    apartmentForm.reset();
    await loadApartments();
  } catch (error) {
    apartmentFormStatus.textContent = error.message || "Erreur lors de l’ajout.";
    apartmentFormStatus.style.color = "red";
  }
}

async function refreshCurrentTab() {
  if (currentTab === "users") await loadUsers();
  if (currentTab === "sessions") await loadSessions();
  if (currentTab === "messages") await loadMessages();
  if (currentTab === "apartments") await loadApartments();
}

document.querySelectorAll(".menu-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    switchTab(btn.dataset.tab);
    await refreshCurrentTab();
  });
});

refreshBtn.addEventListener("click", refreshCurrentTab);

if (loadMessagesBtn) {
  loadMessagesBtn.addEventListener("click", loadMessages);
}

if (apartmentForm) {
  apartmentForm.addEventListener("submit", createApartment);
}

supabaseClient.auth.onAuthStateChange(async (event) => {
  if (event === "SIGNED_OUT") {
    window.location.href = "/login.html";
  }
});

(async function init() {
  try {
    await requireAdmin();
    switchTab("users");
    await loadUsers();
  } catch (error) {
    console.error("Erreur admin init:", error);
  }
})();
