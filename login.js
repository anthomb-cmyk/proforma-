const SUPABASE_URL = "https://nuuzkvgyolxbawvqyugu.supabase.co";
const SUPABASE_KEY = "sb_publishable_103-rw3MwM7k2xUeMMUodg_fRr9vUD4";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginStatus = document.getElementById("loginStatus");

function setLoginStatus(message = "", type = "") {
  if (!loginStatus) return;
  loginStatus.textContent = message;
  loginStatus.className = "login-status";
  if (type) loginStatus.classList.add(type);
}

async function redirectIfLoggedIn() {
  const { data } = await supabaseClient.auth.getSession();
  if (data?.session) {
    window.location.href = "/";
  }
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      setLoginStatus(error.message, "error");
    } else {
      window.location.href = "/";
    }
  });
}

redirectIfLoggedIn();
