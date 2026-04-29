import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ProformaCalculator from "./features/proforma/ProformaCalculator.jsx";

const root = createRoot(document.getElementById("root"));
const isProformaLab = window.location.pathname === "/proforma-lab";

root.render(
  <React.StrictMode>
    {isProformaLab ? <ProformaCalculator /> : <App />}
  </React.StrictMode>
);

// ─── Service worker registration ──────────────────────────────────────────
// Register after load so SW setup never blocks first paint. Only runs on
// production builds over HTTPS (or localhost); browsers ignore SW on http://.
// The hot-reload dev server serves react-scripts' own HMR worker, so we
// deliberately skip registration in development.
if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("Service worker registration failed:", err);
      });
  });
}
