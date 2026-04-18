// Smoke test for ErrorBoundary. Full render-tree tests would need
// @testing-library/react which isn't a dev dep; we just exercise the
// class methods directly to pin the static API: getDerivedStateFromError
// flips state, handleRetry clears it, componentDidCatch doesn't throw.

import ErrorBoundary from "./ErrorBoundary.jsx";

describe("ErrorBoundary class API", () => {
  test("exports a React class component with the expected static method", () => {
    expect(typeof ErrorBoundary).toBe("function");
    expect(typeof ErrorBoundary.getDerivedStateFromError).toBe("function");
  });

  test("getDerivedStateFromError returns a state patch", () => {
    const err = new Error("boom");
    const patch = ErrorBoundary.getDerivedStateFromError(err);
    expect(patch).toEqual({ hasError: true, error: err });
  });

  test("instance handleRetry clears the hasError flag", () => {
    // Use a real constructor call so arrow-function class fields
    // (handleRetry) land on the instance. We stub setState to inspect
    // the patch instead of wiring up React's full render lifecycle.
    const inst = new ErrorBoundary({});
    inst.state = { hasError: true, error: new Error("x") };
    const setStateCalls = [];
    inst.setState = (patch) => setStateCalls.push(patch);
    inst.handleRetry();
    expect(setStateCalls).toEqual([{ hasError: false, error: null }]);
  });

  test("componentDidCatch does not throw and logs via console.error", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const inst = new ErrorBoundary({ label: "x" });
    expect(() => inst.componentDidCatch(new Error("e"), { componentStack: "" })).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("initial state has no error", () => {
    const inst = new ErrorBoundary({});
    expect(inst.state).toEqual({ hasError: false, error: null });
  });
});
