const SUPABASE_URL = "https://nuuzkvgyolxbawvqyugu.supabase.co";
const SUPABASE_KEY = "sb_publishable_103-rw3MwM7k2xUeMMUodg_fRr9vUD4";
const EMPLOYEE_APP_URL = "https://fluxlocatif.up.railway.app";
const CLIENT_APP_URL = "https://client.fluxlocatif.com";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginStatus = document.getElementById("loginStatus");

function isPreviewSafeClientHost() {
  const hostname = String(window.location.hostname || "").trim().toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".up.railway.app")
  );
}

function getRoleDestination(role) {
  if (role === "admin") {
    return `${EMPLOYEE_APP_URL}/admin`;
  }

  if (role === "client") {
    if (isPreviewSafeClientHost()) {
      return `${window.location.origin}/client.html`;
    }

    return `${CLIENT_APP_URL}/client.html`;
  }

  return `${EMPLOYEE_APP_URL}/employee`;
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

async function resolveDefaultDestination(session) {
  const user = session?.user || null;
  const userId = user?.id;
  const role = resolveUserRole(user);

  if (!userId) {
    return getRoleDestination("employee");
  }

  if (role === "admin") {
    return getRoleDestination("admin");
  }

  if (role === "client") {
    return getRoleDestination("client");
  }

  if (role === "employee") {
    return getRoleDestination("employee");
  }

  const { data: adminRow, error } = await supabaseClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (adminRow) {
    return getRoleDestination("admin");
  }

  if (resolveClientId(user)) {
    return getRoleDestination("client");
  }

  return getRoleDestination("employee");
}

async function waitForSession(maxAttempts = 10, delayMs = 150) {
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

function setLoginStatus(message = "", type = "") {
  if (!loginStatus) return;
  loginStatus.textContent = message;
  loginStatus.className = "login-status";
  if (type) loginStatus.classList.add(type);
}

async function redirectIfLoggedIn() {
  const session = await waitForSession(1, 0);

  if (session) {
    const destination = await resolveDefaultDestination(session);
    window.location.replace(destination);
  }
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoginStatus("", "");

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    try {
      const { error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        setLoginStatus(error.message, "error");
        return;
      }

      const session = await waitForSession();

      if (!session) {
        setLoginStatus("Connexion réussie, mais la session n’a pas pu être confirmée. Réessayez.", "error");
        return;
      }

      const destination = await resolveDefaultDestination(session);
      window.location.replace(destination);
    } catch (error) {
      setLoginStatus(error.message || "Erreur de connexion.", "error");
    }
  });
}

redirectIfLoggedIn();
