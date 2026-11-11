import { Router } from "express";
import { getAgenda } from "../controllers/agenda.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);
router.get("/", getAgenda);

export default router;
