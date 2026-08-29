import { Router } from "express";
import {
  createTenant,
  createTenantPortalAccount,
  deleteTenant,
  getTenant,
  getTenantIdDocumentUrl,
  listTenants,
  updateTenant,
} from "../controllers/tenant.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";
import { uploadTenantDocument } from "../middleware/upload";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listTenants);
router.get("/:id", getTenant);
router.post("/", uploadTenantDocument.single("idDocument"), createTenant);
router.put("/:id", uploadTenantDocument.single("idDocument"), updateTenant);
router.delete("/:id", deleteTenant);
router.post("/:id/portal-account", createTenantPortalAccount);
router.get("/:id/id-document-url", getTenantIdDocumentUrl);

export default router;
