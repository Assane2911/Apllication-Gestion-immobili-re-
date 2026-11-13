import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db, Transaction } from "../db/client";
import { contracts, leaseNotices, leaseSettlements, properties, tenants } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { envoyerCopieAuxColocataires } from "../services/colocation.service";
import { sendEmail, settlementEmail } from "../services/email.service";
import { generateSettlementHtml, generateSettlementPdfBuffer } from "../services/pdf.service";
import {
  calculerSolde,
  donneesDuSolde,
  FENETRE_DOUBLON_SOLDE_HEURES,
  listerSoldes,
  MODES_DERNIER_MOIS,
  referenceSolde,
} from "../services/soldeDeToutCompte.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertAccesLocataireOuGestionnaire, assertOwnership, estLocataireDuBail } from "../utils/authorization";
import { ANNEE_BAIL_MAX, ANNEE_BAIL_MIN, dateDeBailPlausible } from "../utils/dates";
import { formaterMontant } from "../utils/montant";
import { nomAvecCivilite, nomComplet } from "../utils/nom";
import { avecCode } from "../utils/validationExplicite";

const dateSchema = z.coerce
  .date()
  .refine(
    dateDeBailPlausible,
    avecCode(`La date doit être comprise entre ${ANNEE_BAIL_MIN} et ${ANNEE_BAIL_MAX}`, "LEASE_DATE_OUT_OF_RANGE", { min: ANNEE_BAIL_MIN, max: ANNEE_BAIL_MAX })
  );

const apercuSchema = z.object({
  lastMonth: z.enum(MODES_DERNIER_MOIS as [string, ...string[]]).default("FULL"),
  exitDate: dateSchema.optional(),
});

const emissionSchema = z.object({
  lastMonthMode: z.enum(MODES_DERNIER_MOIS as [string, ...string[]]).default("FULL"),
  exitDate: dateSchema.optional(),
  sendEmail: z.boolean().default(false),
});

async function bailDuGestionnaire(req: Request) {
  const [contrat] = await db.select().from(contracts).where(eq(contracts.id, req.params.id));
  if (!contrat) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");
  const [bien] = await db.select().from(properties).where(eq(properties.id, contrat.propertyId));
  assertOwnership(bien, (p) => p.managerId, req.user!.userId, "Contrat introuvable", 404, "CONTRACT_NOT_FOUND");
  return { contrat, bien };
}

/** Le calcul à l'écran, sans rien enregistrer : sert à choisir le mode du dernier mois avant d'émettre. */
export const previewSettlement = asyncHandler(async (req: Request, res: Response) => {
  const { contrat } = await bailDuGestionnaire(req);
  const q = apercuSchema.parse(req.query ?? {});
  const calcul = await calculerSolde(contrat, { exitDate: q.exitDate ?? null, lastMonthMode: q.lastMonth as "FULL" | "PRORATA" });
  res.json({ ...calcul, contractStatus: contrat.status });
});

export const listSettlements = asyncHandler(async (req: Request, res: Response) => {
  const { contrat } = await bailDuGestionnaire(req);
  const soldes = await listerSoldes(contrat.id);
  res.json(soldes.map(({ details: _details, ...s }) => ({ ...s, reference: referenceSolde(s) })));
});

/** Émet le solde : fige le calcul et, si demandé, l'envoie par e-mail (PDF joint) au locataire et aux colocataires. */
export const createSettlement = asyncHandler(async (req: Request, res: Response) => {
  const { contrat, bien } = await bailDuGestionnaire(req);
  const body = emissionSchema.parse(req.body ?? {});

  if (contrat.status === "ACTIVE") {
    const [conge] = await db
      .select({ id: leaseNotices.id })
      .from(leaseNotices)
      .where(and(eq(leaseNotices.contractId, contrat.id), eq(leaseNotices.status, "ACTIVE")))
      .limit(1);
    if (!conge) {
      throw new ApiError(409, "Le bail est en cours et aucun congé n'est enregistré : le solde de tout compte se fait à la sortie.", "SETTLEMENT_CONTRACT_STILL_ACTIVE");
    }
  }
  const [locataire] = await db.select().from(tenants).where(eq(tenants.id, contrat.tenantId));
  if (!locataire || locataire.anonymizedAt) {
    throw new ApiError(409, "Le locataire de ce bail a été anonymisé : aucun document ne peut lui être adressé.", "SETTLEMENT_TENANT_ANONYMIZED");
  }

  const calcul = await calculerSolde(contrat, { exitDate: body.exitDate ?? null, lastMonthMode: body.lastMonthMode as "FULL" | "PRORATA" });
  const contenu = {
    exitDate: calcul.exitDate.getTime(),
    lastMonthMode: calcul.lastMonthMode,
    depositAmount: calcul.depositAmount,
    deductionsTotal: calcul.deductionsTotal,
    depositRefunded: calcul.depositRefunded,
    unpaidTotal: calcul.unpaidTotal,
    creditTotal: calcul.creditTotal,
    balance: calcul.balance,
  };
  // Verrou sur le bail, puis comparaison avec le dernier solde émis, DANS la même transaction : deux requêtes simultanées
  // calculent le même contenu ; la seconde attend, voit la première et se voit refuser (ni second solde, ni second e-mail).
  const solde = await db.transaction(async (tx: Transaction) => {
    await tx.execute(sql`SELECT id FROM contracts WHERE id = ${contrat.id} FOR UPDATE`);
    const [dernier] = await tx
      .select({
        id: leaseSettlements.id,
        createdAt: leaseSettlements.createdAt,
        exitDate: leaseSettlements.exitDate,
        lastMonthMode: leaseSettlements.lastMonthMode,
        depositAmount: leaseSettlements.depositAmount,
        deductionsTotal: leaseSettlements.deductionsTotal,
        depositRefunded: leaseSettlements.depositRefunded,
        unpaidTotal: leaseSettlements.unpaidTotal,
        creditTotal: leaseSettlements.creditTotal,
        balance: leaseSettlements.balance,
      })
      .from(leaseSettlements)
      .where(and(eq(leaseSettlements.contractId, contrat.id), gte(leaseSettlements.createdAt, new Date(Date.now() - FENETRE_DOUBLON_SOLDE_HEURES * 3_600_000))))
      .orderBy(desc(leaseSettlements.createdAt))
      .limit(1);
    if (
      dernier &&
      dernier.exitDate.getTime() === contenu.exitDate &&
      dernier.lastMonthMode === contenu.lastMonthMode &&
      dernier.depositAmount === contenu.depositAmount &&
      dernier.deductionsTotal === contenu.deductionsTotal &&
      dernier.depositRefunded === contenu.depositRefunded &&
      dernier.unpaidTotal === contenu.unpaidTotal &&
      dernier.creditTotal === contenu.creditTotal &&
      dernier.balance === contenu.balance
    ) {
      const reference = referenceSolde(dernier);
      const date = new Date(dernier.createdAt).toLocaleDateString("fr-FR");
      throw new ApiError(
        409,
        `Un solde de tout compte identique (réf. ${reference}) a déjà été émis le ${date} : rien n'a changé depuis.`,
        "SETTLEMENT_DUPLICATE",
        { reference, date }
      );
    }
    const [cree] = await tx
      .insert(leaseSettlements)
      .values({
        contractId: contrat.id,
        managerId: bien.managerId,
        currency: calcul.currency,
        exitDate: calcul.exitDate,
        lastMonthMode: calcul.lastMonthMode,
        depositAmount: calcul.depositAmount,
        deductionsTotal: calcul.deductionsTotal,
        depositRefunded: calcul.depositRefunded,
        unpaidTotal: calcul.unpaidTotal,
        creditTotal: calcul.creditTotal,
        balance: calcul.balance,
        details: JSON.stringify({ lignes: calcul.lignes, deductions: calcul.deductions, facturesApresSortie: calcul.facturesApresSortie }),
        createdBy: req.user!.collaboratorId ?? req.user!.userId,
      })
      .returning();
    return cree;
  });

  let emailEnvoye = false;
  let colocatairesPrevenus = 0;
  if (body.sendEmail) {
    const donnees = await donneesDuSolde(solde);
    const pdf = await generateSettlementPdfBuffer(donnees);
    const pieceJointe = [{ filename: `solde-de-tout-compte-${donnees.reference}.pdf`, content: pdf, contentType: "application/pdf" }];
    const pour = (nom: string) =>
      settlementEmail({
        tenantName: nom,
        propertyTitle: donnees.propertyTitle,
        balance: donnees.balance,
        currency: donnees.currency,
        agencyName: donnees.agency.name,
        reference: donnees.reference,
      });
    if (locataire.email) {
      const { subject, html } = pour(nomAvecCivilite(locataire));
      const resultat = await sendEmail(locataire.email, subject, html, pieceJointe);
      emailEnvoye = !("error" in resultat && resultat.error);
    }
    colocatairesPrevenus = await envoyerCopieAuxColocataires(contrat.id, (colocataire) => ({ ...pour(nomAvecCivilite(colocataire)), attachments: pieceJointe }));
    if (emailEnvoye) await db.update(leaseSettlements).set({ emailSentAt: new Date() }).where(eq(leaseSettlements.id, solde.id));
  }

  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.settlement",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: `${bien.title} — ${nomComplet(locataire)}`,
    details:
      `Solde de tout compte ${referenceSolde(solde)} émis : ` +
      (calcul.balance > 0
        ? `${formaterMontant(calcul.balance, calcul.currency)} à restituer au locataire`
        : calcul.balance < 0
          ? `${formaterMontant(-calcul.balance, calcul.currency)} restant dus par le locataire`
          : "compte soldé") +
      (body.sendEmail ? (emailEnvoye ? ", envoyé par e-mail." : ", e-mail NON parti.") : ", sans envoi par e-mail."),
  });

  const { details: _details, ...vue } = solde;
  res.status(201).json({ ...vue, reference: referenceSolde(solde), emailEnvoye, colocatairesPrevenus });
});

/** Marque le solde comme réglé : la somme a été restituée, ou perçue, et le compte du locataire est clos. */
export const settleSettlement = asyncHandler(async (req: Request, res: Response) => {
  const { contrat, bien } = await bailDuGestionnaire(req);
  const [solde] = await db
    .select()
    .from(leaseSettlements)
    .where(and(eq(leaseSettlements.id, req.params.settlementId), eq(leaseSettlements.contractId, contrat.id)));
  if (!solde) throw new ApiError(404, "Solde de tout compte introuvable", "SETTLEMENT_NOT_FOUND");
  const [regle] = await db
    .update(leaseSettlements)
    .set({ settledAt: new Date() })
    .where(and(eq(leaseSettlements.id, solde.id), isNull(leaseSettlements.settledAt)))
    .returning();
  if (!regle) throw new ApiError(409, "Ce solde de tout compte est déjà réglé.", "SETTLEMENT_ALREADY_SETTLED");

  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.settlement_settle",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: bien.title,
    details: `Solde de tout compte ${referenceSolde(regle)} marqué comme réglé.`,
  });
  const { details: _details, ...vue } = regle;
  res.json({ ...vue, reference: referenceSolde(regle) });
});

/** Le document, à l'écran ou à imprimer : le gestionnaire du bien, ou un locataire du bail. */
export const getSettlementDocument = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const [solde] = await db.select().from(leaseSettlements).where(eq(leaseSettlements.id, req.params.settlementId));
  if (!solde) throw new ApiError(404, "Solde de tout compte introuvable", "SETTLEMENT_NOT_FOUND");
  const [contrat] = await db.select().from(contracts).where(eq(contracts.id, solde.contractId));
  if (!contrat) throw new ApiError(404, "Solde de tout compte introuvable", "SETTLEMENT_NOT_FOUND");
  const [bien] = await db.select().from(properties).where(eq(properties.id, contrat.propertyId));
  assertAccesLocataireOuGestionnaire(req.user.role, await estLocataireDuBail(req, contrat), bien?.managerId === req.user.userId, {
    message: "Solde de tout compte introuvable",
    code: "SETTLEMENT_NOT_FOUND",
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(generateSettlementHtml(await donneesDuSolde(solde)));
});
