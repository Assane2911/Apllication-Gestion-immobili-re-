import { Router } from "express";
import { getContractLease, getInvoiceReceipt, getScannedLease } from "../controllers/document.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);

router.get("/receipt/:invoiceId", getInvoiceReceipt);
router.get("/lease/:contractId", getContractLease);
router.get("/lease-scan/:contractId", getScannedLease);

export default router;
