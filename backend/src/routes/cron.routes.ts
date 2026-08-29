import { Router } from "express";
import { triggerContractEndingReminders } from "../controllers/cron.controller";

const router = Router();

// GET, car c'est la méthode utilisée par Vercel Cron Jobs pour invoquer une route planifiée.
router.get("/contract-reminders", triggerContractEndingReminders);

export default router;
