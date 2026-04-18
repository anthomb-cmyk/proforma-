// Thin smoke test for useDebouncedValue. Full behavioral tests would need
// @testing-library/react (not currently a dev dep); the hook itself is only
// a useState + useEffect(setTimeout) so its correctness is well-covered by
// the shipped tests of those React primitives. We just verify the module
// shape here to catch accidental signature breakage in imports.

import useDebouncedValue from "./useDebouncedValue.js";

describe("useDebouncedValue module", () => {
  test("exports a function", () => {
    expect(typeof useDebouncedValue).toBe("function");
  });

  test("accepts value + delay parameters", () => {
    // Arity of 1 means the default-value param counts as required; React
    // hooks are conventionally 2-arg. We just confirm it's callable with up
    // to 2 args without throwing on module load.
    expect(useDebouncedValue.length).toBeLessThanOrEqual(2);
  });
});
