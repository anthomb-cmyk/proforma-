import {
  deriveSessionId,
  saveSession,
  loadSession,
  clearSession,
  listSessions,
} from "./enrichmentSession.js";

const KEYS = ["pf_enrichment_session_v1__index"];
function clearAll() {
  try {
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith("pf_enrichment_session_v1")) localStorage.removeItem(k);
    });
    KEYS.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

describe("deriveSessionId", () => {
  test("same packages → same id", () => {
    const a = [{ lead_owner_name: "A" }, { lead_owner_name: "B" }];
    const b = [{ lead_owner_name: "A" }, { lead_owner_name: "B" }];
    expect(deriveSessionId(a)).toBe(deriveSessionId(b));
  });
  test("different packages → different id", () => {
    const a = [{ lead_owner_name: "A" }];
    const b = [{ lead_owner_name: "B" }];
    expect(deriveSessionId(a)).not.toBe(deriveSessionId(b));
  });
  test("empty / null → empty string", () => {
    expect(deriveSessionId([])).toBe("");
    expect(deriveSessionId(null)).toBe("");
  });
});

describe("save / load / clear session", () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  test("round-trip preserves Map / Set state", () => {
    const sid = "s_test_1";
    const state = {
      allEnrichedResults: new Map([
        ["k1", { status: "ready_to_call", bestPhone: "5145550100" }],
        ["k2", { status: "needs_review", bestPhone: null }],
      ]),
      enrichedKeys: new Set(["k1", "k2"]),
      exportedKeys: new Set(["k1"]),
      reviewDecisions: new Map([["k2", { decision: "skipped", at: 100 }]]),
    };
    expect(saveSession(sid, state)).toBe(true);
    const loaded = loadSession(sid);
    expect(loaded).not.toBeNull();
    expect(loaded.allEnrichedResults.size).toBe(2);
    expect(loaded.allEnrichedResults.get("k1").bestPhone).toBe("5145550100");
    expect(loaded.enrichedKeys.has("k1")).toBe(true);
    expect(loaded.exportedKeys.has("k1")).toBe(true);
    expect(loaded.reviewDecisions.get("k2").decision).toBe("skipped");
  });

  test("load returns null for unknown session", () => {
    expect(loadSession("unknown")).toBeNull();
  });

  test("clearSession removes the session and updates the index", () => {
    saveSession("s1", { allEnrichedResults: new Map([["k", { status: "ready_to_call" }]]) });
    saveSession("s2", { allEnrichedResults: new Map() });
    expect(listSessions().length).toBe(2);
    clearSession("s1");
    expect(loadSession("s1")).toBeNull();
    expect(listSessions().length).toBe(1);
    expect(listSessions()[0].sessionId).toBe("s2");
  });

  test("listSessions returns most-recent first, capped at 20", () => {
    for (let i = 0; i < 25; i++) {
      saveSession(`s_${i}`, { allEnrichedResults: new Map() });
    }
    const idx = listSessions();
    expect(idx.length).toBe(20);
    // Most recent first.
    expect(idx[0].sessionId).toBe("s_24");
  });

  test("missing sessionId is a no-op", () => {
    expect(saveSession("", { allEnrichedResults: new Map() })).toBe(false);
    expect(loadSession("")).toBeNull();
  });
});
