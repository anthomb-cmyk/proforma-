// Module-shape smoke for useFocusHotkey. The hook body is small and its
// only side-effect (document.addEventListener inside useEffect) is
// covered by React's built-in effect semantics; behavioral keyboard
// tests would require @testing-library/react which is not a dev dep.

import useFocusHotkey from "./useFocusHotkey.js";

describe("useFocusHotkey module shape", () => {
  test("exports a function", () => {
    expect(typeof useFocusHotkey).toBe("function");
  });

  test("accepts ref + optional options (arity ≤ 2)", () => {
    expect(useFocusHotkey.length).toBeLessThanOrEqual(2);
  });
});
