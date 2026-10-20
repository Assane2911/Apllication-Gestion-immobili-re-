import { and, eq, isNull } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db, Transaction } from "../db/client";
import { users } from "../db/schema";
import { logAdminAction } from "../services/adminAudit.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { aAccesIllimite } from "../utils/accesIllimite";
import { NOM_FORMULE } from "../utils/formules";

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
      "Cet abonnement est à renouvellement automatique (Stripe) : l'ajuster ici serait écrasé au prochain renouvellement. Passez par Stripe."
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
        throw new ApiError(409, "Cet abonnement n'a pas d'échéance : il n'y a rien à prolonger.");
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
      throw new ApiError(409, `Ce gestionnaire est déjà sur la formule ${PLAN_LABEL[plan]}.`);
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
    if (aAccesIllimite(compte)) throw new ApiError(409, "Ce gestionnaire a déjà un accès illimité.");

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
    if (!aAccesIllimite(compte)) throw new ApiError(409, "Ce gestionnaire n'a pas d'accès illimité.");
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
