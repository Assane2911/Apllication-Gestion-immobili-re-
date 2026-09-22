import { Router } from "express";
import { getContractLease, getInspectionReport, getInvoiceReceipt, getScannedLease } from "../controllers/document.controller";
import { authenticate, requireActiveSubscription } from "../middleware/auth";

const router = Router();

// Même règle que les biens, contrats et factures : un gestionnaire dont
// l'abonnement est terminé n'émet plus de documents — une quittance est un
// document légal, produit par un service qui n'est plus payé. Ces routes
// servent AUSSI les locataires et les propriétaires : le middleware les
// laisse passer sans condition (voir requireActiveSubscription), ils ne sont
// donc jamais pénalisés par l'abonnement de leur gestionnaire.
router.use(authenticate, requireActiveSubscription);

router.get("/receipt/:invoiceId", getInvoiceReceipt);
router.get("/lease/:contractId", getContractLease);
router.get("/lease-scan/:contractId", getScannedLease);
router.get("/inspection/:inspectionId", getInspectionReport);

export default router;
