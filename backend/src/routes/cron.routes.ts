import { Router } from "express";
import {
  triggerContractEndingReminders,
  triggerDailyReminders,
  triggerRentDueReminders,
  triggerUpcomingRentDueReminders,
} from "../controllers/cron.controller";

const router = Router();

// GET, car c'est la méthode utilisée par Vercel Cron Jobs pour invoquer une route planifiée.
// "/daily" est la route réellement déclarée dans vercel.json (voir ce fichier) :
// elle combine fin-de-contrat + avant-échéance pour tenir dans la limite de
// 2 cron jobs du plan Vercel Hobby. Les 3 routes individuelles restent
// disponibles pour un déclenchement manuel/ponctuel.
router.get("/daily", triggerDailyReminders);
router.get("/contract-reminders", triggerContractEndingReminders);
router.get("/rent-due-reminders", triggerRentDueReminders);
router.get("/rent-due-soon-reminders", triggerUpcomingRentDueReminders);

export default router;
