import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { agencySettings, contracts, expenses, invoices, owners, properties } from "../db/schema";
import { generateCrgHtml } from "../services/pdf.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { nomAvecCivilite } from "../utils/nom";
import { chargerProprietaireDuCompte } from "../utils/authorization";

/**
 * Module "CRG" (Compte-Rendu de Gestion) : synthèse mensuelle par
 * propriétaire (Multi-Bailleurs), à la fois côté gestionnaire (n'importe quel
 * propriétaire de son agence) et côté propriétaire (le sien, Espace
 * propriétaire — "/mine").
 *
 * Contrairement au Bilan Fiscal (fiscal.controller.ts), qui reste du point de
 * vue du gestionnaire (revenus encaissés moins charges, toute l'agence,
 * annuel), le CRG :
 *  - se calcule pour UN SEUL propriétaire à la fois (Multi-Bailleurs : chaque
 *    propriétaire ne doit voir que son propre reversement) ;
 *  - est mensuel, pas annuel (reversement classique en gestion locative) ;
 *  - déduit en plus la commission d'agence (owners.managementFeeRate) du
 *    loyer encaissé, pour aboutir au net à reverser au propriétaire.
 *
 * Même base de comptabilisation ("cash basis") que le Bilan Fiscal : un loyer
 * compte le mois où il a été RÉELLEMENT ENCAISSÉ (paidAt, ou dueDate à
 * défaut), pas le mois de la période louée (periodMonth/periodYear).
 *
 * Une ligne est toujours affichée pour CHAQUE bien du propriétaire, y compris
 * un bien sans aucune activité ce mois-ci (loyers/charges à 0) : le
 * propriétaire doit pouvoir constater l'absence d'encaissement sur un bien,
 * pas seulement voir ce bien disparaître du rapport.
 */
const monthQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

function resolveMonthYear(req: Request): { month: number; year: number } {
  const parsed = monthQuerySchema.parse(req.query);
  const now = new Date();
  return {
    month: parsed.month ?? now.getMonth() + 1,
    year: parsed.year ?? now.getFullYear(),
  };
}

function monthBounds(month: number, year: number) {
  return {
    start: new Date(year, month - 1, 1, 0, 0, 0, 0),
    end: new Date(year, month, 0, 23, 59, 59, 999),
  };
}

async function loadOwnerForManager(ownerId: string, managerId: string) {
  const [owner] = await db.select().from(owners).where(eq(owners.id, ownerId));
  if (!owner || owner.managerId !== managerId) throw new ApiError(404, "Propriétaire introuvable");
  return owner;
}

type OwnerRow = typeof owners.$inferSelect;

export type CrgSynthesis = {
  ownerId: string;
  ownerName: string;
  ownerCompanyName: string | null;
  iban: string | null;
  bic: string | null;
  managementFeeRate: number;
  month: number;
  year: number;
  properties: Array<{
    propertyId: string;
    propertyTitle: string;
    currency: string;
    loyersEncaisses: number;
    chargesDeduites: number;
    commission: number;
    netAReverser: number;
  }>;
  totalLoyersByCurrency: Record<string, number>;
  totalChargesByCurrency: Record<string, number>;
  totalCommissionByCurrency: Record<string, number>;
  totalNetByCurrency: Record<string, number>;
};

async function computeCrg(owner: OwnerRow, month: number, year: number): Promise<CrgSynthesis> {
  const { start, end } = monthBounds(month, year);

  const ownerProperties = await db.select().from(properties).where(eq(properties.ownerId, owner.id));
  const propertyIds = ownerProperties.map((p: typeof properties.$inferSelect) => p.id);

  const ownerContracts =
    propertyIds.length > 0
      ? await db.select().from(contracts).where(inArray(contracts.propertyId, propertyIds))
      : [];
  const contractIdToPropertyId = new Map(
    ownerContracts.map((c: typeof contracts.$inferSelect) => [c.id, c.propertyId])
  );
  const contractIds = ownerContracts.map((c: typeof contracts.$inferSelect) => c.id);

  // paidAt est nullable (une facture PAID sans paidAt renseigné retombe sur
  // dueDate) : comme dans fiscal.controller.ts, le filtre par mois est donc
  // appliqué en mémoire après avoir choisi la bonne date par ligne, pas
  // directement en SQL.
  const [paidInvoiceRows, expenseRows] = await Promise.all([
    contractIds.length > 0
      ? db
          .select()
          .from(invoices)
          .where(and(inArray(invoices.contractId, contractIds), eq(invoices.status, "PAID")))
      : Promise.resolve([] as (typeof invoices.$inferSelect)[]),
    propertyIds.length > 0
      ? db
          .select()
          .from(expenses)
          .where(and(inArray(expenses.propertyId, propertyIds), gte(expenses.expenseDate, start), lte(expenses.expenseDate, end)))
      : Promise.resolve([] as (typeof expenses.$inferSelect)[]),
  ]);

  const invoiceDate = (inv: typeof invoices.$inferSelect) => new Date(inv.paidAt ?? inv.dueDate);
  const filteredInvoices = paidInvoiceRows.filter((inv) => {
    const d = invoiceDate(inv);
    return d >= start && d <= end;
  });

  type PropertyLine = CrgSynthesis["properties"][number];

  // Une ligne par couple (bien, devise), et non par bien : la devise d'un
  // loyer vient de son CONTRAT et celle d'une charge de la DÉPENSE, or ni
  // l'une ni l'autre n'est forcément celle du bien (contract.controller.ts
  // autorise explicitement un contrat dans une autre devise). Compter tout
  // sous la devise du bien revenait à déduire une assurance de 300 EUR comme
  // 300 FCFA d'un loyer en FCFA — le propriétaire était alors payé près de
  // 197 000 FCFA de trop. Dans le cas normal (tout dans la même devise), il
  // n'y a qu'une seule ligne par bien, exactement comme avant.
  const perPropertyCurrency = new Map<string, PropertyLine>();
  const cle = (propertyId: string, currency: string) => `${propertyId}|${currency}`;

  const titreParBien = new Map(
    ownerProperties.map((p: typeof properties.$inferSelect) => [p.id, p.title] as const)
  );

  function ligne(propertyId: string, currency: string): PropertyLine | undefined {
    const titre = titreParBien.get(propertyId);
    if (titre === undefined) return undefined;

    const existante = perPropertyCurrency.get(cle(propertyId, currency));
    if (existante) return existante;

    const nouvelle: PropertyLine = {
      propertyId,
      propertyTitle: titre,
      currency,
      loyersEncaisses: 0,
      chargesDeduites: 0,
      commission: 0,
      netAReverser: 0,
    };
    perPropertyCurrency.set(cle(propertyId, currency), nouvelle);
    return nouvelle;
  }

  // Un bien sans aucune activité ce mois-ci garde sa ligne à zéro, dans sa
  // propre devise : le propriétaire doit pouvoir constater l'absence
  // d'encaissement, pas voir le bien disparaître du rapport.
  for (const p of ownerProperties) {
    ligne(p.id, p.currency);
  }
  for (const inv of filteredInvoices) {
    const propertyId = contractIdToPropertyId.get(inv.contractId);
    const entry = propertyId ? ligne(propertyId, inv.currency) : undefined;
    if (!entry) continue;
    entry.loyersEncaisses += inv.amount;
  }
  for (const exp of expenseRows) {
    const entry = ligne(exp.propertyId, exp.currency);
    if (!entry) continue;
    entry.chargesDeduites += exp.amount;
  }
  const perProperty = perPropertyCurrency;

  // Commission arrondie au centime (les montants sont stockés en unité
  // principale de la devise, pas en centimes — voir doublePrecision dans
  // schema.ts) : sans cet arrondi, un taux non entier (ex: 8.5%) produit des
  // décimales binaires non représentatives (ex: 42.500000000000007).
  for (const entry of perProperty.values()) {
    entry.commission = Math.round(entry.loyersEncaisses * owner.managementFeeRate) / 100;
    entry.netAReverser = Math.round((entry.loyersEncaisses - entry.chargesDeduites - entry.commission) * 100) / 100;
  }

  // Tri secondaire par devise : deux lignes d'un même bien (cas multi-devises)
  // doivent sortir dans un ordre stable d'un appel à l'autre, sinon le PDF et
  // l'écran pourraient les présenter différemment pour les mêmes données.
  const propertyLines = Array.from(perProperty.values()).sort(
    (a, b) => a.propertyTitle.localeCompare(b.propertyTitle) || a.currency.localeCompare(b.currency)
  );

  // Plateforme multi-devises (EUR/XOF/...) : chaque total reste ventilé par
  // devise plutôt que sommé à travers des devises différentes, même
  // principe que dashboard.controller.ts / fiscal.controller.ts.
  const totalLoyersByCurrency: Record<string, number> = {};
  const totalChargesByCurrency: Record<string, number> = {};
  const totalCommissionByCurrency: Record<string, number> = {};
  const totalNetByCurrency: Record<string, number> = {};
  for (const entry of propertyLines) {
    totalLoyersByCurrency[entry.currency] = (totalLoyersByCurrency[entry.currency] ?? 0) + entry.loyersEncaisses;
    totalChargesByCurrency[entry.currency] = (totalChargesByCurrency[entry.currency] ?? 0) + entry.chargesDeduites;
    totalCommissionByCurrency[entry.currency] = (totalCommissionByCurrency[entry.currency] ?? 0) + entry.commission;
    totalNetByCurrency[entry.currency] = (totalNetByCurrency[entry.currency] ?? 0) + entry.netAReverser;
  }

  return {
    ownerId: owner.id,
    ownerName: nomAvecCivilite(owner),
    ownerCompanyName: owner.companyName,
    iban: owner.iban,
    bic: owner.bic,
    managementFeeRate: owner.managementFeeRate,
    month,
    year,
    properties: propertyLines,
    totalLoyersByCurrency,
    totalChargesByCurrency,
    totalCommissionByCurrency,
    totalNetByCurrency,
  };
}

async function loadAgencyName(managerId: string): Promise<string> {
  const [settings] = await db
    .select({ agencyName: agencySettings.agencyName })
    .from(agencySettings)
    .where(eq(agencySettings.userId, managerId));
  return settings?.agencyName || "Agence Immobilière";
}

export const getCrgForOwner = asyncHandler(async (req: Request, res: Response) => {
  const { month, year } = resolveMonthYear(req);
  const owner = await loadOwnerForManager(req.params.ownerId, req.user!.userId);
  res.json(await computeCrg(owner, month, year));
});

export const getMyCrg = asyncHandler(async (req: Request, res: Response) => {
  const owner = await chargerProprietaireDuCompte(req);

  const { month, year } = resolveMonthYear(req);
  res.json(await computeCrg(owner, month, year));
});

export const exportCrgForOwner = asyncHandler(async (req: Request, res: Response) => {
  const { month, year } = resolveMonthYear(req);
  const owner = await loadOwnerForManager(req.params.ownerId, req.user!.userId);
  const crg = await computeCrg(owner, month, year);
  const agencyName = await loadAgencyName(req.user!.userId);

  const html = generateCrgHtml({ ...crg, agencyName });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

export const exportMyCrg = asyncHandler(async (req: Request, res: Response) => {
  const owner = await chargerProprietaireDuCompte(req);

  const { month, year } = resolveMonthYear(req);
  const crg = await computeCrg(owner, month, year);
  const agencyName = await loadAgencyName(owner.managerId);

  const html = generateCrgHtml({ ...crg, agencyName });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});
