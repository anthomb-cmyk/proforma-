// Pure formatting helpers used throughout the UI.
// Must remain side-effect-free so they can be unit-tested and imported from
// anywhere in the bundle.

export const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
export const DAYS   = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];

export function fmtSz(b) {
  return b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

export function fileIco(t) {
  if (t?.includes("pdf")) return "📄";
  if (t?.includes("image")) return "🖼️";
  // Check spreadsheet shapes first: the xlsx mime
  // `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  // contains "document" via "officedocument", so a naive "document" check
  // below would mis-flag it as Word. Match the more specific
  // sheet/excel/spreadsheet/csv tokens before the Word hints.
  if (t?.includes("sheet") || t?.includes("excel") || t?.includes("spreadsheet") || t?.includes("csv")) return "📊";
  if (t?.includes("word") || t?.includes("document")) return "📝";
  return "📎";
}

export function initials(name, fallback = "DL") {
  const n = (name || "").trim();
  if (!n) return fallback;
  const parts = n.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || fallback;
}

// Returns a 6-week (42-cell) month grid with previous/next month padding.
// Each cell: { d: dayOfMonth, m: monthIndex, y: year, other: boolean }
export function calDays(y, m) {
  const first = new Date(y, m, 1).getDay();
  const dim   = new Date(y, m + 1, 0).getDate();
  const dprev = new Date(y, m, 0).getDate();
  const days  = [];
  for (let i = first - 1; i >= 0; i--) days.push({ d: dprev - i, m: m - 1, y, other: true });
  for (let i = 1; i <= dim; i++)        days.push({ d: i, m, y, other: false });
  while (days.length < 42)              days.push({ d: days.length - dim - first + 1, m: m + 1, y, other: true });
  return days;
}

export function dayKey({ d, m, y }) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function fmtCallDateTime(value) {
  if (!value) return "Date inconnue";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date inconnue";
  return date.toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" });
}

export function fmtDurationSeconds(value) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m${rem > 0 ? ` ${rem}s` : ""}`;
}

// HTML-escape for interpolation into email/SMS templates and anywhere we
// generate markup from user input.
export function esc(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
