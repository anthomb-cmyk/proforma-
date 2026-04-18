// Tiny toast helper hook. Collapses the `setToast("...")` + `setTimeout(() =>
// setToast(""), N)` pattern that was duplicated ~10 times across the
// PhoneFinder + LeadsManager pages into a single call.
//
// Design notes:
//   - A single timer ref. Each new showToast() cancels the previous timer so
//     overlapping toasts don't cross-schedule each other into empty state
//     prematurely (old bug: toast A fires its timer AFTER toast B displays,
//     blanking B 500ms early).
//   - The timer is cleared on unmount, eliminating React's "can't perform a
//     React state update on an unmounted component" dev warning that fired
//     whenever the user navigated away during a lingering toast.
//   - `duration` defaults to 4000 — the median of the inline callers that
//     used 3500/4000/5000/6000. Callers that want custom timing pass it
//     explicitly; 0 means "show until manually cleared".
//
// Usage:
//   const { toast, showToast, clearToast } = useToast();
//   showToast("Sauvegardé !");          // default 4s
//   showToast("Erreur réseau", 6000);    // 6s
//   showToast("Important", 0);           // sticky

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_DURATION = 4000;

export default function useToast(defaultDuration = DEFAULT_DURATION) {
  const [toast, setToast] = useState("");
  const timerRef = useRef(null);

  // Clear any pending hide-timer; used both on unmount and each time a
  // new toast displaces the previous one.
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showToast = useCallback((message, duration = defaultDuration) => {
    clearTimer();
    setToast(String(message ?? ""));
    // A 0 duration means the caller owns the lifetime — useful for errors
    // the user should explicitly dismiss by taking an action.
    if (duration > 0) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setToast("");
      }, duration);
    }
  }, [defaultDuration, clearTimer]);

  const clearToast = useCallback(() => {
    clearTimer();
    setToast("");
  }, [clearTimer]);

  // Paired with the clearTimer in showToast: if the host component
  // unmounts while a toast is up, make sure the pending setState never
  // fires on a dead component.
  useEffect(() => clearTimer, [clearTimer]);

  return { toast, showToast, clearToast };
}
