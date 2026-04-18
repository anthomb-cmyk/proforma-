// Sharded localStorage layout for PhoneFinder runs.
//
// The legacy layout stored every run in one JSON blob under the key
// `pf_runs`. With 40 runs × a few hundred rows each, a single row edit
// (re-lookup a number, rerun a batch) meant re-serializing the entire
// array on every setResultRuns call. For a full-import run that fires
// setResultRuns once per batch of 10 rows, the O(N×total_rows) write
// cost was large enough to visibly stall the UI and push us close to
// the ~5 MB localStorage quota.
//
// The new layout splits each run into its own shard key:
//
//     pf_runs_index   →  JSON array of lightweight run metadata
//                       [{ id, title, source, createdAt, totalRows,
//                          foundCount, updatedAt }, ...]
//
//     pf_run:<id>     →  JSON { id, rows: [...] }   (one per run)
//
// persistRunsDiff() compares the previous and next resultRuns arrays by
// reference identity on .rows (cheap; React's immutable updates change
// the reference whenever rows actually change) and only rewrites the
// shards that changed. Renaming a run — which keeps the rows reference
// stable — only writes the small index, not the large shard.
//
// A legacy `pf_runs` blob is migrated into shards the first time the
// module runs, and the legacy key is removed.

export const INDEX_KEY = "pf_runs_index";
export const SHARD_PREFIX = "pf_run:";
export const LEGACY_KEY = "pf_runs";

// Fields copied into the lightweight index entry. If this list changes,
// update indexChanged() below too — the diff only inspects these keys.
const INDEX_FIELDS = [
  "id", "title", "source", "createdAt",
  "totalRows", "foundCount", "updatedAt",
];

function indexEntryOf(run) {
  const entry = {};
  for (const k of INDEX_FIELDS) entry[k] = run?.[k];
  // Ensure updatedAt falls back to createdAt so index comparisons are stable
  // for runs that have never been touched since import.
  if (!entry.updatedAt) entry.updatedAt = entry.createdAt;
  return entry;
}

function safeGet(store, k) {
  try { return store.getItem(k); } catch { return null; }
}
function safeSet(store, k, v) {
  try { store.setItem(k, v); return true; } catch { return false; }
}
function safeRemove(store, k) {
  try { store.removeItem(k); } catch {}
}

function resolveStore(store) {
  if (store) return store;
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {}
  return null;
}

// Reads all runs from sharded storage. If a legacy `pf_runs` blob is
// present (and no index exists yet), migrates it in-place: writes a
// shard per run, writes the index, deletes the legacy key. Returns an
// array of raw run objects (rows included); the caller is responsible
// for any row-level normalization (e.g. normalizeResultRowPhones).
export function loadRunsFromStorage(store) {
  const s = resolveStore(store);
  if (!s) return [];

  const indexRaw = safeGet(s, INDEX_KEY);
  const legacyRaw = safeGet(s, LEGACY_KEY);

  // Migration path: sharded layout not yet written, legacy blob present.
  if (!indexRaw && legacyRaw) {
    let parsed;
    try { parsed = JSON.parse(legacyRaw); } catch { parsed = null; }
    if (Array.isArray(parsed) && parsed.length) {
      const runs = parsed
        .filter((r) => r && typeof r === "object")
        .map((run, i) => ({
          ...run,
          id: run.id || `pf_run_${Date.now()}_${i}`,
          rows: Array.isArray(run.rows) ? run.rows : [],
        }));
      // Write shards first so an interrupted migration never leaves an
      // index entry pointing at a missing shard.
      for (const r of runs) {
        safeSet(s, SHARD_PREFIX + r.id, JSON.stringify({ id: r.id, rows: r.rows }));
      }
      safeSet(s, INDEX_KEY, JSON.stringify(runs.map(indexEntryOf)));
      safeRemove(s, LEGACY_KEY);
      return runs;
    }
    // Legacy blob existed but was unusable — clean it up.
    safeRemove(s, LEGACY_KEY);
  }

  if (!indexRaw) return [];

  let index;
  try { index = JSON.parse(indexRaw); } catch { index = null; }
  if (!Array.isArray(index) || !index.length) return [];

  const runs = [];
  for (const entry of index) {
    if (!entry || typeof entry !== "object" || !entry.id) continue;
    const shardRaw = safeGet(s, SHARD_PREFIX + entry.id);
    if (!shardRaw) {
      // Shard missing — surface the run with empty rows so the caller
      // can still show metadata instead of dropping it silently. A
      // subsequent persist will rewrite a correct (empty) shard.
      runs.push({ ...entry, rows: [] });
      continue;
    }
    let shard;
    try { shard = JSON.parse(shardRaw); } catch { shard = null; }
    const rows = Array.isArray(shard?.rows) ? shard.rows : [];
    runs.push({ ...entry, rows });
  }
  return runs;
}

// Detects whether the index metadata changed between two run arrays.
// Intentionally compares only the fields we persist in the index so
// in-memory-only fields (like _src on rows) never trigger index writes.
function indexChanged(prev, next) {
  const a = prev || [];
  const b = next || [];
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i] || {};
    const pb = b[i] || {};
    for (const k of INDEX_FIELDS) {
      if ((pa[k] ?? null) !== (pb[k] ?? null)) return true;
    }
  }
  return false;
}

// Strips in-memory-only fields (like _src) that must never hit
// localStorage — _src holds the full raw input row and would balloon
// the shard size 2-3x.
function stripForStorage(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(({ _src, ...rest }) => rest);
}

// Diffs prev→next and writes only what changed:
//   - For each next run: if the .rows array reference differs from the
//     previous run with the same id, rewrite that shard. New runs always
//     write a shard.
//   - For each prev run missing from next, delete its shard.
//   - Rewrites the index only if any metadata field (title, counts,
//     order, etc.) actually changed — so renaming a run writes one
//     small index blob instead of the full shard.
//
// Returns { wrote, deleted, indexWritten } for tests / instrumentation.
export function persistRunsDiff(prevRuns, nextRuns, store) {
  const s = resolveStore(store);
  if (!s) return { wrote: 0, deleted: 0, indexWritten: false };

  const prevList = Array.isArray(prevRuns) ? prevRuns : [];
  const nextList = Array.isArray(nextRuns) ? nextRuns : [];
  const prevById = new Map(prevList.map((r) => [r.id, r]));
  const nextById = new Map(nextList.map((r) => [r.id, r]));

  let wrote = 0;
  let deleted = 0;

  // Write new / changed shards. Identity compare on .rows is the fast
  // path — React's immutable updates produce a new array only when the
  // rows changed, so rename/metadata-only mutations skip the shard
  // rewrite entirely.
  for (const run of nextList) {
    if (!run || !run.id) continue;
    const prev = prevById.get(run.id);
    const rowsChanged = !prev || prev.rows !== run.rows;
    if (rowsChanged) {
      const payload = JSON.stringify({ id: run.id, rows: stripForStorage(run.rows) });
      if (safeSet(s, SHARD_PREFIX + run.id, payload)) wrote++;
    }
  }

  // Delete shards for runs that disappeared from the array.
  for (const [id] of prevById) {
    if (!nextById.has(id)) {
      safeRemove(s, SHARD_PREFIX + id);
      deleted++;
    }
  }

  // Rewrite the index only when metadata actually changed. This also
  // catches reorderings (the user pinning a run to the top, etc.).
  const prevIndex = prevList.map(indexEntryOf);
  const nextIndex = nextList.map(indexEntryOf);
  const indexWritten = indexChanged(prevIndex, nextIndex);
  if (indexWritten) safeSet(s, INDEX_KEY, JSON.stringify(nextIndex));

  return { wrote, deleted, indexWritten };
}

// Nukes every shard + the index + any legacy blob. Used by the
// "Effacer tous les imports" button so orphaned shards can't accumulate
// across sessions.
export function clearRunsFromStorage(store) {
  const s = resolveStore(store);
  if (!s) return;
  const indexRaw = safeGet(s, INDEX_KEY);
  if (indexRaw) {
    let index;
    try { index = JSON.parse(indexRaw); } catch { index = null; }
    if (Array.isArray(index)) {
      for (const entry of index) {
        if (entry?.id) safeRemove(s, SHARD_PREFIX + entry.id);
      }
    }
  }
  safeRemove(s, INDEX_KEY);
  safeRemove(s, LEGACY_KEY);
}
