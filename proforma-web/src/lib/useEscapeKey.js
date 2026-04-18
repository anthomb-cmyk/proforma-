// Registers a document-level keydown listener that fires `onEscape` when the
// user presses Escape. Intended for modal close handlers — the convention
// across the app is that Escape dismisses any open modal.
//
// Only attaches when `active` is truthy so multiple hidden modals don't
// fight for the same keypress. Pass `active = Boolean(modalState)` so the
// listener goes away with the modal.
//
// The callback is held in a ref to avoid re-attaching the listener every
// time the callback identity changes (inline arrow functions would cause a
// listener attach/detach on every render otherwise).

import { useEffect, useRef } from "react";

export default function useEscapeKey(onEscape, active = true) {
  const cbRef = useRef(onEscape);
  // Always track the latest callback so the listener closure stays fresh
  // without a re-attach.
  cbRef.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => {
      // Honor composition / IME events — when typing an accented char via
      // dead keys, some browsers still fire Escape-like events; guard with
      // isComposing so we don't dismiss a modal while the user is typing.
      if (e.isComposing) return;
      if (e.key === "Escape" || e.key === "Esc") {
        const fn = cbRef.current;
        if (typeof fn === "function") fn(e);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active]);
}
