import { and, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db, Transaction } from "../db/client";
import { ownerPayouts, owners } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { ownerPayoutEmail, sendEmail } from "../services/email.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { finDeLaJournee } from "../utils/dates";
import { arrondir } from "../utils/montants";
import { formaterMontant } from "../utils/montant";
import { nomAvecCivilite } from "../utils/nom";
import { computeCrg, computeCrgPourProprietaires, loadAgencyName, loadOwnerForManager } from "./crg.controller";

/**
 * Reversements aux propriétaires : l'agence enregistre l'argent qu'elle a
 * RÉELLEMENT versé à un propriétaire au titre d'un mois de gestion. Le CRG du
 * mois affiche alors « déjà reversé » et « reste à reverser », côté agence
 * comme côté propriétaire.
 *
 * Garde-fous : un reversement ne dépasse jamais ce qui reste à reverser pour
 * ce mois et cette devise (une faute de frappe ne fait pas verser deux fois
 * le loyer), ne porte pas sur un mois futur, et n'est pas daté avant le début
 * du mois qu'il solde ni dans le futur. Les reversements d'un même
 * propriétaire sont sérialisés (verrou transactionnel) : deux saisies
 * simultanées ne peuvent pas, chacune, consommer le même reste.
 */
export const MOYENS_REVERSEMENT = ["BANK_TRANSFER", "CASH", "CHEQUE", "MOBILE_MONEY", "OTHER"] as const;

const LIBELLES_MOYENS: Record<(typeof MOYENS_REVERSEMENT)[number], string> = {
  BANK_TRANSFER: "virement",
  CASH: "espèces",
  CHEQUE: "chèque",
  MOBILE_MONEY: "mobile money",
  OTHER: "autre moyen",
};

const reversementSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  currency: z.string().trim().min(3).max(3).transform((v) => v.toUpperCase()),
  amount: z.coerce.number().positive("Le montant doit être supérieur à zéro."),
  // Date du versement (AAAA-MM-JJ).
  paidAt: z.coerce.date(),
  method: z.enum(MOYENS_REVERSEMENT),
  reference: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(1000, "La note ne peut pas dépasser 1 000 caractères").nullable().optional(),
  notifyOwner: z.boolean().optional(),
});

const moisAbsolu = (annee: number, mois: number) => annee * 12 + (mois - 1);

export const createOwnerPayout = asyncHandler(async (req: Request, res: Response) => {
  const body = reversementSchema.parse(req.body);
  const owner = await loadOwnerForManager(req.params.ownerId, req.user!.userId);
  const maintenant = new Date();

  if (moisAbsolu(body.year, body.month) > moisAbsolu(maintenant.getFullYear(), maintenant.getMonth() + 1)) {
    throw new ApiError(400, "On ne reverse pas un mois qui n'a pas encore commencé.");
  }
  const debutDuMois = new Date(body.year, body.month - 1, 1);
  const finDuJour = finDeLaJournee(maintenant);
  if (body.paidAt < debutDuMois) throw new ApiError(400, "La date du versement ne peut pas précéder le mois qu'il solde.");
  if (body.paidAt > finDuJour) throw new ApiError(400, "La date du versement ne peut pas être dans le futur.");

  const montant = arrondir(body.amount);

  // Le net du mois ne dépend pas des reversements : calculé avant la transaction.
  const crg = await computeCrg(owner, body.month, body.year);
  if (!(body.currency in crg.totalNetByCurrency)) {
    throw new ApiError(400, `Aucun bien de ce propriétaire n'a d'activité en ${body.currency} pour ce mois.`);
  }

  const reversement = await db.transaction(async (tx: Transaction) => {
    // Un seul enregistrement à la fois par propriétaire : ce qui a déjà été reversé est relu sous ce verrou.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`reversement:${owner.id}`}))`);
    const dejaReverse = await tx
      .select({ total: sql<number>`coalesce(sum(${ownerPayouts.amount}), 0)` })
      .from(ownerPayouts)
      .where(
        and(
          eq(ownerPayouts.ownerId, owner.id),
          eq(ownerPayouts.periodMonth, body.month),
          eq(ownerPayouts.periodYear, body.year),
          eq(ownerPayouts.currency, body.currency)
        )
      );
    const reste = arrondir((crg.totalNetByCurrency[body.currency] ?? 0) - Number(dejaReverse[0]?.total ?? 0));
    if (reste <= 0) throw new ApiError(409, "Il ne reste rien à reverser pour ce mois dans cette devise.");
    if (montant > reste) {
      throw new ApiError(409, `Le montant dépasse ce qui reste à reverser pour ce mois (${formaterMontant(reste, body.currency)}).`);
    }

    const [cree] = await tx
      .insert(ownerPayouts)
      .values({
        ownerId: owner.id,
        periodMonth: body.month,
        periodYear: body.year,
        currency: body.currency,
        amount: montant,
        paidAt: body.paidAt,
        method: body.method,
        reference: body.reference?.trim() || null,
        note: body.note?.trim() || null,
        // Celui qui saisit : le collaborateur, pas le propriétaire dont le jeton porte l'id (voir identiteJetonPourManager).
        createdBy: req.user!.collaboratorId ?? req.user!.userId,
      })
      .returning();
    return cree;
  });

  const periode = `${String(body.month).padStart(2, "0")}/${body.year}`;
  await logActivity({
    req,
    managerId: owner.managerId,
    action: "owner.payout",
    entityType: "owner",
    entityId: owner.id,
    entityLabel: nomAvecCivilite(owner),
    details: `Reversement de ${formaterMontant(montant, body.currency)} au titre de ${periode} (${LIBELLES_MOYENS[body.method]}).`,
  });

  let emailEnvoye = false;
  if (body.notifyOwner && owner.email) {
    try {
      const agence = await loadAgencyName(owner.managerId);
      const { subject, html } = ownerPayoutEmail({
        ownerName: nomAvecCivilite(owner),
        agencyName: agence,
        amount: montant,
        currency: body.currency,
        periodMonth: body.month,
        periodYear: body.year,
        paidAt: body.paidAt,
        methodLabel: LIBELLES_MOYENS[body.method],
        reference: reversement.reference,
      });
      await sendEmail(owner.email, subject, html);
      await db.update(ownerPayouts).set({ ownerNotifiedAt: new Date() }).where(eq(ownerPayouts.id, reversement.id));
      emailEnvoye = true;
    } catch (err) {
      console.error(`[reversement] Email au propriétaire non envoyé pour le reversement ${reversement.id} :`, err);
    }
  }

  res.status(201).json({ ...reversement, emailEnvoye });
});

/** Supprime un reversement saisi par erreur (journalisé). */
export const deleteOwnerPayout = asyncHandler(async (req: Request, res: Response) => {
  const owner = await loadOwnerForManager(req.params.ownerId, req.user!.userId);
  const [supprime] = await db
    .delete(ownerPayouts)
    .where(and(eq(ownerPayouts.id, req.params.payoutId), eq(ownerPayouts.ownerId, owner.id)))
    .returning();
  if (!supprime) throw new ApiError(404, "Reversement introuvable", "PAYOUT_NOT_FOUND");

  await logActivity({
    req,
    managerId: owner.managerId,
    action: "owner.payout_delete",
    entityType: "owner",
    entityId: owner.id,
    entityLabel: nomAvecCivilite(owner),
    details: `Reversement de ${formaterMontant(supprime.amount, supprime.currency)} au titre de ${String(supprime.periodMonth).padStart(2, "0")}/${supprime.periodYear} supprimé.`,
  });
  res.status(204).send();
});

const syntheseSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

/**
 * Synthèse des reversements d'un mois pour toute l'agence : par propriétaire et par devise, le net
 * du mois, ce qui a été reversé et ce qui reste. Les propriétaires anonymisés sont exclus.
 */
export const listPayoutSummary = asyncHandler(async (req: Request, res: Response) => {
  const { month, year } = syntheseSchema.parse(req.query);
  const proprietaires = (await db.select().from(owners).where(eq(owners.managerId, req.user!.userId))).filter(
    (owner: typeof owners.$inferSelect) => !owner.anonymizedAt
  );
  // Un seul calcul groupé pour tous les propriétaires (nombre de requêtes constant) : voir
  // computeCrgPourProprietaires dans crg.controller.ts.
  const synthese = await computeCrgPourProprietaires(proprietaires, month, year);
  const lignes = proprietaires.map((owner: typeof owners.$inferSelect, i: number) => ({
    ownerId: owner.id,
    ownerName: synthese[i].ownerName,
    hasIban: Boolean(owner.iban),
    netByCurrency: synthese[i].totalNetByCurrency,
    reverseByCurrency: synthese[i].totalReverseByCurrency,
    resteByCurrency: synthese[i].resteAReverserByCurrency,
  }));
  res.json({ month, year, owners: lignes.sort((a, b) => a.ownerName.localeCompare(b.ownerName)) });
});
