import { useRef, useState } from "react";

const MAX_MS = 60_000;

function cleanupText(raw) {
  let t = (raw || "").trim();
  if (!t) return "";
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

export default function VoiceDictation({ onTranscript }) {
  const [phase, setPhase] = useState("idle"); // idle | recording | loading | error
  const recRef   = useRef(null);
  const chunksRef = useRef([]);
  const timerRef  = useRef(null);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setPhase("loading");
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        try {
          const fd = new FormData();
          fd.append("audio", blob, "recording.webm");
          const r = await fetch("/api/transcribe", { method: "POST", body: fd });
          const d = await r.json().catch(() => ({}));
          if (d.ok && d.text) {
            onTranscript(cleanupText(d.text));
          } else {
            showError();
          }
        } catch {
          showError();
        }
        setPhase("idle");
      };
      recRef.current = rec;
      rec.start();
      setPhase("recording");
      timerRef.current = setTimeout(stop, MAX_MS);
    } catch {
      showError();
    }
  }

  function stop() {
    clearTimeout(timerRef.current);
    if (recRef.current?.state === "recording") recRef.current.stop();
  }

  function showError() {
    setPhase("error");
    setTimeout(() => setPhase("idle"), 3000);
  }

  const handleClick = () => {
    if (phase === "idle") start();
    else if (phase === "recording") stop();
  };

  const label = phase === "loading" ? "…"
              : phase === "error"   ? "⚠"
              : "🎤";

  return (
    <>
      <button
        type="button"
        className={`vd-btn${phase === "recording" ? " vd-rec" : ""}`}
        onClick={handleClick}
        disabled={phase === "loading"}
        title={phase === "recording" ? "Arrêter l'enregistrement" : "Dicter une note"}
        aria-label={phase === "recording" ? "Arrêter" : "Dicter"}
      >
        {label}
      </button>
      <style>{`
        .vd-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border: 1px solid var(--border, #E5DFC8);
          border-radius: 6px;
          background: #fff;
          cursor: pointer;
          font-size: 14px;
          color: var(--text, #2D2A24);
          flex-shrink: 0;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .vd-btn:hover:not(:disabled) {
          border-color: #D9C07A;
          box-shadow: 0 0 0 2px #F5EDD6;
        }
        .vd-btn:disabled { opacity: 0.5; cursor: default; }
        .vd-btn.vd-rec {
          border-color: #e53e3e;
          color: #e53e3e;
          animation: vd-pulse 1.2s ease-in-out infinite;
        }
        @keyframes vd-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(229,62,62,0.4); }
          50%       { box-shadow: 0 0 0 5px rgba(229,62,62,0); }
        }
      `}</style>
    </>
  );
}
