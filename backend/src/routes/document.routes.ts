import { Router } from "express";
import { getContractLease, getInspectionReport, getInvoiceReceipt, getScannedLease } from "../controllers/document.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);

router.get("/receipt/:invoiceId", getInvoiceReceipt);
router.get("/lease/:contractId", getContractLease);
router.get("/lease-scan/:contractId", getScannedLease);
router.get("/inspection/:inspectionId", getInspectionReport);

export default router;
