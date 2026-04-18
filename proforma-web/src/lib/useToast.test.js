// Smoke test for useToast module shape. Behavioral tests (fake timers +
// renderHook) would need @testing-library/react which isn't a dev dep —
// the hook body is small enough that a signature smoke covers the
// regression we care about (accidental export rename / arity drift).

import useToast from "./useToast.js";

describe("useToast module shape", () => {
  test("exports a function", () => {
    expect(typeof useToast).toBe("function");
  });

  test("optional defaultDuration argument (arity ≤ 1)", () => {
    expect(useToast.length).toBeLessThanOrEqual(1);
  });
});
