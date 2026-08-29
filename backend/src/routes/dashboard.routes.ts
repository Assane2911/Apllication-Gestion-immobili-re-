import { Router } from "express";
import { getDashboardStats } from "../controllers/dashboard.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.get("/stats", authenticate, requireRole("MANAGER"), requireActiveSubscription, getDashboardStats);

export default router;
