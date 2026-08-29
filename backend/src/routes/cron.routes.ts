import { Router } from "express";
import {
  triggerContractEndingReminders,
  triggerRentDueReminders,
  triggerUpcomingRentDueReminders,
} from "../controllers/cron.controller";

const router = Router();

// GET, car c'est la méthode utilisée par Vercel Cron Jobs pour invoquer une route planifiée.
router.get("/contract-reminders", triggerContractEndingReminders);
router.get("/rent-due-reminders", triggerRentDueReminders);
router.get("/rent-due-soon-reminders", triggerUpcomingRentDueReminders);

export default router;
