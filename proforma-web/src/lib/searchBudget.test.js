// proforma-web/src/lib/searchBudget.test.js
//
// Unit tests for searchBudget.js

import {
  getBudgetState,
  incrementUsed,
  setCap,
  resetBudget,
  defaultCap,
} from "./searchBudget.js";

const STORAGE_KEY = "pf_search_budget_v1";

function resetStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

describe("searchBudget", () => {
  beforeEach(resetStorage);

  test("getBudgetState defaults to { used: 0, cap: 500, exhausted: false }", () => {
    const state = getBudgetState();
    expect(state.used).toBe(0);
    expect(state.cap).toBe(500);
    expect(state.remaining).toBe(500);
    expect(state.exhausted).toBe(false);
  });

  test("defaultCap returns 500", () => {
    expect(defaultCap()).toBe(500);
  });

  test("incrementUsed increments used and recomputes exhausted", () => {
    let state = incrementUsed(1);
    expect(state.used).toBe(1);
    expect(state.exhausted).toBe(false);

    state = incrementUsed(5);
    expect(state.used).toBe(6);
    expect(state.remaining).toBe(494);

    // Verify persistence across getBudgetState call
    const loaded = getBudgetState();
    expect(loaded.used).toBe(6);
  });

  test("setCap updates cap", () => {
    setCap(50);
    const state = getBudgetState();
    expect(state.cap).toBe(50);
  });

  test("resetBudget zeros used", () => {
    incrementUsed(10);
    resetBudget();
    const state = getBudgetState();
    expect(state.used).toBe(0);
  });

  test("cap defaults to 500; once 500 calls used, exhausted=true", () => {
    // Use incrementUsed(500) to reach the cap in one call
    const state = incrementUsed(500);
    expect(state.used).toBe(500);
    expect(state.cap).toBe(500);
    expect(state.exhausted).toBe(true);
    expect(state.remaining).toBe(0);

    // getBudgetState should also reflect exhausted
    const loaded = getBudgetState();
    expect(loaded.exhausted).toBe(true);
  });

  test("incrementUsed beyond cap keeps exhausted=true", () => {
    setCap(10);
    incrementUsed(10);
    const state = incrementUsed(1);
    expect(state.exhausted).toBe(true);
    expect(state.used).toBe(11);
    expect(state.remaining).toBe(0);
  });

  test("setCap + resetBudget interaction", () => {
    setCap(50);
    incrementUsed(30);
    resetBudget();
    const state = getBudgetState();
    expect(state.used).toBe(0);
    expect(state.cap).toBe(50); // cap preserved
    expect(state.exhausted).toBe(false);
  });
});
