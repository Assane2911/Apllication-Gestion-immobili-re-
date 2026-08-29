import { Router } from "express";
import { getNotifications } from "../controllers/notification.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);
router.get("/", getNotifications);

export default router;
