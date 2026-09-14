import { Router } from "express";
import { getAgencyBankInfoForTenant, getAgencySettings, updateAgencySettings } from "../controllers/agency.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

// Portail locataire (toujours accessible, avant le verrou gestionnaire ci-dessous).
router.get("/mine", authenticate, requireRole("TENANT"), getAgencyBankInfoForTenant);

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", getAgencySettings);
router.put("/", updateAgencySettings);

export default router;
