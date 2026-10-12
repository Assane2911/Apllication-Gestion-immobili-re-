import * as Sentry from "@sentry/node";
import crypto from "crypto";
import { Request, Response } from "express";
import { env } from "../config/env";
import {
  runContractEndingReminders,
  runInsurancePolicyExpiryReminders,
  runRentDueReminders,
  runUpcomingRentDueReminders,
} from "../services/reminder.service";
import { purgerDonneesDeLaPlateforme } from "../services/conservation.service";
import { markOverdueInvoices } from "../services/invoice.service";
import { runRecurringExpenseGeneration } from "../services/recurringExpense.service";
import { runOverdueReminders } from "../services/relances.service";
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

/** Une étape du travail quotidien qui a échoué : son nom, et la raison. */
interface EtapeEnEchec {
  etape: string;
  message: string;
}

/**
 * Exécute UNE étape du travail quotidien en l'isolant des autres : une
 * exception est journalisée, signalée à Sentry et consignée dans `echecs`, puis
 * l'étape suivante s'exécute quand même. Renvoie `null` si l'étape a échoué.
 *
 * Les étapes s'enchaînaient auparavant sans protection : une exception dans la
 * première — une panne de base passagère, une ligne mal formée — interrompait
 * toute la route. Aucune facture n'était passée en retard ce jour-là, aucun avis
 * d'échéance n'était envoyé, aucune dépense récurrente générée, aucun rappel
 * d'assurance émis ; et un problème qui durait aurait bloqué tout, chaque jour,
 * sans que rien ne dise laquelle des étapes en était la cause.
 */
async function executerEtape<T>(nom: string, echecs: EtapeEnEchec[], tache: () => Promise<T>): Promise<T | null> {
  try {
    return await tache();
  } catch (err) {
    console.error(`[cron] Étape « ${nom} » en échec :`, err);
    try {
      Sentry.captureException(err, { tags: { source: "cron.daily", etape: nom } });
    } catch {
      // Le suivi d'erreurs ne doit jamais casser l'isolation qu'il surveille :
      // un échec de signalement ne doit pas faire sauter les étapes suivantes.
    }
    echecs.push({ etape: nom, message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

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
 * Chaque étape est isolée des autres (voir executerEtape) : une panne dans l'une
 * ne prive plus les suivantes de leur exécution du jour.
 *
 * Chaque route individuelle reste disponible ci-dessous pour un déclenchement
 * manuel ou ponctuel.
 */
export const triggerDailyReminders = asyncHandler(async (req: Request, res: Response) => {
  assertCronAuthorized(req);

  const budget = budgetTemps(env.cronBudgetMs);
  const etapesEnEchec: EtapeEnEchec[] = [];

  // Passage en retard des factures échues, EN PREMIER et pour son propre
  // compte : il ne dépendait que d'un effet de bord de l'envoi des rappels
  // « avant échéance » (voir runUpcomingRentDueReminders), donc d'une étape qui
  // pouvait ne jamais être atteinte. Idempotent : la route des rappels le refait
  // sans dommage. Deux requêtes d'ensemble, hors budget de temps.
  const retards = await executerEtape("passage en retard des factures échues", etapesEnEchec, () => markOverdueInvoices());

  // Purge des données de la PLATEFORME uniquement — jetons périmés, vieux
  // journaux. Aucune donnée locative n'est touchée ici : voir
  // conservation.service.ts.
  const purge = await executerEtape("purge des données de la plateforme", etapesEnEchec, () => purgerDonneesDeLaPlateforme());

  // Les travaux suivants se partagent UN SEUL budget de temps : ils s'exécutent
  // dans la même fonction serverless, donc dans la même limite de durée. Le
  // budget est consulté avant chaque élément et ce qui n'a pas été traité est
  // repris le lendemain (voir utils/budgetTemps.ts).
  const contractEnding = await executerEtape("rappels de fin de contrat", etapesEnEchec, () => runContractEndingReminders(budget));
  const upcoming = await executerEtape("rappels avant échéance", etapesEnEchec, () => runUpcomingRentDueReminders(budget));
  const relances = await executerEtape("relances des impayés", etapesEnEchec, () => runOverdueReminders(budget));
  const rentDue = await executerEtape("avis d'échéance et facturation du mois", etapesEnEchec, () => runRentDueReminders(undefined, budget));
  const recurringExpenses = await executerEtape("dépenses récurrentes", etapesEnEchec, () => runRecurringExpenseGeneration(budget));
  const insurance = await executerEtape("rappels d'assurance", etapesEnEchec, () => runInsurancePolicyExpiryReminders(budget));

  // Un échec reste visible : 500, pour que Vercel marque l'exécution en erreur,
  // mais seulement APRÈS que toutes les autres étapes ont tourné. Les étapes
  // qui ont réussi gardent leurs compteurs dans la réponse.
  const corps = {
    success: etapesEnEchec.length === 0,
    etapesEnEchec,
    facturesPasseesEnRetard: retards ?? 0,
    purge,
    contractEndingRemindersSent: contractEnding?.sent ?? 0,
    upcomingRentDueRemindersSent: upcoming?.sent ?? 0,
    overdueRemindersSent: relances?.sent ?? 0,
    rentDueRemindersSent: rentDue?.sent ?? 0,
    recurringExpensesGenerated: recurringExpenses?.generees ?? 0,
    insuranceRemindersSent: insurance?.sent ?? 0,
    // Les envois qui ont VRAIMENT échoué. Leur marqueur a été relâché, donc
    // ils repartiront demain — mais un cron qui annonce « 40 envoyés » sans
    // dire que 40 ont échoué ne se distingue pas d'un cron qui a réussi.
    echecs:
      (contractEnding?.echecs ?? 0) + (upcoming?.echecs ?? 0) + (relances?.echecs ?? 0) + (rentDue?.echecs ?? 0) + (insurance?.echecs ?? 0),
    // Vrai dès qu'un des travaux s'est arrêté faute de temps : le reliquat
    // n'est pas perdu, il sera traité à la prochaine exécution.
    interrompu:
      !!contractEnding?.interrompu ||
      !!upcoming?.interrompu ||
      !!relances?.interrompu ||
      !!rentDue?.interrompu ||
      !!recurringExpenses?.interrompu ||
      !!insurance?.interrompu,
    details: upcoming?.details ?? [],
  };

  // Une ligne lisible dans les journaux Vercel, qui n'enregistrent ni le code
  // de réponse ni le corps JSON : c'était la seule façon de savoir, après coup,
  // ce que l'exécution du jour avait réellement fait.
  const ligne = ligneDeResume(corps);
  if (corps.success) console.log(ligne);
  else console.warn(ligne);

  res.status(corps.success ? 200 : 500).json(corps);
});

/**
 * Résumé d'une exécution quotidienne en une seule ligne de journal : étapes en
 * échec (leur nom seulement — le message, qui peut citer une donnée, est déjà
 * journalisé par executerEtape), puis les compteurs de chaque étape. Aucune
 * donnée personnelle : ni email, ni nom, ni le détail des envois.
 */
export function ligneDeResume(corps: {
  success: boolean;
  etapesEnEchec: EtapeEnEchec[];
  facturesPasseesEnRetard: number;
  purge: { jetonsEffaces: number; journauxEffaces: number; compteursEfface: number } | null;
  contractEndingRemindersSent: number;
  upcomingRentDueRemindersSent: number;
  overdueRemindersSent: number;
  rentDueRemindersSent: number;
  recurringExpensesGenerated: number;
  insuranceRemindersSent: number;
  echecs: number;
  interrompu: boolean;
}): string {
  const statut = corps.success
    ? "OK"
    : `ÉCHEC de ${corps.etapesEnEchec.length} étape(s) : ${corps.etapesEnEchec.map((e) => e.etape).join(", ")}`;
  const purge = corps.purge
    ? `${corps.purge.jetonsEffaces} jeton(s), ${corps.purge.journauxEffaces} journal(aux), ${corps.purge.compteursEfface} compteur(s)`
    : "non faite";
  return (
    `[cron] Résumé du jour — ${statut} | ` +
    [
      `factures passées en retard : ${corps.facturesPasseesEnRetard}`,
      `purge : ${purge}`,
      `fins de contrat : ${corps.contractEndingRemindersSent}`,
      `rappels avant échéance : ${corps.upcomingRentDueRemindersSent}`,
      `relances d'impayés : ${corps.overdueRemindersSent}`,
      `avis d'échéance : ${corps.rentDueRemindersSent}`,
      `dépenses récurrentes : ${corps.recurringExpensesGenerated}`,
      `rappels d'assurance : ${corps.insuranceRemindersSent}`,
      `envois en échec : ${corps.echecs}`,
      `interrompu faute de temps : ${corps.interrompu ? "oui" : "non"}`,
    ].join(" | ")
  );
}

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

/**
 * Génère les occurrences manquantes des dépenses récurrentes (voir
 * recurringExpense.service.ts). Toujours déclenchée par /daily ; cette route
 * individuelle reste disponible pour un déclenchement manuel.
 */
export const triggerRecurringExpenseGeneration = asyncHandler(async (req: Request, res: Response) => {
  assertCronAuthorized(req);

  const result = await runRecurringExpenseGeneration(budgetTemps(env.cronBudgetMs));
  res.json({
    success: true,
    message: `${result.generees} dépense(s) récurrente(s) générée(s)`,
    generees: result.generees,
    interrompu: result.interrompu,
  });
});

/**
 * Envoie les rappels d'échéance des polices d'assurance arrivant à expiration
 * (voir runInsurancePolicyExpiryReminders). Toujours déclenchée par /daily ;
 * cette route individuelle reste disponible pour un déclenchement manuel.
 */
export const triggerInsurancePolicyExpiryReminders = asyncHandler(async (req: Request, res: Response) => {
  assertCronAuthorized(req);

  const result = await runInsurancePolicyExpiryReminders(budgetTemps(env.cronBudgetMs));
  res.json({
    success: true,
    message: `${result.sent} rappel(s) d'échéance d'assurance envoyé(s)`,
    remindersSent: result.sent,
    echecs: result.echecs,
    interrompu: result.interrompu,
  });
});
