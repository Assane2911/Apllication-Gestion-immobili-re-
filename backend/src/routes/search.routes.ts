import { Router } from "express";
import { globalSearch } from "../controllers/search.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", globalSearch);

export default router;
