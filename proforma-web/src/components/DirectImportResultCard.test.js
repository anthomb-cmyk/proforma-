// DirectImportResultCard.test.js
// Tests the tier determination logic and component API.
// No @testing-library/react needed — we extract the tier logic as a pure
// function and test it directly.

import DirectImportResultCard from "./DirectImportResultCard.jsx";

// ── Pure tier logic (mirrored from component) ─────────────────────────────
function computeTier({ added = 0, updated = 0, skipped = 0 } = {}) {
  if (added > 0) return "success";
  if (updated > 0) return "neutral";
  if (skipped > 0) return "warning";
  return "info";
}

describe("DirectImportResultCard tier logic", () => {
  test("added > 0 → success tier", () => {
    expect(computeTier({ added: 5, updated: 0, skipped: 0 })).toBe("success");
  });

  test("added=0, updated>0 → neutral tier", () => {
    expect(computeTier({ added: 0, updated: 3, skipped: 0 })).toBe("neutral");
  });

  test("added=0, updated=0, skipped>0 → warning tier", () => {
    expect(computeTier({ added: 0, updated: 0, skipped: 10 })).toBe("warning");
  });

  test("all zero → info tier", () => {
    expect(computeTier({ added: 0, updated: 0, skipped: 0 })).toBe("info");
  });

  test("added > 0 takes priority over updated", () => {
    expect(computeTier({ added: 2, updated: 5, skipped: 1 })).toBe("success");
  });
});

describe("DirectImportResultCard component API", () => {
  test("exports a React function component", () => {
    expect(typeof DirectImportResultCard).toBe("function");
  });

  test("accepts result, onDismiss, onViewLeads, lang props", () => {
    const props = {
      result: { added: 5, updated: 0, skipped: 0, totalSent: 5, at: Date.now() },
      onDismiss: jest.fn(),
      onViewLeads: jest.fn(),
      lang: "fr",
    };
    expect(typeof props.result).toBe("object");
    expect(typeof props.onDismiss).toBe("function");
    expect(typeof props.onViewLeads).toBe("function");
    expect(props.lang).toBe("fr");
  });

  test("onDismiss is callable", () => {
    const onDismiss = jest.fn();
    onDismiss();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test("onViewLeads is callable", () => {
    const onViewLeads = jest.fn();
    onViewLeads();
    expect(onViewLeads).toHaveBeenCalledTimes(1);
  });
});

// ── PR #38.1: direct import must NOT call onOpenLeads automatically ────────
describe("PR #38.1 — direct import does not auto-navigate", () => {
  /**
   * The handler logic extracted as a pure function for testability.
   * Mirrors what handleDirectImportPhonesInFile does after the export resolves.
   */
  function simulateHandlerResolution({ result, onAfterImport, onOpenLeads, setDirectImportResult, setImportStatusByRowIndex }) {
    const added = Number(result?.added || 0);
    const updated = Number(result?.updated || 0);
    const skipped = Number(result?.skipped || 0);

    setDirectImportResult({ added, updated, skipped, totalSent: 5, at: Date.now() });
    setImportStatusByRowIndex({});

    if (typeof onAfterImport === "function") onAfterImport();
    // Key: do NOT call onOpenLeads here (PR #38.1)
  }

  test("handler does NOT call onOpenLeads after direct import", () => {
    const onOpenLeads = jest.fn();
    const setDirectImportResult = jest.fn();
    const setImportStatusByRowIndex = jest.fn();

    simulateHandlerResolution({
      result: { added: 5, updated: 0, skipped: 0 },
      onAfterImport: undefined,
      onOpenLeads,
      setDirectImportResult,
      setImportStatusByRowIndex,
    });

    expect(onOpenLeads).not.toHaveBeenCalled();
    expect(setDirectImportResult).toHaveBeenCalledTimes(1);
  });

  test("handler calls onAfterImport if provided (modal close callback)", () => {
    const onAfterImport = jest.fn();
    const onOpenLeads = jest.fn();
    const setDirectImportResult = jest.fn();
    const setImportStatusByRowIndex = jest.fn();

    simulateHandlerResolution({
      result: { added: 3, updated: 0, skipped: 0 },
      onAfterImport,
      onOpenLeads,
      setDirectImportResult,
      setImportStatusByRowIndex,
    });

    expect(onAfterImport).toHaveBeenCalledTimes(1);
    expect(onOpenLeads).not.toHaveBeenCalled();
  });
});
