import { SK, load, isQuotaError, persist } from "./storage.js";

describe("SK", () => {
  test("is the versioned CRM storage key", () => {
    expect(SK).toBe("acq_crm_v4");
  });
});

describe("isQuotaError", () => {
  test("returns false for falsy input", () => {
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
    expect(isQuotaError(0)).toBe(false);
  });

  test("detects modern QuotaExceededError by name", () => {
    const err = { name: "QuotaExceededError" };
    expect(isQuotaError(err)).toBe(true);
  });

  test("detects Firefox quota error by name", () => {
    const err = { name: "NS_ERROR_DOM_QUOTA_REACHED" };
    expect(isQuotaError(err)).toBe(true);
  });

  test("detects legacy IE/Edge codes 22 and 1014", () => {
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError({ code: 1014 })).toBe(true);
  });

  test("returns false for unrelated errors", () => {
    expect(isQuotaError({ name: "TypeError", code: 0 })).toBe(false);
    expect(isQuotaError(new Error("boom"))).toBe(false);
  });
});

describe("load / persist", () => {
  // jest-environment-jsdom provides a real localStorage implementation.
  beforeEach(() => {
    localStorage.clear();
  });

  test("load returns null on empty storage", () => {
    expect(load()).toBeNull();
  });

  test("persist then load roundtrips the state", () => {
    const state = { deals: [{ id: "a", title: "T" }], leads: [], currentId: null, gcalOk: true };
    persist(state);
    expect(load()).toEqual(state);
  });

  test("load returns null on corrupted JSON", () => {
    localStorage.setItem(SK, "{not json");
    expect(load()).toBeNull();
  });

  test("persist calls onError with a quota-shaped error when setItem throws", () => {
    const fakeErr = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    // Spy on the prototype; jsdom resolves localStorage.setItem through it,
    // so direct reassignment on the instance wouldn't intercept the call.
    const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw fakeErr;
    });

    const seen = [];
    persist({ deals: [] }, (err) => seen.push(err));
    expect(seen).toHaveLength(1);
    expect(isQuotaError(seen[0])).toBe(true);

    spy.mockRestore();
  });
});
