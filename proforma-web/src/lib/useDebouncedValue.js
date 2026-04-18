// Trailing-edge debounce hook for rapidly-changing values (typically
// controlled search inputs). Returns the last value that stayed stable for
// `delay` ms. The subscriber reads the debounced value, while the <input>
// stays bound to the raw state so typing feels instant.
//
// Usage:
//   const [input, setInput] = useState("");
//   const debounced = useDebouncedValue(input, 180);
//   const filtered = useMemo(() => filter(rows, debounced), [rows, debounced]);
//
// Why this instead of a throttle / rAF:
//   - Throttling fires on leading+intervals and wastes filter work on bursts.
//   - rAF is tied to frame rate; filter cost of 1000+ rows can miss a frame
//     and make typing feel laggy. A small fixed delay coalesces bursts.
//
// Why setTimeout (vs requestIdleCallback):
//   - rIC has no Safari support pre-17 and no determinism for short waits.

import { useEffect, useState } from "react";

export default function useDebouncedValue(value, delay = 180) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
