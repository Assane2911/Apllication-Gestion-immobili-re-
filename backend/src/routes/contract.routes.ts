import { Router } from "express";
import {
  createContract,
  deleteContract,
  getContract,
  listContracts,
  myContracts,
  recordDepositRefund,
  renewContract,
  signContract,
  updateContract,
  uploadScannedContract,
} from "../controllers/contract.controller";
import { cancelRentRevision, createRentRevision, listRentRevisions, listRevisionsDue } from "../controllers/rentRevision.controller";
import { createFormalNotice, listFormalNotices, listFormalNoticesDue } from "../controllers/formalNotice.controller";
import { addCotenant, listCotenants, removeCotenant } from "../controllers/cotenant.controller";
import { createGuarantor, deleteGuarantor, listGuarantors, updateGuarantor } from "../controllers/guarantor.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";
import { uploadContractScan } from "../middleware/upload";

const router = Router();

router.get("/mine", authenticate, requireRole("TENANT"), myContracts);
router.post("/:id/sign", authenticate, signContract);

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);
router.get("/", listContracts);
// Avant "/:id" : sinon « revisions-due » serait lu comme un identifiant de contrat.
router.get("/revisions-due", listRevisionsDue);
router.get("/formal-notices-due", listFormalNoticesDue);
router.get("/:id", getContract);
router.post("/", createContract);
router.post("/:id/scan", uploadContractScan.single("scan"), uploadScannedContract);
router.post("/:id/renew", renewContract);
router.get("/:id/rent-revisions", listRentRevisions);
router.post("/:id/rent-revisions", createRentRevision);
router.delete("/:id/rent-revisions/:revisionId", cancelRentRevision);
router.get("/:id/formal-notices", listFormalNotices);
router.post("/:id/formal-notices", createFormalNotice);
router.get("/:id/cotenants", listCotenants);
router.post("/:id/cotenants", addCotenant);
router.delete("/:id/cotenants/:cotenantId", removeCotenant);
router.get("/:id/guarantors", listGuarantors);
router.post("/:id/guarantors", createGuarantor);
router.put("/:id/guarantors/:guarantorId", updateGuarantor);
router.delete("/:id/guarantors/:guarantorId", deleteGuarantor);
router.put("/:id/deposit-refund", recordDepositRefund);
router.put("/:id", updateContract);
router.delete("/:id", deleteContract);

export default router;
