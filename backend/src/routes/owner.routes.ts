import { Router } from "express";
import {
  anonymiserOwner,
  createOwner,
  deleteOwner,
  getOwner,
  getOwnerDashboard,
  inviteOwnerPortalAccount,
  listOwners,
  updateOwner,
} from "../controllers/owner.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

// Portail propriétaire (résumé financier en lecture seule) — avant le
// router.use ci-dessous, réservé au gestionnaire (même pattern que
// contract.routes.ts pour GET /mine côté locataire).
router.get("/mine/dashboard", authenticate, requireRole("OWNER"), getOwnerDashboard);

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listOwners);
router.get("/:id", getOwner);
router.post("/", createOwner);
router.put("/:id", updateOwner);
router.delete("/:id", deleteOwner);
router.post("/:id/invite", inviteOwnerPortalAccount);
// Droit à l'effacement : la seule issue quand un bien associé interdit la suppression.
router.post("/:id/anonymiser", anonymiserOwner);

export default router;
