import { Router } from "express";
import { exportGrandLivre, getAnnualSynthesis } from "../controllers/fiscal.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/synthese", getAnnualSynthesis);
router.get("/grand-livre", exportGrandLivre);

export default router;
