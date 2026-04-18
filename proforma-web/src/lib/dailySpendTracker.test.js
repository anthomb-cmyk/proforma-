import { loadTodaySpend, recordBatch, clearTodaySpend, todayKey } from "./dailySpendTracker.js";

// Fake localStorage shim — jsdom provides one, but isolating per-test
// keeps us honest about what persists vs. resets.
function makeStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    key: i => Array.from(m.keys())[i] || null,
    get length() { return m.size; },
  };
}

// Stub window.localStorage for each test so state from a previous
// test can't leak forward. Restoring on teardown keeps jsdom happy.
let realStorage;
beforeEach(() => {
  realStorage = window.localStorage;
  Object.defineProperty(window, "localStorage", { value: makeStore(), writable: true, configurable: true });
});
afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: realStorage, writable: true, configurable: true });
});

describe("todayKey", () => {
  test("returns YYYY-MM-DD for a given date", () => {
    expect(todayKey(new Date(2026, 3, 17))).toBe("2026-04-17"); // April (month=3)
    expect(todayKey(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(todayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("loadTodaySpend", () => {
  test("returns zeroed entry when storage is empty", () => {
    const now = new Date(2026, 3, 17);
    const spend = loadTodaySpend(now);
    expect(spend).toEqual({ date: "2026-04-17", rows: 0, estCost: 0 });
  });

  test("ignores a stale day and returns zeroed entry", () => {
    const past = new Date(2026, 3, 16);
    recordBatch(5, 0.5, past);
    const today = new Date(2026, 3, 17);
    const spend = loadTodaySpend(today);
    expect(spend.rows).toBe(0);
    expect(spend.estCost).toBe(0);
  });

  test("returns persisted tally for today", () => {
    const today = new Date(2026, 3, 17);
    recordBatch(10, 1.23, today);
    const spend = loadTodaySpend(today);
    expect(spend.rows).toBe(10);
    expect(spend.estCost).toBeCloseTo(1.23, 4);
  });

  test("tolerates malformed JSON", () => {
    window.localStorage.setItem("pf_daily_spend", "{ not-json");
    const spend = loadTodaySpend(new Date(2026, 3, 17));
    expect(spend.rows).toBe(0);
  });

  test("tolerates wrong shape", () => {
    window.localStorage.setItem("pf_daily_spend", JSON.stringify([1, 2, 3]));
    const spend = loadTodaySpend(new Date(2026, 3, 17));
    expect(spend.rows).toBe(0);
  });
});

describe("recordBatch", () => {
  test("accumulates rows + cost within the same day", () => {
    const now = new Date(2026, 3, 17);
    recordBatch(5, 0.5, now);
    recordBatch(10, 1.0, now);
    const spend = loadTodaySpend(now);
    expect(spend.rows).toBe(15);
    expect(spend.estCost).toBeCloseTo(1.5, 4);
  });

  test("rolls to zero when the day changes", () => {
    const d1 = new Date(2026, 3, 17);
    recordBatch(100, 10.0, d1);
    const d2 = new Date(2026, 3, 18);
    recordBatch(5, 0.5, d2);
    const spend = loadTodaySpend(d2);
    expect(spend.date).toBe("2026-04-18");
    expect(spend.rows).toBe(5);
    expect(spend.estCost).toBeCloseTo(0.5, 4);
  });

  test("clamps negative inputs to zero", () => {
    const now = new Date(2026, 3, 17);
    recordBatch(-5, -1, now);
    const spend = loadTodaySpend(now);
    expect(spend.rows).toBe(0);
    expect(spend.estCost).toBe(0);
  });

  test("rounds non-integer row counts", () => {
    const now = new Date(2026, 3, 17);
    recordBatch(5.7, 0.2, now);
    expect(loadTodaySpend(now).rows).toBe(6);
  });
});

describe("clearTodaySpend", () => {
  test("resets the stored tally", () => {
    const now = new Date(2026, 3, 17);
    recordBatch(10, 1.0, now);
    clearTodaySpend();
    const spend = loadTodaySpend(now);
    expect(spend.rows).toBe(0);
    expect(spend.estCost).toBe(0);
  });
});
