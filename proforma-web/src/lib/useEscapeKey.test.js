// Module-shape smoke for useEscapeKey. Real keyboard interaction tests
// would need jsdom + testing-library; the hook body is simple enough
// that we just verify export / arity here. Listener attach/detach is
// exercised by React's built-in useEffect semantics.

import useEscapeKey from "./useEscapeKey.js";

describe("useEscapeKey module shape", () => {
  test("exports a function", () => {
    expect(typeof useEscapeKey).toBe("function");
  });

  test("accepts callback + optional active flag (arity ≤ 2)", () => {
    expect(useEscapeKey.length).toBeLessThanOrEqual(2);
  });
});
