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

  test("falls back to manual_review_accepted relationship when none provided", () => {
    const out = applyAcceptedDecision({ status: "needs_review" }, null);
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
