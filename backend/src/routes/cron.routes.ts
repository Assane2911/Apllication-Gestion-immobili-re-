import { Router } from "express";
import {
  triggerContractEndingReminders,
  triggerDailyReminders,
  triggerRentDueReminders,
  triggerUpcomingRentDueReminders,
} from "../controllers/cron.controller";
import { cronLimiter } from "../middleware/rateLimit";

const router = Router();

// Profondeur de défense : la comparaison en temps constant du secret
// (assertCronAuthorized) empêche une attaque par mesure de timing, mais pas
// un nombre illimité de tentatives réseau pour le deviner par force brute.
router.use(cronLimiter);

// GET, car c'est la méthode utilisée par Vercel Cron Jobs pour invoquer une
// route planifiée. "/daily" est la route réellement déclarée dans vercel.json :
// elle enchaîne les trois travaux quotidiens (fin de bail, avant échéance,
// factures du mois + avis d'échéance) dans une seule invocation, qu'elles
// partagent avec un budget de temps commun.
//
// Le regroupement ne tenait autrefois qu'à une contrainte supposée du plan
// Hobby — « 2 cron jobs par projet » — qui n'existe plus : Vercel en autorise
// 100 par projet sur tous les plans. Ce qui subsiste sur Hobby, c'est une
// exécution par jour au plus et un déclenchement à l'heure près (une tâche
// prévue à 8h peut partir jusqu'à 8h59). Le regroupement reste donc un choix,
// et non une nécessité : il garantit que les trois travaux voient le même
// instant et se partagent une seule durée de fonction.
//
// Les routes individuelles restent disponibles pour un déclenchement manuel.
router.get("/daily", triggerDailyReminders);
router.get("/contract-reminders", triggerContractEndingReminders);
router.get("/rent-due-reminders", triggerRentDueReminders);
router.get("/rent-due-soon-reminders", triggerUpcomingRentDueReminders);

export default router;
