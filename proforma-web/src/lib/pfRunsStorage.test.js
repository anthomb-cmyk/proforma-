import {
  INDEX_KEY,
  SHARD_PREFIX,
  LEGACY_KEY,
  loadRunsFromStorage,
  persistRunsDiff,
  clearRunsFromStorage,
} from "./pfRunsStorage.js";

// Minimal Storage-like double. We intentionally don't use jsdom's real
// localStorage because a) most of these tests care about the exact set
// of writes performed (diffing), and b) Jest's jsdom localStorage
// persists across tests unless you reset it carefully.
function makeStore() {
  const map = new Map();
  const writes = [];
  const removes = [];
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
      writes.push(k);
    },
    removeItem: (k) => {
      map.delete(k);
      removes.push(k);
    },
    // test helpers (not part of Storage interface):
    _writes: writes,
    _removes: removes,
    _keys: () => [...map.keys()],
    _get: (k) => map.get(k),
    _has: (k) => map.has(k),
    _resetLogs: () => { writes.length = 0; removes.length = 0; },
  };
}

function makeRun(overrides = {}) {
  return {
    id: "r1",
    title: "Run 1",
    source: "csv",
    createdAt: "2026-04-17T10:00:00.000Z",
    updatedAt: "2026-04-17T10:00:00.000Z",
    totalRows: 2,
    foundCount: 1,
    rows: [
      { id: "row-a", phone: "5145550001", status: "found" },
      { id: "row-b", phone: "", status: "not_found" },
    ],
    ...overrides,
  };
}

describe("loadRunsFromStorage", () => {
  test("returns [] on an empty store", () => {
    const s = makeStore();
    expect(loadRunsFromStorage(s)).toEqual([]);
  });

  test("reads sharded layout back into run objects", () => {
    const s = makeStore();
    const run = makeRun();
    s.setItem(SHARD_PREFIX + run.id, JSON.stringify({ id: run.id, rows: run.rows }));
    s.setItem(INDEX_KEY, JSON.stringify([{
      id: run.id, title: run.title, source: run.source,
      createdAt: run.createdAt, updatedAt: run.updatedAt,
      totalRows: run.totalRows, foundCount: run.foundCount,
    }]));
    const out = loadRunsFromStorage(s);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(run.id);
    expect(out[0].title).toBe(run.title);
    expect(out[0].rows).toHaveLength(2);
    expect(out[0].rows[0].phone).toBe("5145550001");
  });

  test("surfaces index entry with empty rows when shard is missing", () => {
    const s = makeStore();
    // Index says r1 exists but no pf_run:r1 shard written — e.g. a
    // migration that crashed between writes, or a user tampering.
    s.setItem(INDEX_KEY, JSON.stringify([
      { id: "r1", title: "Orphan", source: "csv", createdAt: "x", updatedAt: "x", totalRows: 0, foundCount: 0 },
    ]));
    const out = loadRunsFromStorage(s);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("r1");
    expect(out[0].rows).toEqual([]);
  });

  test("migrates legacy pf_runs blob into sharded layout and deletes the legacy key", () => {
    const s = makeStore();
    const legacy = [makeRun({ id: "legacyA" }), makeRun({ id: "legacyB", title: "Run B" })];
    s.setItem(LEGACY_KEY, JSON.stringify(legacy));
    s._resetLogs();

    const out = loadRunsFromStorage(s);

    expect(out).toHaveLength(2);
    expect(out.map((r) => r.id)).toEqual(["legacyA", "legacyB"]);
    // Shards written, index written, legacy removed.
    expect(s._has(SHARD_PREFIX + "legacyA")).toBe(true);
    expect(s._has(SHARD_PREFIX + "legacyB")).toBe(true);
    expect(s._has(INDEX_KEY)).toBe(true);
    expect(s._has(LEGACY_KEY)).toBe(false);
  });

  test("ignores malformed legacy blob instead of throwing", () => {
    const s = makeStore();
    s.setItem(LEGACY_KEY, "not-json{");
    expect(loadRunsFromStorage(s)).toEqual([]);
    // We still clean up the unparseable legacy key so it can't confuse
    // future loads.
    expect(s._has(LEGACY_KEY)).toBe(false);
  });
});

describe("persistRunsDiff", () => {
  test("writes shard + index for a brand-new run", () => {
    const s = makeStore();
    const next = [makeRun()];
    const out = persistRunsDiff([], next, s);
    expect(out).toEqual({ wrote: 1, deleted: 0, indexWritten: true });
    expect(s._has(SHARD_PREFIX + "r1")).toBe(true);
    expect(s._has(INDEX_KEY)).toBe(true);
  });

  test("does nothing when prev === next (no changes)", () => {
    const s = makeStore();
    const run = makeRun();
    const prev = [run];
    // Same references on both sides → diff should be a no-op.
    const out = persistRunsDiff(prev, prev, s);
    expect(out).toEqual({ wrote: 0, deleted: 0, indexWritten: false });
    expect(s._writes).toEqual([]);
  });

  test("renaming writes only the index, not the shard", () => {
    const s = makeStore();
    const run = makeRun();
    // Spread keeps .rows reference stable, which is the same contract
    // PhoneFinder's renameRun() uses. That's what lets us skip the
    // expensive shard rewrite.
    const renamed = { ...run, title: "Renamed" };
    const out = persistRunsDiff([run], [renamed], s);
    expect(out).toEqual({ wrote: 0, deleted: 0, indexWritten: true });
    expect(s._writes).toEqual([INDEX_KEY]);
  });

  test("editing rows writes just that run's shard + the index", () => {
    const s = makeStore();
    const run = makeRun({ id: "alpha" });
    const other = makeRun({ id: "beta", title: "Run B" });
    const prev = [run, other];
    // Mutate alpha's rows by creating a new array (React-style).
    const updatedAlpha = {
      ...run,
      rows: [...run.rows, { id: "row-c", phone: "5145550002", status: "found" }],
      totalRows: 3,
      foundCount: 2,
      updatedAt: "2026-04-17T11:00:00.000Z",
    };
    const next = [updatedAlpha, other];

    s._resetLogs();
    const out = persistRunsDiff(prev, next, s);
    expect(out.wrote).toBe(1);
    expect(out.deleted).toBe(0);
    expect(out.indexWritten).toBe(true);
    // Only alpha's shard should have been touched, not beta's.
    expect(s._writes).toEqual(expect.arrayContaining([SHARD_PREFIX + "alpha", INDEX_KEY]));
    expect(s._writes).not.toContain(SHARD_PREFIX + "beta");
  });

  test("removing a run deletes its shard and rewrites the index", () => {
    const s = makeStore();
    const a = makeRun({ id: "alpha" });
    const b = makeRun({ id: "beta" });
    // Seed storage as if both were persisted.
    persistRunsDiff([], [a, b], s);
    s._resetLogs();

    const out = persistRunsDiff([a, b], [a], s);
    expect(out.deleted).toBe(1);
    expect(out.indexWritten).toBe(true);
    expect(s._removes).toContain(SHARD_PREFIX + "beta");
    expect(s._has(SHARD_PREFIX + "alpha")).toBe(true);
  });

  test("strips in-memory _src fields before writing shards", () => {
    const s = makeStore();
    const run = makeRun({
      rows: [
        { id: "row-a", phone: "5145550001", status: "found",
          _src: { bloat: "x".repeat(1000) } },
      ],
    });
    persistRunsDiff([], [run], s);
    const shard = JSON.parse(s._get(SHARD_PREFIX + run.id));
    expect(shard.rows[0]).not.toHaveProperty("_src");
    expect(shard.rows[0].phone).toBe("5145550001");
  });
});

describe("clearRunsFromStorage", () => {
  test("removes every shard + index + legacy key", () => {
    const s = makeStore();
    persistRunsDiff([], [makeRun({ id: "a" }), makeRun({ id: "b" })], s);
    s.setItem(LEGACY_KEY, "[]");
    clearRunsFromStorage(s);
    expect(s._has(INDEX_KEY)).toBe(false);
    expect(s._has(SHARD_PREFIX + "a")).toBe(false);
    expect(s._has(SHARD_PREFIX + "b")).toBe(false);
    expect(s._has(LEGACY_KEY)).toBe(false);
  });

  test("is a no-op on an empty store", () => {
    const s = makeStore();
    expect(() => clearRunsFromStorage(s)).not.toThrow();
  });
});
