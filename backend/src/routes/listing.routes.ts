import { Router } from "express";
import {
  createListing,
  createPublicLead,
  deleteListing,
  getListing,
  getPublicListing,
  listListingLeads,
  listListings,
  listPublicCountries,
  listPublicListings,
  updateListing,
  updateListingLead,
} from "../controllers/listing.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";
import { uploadListingImage } from "../middleware/upload";
import { listingLeadLimiter } from "../middleware/rateLimit";

const router = Router();

// Vitrine publique : aucune authentification, comme GET /api/subscription/plans
// (voir subscription.routes.ts) — pas un `router.use(authenticate...)` global
// suivi d'une exception, puisqu'ici c'est l'inverse qui domine (la majorité
// de ce qui suit est public, seul le CRM gestionnaire est protégé).
router.get("/public", listPublicListings);
router.get("/public/countries", listPublicCountries);
router.get("/public/:id", getPublicListing);
router.post("/public/:id/leads", listingLeadLimiter, createPublicLead);

// CRM gestionnaire : "/leads" et "/leads/:id" sont enregistrées AVANT "/:id"
// ci-dessous, sans quoi Express ferait matcher "/leads" par la route
// dynamique "/:id" (id="leads") — jamais atteinte, la route CRM Leads.
router.get("/leads", authenticate, requireRole("MANAGER"), requireActiveSubscription, listListingLeads);
router.patch("/leads/:id", authenticate, requireRole("MANAGER"), requireActiveSubscription, updateListingLead);

router.get("/", authenticate, requireRole("MANAGER"), requireActiveSubscription, listListings);
router.get("/:id", authenticate, requireRole("MANAGER"), requireActiveSubscription, getListing);
router.post(
  "/",
  authenticate,
  requireRole("MANAGER"),
  requireActiveSubscription,
  uploadListingImage.single("image"),
  createListing
);
router.put(
  "/:id",
  authenticate,
  requireRole("MANAGER"),
  requireActiveSubscription,
  uploadListingImage.single("image"),
  updateListing
);
router.delete("/:id", authenticate, requireRole("MANAGER"), requireActiveSubscription, deleteListing);

export default router;
