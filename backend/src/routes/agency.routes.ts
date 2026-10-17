import { Router } from "express";
import {
  deleteAgencyLogo,
  getAgencyBankInfoForTenant,
  getAgencySettings,
  updateAgencySettings,
  uploadLogo,
} from "../controllers/agency.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";
import { uploadAgencyLogo } from "../middleware/upload";

const router = Router();

// Portail locataire (toujours accessible, avant le verrou gestionnaire ci-dessous).
router.get("/mine", authenticate, requireRole("TENANT"), getAgencyBankInfoForTenant);

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", getAgencySettings);
router.put("/", updateAgencySettings);
router.post("/logo", uploadAgencyLogo.single("logo"), uploadLogo);
router.delete("/logo", deleteAgencyLogo);

export default router;
