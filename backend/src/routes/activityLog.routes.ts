import { Router } from "express";
import { listActivityLogs } from "../controllers/activityLog.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listActivityLogs);

export default router;
