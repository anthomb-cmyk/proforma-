// Free-form address input backed by the Photon (OSM) autocomplete service,
// biased toward Quebec. Filters to Canadian results only. Debounces user
// input by 400 ms and cancels in-flight requests with AbortController so a
// slow response to an early keystroke can't overwrite fresher suggestions.

import { useState, useRef, useEffect, useCallback } from "react";

export default function AddressAutocomplete({ value, onChange, onSelect, placeholder, style }) {
  const [suggestions, setSuggestions] = useState([]);
  const [dropRect, setDropRect] = useState(null);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  // AbortController lets us cancel the in-flight Photon request when the user
  // keeps typing. Without it, a slow response to an early keystroke can
  // overwrite the suggestions the user is actually looking at.
  const abortRef = useRef(null);

  const fetchSuggestions = useCallback(async (query) => {
    if (!query || query.length < 3) { setSuggestions([]); return; }
    // Cancel any request still in flight before starting a new one.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const q = encodeURIComponent(query);
    try {
      // Photon: autocomplete engine on OSM data, biased toward Quebec (Montreal coords)
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${q}&lat=45.5088&lon=-73.5878&limit=6&lang=fr`,
        { headers: { Accept: "application/json" }, signal: controller.signal }
      );
      if (!res.ok) { setSuggestions([]); return; }
      const data = await res.json();
      const features = data?.features;
      if (!Array.isArray(features) || features.length === 0) { setSuggestions([]); return; }
      const results = features
        .filter(f => {
          // Keep only Canadian results
          const country = f.properties?.country || "";
          return /canada/i.test(country);
        })
        .map(f => {
          const p = f.properties || {};
          const parts = [
            p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street || p.name || "",
            p.city || p.town || p.village || p.county || "",
            p.state || ""
          ].filter(Boolean);
          const label = parts.join(", ");
          const [lng, lat] = f.geometry?.coordinates || [null, null];
          return { label, lat: Number(lat), lng: Number(lng) };
        })
        .filter(r => r.label && Number.isFinite(r.lat));
      setSuggestions(results);
      if (inputRef.current && results.length > 0) {
        const rect = inputRef.current.getBoundingClientRect();
        setDropRect({ top: rect.bottom, left: rect.left, width: rect.width });
      }
    } catch (err) {
      // Aborts are expected when the user keeps typing — ignore those.
      if (err?.name !== "AbortError") setSuggestions([]);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        onChange={e => {
          onChange(e.target.value);
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => fetchSuggestions(e.target.value), 400);
        }}
        onBlur={() => setTimeout(() => setSuggestions([]), 200)}
        placeholder={placeholder}
        style={style}
      />
      {suggestions.length > 0 && dropRect && (
        <div style={{
          position:"fixed", top:dropRect.top, left:dropRect.left, width:dropRect.width,
          background:"#fff", border:"1px solid #e0d9cc", borderRadius:6,
          boxShadow:"0 4px 16px rgba(0,0,0,0.13)", zIndex:9999,
          maxHeight:220, overflowY:"auto"
        }}>
          {suggestions.map((s, i) => (
            <div key={i}
              style={{padding:"9px 12px",cursor:"pointer",fontSize:13,color:"#3a2e1e",borderBottom:"1px solid #f0ede8",lineHeight:1.4}}
              onMouseDown={() => { onSelect(s); setSuggestions([]); }}
            >
              {s.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
