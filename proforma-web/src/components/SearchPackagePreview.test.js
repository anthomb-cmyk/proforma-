// Smoke test for the SearchPackagePreview component. @testing-library/react
// is not a dev dep in this repo (see ErrorBoundary.test.js), so we just
// pin the static API: the file exports a React function component, the
// data-shaping helper it consumes is covered exhaustively in
// lib/searchPackageDebug.test.js.

import SearchPackagePreview from "./SearchPackagePreview.jsx";

describe("SearchPackagePreview component API", () => {
  test("exports a React function component", () => {
    expect(typeof SearchPackagePreview).toBe("function");
  });

  test("declares the expected props in its function signature length", () => {
    // React function components take a single `props` arg, so length === 1.
    expect(SearchPackagePreview.length).toBe(1);
  });
});
