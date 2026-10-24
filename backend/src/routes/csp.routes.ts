import { Router } from "express";
import { recevoirRapportCsp } from "../controllers/csp.controller";
import { cspLimiter } from "../middleware/rateLimit";

const router = Router();

// Public (voir csp.controller.ts) : limité par adresse IP, n'écrit rien en base.
router.post("/", cspLimiter, recevoirRapportCsp);

export default router;
