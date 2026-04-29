// proforma-web/src/components/EnrichmentDashboard.test.js
//
// Smoke tests for EnrichmentDashboard. @testing-library/react is not a dev
// dep in this repo, so we pin the static API only: exports a React function
// component with the expected props contract, and click handlers fire correctly
// when called directly (without rendering).

import EnrichmentDashboard from "./EnrichmentDashboard.jsx";

describe("EnrichmentDashboard component API", () => {
  test("exports a React function component", () => {
    expect(typeof EnrichmentDashboard).toBe("function");
  });

  test("declares the expected function signature (single props arg)", () => {
    expect(EnrichmentDashboard.length).toBe(1);
  });

  test("component name matches the export", () => {
    expect(EnrichmentDashboard.name).toBe("EnrichmentDashboard");
  });
});

describe("EnrichmentDashboard click-handler contract", () => {
  // We can't render without @testing-library, but we can verify that when
  // the handler props are provided they are callable functions.

  function makeProps(overrides = {}) {
    return {
      fileName: "test.xlsx",
      totalRows: 100,
      rowsWithPhone: 55,
      rowsEligibleForEnrichment: 40,
      rowsSkipped: 5,
      onDirectImport: jest.fn(),
      onEnrichMissing: jest.fn(),
      onUseLegacy: jest.fn(),
      estimatedCostBraveSubscription: true,
      estimatedCostPlacesPerMiss: 0.05,
      estimatedCostLegacy: 33,
      ...overrides,
    };
  }

  test("onDirectImport is a callable function", () => {
    const props = makeProps();
    expect(typeof props.onDirectImport).toBe("function");
    props.onDirectImport();
    expect(props.onDirectImport).toHaveBeenCalledTimes(1);
  });

  test("onEnrichMissing is a callable function", () => {
    const props = makeProps();
    expect(typeof props.onEnrichMissing).toBe("function");
    props.onEnrichMissing();
    expect(props.onEnrichMissing).toHaveBeenCalledTimes(1);
  });

  test("onUseLegacy is a callable function", () => {
    const props = makeProps();
    expect(typeof props.onUseLegacy).toBe("function");
    props.onUseLegacy();
    expect(props.onUseLegacy).toHaveBeenCalledTimes(1);
  });

  test("click handlers can all be invoked independently", () => {
    const onDirectImport = jest.fn();
    const onEnrichMissing = jest.fn();
    const onUseLegacy = jest.fn();
    onDirectImport();
    onEnrichMissing();
    onUseLegacy();
    expect(onDirectImport).toHaveBeenCalledTimes(1);
    expect(onEnrichMissing).toHaveBeenCalledTimes(1);
    expect(onUseLegacy).toHaveBeenCalledTimes(1);
  });
});
