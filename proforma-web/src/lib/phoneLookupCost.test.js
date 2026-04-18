import { estimateLookupCost, formatCost, TEXTSEARCH_COST, DETAILS_COST } from "./phoneLookupCost.js";

describe("estimateLookupCost", () => {
  test("returns zero cost for empty batch", () => {
    const est = estimateLookupCost(0);
    expect(est.lo).toBe(0);
    expect(est.hi).toBe(0);
    expect(est.mid).toBe(0);
    expect(est.rowCount).toBe(0);
  });

  test("lo <= mid <= hi always", () => {
    for (const n of [1, 5, 50, 500]) {
      const est = estimateLookupCost(n);
      expect(est.lo).toBeLessThanOrEqual(est.mid);
      expect(est.mid).toBeLessThanOrEqual(est.hi);
    }
  });

  test("scales linearly with row count", () => {
    const a = estimateLookupCost(100);
    const b = estimateLookupCost(200);
    // 200 rows should cost almost exactly 2x 100 rows (floating-point
    // rounding aside). Check within a cent.
    expect(b.mid).toBeCloseTo(a.mid * 2, 2);
  });

  test("lo bound uses the conservative per-row counts", () => {
    // 1 textSearch + 2 details = $0.032 + $0.034 = $0.066 per row
    const est = estimateLookupCost(100);
    const expectedLo = 100 * (1 * TEXTSEARCH_COST + 2 * DETAILS_COST);
    expect(est.lo).toBeCloseTo(expectedLo, 4);
  });

  test("hi bound uses the worst-case per-row counts", () => {
    // 3 textSearch + 5 details = $0.096 + $0.085 = $0.181 per row
    const est = estimateLookupCost(100);
    const expectedHi = 100 * (3 * TEXTSEARCH_COST + 5 * DETAILS_COST);
    expect(est.hi).toBeCloseTo(expectedHi, 4);
  });

  test("residentialRatio discounts the cost", () => {
    const all = estimateLookupCost(100);
    const half = estimateLookupCost(100, { residentialRatio: 0.5 });
    const none = estimateLookupCost(100, { residentialRatio: 1 });
    expect(half.mid).toBeCloseTo(all.mid * 0.5, 4);
    expect(none.mid).toBe(0);
  });

  test("clamps residentialRatio to [0, 1]", () => {
    // Above 1 should behave like 1 (everything free)
    expect(estimateLookupCost(100, { residentialRatio: 5 }).mid).toBe(0);
    // Negative should behave like 0 (everything billable)
    const neg = estimateLookupCost(100, { residentialRatio: -1 });
    const full = estimateLookupCost(100);
    expect(neg.mid).toBeCloseTo(full.mid, 4);
  });

  test("handles non-numeric row counts gracefully", () => {
    expect(estimateLookupCost(null).mid).toBe(0);
    expect(estimateLookupCost(undefined).mid).toBe(0);
    expect(estimateLookupCost(NaN).mid).toBe(0);
  });
});

describe("formatCost", () => {
  test("zero and negatives render as $0", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(-5)).toBe("$0");
    expect(formatCost(NaN)).toBe("$0");
  });

  test("small amounts use 2 decimals", () => {
    expect(formatCost(0.48)).toBe("$0.48");
    expect(formatCost(0.05)).toBe("$0.05");
  });

  test("single-digit amounts use 1 decimal", () => {
    expect(formatCost(4.37)).toBe("$4.4");
    expect(formatCost(9.0)).toBe("$9.0");
  });

  test("larger amounts use whole dollars", () => {
    expect(formatCost(23.87)).toBe("$24");
    expect(formatCost(150)).toBe("$150");
  });
});
