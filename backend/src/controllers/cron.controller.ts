import crypto from "crypto";
import { Request, Response } from "express";
import { env } from "../config/env";
import { runContractEndingReminders, runRentDueReminders, runUpcomingRentDueReminders } from "../services/reminder.service";
import { purgerDonneesDeLaPlateforme } from "../services/conservation.service";
import { budgetTemps } from "../utils/budgetTemps";
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
/**
 * Compare l'en-tete d'autorisation au secret attendu en TEMPS CONSTANT.
 *
 * `!==` s'arrete au premier caractere qui differe : la duree de la comparaison
 * depend donc du nombre de caracteres devines, ce qui permet en principe de
 * reconstituer le secret octet par octet. L'attaque est difficile a mener a
 * travers le reseau, mais la parade ne coute rien et le webhook Stripe compare
 * deja sa signature ainsi (voir stripe.controller.ts) : deux facons de
 * comparer un secret dans la meme application, c'est une de trop.
 *
 * timingSafeEqual exige des longueurs egales et leve sinon. On compare donc
 * les EMPREINTES des deux valeurs : toujours 32 octets, quelle que soit la
 * longueur de l'en-tete recu, qui reste ainsi sans influence sur la duree.
 */
function secretValide(recu: string | undefined, attendu: string): boolean {
  if (typeof recu !== "string") return false;
  const empreinte = (valeur: string) => crypto.createHash("sha256").update(valeur).digest();
  return crypto.timingSafeEqual(empreinte(recu), empreinte(attendu));
}

function assertCronAuthorized(req: Request) {
  if (env.cronSecret) {
    if (!secretValide(req.headers.authorization, `Bearer ${env.cronSecret}`)) {
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

  const { sent, echecs, interrompu } = await runContractEndingReminders(budgetTemps(env.cronBudgetMs));
  res.json({ success: true, remindersSent: sent, echecs, interrompu });
});

/**
 * LA tâche planifiée quotidienne : c'est la seule route que vercel.json
 * déclare en fréquence journalière, et elle enchaîne tout ce qui doit être
 * fait chaque jour.
 *
 * Elle inclut désormais runRentDueReminders — génération des factures du mois
 * et avis d'échéance — qui ne dépendait jusqu'ici que du cron mensuel. Un
 * échec de cette unique invocation privait tout le mois de facturation sans
 * aucune reprise ; l'appel quotidien supprime ce point unique de défaillance,
 * et l'idempotence par facture (`reminderSentAt`) garantit qu'aucun locataire
 * n'est prévenu deux fois.
 *
 * Les trois travaux se partagent UN SEUL budget de temps : ils s'exécutent
 * dans la même fonction serverless, donc dans la même limite de durée. Le
 * budget est consulté avant chaque élément et ce qui n'a pas été traité est
 * repris le lendemain (voir utils/budgetTemps.ts).
 *
 * Chaque route individuelle reste disponible ci-dessous pour un déclenchement
 * manuel ou ponctuel.
 */
export const triggerDailyReminders = asyncHandler(async (req: Request, res: Response) => {
  assertCronAuthorized(req);

  const budget = budgetTemps(env.cronBudgetMs);

  // Purge des données de la PLATEFORME uniquement — jetons périmés, vieux
  // journaux. Deux requêtes d'ensemble, donc hors budget de temps. Aucune
  // donnée locative n'est touchée ici : voir conservation.service.ts.
  const purge = await purgerDonneesDeLaPlateforme();

  const contractEnding = await runContractEndingReminders(budget);
  const upcoming = await runUpcomingRentDueReminders(budget);
  const rentDue = await runRentDueReminders(undefined, budget);

  res.json({
    success: true,
    purge,
    contractEndingRemindersSent: contractEnding.sent,
    upcomingRentDueRemindersSent: upcoming.sent,
    rentDueRemindersSent: rentDue.sent,
    // Les envois qui ont VRAIMENT échoué. Leur marqueur a été relâché, donc
    // ils repartiront demain — mais un cron qui annonce « 40 envoyés » sans
    // dire que 40 ont échoué ne se distingue pas d'un cron qui a réussi.
    echecs: contractEnding.echecs + upcoming.echecs + rentDue.echecs,
    // Vrai dès qu'un des trois travaux s'est arrêté faute de temps : le
    // reliquat n'est pas perdu, il sera traité à la prochaine exécution.
    interrompu: contractEnding.interrompu || upcoming.interrompu || rentDue.interrompu,
    details: upcoming.details,
  });
});

/**
 * Génération des factures du mois et avis d'échéance aux locataires.
 *
 * Toujours déclenchée par le cron mensuel déclaré dans vercel.json, mais ce
 * n'en est plus l'unique déclencheur : /daily fait le même travail chaque
 * jour (voir triggerDailyReminders). Les deux peuvent coexister sans rien
 * envoyer en double — la facture déjà traitée porte son `reminderSentAt`.
 */
export const triggerRentDueReminders = asyncHandler(async (req: Request, res: Response) => {
  assertCronAuthorized(req);

  const result = await runRentDueReminders(undefined, budgetTemps(env.cronBudgetMs));
  res.json({
    success: true,
    message: `${result.sent} avis d'échéance de loyer envoyé(s)`,
    remindersSent: result.sent,
    echecs: result.echecs,
    interrompu: result.interrompu,
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

  const result = await runUpcomingRentDueReminders(budgetTemps(env.cronBudgetMs));
  res.json({
    success: true,
    message: `${result.sent} rappel(s) "avant échéance" envoyé(s)`,
    remindersSent: result.sent,
    echecs: result.echecs,
    interrompu: result.interrompu,
    details: result.details,
  });
});

