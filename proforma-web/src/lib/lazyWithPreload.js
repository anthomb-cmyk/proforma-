// Wraps React.lazy with an extra `.preload()` method that triggers the
// dynamic-import ahead of time. Use it to prefetch a route's chunk on
// hover / focus of the nav entry that opens it — by the time the user
// actually clicks, webpack has the chunk cached and the Suspense
// fallback flashes for ~0ms instead of ~150ms.
//
// Usage:
//   const LeadsManager = lazyWithPreload(() => import("./pages/LeadsManager.jsx"));
//   // …
//   <button
//     onMouseEnter={LeadsManager.preload}
//     onFocus={LeadsManager.preload}
//     onClick={() => setView("leads")}
//   >Leads</button>
//
// The returned component behaves identically to React.lazy's output —
// same Suspense semantics, same named-vs-default rules. preload() is
// idempotent: webpack dedupes the import() promise internally so calling
// it 10 times just returns the cached chunk.
//
// Why attach to the component (vs. a separate object):
//   The caller usually only imports the component symbol; attaching
//   preload as a method keeps the call-site short and co-located with
//   the lazy definition. React itself doesn't look at extra properties
//   on lazy() results so this is safe.

import { lazy } from "react";

export default function lazyWithPreload(loader) {
  const Component = lazy(loader);
  // Fire-and-forget preload. Caller typically ignores the returned
  // promise; we return it anyway so tests / programmatic triggers can
  // await completion if they want.
  Component.preload = () => loader();
  return Component;
}
