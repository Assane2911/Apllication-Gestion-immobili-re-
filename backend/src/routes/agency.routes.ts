import { Router } from "express";
import {
  deleteAgencyLogo,
  deleteAgencyStamp,
  getAgencyBankInfoForTenant,
  getAgencySettings,
  updateAgencySettings,
  uploadLogo,
  uploadStamp,
} from "../controllers/agency.controller";
import { deleteComptePaiement, getComptePaiement, patchComptePaiement, putComptePaiement } from "../controllers/comptePaiementAgence.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";
import { uploadAgencyLogo, uploadAgencyStamp } from "../middleware/upload";

const router = Router();

// Portail locataire (toujours accessible, avant le verrou gestionnaire ci-dessous).
router.get("/mine", authenticate, requireRole("TENANT"), getAgencyBankInfoForTenant);

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", getAgencySettings);
router.put("/", updateAgencySettings);
router.post("/logo", uploadAgencyLogo.single("logo"), uploadLogo);
router.delete("/logo", deleteAgencyLogo);
router.post("/stamp", uploadAgencyStamp.single("stamp"), uploadStamp);
router.delete("/stamp", deleteAgencyStamp);
// Compte PayDunya de l'agence (loyers payés en ligne directement chez elle).
router.get("/payment-account", getComptePaiement);
router.put("/payment-account", putComptePaiement);
router.patch("/payment-account", patchComptePaiement);
router.delete("/payment-account", deleteComptePaiement);

export default router;
