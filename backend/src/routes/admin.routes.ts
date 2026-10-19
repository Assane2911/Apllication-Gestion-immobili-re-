import { Router } from "express";
import {
  confirmBankTransfer,
  getManagerDetail,
  getPlatformDashboardStats,
  listAdminAuditLogs,
  listManagers,
  listPendingBankTransfers,
  reactivateManager,
  rejectBankTransfer,
  suspendManager,
} from "../controllers/admin.controller";
import { exportAuditCsv, exportManagersCsv } from "../controllers/adminExport.controller";
import { deleteManager } from "../controllers/adminSuppression.controller";
import { hideListing, listAdminListings, restoreListing, setListingFeatured } from "../controllers/adminListing.controller";
import { changeManagerPlan, grantSubscriptionDays, grantUnlimitedAccess, revokeUnlimitedAccess } from "../controllers/adminSubscription.controller";
import { getPlatformSettings, updatePlatformSettings } from "../controllers/platformSettings.controller";
import { listSuggestions, updateSuggestion } from "../controllers/suggestion.controller";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();

// Toutes les routes admin sont réservées au rôle ADMIN — aucune inscription
// publique ne mène à ce rôle, il est attribué manuellement en base.
router.use(authenticate, requireRole("ADMIN"));

router.get("/dashboard/stats", getPlatformDashboardStats);
router.get("/subscriptions/pending-bank-transfers", listPendingBankTransfers);
router.post("/subscriptions/:id/confirm-bank-transfer", confirmBankTransfer);
router.post("/subscriptions/:id/reject-bank-transfer", rejectBankTransfer);
router.get("/managers", listManagers);
router.get("/managers/:id", getManagerDetail);
router.post("/managers/:id/suspend", suspendManager);
router.delete("/managers/:id", deleteManager);
router.post("/managers/:id/reactivate", reactivateManager);
router.post("/managers/:id/subscription/grant-days", grantSubscriptionDays);
router.post("/managers/:id/subscription/change-plan", changeManagerPlan);
router.post("/managers/:id/subscription/grant-unlimited", grantUnlimitedAccess);
router.post("/managers/:id/subscription/revoke-unlimited", revokeUnlimitedAccess);
router.get("/audit-logs", listAdminAuditLogs);
router.get("/exports/managers.csv", exportManagersCsv);
router.get("/exports/audit-logs.csv", exportAuditCsv);
router.get("/listings", listAdminListings);
router.post("/listings/:id/hide", hideListing);
router.post("/listings/:id/restore", restoreListing);
router.post("/listings/:id/featured", setListingFeatured);
router.get("/settings", getPlatformSettings);
router.put("/settings", updatePlatformSettings);
router.get("/suggestions", listSuggestions);
router.patch("/suggestions/:id", updateSuggestion);

export default router;
