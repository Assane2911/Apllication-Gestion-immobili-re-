import { Router } from "express";
import { importerCsv, previsualiserImport, telechargerModele } from "../controllers/import.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/modele/:type", telechargerModele);
router.post("/preview", previsualiserImport);
router.post("/", importerCsv);

export default router;
