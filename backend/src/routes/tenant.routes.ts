import { Router } from "express";
import {
  anonymiserTenant,
  createTenant,
  createTenantPortalAccount,
  deleteTenant,
  exporterMesDonnees,
  exporterTenant,
  getTenant,
  getTenantIdDocumentUrl,
  listTenants,
  updateTenant,
} from "../controllers/tenant.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";
import { uploadTenantDocument } from "../middleware/upload";

const router = Router();

// Déclarée AVANT le router.use ci-dessous, qui réserve tout le reste du
// routeur aux gestionnaires : c'est la seule route de ce fichier destinée au
// locataire lui-même, qui exerce son droit d'accès sans avoir personne à
// solliciter. Elle porte donc ses propres middlewares.
router.get("/mine/export", authenticate, requireRole("TENANT"), exporterMesDonnees);

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listTenants);
router.get("/:id", getTenant);
router.post("/", uploadTenantDocument.single("idDocument"), createTenant);
router.put("/:id", uploadTenantDocument.single("idDocument"), updateTenant);
router.delete("/:id", deleteTenant);
router.post("/:id/portal-account", createTenantPortalAccount);
// Droit à l'effacement : la seule issue quand un historique interdit la suppression.
router.post("/:id/anonymiser", anonymiserTenant);
// Droit d'accès et portabilité : le dossier complet, en un fichier.
router.get("/:id/export", exporterTenant);
router.get("/:id/id-document-url", getTenantIdDocumentUrl);

export default router;
