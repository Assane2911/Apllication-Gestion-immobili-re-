import { Router } from "express";
import { getAgencySettings, updateAgencySettings } from "../controllers/agency.controller";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"));

router.get("/", getAgencySettings);
router.put("/", updateAgencySettings);

export default router;
