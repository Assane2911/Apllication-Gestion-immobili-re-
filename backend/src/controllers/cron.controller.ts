import { Request, Response } from "express";
import { env } from "../config/env";
import { runContractEndingReminders, runRentDueReminders, runUpcomingRentDueReminders } from "../services/reminder.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

/**
 * Vérifie l'autorisation d'un appel aux routes cron. Si CRON_SECRET est
 * configuré, on exige `Authorization: Bearer <secret>` (c'est ce que Vercel
 * Cron Jobs envoie automatiquement). Si CRON_SECRET n'est PAS configuré :
 * on bloque en production (fail-closed — un oubli de configuration ne doit
 * jamais laisser une route capable d'envoyer des emails en masse ouverte à
 * n'importe qui), et on se contente d'un avertissement en développement
 * local pour ne pas gêner les tests.
 */
function assertCronAuthorized(req: Request) {
  if (env.cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${env.cronSecret}`) {
      throw new ApiError(401, "Non autorisé");
    }
    return;
  }

  // Fail-closed par défaut : on n'autorise l'absence de CRON_SECRET QUE si on
  // est sûr d'être en développement local. env.nodeEnv retombe silencieusement
  // sur "development" si NODE_ENV n'est pas défini (voir config/env.ts) — un
  // simple `=== "production"` restait donc vulnérable si NODE_ENV venait à
  // manquer sur Vercel. `VERCEL === "1"` est positionné automatiquement par
  // la plateforme sur CHAQUE déploiement, quel que soit NODE_ENV : on l'utilise
  // en complément pour ne jamais se fier au seul NODE_ENV en production
  // serverless.
  const isConfidentlyLocalDev = env.nodeEnv === "development" && process.env.VERCEL !== "1";
  if (!isConfidentlyLocalDev) {
    throw new ApiError(500, "CRON_SECRET non configuré : route désactivée par sécurité.");
  }
  console.warn("[cron] CRON_SECRET non configuré (développement) : route non protégée.");
}

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
  assertCronAuthorized(req);

  const sent = await runContractEndingReminders();
  res.json({ success: true, remindersSent: sent });
});

/**
 * Combine en un seul appel les deux tâches planifiées QUOTIDIENNES (rappel de
 * fin de contrat + rappel "avant échéance"/passage en retard) afin de tenir
 * dans la limite de 2 cron jobs par projet du plan Vercel Hobby — voir
 * vercel.json, qui ne déclare que cette route (quotidienne) et
 * /rent-due-reminders (mensuelle) plutôt que les 3 routes séparément.
 * Chaque route individuelle reste disponible ci-dessous pour un
 * déclenchement manuel/ponctuel.
 */
export const triggerDailyReminders = asyncHandler(async (req: Request, res: Response) => {
  assertCronAuthorized(req);

  const contractEndingRemindersSent = await runContractEndingReminders();
  const upcoming = await runUpcomingRentDueReminders();

  res.json({
    success: true,
    contractEndingRemindersSent,
    upcomingRentDueRemindersSent: upcoming.sent,
    details: upcoming.details,
  });
});

/**
 * Déclenché par Vercel Cron Jobs le 1er de chaque mois pour envoyer
 * les alertes d'échéance de loyer aux locataires (délai de règlement : au plus tard le 5).
 */
export const triggerRentDueReminders = asyncHandler(async (req: Request, res: Response) => {
  assertCronAuthorized(req);

  const result = await runRentDueReminders();
  res.json({
    success: true,
    message: `${result.sent} rappel(s) de loyer du 1er du mois envoyé(s)`,
    remindersSent: result.sent,
    details: result.details,
  });
});

/**
 * Déclenché par Vercel Cron Jobs une fois par jour pour envoyer le rappel
 * complémentaire "avant échéance" (J-3 par défaut) aux locataires dont la
 * facture est encore impayée.
 */
export const triggerUpcomingRentDueReminders = asyncHandler(async (req: Request, res: Response) => {
  assertCronAuthorized(req);

  const result = await runUpcomingRentDueReminders();
  res.json({
    success: true,
    message: `${result.sent} rappel(s) "avant échéance" envoyé(s)`,
    remindersSent: result.sent,
    details: result.details,
  });
});

