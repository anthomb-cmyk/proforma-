import {
  buildCL,
  createDeal,
  dealLabel,
  normalizeDeal,
  stageColor,
  buildLeadIdentityKey,
  getLeadPhones,
} from "./dealHelpers.js";
import { STAGES, CHECKLISTS } from "./stages.js";

describe("buildCL", () => {
  test("returns empty array for unknown stage", () => {
    expect(buildCL("nope")).toEqual([]);
  });

  test("builds checklist items with stable ids", () => {
    const cl = buildCL("prospection");
    expect(cl.length).toBe(CHECKLISTS.prospection.length);
    expect(cl[0]).toHaveProperty("id");
    expect(cl[0].id.startsWith("prospection_")).toBe(true);
    expect(cl[0].done).toBe(false);
  });
});

describe("createDeal", () => {
  test("creates with required defaults", () => {
    const deal = createDeal("Test Deal");
    expect(deal.title).toBe("Test Deal");
    expect(deal.stage).toBe("prospection");
    expect(deal.priority).toBe("medium");
    expect(Array.isArray(deal.files)).toBe(true);
    expect(Array.isArray(deal.activities)).toBe(true);
    expect(Array.isArray(deal.events)).toBe(true);
    expect(deal.checklists.prospection.length).toBe(CHECKLISTS.prospection.length);
  });

  test("fills title fallback when empty", () => {
    const deal = createDeal("");
    expect(deal.title).toBe("Nouveau deal");
  });

  test("keeps optional address/coords/units/price when provided", () => {
    const deal = createDeal("T", "123 rue X", { lat: 45, lng: -73 }, "12", "500000");
    expect(deal.address).toBe("123 rue X");
    expect(deal.coords).toEqual({ lat: 45, lng: -73 });
    expect(deal.units).toBe("12");
    expect(deal.askingPrice).toBe("500000");
  });

  test("id is unique across quick successive calls", () => {
    const a = createDeal("A");
    const b = createDeal("B");
    expect(a.id).not.toBe(b.id);
  });
});

describe("dealLabel", () => {
  test("renders title + units + formatted price", () => {
    expect(dealLabel({ title: "Immeuble Nord", units: 6, askingPrice: "875000" }))
      .toBe("Immeuble Nord • 6 unités • 875,000 $");
  });

  test("falls back to Sans titre when empty", () => {
    expect(dealLabel({})).toBe("Sans titre");
    expect(dealLabel(null)).toBe("Sans titre");
  });

  test("passes through non-numeric price", () => {
    expect(dealLabel({ title: "X", askingPrice: "à négocier" }))
      .toBe("X • à négocier $");
  });
});

describe("normalizeDeal", () => {
  test("coerces string coords to numbers", () => {
    const d = normalizeDeal({ title: "X", coords: { lat: "45.5", lng: "-73.5" } });
    expect(d.coords).toEqual({ lat: 45.5, lng: -73.5 });
  });

  test("nulls coords with invalid numbers", () => {
    const d = normalizeDeal({ title: "X", coords: { lat: "junk", lng: 10 } });
    expect(d.coords).toBeNull();
  });

  test("handles missing coords", () => {
    expect(normalizeDeal({ title: "X" }).coords).toBeNull();
  });

  test("defaults address to empty string", () => {
    expect(normalizeDeal({ title: "X" }).address).toBe("");
  });
});

describe("stageColor", () => {
  test("returns color for a known stage", () => {
    const expected = STAGES.find((s) => s.id === "prospection").color;
    expect(stageColor("prospection")).toBe(expected);
  });

  test("returns neutral fallback for unknown stage", () => {
    expect(stageColor("not_a_stage")).toBe("#6B7280");
  });
});

describe("buildLeadIdentityKey", () => {
  test("uses company + address + contact when present", () => {
    const k = buildLeadIdentityKey({
      companyName: "ACME Inc",
      buildingAddress: "123 rue X",
      contactName: "Jean Tremblay",
    });
    expect(k.startsWith("c:")).toBe(true);
    expect(k).toContain("acme inc");
    expect(k).toContain("123 rue x");
    expect(k).toContain("jean tremblay");
  });

  test("falls back to phone hash when no name/address/contact", () => {
    const k = buildLeadIdentityKey({ phones: ["514-777-1234"] });
    expect(k).toBe("p:5147771234");
  });

  test("returns empty string when nothing usable", () => {
    expect(buildLeadIdentityKey({})).toBe("");
    expect(buildLeadIdentityKey()).toBe("");
  });

  test("same identity regardless of case / accents in company name", () => {
    const a = buildLeadIdentityKey({ companyName: "Café Central" });
    const b = buildLeadIdentityKey({ companyName: "CAFE CENTRAL" });
    expect(a).toBe(b);
  });
});

describe("getLeadPhones", () => {
  test("merges phones array + phone scalar + originalPhone", () => {
    const phones = getLeadPhones({
      phones: ["(514) 777-1234"],
      phone: "438-823-9999",
      originalPhone: "5147771234", // dup of first
    });
    expect(phones).toHaveLength(2);
  });

  test("returns [] when lead has no phones", () => {
    expect(getLeadPhones({})).toEqual([]);
    expect(getLeadPhones(null)).toEqual([]);
  });
});
