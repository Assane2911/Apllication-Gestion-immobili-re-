import { Router } from "express";
import {
  cancelSubscription,
  getPlans,
  getStatus,
  subscribe,
} from "../controllers/subscription.controller";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();

// Route publique : consultation des offres tarifaires
router.get("/plans", getPlans);

// Routes privées gestionnaire : statut de la période d'essai et souscription
router.get("/status", authenticate, requireRole("MANAGER"), getStatus);
router.post("/subscribe", authenticate, requireRole("MANAGER"), subscribe);
router.post("/cancel", authenticate, requireRole("MANAGER"), cancelSubscription);

export default router;
