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

  // Per-package endpoint — the workhorse for the orchestrator-driven client.
  // One package per HTTP call, ~10-30s max, well under any HTTP timeout. The
  // 2000-row workflow uses this exclusively when "Use per-package mode" is
  // on (default since Phase 2). Backward compatible: /preview is unchanged.
  //
  // NB: PR #24 merged the *tests* for this route but the route itself was
  // dropped from the diff. Restoring here closes the live regression where
  // per-package mode silently returns 404 in production.
  router.post("/single", async (req, res) => {
    const pkg = req.body?.package;
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
      return res.status(400).json({ ok: false, error: "package required (single object)." });
    }

    const searchFn = createSearchFn();
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
        packages: [pkg],
        limit: 1,
        searchFn,
        fetchPageFn,
      });
      // Always return the single result object directly so the client doesn't
      // need to unwrap an array of length 1.
      return res.json({ ok: true, result: results[0] || null });
    } catch (err) {
      console.error("[contact-enrichment/single] pipeline error:", err);
      return res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  return router;
}
