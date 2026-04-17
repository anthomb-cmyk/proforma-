import {
  fmtSz,
  fileIco,
  initials,
  calDays,
  dayKey,
  fmtCallDateTime,
  fmtDurationSeconds,
  esc,
  MONTHS,
  DAYS,
} from "./format.js";

describe("fmtSz", () => {
  test("renders KB under 1 MB", () => {
    expect(fmtSz(500)).toBe("0 KB");
    expect(fmtSz(1024)).toBe("1 KB");
    expect(fmtSz(1048575)).toBe("1024 KB");
  });

  test("renders MB at or above 1 MB", () => {
    expect(fmtSz(1048576)).toBe("1.0 MB");
    expect(fmtSz(1572864)).toBe("1.5 MB");
  });
});

describe("fileIco", () => {
  test("picks icons by mime fragment", () => {
    expect(fileIco("application/pdf")).toBe("📄");
    expect(fileIco("image/png")).toBe("🖼️");
    expect(fileIco("application/msword")).toBe("📝");
    expect(fileIco("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("📝");
    expect(fileIco("application/vnd.ms-excel")).toBe("📊");
    expect(fileIco("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("📊");
  });

  test("falls back for unknown types", () => {
    expect(fileIco("application/zip")).toBe("📎");
    expect(fileIco(undefined)).toBe("📎");
  });
});

describe("initials", () => {
  test("returns two-letter uppercase initials", () => {
    expect(initials("Jean Tremblay")).toBe("JT");
    expect(initials("Marie-Claire Dubois")).toBe("MD");
  });

  test("drops to one when single word", () => {
    expect(initials("Cher")).toBe("C");
  });

  test("uses fallback for empty/null", () => {
    expect(initials("")).toBe("DL");
    expect(initials(null)).toBe("DL");
    expect(initials("", "XX")).toBe("XX");
  });
});

describe("calDays", () => {
  test("returns 42 cells", () => {
    expect(calDays(2026, 0)).toHaveLength(42);
  });

  test("cells flagged 'other' for padding", () => {
    const days = calDays(2026, 0); // January 2026 starts Thursday
    const inMonthCount = days.filter((d) => !d.other).length;
    expect(inMonthCount).toBe(31);
  });
});

describe("dayKey", () => {
  test("formats as YYYY-MM-DD with zero padding", () => {
    expect(dayKey({ d: 5, m: 0, y: 2026 })).toBe("2026-01-05");
    expect(dayKey({ d: 31, m: 11, y: 2026 })).toBe("2026-12-31");
  });
});

describe("fmtCallDateTime", () => {
  test("formats valid ISO date (locale fr-CA)", () => {
    const formatted = fmtCallDateTime("2026-04-17T14:30:00Z");
    expect(typeof formatted).toBe("string");
    expect(formatted).not.toBe("Date inconnue");
  });

  test("returns 'Date inconnue' for falsy/invalid", () => {
    expect(fmtCallDateTime(null)).toBe("Date inconnue");
    expect(fmtCallDateTime("")).toBe("Date inconnue");
    expect(fmtCallDateTime("not a date")).toBe("Date inconnue");
  });
});

describe("fmtDurationSeconds", () => {
  test("returns 0s for non-positive", () => {
    expect(fmtDurationSeconds(0)).toBe("0s");
    expect(fmtDurationSeconds(-5)).toBe("0s");
    expect(fmtDurationSeconds("junk")).toBe("0s");
    expect(fmtDurationSeconds(null)).toBe("0s");
  });

  test("formats seconds under a minute", () => {
    expect(fmtDurationSeconds(42)).toBe("42s");
  });

  test("formats minutes + optional seconds", () => {
    expect(fmtDurationSeconds(60)).toBe("1m");
    expect(fmtDurationSeconds(125)).toBe("2m 5s");
  });
});

describe("esc", () => {
  test("escapes HTML-special characters", () => {
    expect(esc("<script>")).toBe("&lt;script&gt;");
    expect(esc('a & b "c" \'d\'')).toBe("a &amp; b &quot;c&quot; &#39;d&#39;");
  });

  test("passes through plain text", () => {
    expect(esc("hello")).toBe("hello");
    expect(esc("")).toBe("");
  });

  test("stringifies non-strings", () => {
    expect(esc(42)).toBe("42");
    expect(esc(null)).toBe("null");
  });
});

describe("MONTHS / DAYS", () => {
  test("12 months + 7 days, in French", () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS[0]).toBe("Janvier");
    expect(DAYS).toHaveLength(7);
    expect(DAYS[0]).toBe("Dim");
  });
});
