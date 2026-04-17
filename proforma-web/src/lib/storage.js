// localStorage persistence for the top-level CRM state (deals, leads,
// currentId, gcalOk). SK is the single storage key; bump the suffix when
// the shape of persisted state changes incompatibly.

export const SK = "acq_crm_v4";

export function load() {
  try {
    const r = localStorage.getItem(SK);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}

// localStorage quota is typically ~5 MB. A large leads import can push us
// close. Callers that care (the top-level state sync) pass onError so we can
// surface a toast instead of silently losing writes.
export function isQuotaError(err) {
  if (!err) return false;
  if (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  // Legacy IE/Edge codes.
  return err.code === 22 || err.code === 1014;
}

export function persist(s, onError) {
  try {
    localStorage.setItem(SK, JSON.stringify(s));
  } catch (err) {
    if (typeof onError === "function") onError(err);
    // Quota errors surface via onError; everything else (e.g. SecurityError in
    // private browsing) is logged but not user-facing to avoid noise.
    if (!isQuotaError(err)) {
      // eslint-disable-next-line no-console
      console.warn("persist() failed:", err);
    }
  }
}
