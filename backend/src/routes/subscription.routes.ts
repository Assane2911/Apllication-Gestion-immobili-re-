import { Router } from "express";
import {
  cancelSubscription,
  getPlans,
  getStatus,
  subscribe,
} from "../controllers/subscription.controller";
import { getPlatformBankInfoForManager } from "../controllers/platformSettings.controller";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();

// Route publique : consultation des offres tarifaires
router.get("/plans", getPlans);

// Routes privées gestionnaire : statut de la période d'essai et souscription
router.get("/status", authenticate, requireRole("MANAGER"), getStatus);
router.post("/subscribe", authenticate, requireRole("MANAGER"), subscribe);
router.post("/cancel", authenticate, requireRole("MANAGER"), cancelSubscription);
// Coordonnées bancaires de LA PLATEFORME (pas celles d'une agence), pour le
// gestionnaire qui règle son abonnement par virement — voir
// platformSettings.controller.ts.
router.get("/bank-details", authenticate, requireRole("MANAGER"), getPlatformBankInfoForManager);

export default router;
