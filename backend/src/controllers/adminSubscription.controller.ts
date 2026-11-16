import { and, eq, isNull, ne, or } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { db, Transaction } from "../db/client";
import { users } from "../db/schema";
import { logAdminAction } from "../services/adminAudit.service";
import { accessEndEmail, sendEmail } from "../services/email.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { aAccesIllimite } from "../utils/accesIllimite";
import { joursEntre } from "../utils/dates";
import { NOM_FORMULE } from "../utils/formules";
import { langueOuDefaut } from "../utils/langue";

const JOUR_MS = 86_400_000;

const PLAN_LABEL = NOM_FORMULE;

const motifSchema = z.string().trim().min(3, "Indiquez le motif de l'ajustement").max(500);

const grantDaysSchema = z.object({
  days: z.coerce.number().int("Nombre de jours entier requis").min(1).max(365),
  reason: motifSchema,
});

const changePlanSchema = z.object({
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]),
  reason: motifSchema,
});

const motifSeulSchema = z.object({ reason: motifSchema });

const dateFr = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Les ajustements manuels n'existent que pour un abonnement géré À LA MAIN.
 * Un abonnement à renouvellement automatique Stripe est piloté par Stripe : à
 * chaque échéance, le webhook réécrit la fin de période et la formule depuis
 * Stripe, ce qui effacerait silencieusement l'ajustement — pire qu'un refus
 * explicite.
 */
function refuserSiStripe(compte: typeof users.$inferSelect) {
  if (compte.stripeSubscriptionId) {
    throw new ApiError(
      409,
      "Cet abonnement est à renouvellement automatique (Stripe) : l'ajuster ici serait écrasé au prochain renouvellement. Passez par Stripe.",
      "SUBSCRIPTION_STRIPE_MANAGED"
    );
  }
}

/** Gestionnaire propriétaire verrouillé pour la durée de la transaction, ou 404. */
async function verrouillerGestionnaire(tx: Transaction, id: string) {
  const [compte] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "MANAGER"), isNull(users.teamOwnerId)))
    .for("update");
  if (!compte) throw new ApiError(404, "Gestionnaire introuvable", "MANAGER_NOT_FOUND");
  return compte;
}

/**
 * Offre N jours à un gestionnaire (geste commercial, compensation d'incident).
 *
 * Le temps offert est ajouté À LA BONNE COLONNE, sans jamais mélanger essai et
 * temps payé (voir calculerPeriode : subscriptionEndsAt ne doit contenir que
 * du temps payé ou offert sur un abonnement, jamais l'essai) :
 *  - essai (TRIAL, ou statut EXPIRED jamais écrit par le code) : trialEndsAt ;
 *  - abonnement payant (ACTIVE / CANCELLED) : subscriptionEndsAt.
 * Les jours s'ajoutent à la fin actuelle si elle est future, sinon à
 * MAINTENANT : offrir 10 jours à un compte expiré depuis 3 mois lui rend 10
 * jours d'accès, pas un accès déjà écoulé.
 *
 * Verrou de ligne : deux ajustements simultanés (deux administrateurs) se
 * succèdent au lieu de se piétiner. Un abonnement ACTIVE sans échéance est
 * refusé : il est illimité, « lui ajouter N jours » le raccourcirait.
 */
export const grantSubscriptionDays = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { days, reason } = grantDaysSchema.parse(req.body);

  const { avant, apres, colonne, email } = await db.transaction(async (tx: Transaction) => {
    const compte = await verrouillerGestionnaire(tx, id);
    refuserSiStripe(compte);

    const maintenant = Date.now();
    const base = (fin: Date | null) => (fin && fin.getTime() > maintenant ? fin.getTime() : maintenant);
    const ajout = days * JOUR_MS;

    if (compte.subscriptionStatus === "ACTIVE" || compte.subscriptionStatus === "CANCELLED") {
      if (compte.subscriptionStatus === "ACTIVE" && !compte.subscriptionEndsAt) {
        throw new ApiError(409, "Cet abonnement n'a pas d'échéance : il n'y a rien à prolonger.", "SUBSCRIPTION_NO_EXPIRY");
      }
      const nouvelleFin = new Date(base(compte.subscriptionEndsAt) + ajout);
      await tx.update(users).set({ subscriptionEndsAt: nouvelleFin }).where(eq(users.id, id));
      return {
        avant: compte.subscriptionEndsAt,
        apres: nouvelleFin,
        colonne: "abonnement" as const,
        email: compte.email,
      };
    }

    // Essai (ou statut EXPIRED) : l'essai repart, le statut redevient TRIAL.
    const nouvelleFin = new Date(base(compte.trialEndsAt) + ajout);
    await tx.update(users).set({ subscriptionStatus: "TRIAL", trialEndsAt: nouvelleFin }).where(eq(users.id, id));
    return { avant: compte.trialEndsAt, apres: nouvelleFin, colonne: "essai" as const, email: compte.email };
  });

  await logAdminAction({
    req,
    action: "subscription.grant_days",
    targetUserId: id,
    targetLabel: email,
    details: `${days} jour(s) offert(s) sur l'${colonne} : fin ${avant ? dateFr(avant) : "—"} → ${dateFr(apres)}. Motif : ${reason}`,
  });

  res.json({ success: true, endsAt: apres });
});

/**
 * Change manuellement la formule d'un gestionnaire (geste commercial, erreur
 * de souscription). Aucun paiement n'est créé ni modifié : l'historique de
 * facturation et le MRR (calculés sur les paiements confirmés) ne bougent
 * pas — on ne fabrique pas de revenu. Les dates ne changent pas non plus.
 */
export const changeManagerPlan = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { plan, reason } = changePlanSchema.parse(req.body);

  const { ancien, email } = await db.transaction(async (tx: Transaction) => {
    const compte = await verrouillerGestionnaire(tx, id);
    refuserSiStripe(compte);
    if (compte.subscriptionPlan === plan) {
      throw new ApiError(409, `Ce gestionnaire est déjà sur la formule ${PLAN_LABEL[plan]}.`, "MANAGER_ALREADY_ON_PLAN", { plan: PLAN_LABEL[plan] });
    }
    await tx.update(users).set({ subscriptionPlan: plan }).where(eq(users.id, id));
    return { ancien: compte.subscriptionPlan, email: compte.email };
  });

  await logAdminAction({
    req,
    action: "subscription.change_plan",
    targetUserId: id,
    targetLabel: email,
    details: `Formule ${PLAN_LABEL[ancien]} → ${PLAN_LABEL[plan]}. Motif : ${reason}`,
  });

  res.json({ success: true, plan });
});

/**
 * Accorde à un gestionnaire un accès SANS ÉCHÉANCE (compte interne, partenaire,
 * convention) : abonnement ACTIVE sans date de fin, formule Entreprise. Aucun
 * paiement n'est créé : le MRR et l'historique de facturation ne bougent pas.
 *
 * Même garde-fou que les autres ajustements : un abonnement Stripe est refusé
 * (le webhook réécrirait la fin de période). Un compte déjà illimité l'est
 * aussi, pour ne pas laisser de trace d'audit d'un changement qui n'en est pas
 * un. L'accès se retire avec revokeUnlimitedAccess ; un paiement ultérieur
 * (virement confirmé) le remplace par une échéance datée.
 */
export const grantUnlimitedAccess = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = motifSeulSchema.parse(req.body ?? {});

  const { avant, email } = await db.transaction(async (tx: Transaction) => {
    const compte = await verrouillerGestionnaire(tx, id);
    refuserSiStripe(compte);
    if (aAccesIllimite(compte)) throw new ApiError(409, "Ce gestionnaire a déjà un accès illimité.", "MANAGER_ALREADY_UNLIMITED");

    await tx
      .update(users)
      .set({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: null })
      .where(eq(users.id, id));
    return { avant: compte, email: compte.email };
  });

  await logAdminAction({
    req,
    action: "subscription.grant_unlimited",
    targetUserId: id,
    targetLabel: email,
    details: `Accès illimité accordé (avant : ${avant.subscriptionStatus}, formule ${PLAN_LABEL[avant.subscriptionPlan]}, fin ${
      avant.subscriptionEndsAt ? dateFr(avant.subscriptionEndsAt) : "—"
    }). Motif : ${reason}`,
  });

  res.json({ success: true });
});

/**
 * Retire l'accès illimité : le compte repasse en EXPIRED (aucun accès tant
 * qu'il ne souscrit pas ou qu'on ne lui offre pas de jours — grantSubscriptionDays
 * le traite comme un essai terminé). Refusé pour tout autre compte : ce chemin
 * ne sert pas à couper un abonnement payé ou un essai en cours.
 */
export const revokeUnlimitedAccess = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = motifSeulSchema.parse(req.body ?? {});

  const { email } = await db.transaction(async (tx: Transaction) => {
    const compte = await verrouillerGestionnaire(tx, id);
    if (!aAccesIllimite(compte)) throw new ApiError(409, "Ce gestionnaire n'a pas d'accès illimité.", "MANAGER_NOT_UNLIMITED");
    await tx.update(users).set({ subscriptionStatus: "EXPIRED", subscriptionEndsAt: null }).where(eq(users.id, id));
    return { email: compte.email };
  });

  await logAdminAction({
    req,
    action: "subscription.revoke_unlimited",
    targetUserId: id,
    targetLabel: email,
    details: `Accès illimité retiré. Motif : ${reason}`,
  });

  res.json({ success: true });
});

/**
 * Envoie MAINTENANT au gestionnaire le rappel de fin d'essai gratuit (le même message que l'envoi automatique, voir
 * runSubscriptionExpiryNotices), depuis la plateforme : le geste de la ligne « Essais se terminant bientôt » du tableau de bord.
 * Avant, c'était un lien « mailto: » qui n'ouvrait rien sur un poste sans messagerie configurée.
 *
 * Même garde-fou que l'envoi automatique : la colonne `ending_notice_for` retient l'échéance POUR laquelle le message est parti,
 * réclamée de façon atomique AVANT l'envoi et rendue si l'envoi échoue. Un double clic, ou un rappel déjà parti (à la main ou
 * par le cron) pour cette échéance, ne produit donc qu'un message ; et l'envoi automatique ne doublonne pas ensuite.
 *
 * Un envoi simulé (SMTP non configuré) est un ÉCHEC ici : annoncer « rappel envoyé » à l'administrateur alors que rien n'est parti
 * serait un mensonge.
 */
export const sendTrialReminder = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const [compte] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "MANAGER"), isNull(users.teamOwnerId)));
  if (!compte) throw new ApiError(404, "Gestionnaire introuvable", "MANAGER_NOT_FOUND");
  if (compte.suspendedAt) throw new ApiError(409, "Ce compte est suspendu : il ne reçoit pas de rappel.", "TRIAL_REMINDER_SUSPENDED");
  if (!compte.emailVerifiedAt) throw new ApiError(409, "L'adresse e-mail de ce gestionnaire n'est pas confirmée.", "TRIAL_REMINDER_EMAIL_UNVERIFIED");

  const maintenant = new Date();
  const echeance = compte.trialEndsAt ? new Date(compte.trialEndsAt) : null;
  if (compte.subscriptionStatus !== "TRIAL" || !echeance || echeance.getTime() <= maintenant.getTime()) {
    throw new ApiError(409, "Ce gestionnaire n'est pas en essai gratuit en cours.", "TRIAL_REMINDER_NOT_IN_TRIAL");
  }

  const reclame = await db
    .update(users)
    .set({ endingNoticeFor: echeance })
    .where(and(eq(users.id, id), isNull(users.suspendedAt), eq(users.trialEndsAt, echeance), or(isNull(users.endingNoticeFor), ne(users.endingNoticeFor, echeance))))
    .returning({ id: users.id });
  if (reclame.length === 0) {
    throw new ApiError(409, "Un rappel est déjà parti pour cette échéance.", "TRIAL_REMINDER_ALREADY_SENT");
  }

  const { subject, html } = accessEndEmail({
    cas: "essaiBientot",
    endDate: echeance,
    daysLeft: Math.max(1, joursEntre(maintenant, echeance)),
    frontendUrl: env.frontendUrl,
    langue: langueOuDefaut(compte.language),
  });
  const resultat = await sendEmail(compte.email, subject, html);
  if ("error" in resultat || resultat.simulated) {
    // Rendu : on peut réessayer.
    await db.update(users).set({ endingNoticeFor: compte.endingNoticeFor }).where(eq(users.id, id));
    throw new ApiError(502, "Le rappel n'a pas pu être envoyé : le service d'e-mail n'a pas accepté le message.", "TRIAL_REMINDER_SEND_FAILED");
  }

  await logAdminAction({
    req,
    action: "manager.trial_reminder",
    targetUserId: id,
    targetLabel: compte.email,
    details: `Rappel de fin d'essai envoyé (fin le ${dateFr(echeance)}).`,
  });

  res.json({ success: true });
});
