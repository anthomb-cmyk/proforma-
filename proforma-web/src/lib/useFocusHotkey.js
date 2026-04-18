// Registers a Cmd/Ctrl+K keyboard shortcut that focuses (and selects the
// existing contents of) the element held by `ref`. This is the same
// convention used by Linear, GitHub, Notion, Slack, VS Code, etc. — users
// already expect Cmd+K to drop their cursor into the page's search box.
//
// Usage:
//   const searchRef = useRef(null);
//   useFocusHotkey(searchRef);
//   ...
//   <input ref={searchRef} className="tb-search" ... />
//
// Behavior notes:
//   - Listens to `keydown` on document, scoped per-hook mount (so two pages
//     that both call it won't double-focus; only the mounted one is active).
//   - Requires meta (Cmd on mac) OR ctrl (Windows/Linux) to be down. We
//     intentionally do NOT fire on a bare "k" keypress — that would steal
//     the key while the user is typing in a textarea / contenteditable.
//   - Calls `preventDefault()` so the browser's own Cmd+K behavior (which
//     in Chrome focuses the address bar on some platforms and in Firefox
//     opens the web search field) doesn't steal focus from our input.
//   - Calls `.select()` after `.focus()` so the existing query is
//     highlighted — matching Cmd+L in browsers. User just starts typing
//     to replace; arrow keys to position the cursor inside the existing
//     text if they want to edit.
//   - Guards on `isComposing` to avoid stealing the shortcut from an IME
//     dead-key sequence (same guard as useEscapeKey).
//
// Why a ref (vs. an id/selector):
//   Refs survive rerenders and don't depend on a stable DOM id. The caller
//   wires it directly to the input with `ref={searchRef}`.

import { useEffect } from "react";

export default function useFocusHotkey(ref, { key = "k" } = {}) {
  useEffect(() => {
    const handler = (e) => {
      if (e.isComposing) return;
      // Require Cmd (mac) or Ctrl (everywhere else). Using `metaKey ||
      // ctrlKey` makes the shortcut work cross-platform without branching
      // on navigator.platform (which is deprecated anyway).
      if (!(e.metaKey || e.ctrlKey)) return;
      // Match the key case-insensitively. e.key is "k" or "K" depending on
      // Shift state; we accept either.
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      const el = ref && ref.current;
      if (!el) return;
      e.preventDefault();
      // focus() can throw if the element was unmounted between ref capture
      // and the event; swallow silently — the next keypress will find a
      // fresh ref.
      try {
        el.focus();
        if (typeof el.select === "function") el.select();
      } catch {
        // no-op
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [ref, key]);
}
