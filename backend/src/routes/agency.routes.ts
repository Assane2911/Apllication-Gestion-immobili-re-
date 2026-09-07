import { Router } from "express";
import { getAgencySettings, updateAgencySettings } from "../controllers/agency.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", getAgencySettings);
router.put("/", updateAgencySettings);

export default router;
