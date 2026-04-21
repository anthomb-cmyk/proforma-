// Web Push subscription helpers. The browser gives us a PushSubscription
// (endpoint URL + P-256 keys) that we POST to the backend; the backend
// encrypts + signs payloads with VAPID and pushes them via the browser's
// push service.
//
// All functions return {ok, ...} and never throw — the caller uses the
// result to decide what UI to show. A missing server endpoint, denied
// permission, or unsupported browser all surface as `ok:false` with a
// descriptive error; nothing crashes the app.

function urlBase64ToUint8Array(b64) {
  // The applicationServerKey must be a Uint8Array, not base64url. Pad
  // and convert.
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported() {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

// Returns "granted" | "denied" | "default" | "unsupported"
export function pushPermission() {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

async function getVapidPublicKey() {
  try {
    const r = await fetch("/api/push/vapid-public-key");
    if (!r.ok) return null;
    const d = await r.json();
    return d?.publicKey || null;
  } catch {
    return null;
  }
}

// Prompt for permission, register with the push service, send subscription
// to the backend. Returns {ok:true, subscription} on success.
export async function subscribeToPush(user) {
  if (!pushSupported()) return { ok: false, error: "unsupported" };

  // Request permission. If already denied we can't reprompt — the user has
  // to flip it in browser settings.
  let perm = Notification.permission;
  if (perm === "default") {
    try { perm = await Notification.requestPermission(); } catch { perm = "denied"; }
  }
  if (perm !== "granted") return { ok: false, error: perm };

  let reg;
  try {
    reg = await navigator.serviceWorker.ready;
  } catch (err) {
    return { ok: false, error: "sw-not-ready" };
  }

  const vapidPub = await getVapidPublicKey();
  if (!vapidPub) return { ok: false, error: "no-vapid-key" };

  let sub;
  try {
    // If already subscribed, reuse — avoids churning endpoints on every app boot.
    sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPub),
      });
    }
  } catch (err) {
    return { ok: false, error: err?.message || "subscribe-failed" };
  }

  // POST to backend. The backend persists {endpoint, keys, user_id} so it
  // can push later.
  try {
    const r = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        userId: user?.id || null,
        userName: user?.name || null,
      }),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
  } catch (err) {
    return { ok: false, error: err?.message || "network" };
  }

  return { ok: true, subscription: sub };
}

export async function unsubscribeFromPush() {
  if (!pushSupported()) return { ok: false, error: "unsupported" };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    // Best-effort: tell the backend to forget this subscription.
    try {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
    } catch {}
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || "unsubscribe-failed" };
  }
}
