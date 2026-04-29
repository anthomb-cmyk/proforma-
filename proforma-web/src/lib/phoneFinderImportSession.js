const KEY = "pf_import_session_v1";

/**
 * Persist the current PhoneFinder import session to localStorage.
 * Called whenever csvFile / colMap / dashboard state changes.
 */
export function saveImportSession({ fileName, rows, headers, colMap, importStatusByRowIndex, savedAt = Date.now() }) {
  try {
    const payload = { v: 1, fileName, rows, headers, colMap, importStatusByRowIndex, savedAt };
    const json = JSON.stringify(payload);
    // Defensive: large rôle files can hit localStorage 5MB quota. If the
    // serialized payload is > 4MB, drop rows[].rawRow (largest field) and
    // keep just the mapped columns we need.
    if (json.length > 4_000_000) {
      const trimmedRows = rows.map(r => {
        const out = {};
        for (const k of Object.keys(r)) {
          if (k === "rawRow") continue;
          out[k] = r[k];
        }
        return out;
      });
      const trimmed = { ...payload, rows: trimmedRows, _trimmed: true };
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      return;
    }
    localStorage.setItem(KEY, json);
  } catch {
    // Storage full or disabled — silently no-op so the app keeps working.
  }
}

export function loadImportSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearImportSession() {
  try { localStorage.removeItem(KEY); } catch {}
}
