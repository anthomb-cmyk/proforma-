import {
  normalizePhoneDigits,
  normalizeOwnerKey,
  isNeverCall,
  markNeverCall,
  unmarkNeverCall,
  listNeverCall,
  clearNeverCallList,
} from "./neverCallList.js";

beforeEach(() => clearNeverCallList());
afterEach(() => clearNeverCallList());

describe("normalization", () => {
  test("normalizePhoneDigits strips non-digits", () => {
    expect(normalizePhoneDigits("(514) 555-0100")).toBe("5145550100");
    expect(normalizePhoneDigits("+1 514 555 0100")).toBe("15145550100");
    expect(normalizePhoneDigits(null)).toBe("");
  });
  test("normalizeOwnerKey lowercases + strips diacritics", () => {
    expect(normalizeOwnerKey("GESTION IMMOBILIÈRE CHOINIÈRE INC.")).toBe("gestion immobiliere choiniere inc");
    expect(normalizeOwnerKey("9876-5432 Québec Inc.")).toBe("9876 5432 quebec inc");
  });
});

describe("never-call list — phone keying", () => {
  test("markNeverCall + isNeverCall by phone", () => {
    expect(isNeverCall({ phone: "(514) 555-0100" })).toBe(false);
    markNeverCall({ phone: "(514) 555-0100", reason: "test" });
    expect(isNeverCall({ phone: "5145550100" })).toBe(true);
    expect(isNeverCall({ phone: "514-555-0100" })).toBe(true);
  });
  test("unmark removes the entry", () => {
    markNeverCall({ phone: "5145550100" });
    expect(unmarkNeverCall({ phone: "5145550100" })).toBe(true);
    expect(isNeverCall({ phone: "5145550100" })).toBe(false);
  });
});

describe("never-call list — owner keying", () => {
  test("matches across diacritic / case variants", () => {
    markNeverCall({ ownerName: "Gestion Immobilière Choinière Inc." });
    expect(isNeverCall({ ownerName: "GESTION IMMOBILIERE CHOINIERE INC" })).toBe(true);
  });
  test("phone hit is sufficient even when owner not listed", () => {
    markNeverCall({ phone: "5145550100" });
    expect(isNeverCall({ phone: "5145550100", ownerName: "Some Random Owner" })).toBe(true);
  });
});

describe("listNeverCall", () => {
  test("returns phone + owner entries, most-recent first", async () => {
    markNeverCall({ phone: "5145550100", reason: "wrong number" });
    await new Promise((r) => setTimeout(r, 5));
    markNeverCall({ ownerName: "Acme Corp", reason: "do not call" });
    const all = listNeverCall();
    expect(all.length).toBe(2);
    expect(all[0].kind).toBe("owner");
    expect(all[1].kind).toBe("phone");
  });
});
