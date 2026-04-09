import { Router } from "express";

export function createListingsRouter({ listingsService }) {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const listings = await listingsService.loadListingsMap();
      res.json({ ok: true, listings });
    } catch {
      res.status(500).json({
        ok: false,
        error: "Impossible de lire listings.json."
      });
    }
  });

  return router;
}
