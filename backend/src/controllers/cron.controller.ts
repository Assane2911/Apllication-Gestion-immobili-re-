import { Request, Response } from "express";
import { env } from "../config/env";
import { runContractEndingReminders, runRentDueReminders } from "../services/reminder.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

/**
 * Déclenché par Vercel Cron Jobs (voir vercel.json) une fois par jour.
 * Vercel envoie automatiquement `Authorization: Bearer <CRON_SECRET>` quand
 * la variable d'environnement CRON_SECRET est configurée sur le projet —
 * on vérifie cette valeur pour empêcher n'importe qui d'appeler la route.
 *
 * En développement local, ce même travail est aussi effectué par le
 * scheduler node-cron interne (voir services/reminder.service.ts et
 * index.ts) — cette route sert uniquement au déploiement serverless.
 */
export const triggerContractEndingReminders = asyncHandler(async (req: Request, res: Response) => {
  if (env.cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${env.cronSecret}`) {
      throw new ApiError(401, "Non autorisé");
    }
  } else {
    console.warn("[cron] CRON_SECRET non configuré : la route /api/cron/contract-reminders n'est pas protégée.");
  }

  const sent = await runContractEndingReminders();
  res.json({ success: true, remindersSent: sent });
});

/**
 * Déclenché par Vercel Cron Jobs le 1er de chaque mois pour envoyer
 * les alertes d'échéance de loyer aux locataires (délai de règlement : au plus tard le 5).
 */
export const triggerRentDueReminders = asyncHandler(async (req: Request, res: Response) => {
  if (env.cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${env.cronSecret}`) {
      throw new ApiError(401, "Non autorisé");
    }
  } else {
    console.warn("[cron] CRON_SECRET non configuré : la route /api/cron/rent-due-reminders n'est pas protégée.");
  }

  const result = await runRentDueReminders();
  res.json({
    success: true,
    message: `${result.sent} rappel(s) de loyer du 1er du mois envoyé(s)`,
    remindersSent: result.sent,
    details: result.details,
  });
});

