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
import { cancelRentRevision, createRentRevision, listRentRevisions } from "../controllers/rentRevision.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";
import { uploadContractScan } from "../middleware/upload";

const router = Router();

router.get("/mine", authenticate, requireRole("TENANT"), myContracts);
router.post("/:id/sign", authenticate, signContract);

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);
router.get("/", listContracts);
router.get("/:id", getContract);
router.post("/", createContract);
router.post("/:id/scan", uploadContractScan.single("scan"), uploadScannedContract);
router.post("/:id/renew", renewContract);
router.get("/:id/rent-revisions", listRentRevisions);
router.post("/:id/rent-revisions", createRentRevision);
router.delete("/:id/rent-revisions/:revisionId", cancelRentRevision);
router.put("/:id/deposit-refund", recordDepositRefund);
router.put("/:id", updateContract);
router.delete("/:id", deleteContract);

export default router;
