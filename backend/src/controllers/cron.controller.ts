import { Request, Response } from "express";
import { env } from "../config/env";
import { runContractEndingReminders } from "../services/reminder.service";
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
