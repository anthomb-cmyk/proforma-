import {
  isValidNanpPhone,
  normalizePhoneKey,
  formatPhone,
  extractPhonesFromText,
  mergePhoneLists,
  normalizeTextKey,
  extractPhonesFromRow,
} from "./phoneUtils.js";

// 555 is a reserved NANP exchange (only 555-01XX is assignable), so tests
// throughout this file use the 777 / 823 / 824 exchanges instead — they're
// assignable real exchanges and pass isValidNanpPhone.

describe("isValidNanpPhone", () => {
  test("accepts a typical Montreal number", () => {
    expect(isValidNanpPhone("5147771234")).toBe(true);
  });

  test("rejects N11 area codes", () => {
    expect(isValidNanpPhone("4117778888")).toBe(false);
    expect(isValidNanpPhone("9117771234")).toBe(false);
  });

  test("rejects area codes starting with 0 or 1", () => {
    expect(isValidNanpPhone("0147771234")).toBe(false);
    expect(isValidNanpPhone("1147771234")).toBe(false);
  });

  test("rejects exchange (NXX) starting with 0 or 1", () => {
    expect(isValidNanpPhone("5140771234")).toBe(false);
    expect(isValidNanpPhone("5141771234")).toBe(false);
  });

  test("rejects reserved NXX 000/999/958/959", () => {
    expect(isValidNanpPhone("5140001234")).toBe(false);
    expect(isValidNanpPhone("5149991234")).toBe(false);
    expect(isValidNanpPhone("5149581234")).toBe(false);
    expect(isValidNanpPhone("5149591234")).toBe(false);
  });

  test("only accepts fictional 555-01XX", () => {
    expect(isValidNanpPhone("5145550123")).toBe(true);
    expect(isValidNanpPhone("5145551234")).toBe(false); // 555 requires 01XX
  });

  test("rejects all-same-digit numbers", () => {
    expect(isValidNanpPhone("7777777777")).toBe(false);
    expect(isValidNanpPhone("4444444444")).toBe(false);
  });

  test("rejects runs of 7+ identical digits", () => {
    expect(isValidNanpPhone("5140000000")).toBe(false);
    expect(isValidNanpPhone("5147777777")).toBe(false);
  });

  test("rejects non-10-digit input", () => {
    expect(isValidNanpPhone("514777123")).toBe(false);
    expect(isValidNanpPhone("15147771234")).toBe(false);
    expect(isValidNanpPhone("")).toBe(false);
    expect(isValidNanpPhone("abcdefghij")).toBe(false);
  });
});

describe("normalizePhoneKey", () => {
  test("strips formatting", () => {
    expect(normalizePhoneKey("(514) 777-1234")).toBe("5147771234");
    expect(normalizePhoneKey("514.777.1234")).toBe("5147771234");
    expect(normalizePhoneKey("514 777 1234")).toBe("5147771234");
  });

  test("strips leading 1 country code", () => {
    expect(normalizePhoneKey("+1 (514) 777-1234")).toBe("5147771234");
    expect(normalizePhoneKey("15147771234")).toBe("5147771234");
  });

  test("returns '' for invalid phones", () => {
    expect(normalizePhoneKey("1117771234")).toBe(""); // area starts with 1
    expect(normalizePhoneKey("garbage")).toBe("");
    expect(normalizePhoneKey(null)).toBe("");
    expect(normalizePhoneKey(undefined)).toBe("");
    expect(normalizePhoneKey("")).toBe("");
  });

  test("truncates >10 digits after dropping country prefix", () => {
    expect(normalizePhoneKey("1514777123456")).toBe("5147771234");
  });
});

describe("formatPhone", () => {
  test("formats valid phones as (NPA) NXX-XXXX", () => {
    expect(formatPhone("5147771234")).toBe("(514) 777-1234");
    expect(formatPhone("+1-514-777-1234")).toBe("(514) 777-1234");
  });

  test("returns trimmed original for invalid phones", () => {
    expect(formatPhone("  garbage  ")).toBe("garbage");
    expect(formatPhone("")).toBe("");
    expect(formatPhone(null)).toBe("");
  });
});

describe("extractPhonesFromText", () => {
  test("finds standalone phones in free text", () => {
    const phones = extractPhonesFromText("Call me at 514-777-1234 or 438.823.9876");
    expect(phones).toHaveLength(2);
    expect(phones).toContain("514-777-1234");
    expect(phones).toContain("438.823.9876");
  });

  test("deduplicates same number with different formatting", () => {
    const phones = extractPhonesFromText("Home: (514) 777-1234 / Cell: 5147771234");
    expect(phones).toHaveLength(1);
  });

  test("returns empty for text with no phones", () => {
    expect(extractPhonesFromText("no numbers here")).toEqual([]);
    expect(extractPhonesFromText("")).toEqual([]);
    expect(extractPhonesFromText(null)).toEqual([]);
  });

  test("ignores invalid NANP sequences", () => {
    const phones = extractPhonesFromText("fake: 111-555-1234");
    expect(phones).toEqual([]);
  });
});

describe("mergePhoneLists", () => {
  test("merges arrays and scalars, dedupes", () => {
    const out = mergePhoneLists(
      ["(514) 777-1234", "438-823-9876"],
      "5147771234", // dup of first
      "4508241122",
    );
    expect(out).toHaveLength(3);
  });

  test("flattens nested arrays", () => {
    const out = mergePhoneLists([["(514) 777-1234"], "438-823-9876"]);
    expect(out).toHaveLength(2);
  });

  test("drops null/undefined/empty", () => {
    const out = mergePhoneLists(null, undefined, "", "(514) 777-1234");
    expect(out).toEqual(["(514) 777-1234"]);
  });
});

describe("normalizeTextKey", () => {
  test("strips accents and lowercases", () => {
    expect(normalizeTextKey("Éléphant À Café")).toBe("elephant a cafe");
  });

  test("collapses non-alphanumerics to single spaces", () => {
    expect(normalizeTextKey("Foo-Bar_Baz.qux")).toBe("foo bar baz qux");
  });

  test("handles null/undefined/empty", () => {
    expect(normalizeTextKey(null)).toBe("");
    expect(normalizeTextKey(undefined)).toBe("");
    expect(normalizeTextKey("")).toBe("");
  });
});

describe("extractPhonesFromRow", () => {
  test("prefers columns tagged as phone", () => {
    const row = {
      "Nom": "Jean Tremblay",
      "Téléphone": "(514) 777-1234",
      "Adresse postale": "438-823-9999", // tagged as address → ignored for hint
    };
    const phones = extractPhonesFromRow(row);
    expect(phones[0]).toBe("(514) 777-1234");
  });

  test("falls back to scanning all values", () => {
    const row = { description: "Contact: 514-777-1234" };
    expect(extractPhonesFromRow(row)).toHaveLength(1);
  });

  test("returns [] for non-object", () => {
    expect(extractPhonesFromRow(null)).toEqual([]);
    expect(extractPhonesFromRow("string")).toEqual([]);
    expect(extractPhonesFromRow(undefined)).toEqual([]);
  });
});
