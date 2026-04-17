// Compact activity log input for a deal. Quick buttons (pre-baked
// activity labels) fire onLog synchronously. Free-form text gets split
// by newlines so a pasted multi-line update becomes several log entries,
// and can be re-formatted through the /api/ai/summarize endpoint before
// logging. Stateless w.r.t. the global CRM state — the parent decides
// what onLog actually does with the text.

import { useState } from "react";

export default function ActivityLogger({ dealId, onLog }) {
  const [text, setText] = useState("");
  const [formatLoading, setFormatLoading] = useState(false);
  const [formatError, setFormatError] = useState("");
  const QUICK = ["📞 Appel effectué","📧 Email envoyé","🤝 Rencontre faite","💰 Offre déposée","📋 Documents reçus","🔍 Inspection faite","🏦 Dossier financier soumis","✅ Condition levée"];

  function splitActivityLines(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map(line => line.trim().replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean);
  }

  function logCurrentText() {
    const lines = splitActivityLines(text);
    if (!lines.length) return;
    lines.forEach(line => onLog(dealId, line));
    setText("");
    setFormatError("");
  }

  async function formatActivityText() {
    if (!text.trim()) return;
    setFormatLoading(true);
    setFormatError("");
    try {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "deal", text }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Erreur ${res.status}`);
      }
      setText(String(data.summary || "").trim());
    } catch (err) {
      setFormatError(String(err?.message || "Formatage impossible."));
    } finally {
      setFormatLoading(false);
    }
  }

  return (
    <div>
      <div className="qa-wrap">
        {QUICK.map(q => <button key={q} className="qa-btn" onClick={() => onLog(dealId, q)}>{q}</button>)}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8}}>
        <button className={`ai-btn${formatLoading ? " loading" : ""}`} onClick={formatActivityText}>
          {formatLoading ? "Formatage..." : "✦ Formater la note"}
        </button>
        {formatError && <span style={{fontSize:11,color:"var(--red)"}}>{formatError}</span>}
      </div>
      <div style={{display:"flex",gap:8}}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Note personnalisée…"
          onKeyDown={e => { if (e.key === "Enter" && text.trim()) { logCurrentText(); } }} />
        <button className="btn btn-gold" onClick={logCurrentText}>Log</button>
      </div>
    </div>
  );
}
