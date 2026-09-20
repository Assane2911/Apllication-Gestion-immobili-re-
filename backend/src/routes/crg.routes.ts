import { Router } from "express";
import { exportCrgForOwner, exportMyCrg, getCrgForOwner, getMyCrg } from "../controllers/crg.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

// Espace propriétaire (CRG du propriétaire connecté) — avant le router.use
// ci-dessous, réservé au gestionnaire (même pattern que owner.routes.ts pour
// GET /mine/dashboard).
router.get("/mine", authenticate, requireRole("OWNER"), getMyCrg);
router.get("/mine/export", authenticate, requireRole("OWNER"), exportMyCrg);

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/:ownerId", getCrgForOwner);
router.get("/:ownerId/export", exportCrgForOwner);

export default router;
