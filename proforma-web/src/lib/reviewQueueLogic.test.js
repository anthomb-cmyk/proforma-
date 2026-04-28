import {
  filterReviewableEntries,
  summarizeSession,
  applyAcceptedDecision,
  pickPrimaryCandidate,
  REVIEW_STATUSES,
} from "./reviewQueueLogic.js";

function entry(key, status, extra = {}) {
  return [key, { status, ...extra }];
}

describe("filterReviewableEntries", () => {
  test("includes only needs_review / ready_to_email by default", () => {
    const entries = [
      entry("a", "ready_to_call"),
      entry("b", "needs_review"),
      entry("c", "ready_to_email"),
      entry("d", "no_contact_found"),
    ];
    const out = filterReviewableEntries(entries, new Map());
    expect(out.map((x) => x.packageKey)).toEqual(["b", "c"]);
  });

  test("hides accepted / rejected by default; honors flags", () => {
    const entries = [
      entry("b", "needs_review"),
      entry("c", "needs_review"),
      entry("d", "needs_review"),
    ];
    const dec = new Map([
      ["b", { decision: "accepted" }],
      ["c", { decision: "rejected" }],
    ]);
    expect(filterReviewableEntries(entries, dec).map((x) => x.packageKey)).toEqual(["d"]);
    expect(filterReviewableEntries(entries, dec, { includeAccepted: true }).map((x) => x.packageKey))
      .toEqual(["b", "d"]);
    expect(filterReviewableEntries(entries, dec, { includeRejected: true }).map((x) => x.packageKey))
      .toEqual(["c", "d"]);
  });

  test("skipped entries remain in queue", () => {
    const entries = [entry("b", "needs_review")];
    const dec = new Map([["b", { decision: "skipped" }]]);
    const out = filterReviewableEntries(entries, dec);
    expect(out.length).toBe(1);
    expect(out[0].decision).toBe("skipped");
  });
});

describe("summarizeSession", () => {
  test("counts statuses + decisions correctly", () => {
    const m = new Map([
      ["a", { status: "ready_to_call" }],
      ["b", { status: "needs_review" }],
      ["c", { status: "needs_review" }],
      ["d", { status: "ready_to_email" }],
      ["e", { status: "no_contact_found" }],
      ["f", { status: "skipped_existing_phone" }],
    ]);
    const dec = new Map([
      ["b", { decision: "accepted" }],
      ["c", { decision: "rejected" }],
    ]);
    const s = summarizeSession(m, dec);
    expect(s.total).toBe(6);
    expect(s.ready).toBe(1);
    expect(s.review).toBe(2);
    expect(s.email).toBe(1);
    expect(s.none).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.accepted).toBe(1);
    expect(s.rejected).toBe(1);
  });
});

describe("applyAcceptedDecision", () => {
  test("promotes to ready_to_call and copies candidate fields", () => {
    const result = {
      status: "needs_review",
      bestPhone: null,
      evidence: ["weak_name_match: …"],
    };
    const cand = {
      raw: "5145550100",
      belongsTo: "Acme",
      relationship: "manual",
      confidence: "high",
    };
    const out = applyAcceptedDecision(result, cand);
    expect(out.status).toBe("ready_to_call");
    expect(out.bestPhone).toBe("5145550100");
    expect(out.bestPhoneBelongsTo).toBe("Acme");
    expect(out.phoneRelationship).toBe("manual");
    expect(out.evidence.some((e) => /manual_accept/.test(e))).toBe(true);
    // Original is not mutated.
    expect(result.status).toBe("needs_review");
  });

  test("falls back to manual_review_accepted relationship when candidatePhone has raw but no named phone", () => {
    // candidatePhone provided but no raw/phone field — resolves bestPhone from result.bestPhone
    const out = applyAcceptedDecision({ status: "needs_review", bestPhone: "5145550100" }, null);
    expect(out.status).toBe("ready_to_call");
    expect(out.phoneRelationship).toBe("manual_review_accepted");
  });
});

describe("pickPrimaryCandidate", () => {
  test("uses bestPhone when present", () => {
    const c = pickPrimaryCandidate({ bestPhone: "514-555-0100", bestPhoneBelongsTo: "X" });
    expect(c.raw).toBe("514-555-0100");
    expect(c.digits).toBe("5145550100");
  });
  test("falls back to first phoneCandidates entry", () => {
    const c = pickPrimaryCandidate({ phoneCandidates: [{ raw: "1", belongsTo: "Y" }] });
    expect(c.raw).toBe("1");
  });
  test("returns null on empty result", () => {
    expect(pickPrimaryCandidate(null)).toBeNull();
    expect(pickPrimaryCandidate({})).toBeNull();
  });
});

test("REVIEW_STATUSES export", () => {
  expect(REVIEW_STATUSES.has("needs_review")).toBe(true);
  expect(REVIEW_STATUSES.has("ready_to_email")).toBe(true);
  expect(REVIEW_STATUSES.has("ready_to_call")).toBe(false);
});

// ─── Phase 4: computeReviewSignals tests ─────────────────────────────────────

import { computeReviewSignals } from "./reviewQueueLogic.js";

describe("computeReviewSignals", () => {
  // ── Test 1: URL matches owner name → positive signal ─────────────────────
  test("URL containing owner name token yields URL-match positive signal", () => {
    const result = {
      lead_owner_name: "Gestion Tremblay Inc.",
      bestPhone: "(514) 555-0100",
      bestPhoneBelongsTo: "Gestion Tremblay Inc.",
      bestWebsite: "https://gestiontremblay.ca",
      phoneRelationship: "direct_entity_match",
      phoneCandidates: [],
    };
    const { signals, recommendation } = computeReviewSignals(result);
    expect(signals.some((s) => s.text === "URL matches owner name")).toBe(true);
    expect(signals.some((s) => s.kind === "positive")).toBe(true);
  });

  // ── Test 2: bestPhoneBelongsTo shares distinctive token with owner ────────
  test('"Belongs to" matching owner name yields positive signal', () => {
    const result = {
      lead_owner_name: "Immobilier Dumont Inc.",
      bestPhone: "(514) 555-0101",
      bestPhoneBelongsTo: "Gestion Immobilier Dumont",
      bestWebsite: "",
      phoneRelationship: "mailing",
      phoneCandidates: [],
    };
    const { signals } = computeReviewSignals(result);
    expect(signals.some((s) => s.text === '"Belongs to" matches owner')).toBe(true);
  });

  // ── Test 3: exact_director_match relationship → positive ──────────────────
  test("exact_director_match relationship yields director positive signal", () => {
    const result = {
      lead_owner_name: "Placements ABC Inc.",
      bestPhone: "(514) 555-0102",
      bestPhoneBelongsTo: "Jean Lalonde",
      bestWebsite: "",
      phoneRelationship: "exact_director_match",
      phoneCandidates: [],
    };
    const { signals } = computeReviewSignals(result);
    expect(signals.some((s) => s.text === "Exact director/co-owner match")).toBe(true);
    expect(signals.some((s) => s.kind === "positive")).toBe(true);
  });

  // ── Test 4: high confidence candidate → positive signal ──────────────────
  test("top phoneCandidates with nameMatch=true and score>=5 yields High confidence signal", () => {
    const result = {
      lead_owner_name: "Les Immeubles XYZ Inc.",
      bestPhone: "(514) 555-0103",
      bestPhoneBelongsTo: "Les Immeubles XYZ Inc.",
      bestWebsite: "",
      phoneRelationship: "direct_entity_match",
      phoneCandidates: [{ nameMatch: true, score: 7, raw: "(514) 555-0103" }],
    };
    const { signals } = computeReviewSignals(result);
    expect(signals.some((s) => s.text === "High confidence match")).toBe(true);
  });

  // ── Test 5: toll-free number → negative signal ────────────────────────────
  test("1-800 number yields toll-free negative signal", () => {
    const result = {
      lead_owner_name: "Gestion Leblanc Inc.",
      bestPhone: "1-800-555-0100",
      // Use a belongsTo that shares no distinctive tokens with owner name to
      // ensure no positive "Belongs to" signal fires.
      bestPhoneBelongsTo: "Services Généraux Corporatifs",
      bestWebsite: "",
      phoneRelationship: "directory_match",
      phoneCandidates: [],
    };
    const { signals, recommendation } = computeReviewSignals(result);
    expect(signals.some((s) => s.text === "Toll-free number")).toBe(true);
    expect(signals.some((s) => s.kind === "negative")).toBe(true);
    // No positives present → recommendation should be reject
    expect(recommendation).toBe("reject");
  });

  // ── Test 6: generic directory URL + no nameMatch → negative signal ────────
  test("generic directory URL with no nameMatch yields directory negative signal", () => {
    const result = {
      lead_owner_name: "Placements Martin Inc.",
      bestPhone: "(514) 555-0105",
      bestPhoneBelongsTo: "Unknown Company",
      bestWebsite: "https://www.yellowpages.ca/some-listing",
      phoneRelationship: "directory_match",
      phoneCandidates: [{ nameMatch: false, score: 2 }],
    };
    const { signals } = computeReviewSignals(result);
    expect(signals.some((s) => s.text === "Generic directory listing")).toBe(true);
  });

  // ── Test 7: places_fallback relationship → neutral signal ─────────────────
  test("places_fallback relationship yields neutral Places signal", () => {
    const result = {
      lead_owner_name: "Gestion ACME Inc.",
      bestPhone: "(514) 555-0106",
      bestPhoneBelongsTo: "ACME Services Inc.",
      bestWebsite: "",
      phoneRelationship: "places_fallback",
      phoneCandidates: [],
    };
    const { signals } = computeReviewSignals(result);
    expect(signals.some((s) => s.text === "Found via Places fallback")).toBe(true);
    expect(signals.some((s) => s.kind === "neutral")).toBe(true);
  });

  // ── Test 8: recommendation logic — mixed signals → verify; empty → verify ──
  test("mixed positive+negative signals yield verify; empty result yields verify", () => {
    // Mixed: URL match (positive) + toll-free (negative)
    const mixed = {
      lead_owner_name: "Tremblay Gestion Inc.",
      bestPhone: "1-888-555-0100",
      bestPhoneBelongsTo: "Tremblay Gestion Inc.",
      bestWebsite: "https://tremblayGestion.ca",
      phoneRelationship: "direct_entity_match",
      phoneCandidates: [],
    };
    const { recommendation: r1 } = computeReviewSignals(mixed);
    expect(r1).toBe("verify");

    // Empty result
    const { recommendation: r2, signals: s2 } = computeReviewSignals({});
    expect(r2).toBe("verify");
    expect(s2.length).toBe(0);

    // Null result
    const { recommendation: r3 } = computeReviewSignals(null);
    expect(r3).toBe("verify");
  });
});

describe("applyAcceptedDecision — phone gating (P1 audit fix)", () => {
  test("accept with explicit phone candidate → ready_to_call", () => {
    const r = applyAcceptedDecision({ status: "needs_review" }, { raw: "5145550100", belongsTo: "X" });
    expect(r.status).toBe("ready_to_call");
    expect(r.bestPhone).toBe("5145550100");
  });

  test("accept with existing bestPhone and null candidate → ready_to_call (preserves bestPhone)", () => {
    const r = applyAcceptedDecision({ status: "needs_review", bestPhone: "5145550100" }, null);
    expect(r.status).toBe("ready_to_call");
    expect(r.bestPhone).toBe("5145550100");
  });

  test("accept with email only (no phone) → ready_to_email, no bestPhone", () => {
    const r = applyAcceptedDecision(
      { status: "ready_to_email", bestEmail: "x@y.ca", bestPhone: null },
      null
    );
    expect(r.status).toBe("ready_to_email");
    expect(r.bestPhone).toBeFalsy();
    expect(r.evidence.some((e) => /promoted to ready_to_email/.test(e))).toBe(true);
  });

  test("accept with no phone and no email → does NOT become ready_to_call", () => {
    const r = applyAcceptedDecision({ status: "needs_review" }, null);
    expect(r.status).toBe("needs_review");
    expect(r.bestPhone).toBeFalsy();
    expect(r.evidence.some((e) => /no contact data/.test(e))).toBe(true);
  });
});
