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

let currentTab = "users";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-CA");
}

function formatDuration(seconds) {
  const total = Number(seconds || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h ${m}m ${s}s`;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erreur");
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
  const data = await fetchJSON("/api/user-time-summary");
  usersBody.innerHTML = "";

  for (const row of (data.summary || [])) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.user_id || "-"}</td>
      <td>${row.total_sessions ?? 0}</td>
      <td>${formatDate(row.first_login)}</td>
      <td>${formatDate(row.last_seen)}</td>
      <td>${formatDuration(row.total_seconds)}</td>
    `;
    usersBody.appendChild(tr);
  }
}

async function loadSessions() {
  const data = await fetchJSON("/api/admin/chat-sessions");
  sessionsBody.innerHTML = "";

  for (const row of (data.sessions || [])) {
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

  for (const row of (data.messages || [])) {
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
      <td>${row.ref || "-"}</td>
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
loadMessagesBtn.addEventListener("click", loadMessages);

(async function init() {
  switchTab("users");
  await loadUsers();
})();
