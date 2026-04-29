import { saveImportSession, loadImportSession, clearImportSession } from "./phoneFinderImportSession.js";

// ── localStorage mock ──────────────────────────────────────────────────────
// Use Object.defineProperty to install a fresh store object each time.
// Re-assigning 'store' would break closures; instead we mutate it.
const store = {};

function clearStore() {
  for (const k of Object.keys(store)) delete store[k];
}

beforeEach(() => {
  clearStore();
  Object.defineProperty(global, "localStorage", {
    value: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    writable: true,
    configurable: true,
  });
});
afterEach(() => {
  clearStore();
});

// ── save + load roundtrip ──────────────────────────────────────────────────
test("save+load roundtrip preserves all fields", () => {
  const session = {
    fileName: "test.xlsx",
    rows: [{ "Nom": "Dupont", rawRow: { "Nom": "Dupont" } }],
    headers: ["Nom"],
    colMap: { name: "Nom" },
    importStatusByRowIndex: { 0: "imported" },
    savedAt: 1700000000000,
  };
  saveImportSession(session);
  const loaded = loadImportSession();
  expect(loaded).not.toBeNull();
  expect(loaded.v).toBe(1);
  expect(loaded.fileName).toBe("test.xlsx");
  expect(loaded.rows).toHaveLength(1);
  expect(loaded.headers).toEqual(["Nom"]);
  expect(loaded.colMap).toEqual({ name: "Nom" });
  expect(loaded.importStatusByRowIndex).toEqual({ 0: "imported" });
  expect(loaded.savedAt).toBe(1700000000000);
});

// ── clear removes the entry ────────────────────────────────────────────────
test("clear removes the entry", () => {
  saveImportSession({ fileName: "a.csv", rows: [], headers: [], colMap: {}, importStatusByRowIndex: {} });
  clearImportSession();
  expect(loadImportSession()).toBeNull();
});

// ── save with rows >4MB trims rawRow ──────────────────────────────────────
test("save with rows >4MB equivalent trims rawRow", () => {
  // Build rows where rawRow contains a large string pushing total > 4MB
  const bigString = "x".repeat(100_000); // 100KB per row × 50 = 5MB
  const rows = Array.from({ length: 50 }, (_, i) => ({
    Nom: `Owner${i}`,
    rawRow: { Nom: `Owner${i}`, bigField: bigString },
  }));
  saveImportSession({ fileName: "big.xlsx", rows, headers: ["Nom"], colMap: {}, importStatusByRowIndex: {} });
  const loaded = loadImportSession();
  expect(loaded).not.toBeNull();
  // rawRow should have been stripped from each row
  for (const row of loaded.rows) {
    expect(row.rawRow).toBeUndefined();
    expect(row.Nom).toBeDefined();
  }
  expect(loaded._trimmed).toBe(true);
});

// ── load returns null when nothing stored ─────────────────────────────────
test("load returns null when nothing stored", () => {
  expect(loadImportSession()).toBeNull();
});

// ── load returns null when version mismatch ───────────────────────────────
test("load returns null when version mismatch", () => {
  store["pf_import_session_v1"] = JSON.stringify({ v: 2, fileName: "old.csv" });
  expect(loadImportSession()).toBeNull();
});
