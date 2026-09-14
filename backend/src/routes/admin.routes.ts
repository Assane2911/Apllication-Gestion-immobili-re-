import { Router } from "express";
import { confirmBankTransfer, getPlatformDashboardStats, listPendingBankTransfers } from "../controllers/admin.controller";
import { getPlatformSettings, updatePlatformSettings } from "../controllers/platformSettings.controller";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();

// Toutes les routes admin sont réservées au rôle ADMIN — aucune inscription
// publique ne mène à ce rôle, il est attribué manuellement en base.
router.use(authenticate, requireRole("ADMIN"));

router.get("/dashboard/stats", getPlatformDashboardStats);
router.get("/subscriptions/pending-bank-transfers", listPendingBankTransfers);
router.post("/subscriptions/:id/confirm-bank-transfer", confirmBankTransfer);
router.get("/settings", getPlatformSettings);
router.put("/settings", updatePlatformSettings);

export default router;
