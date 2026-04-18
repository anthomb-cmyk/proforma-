// Rough cost estimator for a phone-lookup batch. The backend pipeline
// issues a mix of Places Text Search + Places Details calls per row,
// and both SKUs are billed per call at 2025 public pricing:
//
//   Places Text Search (Essentials):   $0.032 / call  ($32 per 1000)
//   Places Details — Contact fields:   $0.017 / call  ($17 per 1000)
//
// See https://mapsplatform.google.com/pricing/ for the latest rates;
// Google moved to SKU-based pricing in 2025 so these numbers are the
// Essentials tier, which the backend uses (textsearch + details with
// a narrow field mask).
//
// Per-row counts come from measuring the live backend — a typical
// commercial row fires 1–3 text searches and 2–5 details calls
// depending on how many candidates each query returns and whether
// the radius fallback kicks in. Cache hits inside a batch reduce
// the effective cost further. The estimator returns a range so the
// UI can display both an optimistic and a pessimistic number.

export const TEXTSEARCH_COST = 0.032;
export const DETAILS_COST = 0.017;

// Per-row call-count assumptions, chosen conservatively so we over-
// estimate rather than surprise the user with a higher bill. Actual
// numbers observed on production batches:
//   lo  — cache-friendly runs where similar addresses dedupe
//   hi  — cold runs on unique addresses hitting the radius fallback
const PER_ROW_LO = { textSearch: 1, details: 2 };
const PER_ROW_HI = { textSearch: 3, details: 5 };

export function estimateLookupCost(rowCount, { residentialRatio = 0 } = {}) {
  const count = Math.max(0, Math.round(rowCount || 0));
  // Residential rows (isResidential in the backend) short-circuit
  // before any API call, so they cost $0. The caller can pass an
  // estimate of the residential share; default assumes worst-case
  // (all rows hit Google).
  const ratio = Math.max(0, Math.min(1, residentialRatio));
  const billable = count * (1 - ratio);
  const lo = billable * (PER_ROW_LO.textSearch * TEXTSEARCH_COST + PER_ROW_LO.details * DETAILS_COST);
  const hi = billable * (PER_ROW_HI.textSearch * TEXTSEARCH_COST + PER_ROW_HI.details * DETAILS_COST);
  return {
    rowCount: count,
    billableRows: billable,
    lo,
    hi,
    // Midpoint is what we show as the headline estimate; the range is
    // available for callers that want to emphasize uncertainty.
    mid: (lo + hi) / 2,
    callsLoTextSearch: billable * PER_ROW_LO.textSearch,
    callsHiTextSearch: billable * PER_ROW_HI.textSearch,
    callsLoDetails: billable * PER_ROW_LO.details,
    callsHiDetails: billable * PER_ROW_HI.details,
  };
}

// Format a dollar amount for display. Under $1 we show 2 decimals
// ("$0.48"); over $1 we drop to whole-dollar precision so "$24"
// reads cleanly in the UI instead of "$23.87".
export function formatCost(n) {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 10) return `$${n.toFixed(1)}`;
  return `$${Math.round(n)}`;
}
