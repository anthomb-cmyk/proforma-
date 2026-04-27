// routes/contactEnrichment.js
//
// Route factory for POST /api/contact-enrichment/preview.
// Dev-only endpoint — no auth required; not wired into production flows.
//
// Dependencies are injected so the route stays unit-testable.

import { Router } from "express";
import { runContactEnrichmentPreview } from "../services/contactEnrichmentPipeline.js";

/**
 * @param {object} deps
 * @param {Function} deps.createSearchFn   () => searchFn — factory that returns
 *   the current web-search function (called per request so key changes take effect).
 * @param {Function} [deps.fetchPageFn]    async (url) => html | null
 * @returns {import("express").Router}
 */
export function createContactEnrichmentRouter({ createSearchFn, fetchPageFn }) {
  const router = Router();

  router.post("/preview", async (req, res) => {
    const packages = req.body?.packages;
    if (!Array.isArray(packages) || !packages.length) {
      return res.status(400).json({ ok: false, error: "packages[] required." });
    }

    const rawLimit = req.body?.limit;
    const limit = Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : 5;

    const searchFn = createSearchFn();

    // Guard: if the provider isn't configured return a helpful 503 instead of
    // silently returning empty results for every package.
    const probe = await searchFn("probe");
    if (!probe.ok && probe.error === "WEB_SEARCH_NOT_CONFIGURED") {
      return res.status(503).json({
        ok: false,
        error: "WEB_SEARCH_NOT_CONFIGURED",
        message:
          "Set WEB_SEARCH_PROVIDER=brave and BRAVE_SEARCH_API_KEY (or SERPER_API_KEY) to use this endpoint.",
      });
    }

    try {
      const results = await runContactEnrichmentPreview({
        packages,
        limit,
        searchFn,
        fetchPageFn,
      });
      return res.json({ ok: true, results });
    } catch (err) {
      console.error("[contact-enrichment] pipeline error:", err);
      return res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  return router;
}
