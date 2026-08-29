import { Router } from "express";
import { getContractLease, getInvoiceReceipt } from "../controllers/document.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);

router.get("/receipt/:invoiceId", getInvoiceReceipt);
router.get("/lease/:contractId", getContractLease);

export default router;
