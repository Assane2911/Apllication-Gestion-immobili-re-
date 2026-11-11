import { Router } from "express";
import { getAgenda, getAgendaSummary } from "../controllers/agenda.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);
router.get("/", getAgenda);
router.get("/summary", getAgendaSummary);

export default router;
