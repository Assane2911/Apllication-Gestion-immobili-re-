import { Router } from "express";
import { listerEcheances } from "../controllers/conservation.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

// Lecture seule : voir listerEcheances pour la raison.
router.get("/echeances", listerEcheances);

export default router;
