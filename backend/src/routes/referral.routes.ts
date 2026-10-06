import { Router } from "express";
import { getMyReferral } from "../controllers/referral.controller";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();

// Pas de requireActiveSubscription : un gestionnaire en essai doit pouvoir
// parrainer pour prolonger son essai, c'est précisément le cas où la
// récompense sert le plus.
router.use(authenticate, requireRole("MANAGER"));
router.get("/", getMyReferral);

export default router;
