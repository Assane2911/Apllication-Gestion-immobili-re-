import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { agencySettings, contracts, expenses, invoices, ownerPayouts, owners, properties } from "../db/schema";
import { generateReleveAnnuelHtml } from "../services/document.releveAnnuel";
import { generateCrgHtml } from "../services/pdf.service";
import { developperFactures, factureEncaissee } from "../services/encaissements.service";
import { chargerHistoriqueTaux } from "../services/tauxCommission.service";
import { asyncHandler } from "../utils/asyncHandler";
import { langueOuDefaut } from "../utils/langue";
import { arrondir } from "../utils/montants";
import { nomAvecCivilite } from "../utils/nom";
import { TauxDepuis, tauxDuMois } from "../utils/tauxCommission";
import { assertOwnership, chargerProprietaireDuCompte } from "../utils/authorization";

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

export async function loadOwnerForManager(ownerId: string, managerId: string) {
  const [owner] = await db.select().from(owners).where(eq(owners.id, ownerId));
  assertOwnership(owner, (o) => o.managerId, managerId, "Propriétaire introuvable", 404, "OWNER_NOT_FOUND");
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
  /** Reversements enregistrés au titre de ce mois, du plus ancien au plus récent. */
  reversements: Array<{
    id: string;
    currency: string;
    amount: number;
    paidAt: Date;
    method: string;
    reference: string | null;
    note: string | null;
  }>;
  totalReverseByCurrency: Record<string, number>;
  /** Net du mois moins ce qui a déjà été reversé ; négatif si l'agence a versé plus que le net (encaissement corrigé depuis). */
  resteAReverserByCurrency: Record<string, number>;
};

export async function computeCrg(owner: OwnerRow, month: number, year: number): Promise<CrgSynthesis> {
  const [crg] = await computeCrgPourProprietaires([owner], month, year);
  return crg;
}

/** Valeur de `groupe` pour la clé donnée, créée vide au besoin. */
function parCle<K, V>(groupes: Map<K, V[]>, cle: K): V[] {
  let liste = groupes.get(cle);
  if (!liste) {
    liste = [];
    groupes.set(cle, liste);
  }
  return liste;
}

/**
 * Compte-rendu de gestion de PLUSIEURS propriétaires pour un même mois, avec un nombre de requêtes
 * constant : biens, baux, encaissements, dépenses et reversements de tous les propriétaires sont lus
 * en une fois, puis répartis. La synthèse des reversements de l'agence recalculait auparavant le
 * compte-rendu de chaque propriétaire l'un après l'autre (environ cinq requêtes chacun), et la page
 * ralentissait avec le nombre de propriétaires. Le résultat de chacun est identique à celui d'un calcul
 * isolé — c'est le même code (computeCrg n'est qu'un appel avec un seul propriétaire).
 */
export async function computeCrgPourProprietaires(proprietaires: OwnerRow[], month: number, year: number): Promise<CrgSynthesis[]> {
  if (proprietaires.length === 0) return [];
  const { start, end } = monthBounds(month, year);
  const ownerIds = proprietaires.map((o) => o.id);

  const tousLesBiens: Array<typeof properties.$inferSelect> = await db.select().from(properties).where(inArray(properties.ownerId, ownerIds));
  const propertyIds = tousLesBiens.map((p) => p.id);

  const tousLesBaux: Array<typeof contracts.$inferSelect> =
    propertyIds.length > 0 ? await db.select().from(contracts).where(inArray(contracts.propertyId, propertyIds)) : [];
  const contractIds = tousLesBaux.map((c) => c.id);

  // paidAt est nullable (une facture PAID sans paidAt renseigné retombe sur
  // dueDate) : comme dans fiscal.controller.ts, le filtre par mois est donc
  // appliqué en mémoire après avoir choisi la bonne date par ligne, pas
  // directement en SQL.
  const [paidInvoiceRows, expenseRows, payoutRows] = await Promise.all([
    contractIds.length > 0
      ? db.select().from(invoices).where(and(inArray(invoices.contractId, contractIds), factureEncaissee))
      : Promise.resolve([] as (typeof invoices.$inferSelect)[]),
    propertyIds.length > 0
      ? db
          .select()
          .from(expenses)
          .where(and(inArray(expenses.propertyId, propertyIds), gte(expenses.expenseDate, start), lte(expenses.expenseDate, end)))
      : Promise.resolve([] as (typeof expenses.$inferSelect)[]),
    db
      .select()
      .from(ownerPayouts)
      .where(and(inArray(ownerPayouts.ownerId, ownerIds), eq(ownerPayouts.periodMonth, month), eq(ownerPayouts.periodYear, year)))
      .orderBy(asc(ownerPayouts.paidAt), asc(ownerPayouts.createdAt)),
  ]);

  const invoiceDate = (inv: typeof invoices.$inferSelect) => new Date(inv.paidAt ?? inv.dueDate);
  // Un encaissement par paiement (voir encaissements.service.ts).
  const encaissements = (await developperFactures(paidInvoiceRows)).filter((inv) => {
    const d = invoiceDate(inv);
    return d >= start && d <= end;
  });

  // Répartition par propriétaire.
  const proprietaireDuBien = new Map(tousLesBiens.map((p) => [p.id, p.ownerId] as const));
  const bauxParProprietaire = new Map<string, Array<typeof contracts.$inferSelect>>();
  const proprietaireDuBail = new Map<string, string>();
  for (const c of tousLesBaux) {
    const ownerId = proprietaireDuBien.get(c.propertyId);
    if (!ownerId) continue;
    proprietaireDuBail.set(c.id, ownerId);
    parCle(bauxParProprietaire, ownerId).push(c);
  }
  const biensParProprietaire = new Map<string, Array<typeof properties.$inferSelect>>();
  for (const p of tousLesBiens) if (p.ownerId) parCle(biensParProprietaire, p.ownerId).push(p);
  const encaissementsParProprietaire = new Map<string, Array<typeof invoices.$inferSelect>>();
  for (const inv of encaissements) {
    const ownerId = proprietaireDuBail.get(inv.contractId);
    if (ownerId) parCle(encaissementsParProprietaire, ownerId).push(inv);
  }
  const depensesParProprietaire = new Map<string, Array<typeof expenses.$inferSelect>>();
  for (const exp of expenseRows) {
    const ownerId = proprietaireDuBien.get(exp.propertyId);
    if (ownerId) parCle(depensesParProprietaire, ownerId).push(exp);
  }
  const reversementsParProprietaire = new Map<string, Array<typeof ownerPayouts.$inferSelect>>();
  for (const r of payoutRows) parCle(reversementsParProprietaire, r.ownerId).push(r);
  const historiqueTaux = await chargerHistoriqueTaux(ownerIds);

  return proprietaires.map((owner) =>
    assemblerCrg(owner, month, year, {
      biens: biensParProprietaire.get(owner.id) ?? [],
      baux: bauxParProprietaire.get(owner.id) ?? [],
      encaissements: encaissementsParProprietaire.get(owner.id) ?? [],
      depenses: depensesParProprietaire.get(owner.id) ?? [],
      reversements: reversementsParProprietaire.get(owner.id) ?? [],
      historiqueTaux: historiqueTaux.get(owner.id) ?? [],
    })
  );
}

type DonneesCrg = {
  biens: Array<typeof properties.$inferSelect>;
  baux: Array<typeof contracts.$inferSelect>;
  encaissements: Array<typeof invoices.$inferSelect>;
  depenses: Array<typeof expenses.$inferSelect>;
  reversements: Array<typeof ownerPayouts.$inferSelect>;
  /** Changements de taux de commission du propriétaire ; vide s'il n'en a jamais fait. */
  historiqueTaux: TauxDepuis[];
};

/** Le calcul proprement dit, sur des données d'UN propriétaire déjà lues : aucune requête. */
function assemblerCrg(owner: OwnerRow, month: number, year: number, donnees: DonneesCrg): CrgSynthesis {
  const ownerProperties = donnees.biens;
  const contractIdToPropertyId = new Map(donnees.baux.map((c) => [c.id, c.propertyId]));
  const filteredInvoices = donnees.encaissements;
  const expenseRows = donnees.depenses;

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

  const titreParBien = new Map(ownerProperties.map((p) => [p.id, p.title] as const));

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
  // Taux en vigueur CE mois-là : un changement de taux ne recalcule pas les mois passés.
  const tauxCommission = tauxDuMois(owner.managementFeeRate, donnees.historiqueTaux, month, year);
  for (const entry of perProperty.values()) {
    entry.commission = Math.round(entry.loyersEncaisses * tauxCommission) / 100;
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

  const reversements = donnees.reversements;
  const totalReverseByCurrency: Record<string, number> = {};
  for (const r of reversements) {
    totalReverseByCurrency[r.currency] = arrondir((totalReverseByCurrency[r.currency] ?? 0) + r.amount);
  }
  const resteAReverserByCurrency: Record<string, number> = {};
  for (const devise of new Set([...Object.keys(totalNetByCurrency), ...Object.keys(totalReverseByCurrency)])) {
    resteAReverserByCurrency[devise] = arrondir((totalNetByCurrency[devise] ?? 0) - (totalReverseByCurrency[devise] ?? 0));
  }

  return {
    ownerId: owner.id,
    ownerName: nomAvecCivilite(owner),
    ownerCompanyName: owner.companyName,
    iban: owner.iban,
    bic: owner.bic,
    managementFeeRate: tauxCommission,
    month,
    year,
    properties: propertyLines,
    totalLoyersByCurrency,
    totalChargesByCurrency,
    totalCommissionByCurrency,
    totalNetByCurrency,
    reversements: reversements.map((r) => ({
      id: r.id,
      currency: r.currency,
      amount: r.amount,
      paidAt: r.paidAt,
      method: r.method,
      reference: r.reference,
      note: r.note,
    })),
    totalReverseByCurrency,
    resteAReverserByCurrency,
  };
}

/** Relevé annuel des loyers d'UN propriétaire : la somme des douze comptes-rendus de gestion mensuels de l'année. */
export type ReleveAnnuel = {
  ownerId: string;
  ownerName: string;
  ownerCompanyName: string | null;
  /** Taux de commission de la fin de l'année (le dernier de `managementFeeRates`). */
  managementFeeRate: number;
  /** Taux appliqués dans l'année aux mois qui ont une activité, dans l'ordre des mois : plusieurs valeurs si le taux a changé en cours d'année. */
  managementFeeRates: number[];
  year: number;
  months: Array<{
    month: number;
    totalLoyersByCurrency: Record<string, number>;
    totalChargesByCurrency: Record<string, number>;
    totalCommissionByCurrency: Record<string, number>;
    totalNetByCurrency: Record<string, number>;
    totalReverseByCurrency: Record<string, number>;
  }>;
  /** Une ligne par couple (bien, devise), cumulée sur l'année. */
  properties: CrgSynthesis["properties"];
  totalLoyersByCurrency: Record<string, number>;
  totalChargesByCurrency: Record<string, number>;
  totalCommissionByCurrency: Record<string, number>;
  totalNetByCurrency: Record<string, number>;
  /** Reversements enregistrés au titre de l'année, du plus ancien au plus récent. */
  reversements: CrgSynthesis["reversements"];
  totalReverseByCurrency: Record<string, number>;
  /** Net de l'année moins ce qui a été reversé ; négatif si l'agence a versé plus que le net. */
  resteAReverserByCurrency: Record<string, number>;
};

function ajouterParDevise(cumul: Record<string, number>, ajout: Record<string, number>) {
  for (const [devise, montant] of Object.entries(ajout)) cumul[devise] = arrondir((cumul[devise] ?? 0) + montant);
}

/**
 * Relevé annuel d'un propriétaire. Chaque mois est calculé par assemblerCrg, le même code que le compte-rendu mensuel que le
 * propriétaire reçoit déjà : les douze mois du relevé sont donc exactement ceux de ses comptes-rendus (même base d'encaissement,
 * même commission arrondie mois par mois), et le total de l'année en est la somme. Les données de l'année sont lues une seule
 * fois, puis réparties par mois en mémoire.
 */
export async function computeReleveAnnuel(owner: OwnerRow, year: number): Promise<ReleveAnnuel> {
  const debutAnnee = monthBounds(1, year).start;
  const finAnnee = monthBounds(12, year).end;

  const biens: Array<typeof properties.$inferSelect> = await db.select().from(properties).where(eq(properties.ownerId, owner.id));
  const propertyIds = biens.map((p) => p.id);
  const baux: Array<typeof contracts.$inferSelect> =
    propertyIds.length > 0 ? await db.select().from(contracts).where(inArray(contracts.propertyId, propertyIds)) : [];
  const contractIds = baux.map((c) => c.id);
  const historiqueTaux = (await chargerHistoriqueTaux([owner.id])).get(owner.id) ?? [];

  const [paidInvoiceRows, expenseRows, payoutRows] = await Promise.all([
    contractIds.length > 0
      ? db.select().from(invoices).where(and(inArray(invoices.contractId, contractIds), factureEncaissee))
      : Promise.resolve([] as (typeof invoices.$inferSelect)[]),
    propertyIds.length > 0
      ? db
          .select()
          .from(expenses)
          .where(and(inArray(expenses.propertyId, propertyIds), gte(expenses.expenseDate, debutAnnee), lte(expenses.expenseDate, finAnnee)))
      : Promise.resolve([] as (typeof expenses.$inferSelect)[]),
    db
      .select()
      .from(ownerPayouts)
      .where(and(eq(ownerPayouts.ownerId, owner.id), eq(ownerPayouts.periodYear, year)))
      .orderBy(asc(ownerPayouts.paidAt), asc(ownerPayouts.createdAt)),
  ]);

  const invoiceDate = (inv: typeof invoices.$inferSelect) => new Date(inv.paidAt ?? inv.dueDate);
  const encaissementsDeLAnnee = (await developperFactures(paidInvoiceRows)).filter((inv) => {
    const d = invoiceDate(inv);
    return d >= debutAnnee && d <= finAnnee;
  });

  const mois: ReleveAnnuel["months"] = [];
  const parBien = new Map<string, CrgSynthesis["properties"][number]>();
  const totalLoyersByCurrency: Record<string, number> = {};
  const totalChargesByCurrency: Record<string, number> = {};
  const totalCommissionByCurrency: Record<string, number> = {};
  const totalNetByCurrency: Record<string, number> = {};
  const totalReverseByCurrency: Record<string, number> = {};
  const tauxParMois: Array<{ taux: number; actif: boolean }> = [];

  for (let month = 1; month <= 12; month++) {
    const { start, end } = monthBounds(month, year);
    const crg = assemblerCrg(owner, month, year, {
      biens,
      baux,
      encaissements: encaissementsDeLAnnee.filter((inv) => {
        const d = invoiceDate(inv);
        return d >= start && d <= end;
      }),
      depenses: expenseRows.filter((e) => e.expenseDate >= start && e.expenseDate <= end),
      reversements: payoutRows.filter((r) => r.periodMonth === month),
      historiqueTaux,
    });
    const actif = [crg.totalLoyersByCurrency, crg.totalChargesByCurrency, crg.totalReverseByCurrency].some((t) => Object.values(t).some((m) => m !== 0));
    tauxParMois.push({ taux: crg.managementFeeRate, actif });
    mois.push({
      month,
      totalLoyersByCurrency: crg.totalLoyersByCurrency,
      totalChargesByCurrency: crg.totalChargesByCurrency,
      totalCommissionByCurrency: crg.totalCommissionByCurrency,
      totalNetByCurrency: crg.totalNetByCurrency,
      totalReverseByCurrency: crg.totalReverseByCurrency,
    });
    ajouterParDevise(totalLoyersByCurrency, crg.totalLoyersByCurrency);
    ajouterParDevise(totalChargesByCurrency, crg.totalChargesByCurrency);
    ajouterParDevise(totalCommissionByCurrency, crg.totalCommissionByCurrency);
    ajouterParDevise(totalNetByCurrency, crg.totalNetByCurrency);
    ajouterParDevise(totalReverseByCurrency, crg.totalReverseByCurrency);
    for (const ligneDuMois of crg.properties) {
      const cleBien = `${ligneDuMois.propertyId}|${ligneDuMois.currency}`;
      const cumul = parBien.get(cleBien) ?? { ...ligneDuMois, loyersEncaisses: 0, chargesDeduites: 0, commission: 0, netAReverser: 0 };
      cumul.loyersEncaisses = arrondir(cumul.loyersEncaisses + ligneDuMois.loyersEncaisses);
      cumul.chargesDeduites = arrondir(cumul.chargesDeduites + ligneDuMois.chargesDeduites);
      cumul.commission = arrondir(cumul.commission + ligneDuMois.commission);
      cumul.netAReverser = arrondir(cumul.netAReverser + ligneDuMois.netAReverser);
      parBien.set(cleBien, cumul);
    }
  }

  const resteAReverserByCurrency: Record<string, number> = {};
  for (const devise of new Set([...Object.keys(totalNetByCurrency), ...Object.keys(totalReverseByCurrency)])) {
    resteAReverserByCurrency[devise] = arrondir((totalNetByCurrency[devise] ?? 0) - (totalReverseByCurrency[devise] ?? 0));
  }

  // Taux des mois qui ont une activité, sans répétition ; sans aucune activité, le taux du dernier mois de l'année.
  const tauxDistincts: number[] = [];
  for (const { taux, actif } of tauxParMois) if (actif && tauxDistincts[tauxDistincts.length - 1] !== taux) tauxDistincts.push(taux);
  const managementFeeRates = tauxDistincts.length > 0 ? tauxDistincts : [tauxParMois[tauxParMois.length - 1].taux];

  return {
    ownerId: owner.id,
    ownerName: nomAvecCivilite(owner),
    ownerCompanyName: owner.companyName,
    managementFeeRate: managementFeeRates[managementFeeRates.length - 1],
    managementFeeRates,
    year,
    months: mois,
    properties: Array.from(parBien.values()).sort((a, b) => a.propertyTitle.localeCompare(b.propertyTitle) || a.currency.localeCompare(b.currency)),
    totalLoyersByCurrency,
    totalChargesByCurrency,
    totalCommissionByCurrency,
    totalNetByCurrency,
    reversements: payoutRows.map((r) => ({
      id: r.id,
      currency: r.currency,
      amount: r.amount,
      paidAt: r.paidAt,
      method: r.method,
      reference: r.reference,
      note: r.note,
    })),
    totalReverseByCurrency,
    resteAReverserByCurrency,
  };
}

export async function loadAgencyName(managerId: string): Promise<string> {
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

/**
 * Compte-rendu tel que le PROPRIÉTAIRE peut le lire : sans les notes internes de l'agence. La note d'un
 * reversement est libellée « Note interne » côté agence (« propriétaire difficile à joindre »...), mais l'API du
 * propriétaire la renvoyait avec le reste : invisible à l'écran, lisible dans la réponse réseau.
 */
type CrgPourProprietaire = Omit<CrgSynthesis, "reversements"> & {
  reversements: Array<Omit<CrgSynthesis["reversements"][number], "note">>;
};

function sansNotesInternes(crg: CrgSynthesis): CrgPourProprietaire {
  return { ...crg, reversements: crg.reversements.map(({ note: _note, ...visible }) => visible) };
}

export const getMyCrg = asyncHandler(async (req: Request, res: Response) => {
  const owner = await chargerProprietaireDuCompte(req);

  const { month, year } = resolveMonthYear(req);
  res.json(sansNotesInternes(await computeCrg(owner, month, year)));
});

export const exportCrgForOwner = asyncHandler(async (req: Request, res: Response) => {
  const { month, year } = resolveMonthYear(req);
  const owner = await loadOwnerForManager(req.params.ownerId, req.user!.userId);
  const crg = await computeCrg(owner, month, year);
  const agencyName = await loadAgencyName(req.user!.userId);

  // Le compte-rendu est écrit à l'attention du propriétaire : dans SA langue, quelle que soit celle du gestionnaire.
  const html = generateCrgHtml({ ...crg, agencyName, langue: langueOuDefaut(owner.language) });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

export const exportMyCrg = asyncHandler(async (req: Request, res: Response) => {
  const owner = await chargerProprietaireDuCompte(req);

  const { month, year } = resolveMonthYear(req);
  const crg = sansNotesInternes(await computeCrg(owner, month, year));
  const agencyName = await loadAgencyName(owner.managerId);

  const html = generateCrgHtml({ ...crg, agencyName, langue: langueOuDefaut(owner.language) });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

const anneeQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });

function resolveYear(req: Request): number {
  return anneeQuerySchema.parse(req.query).year ?? new Date().getFullYear();
}

export const getReleveAnnuelForOwner = asyncHandler(async (req: Request, res: Response) => {
  const owner = await loadOwnerForManager(req.params.ownerId, req.user!.userId);
  res.json(await computeReleveAnnuel(owner, resolveYear(req)));
});

export const getMyReleveAnnuel = asyncHandler(async (req: Request, res: Response) => {
  const owner = await chargerProprietaireDuCompte(req);
  const releve = await computeReleveAnnuel(owner, resolveYear(req));
  // Comme pour le compte-rendu mensuel : la note d'un reversement est interne à l'agence.
  res.json({ ...releve, reversements: releve.reversements.map(({ note: _note, ...visible }) => visible) });
});

export const exportReleveAnnuelForOwner = asyncHandler(async (req: Request, res: Response) => {
  const owner = await loadOwnerForManager(req.params.ownerId, req.user!.userId);
  const releve = await computeReleveAnnuel(owner, resolveYear(req));
  const agencyName = await loadAgencyName(req.user!.userId);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(generateReleveAnnuelHtml({ ...releve, agencyName, langue: langueOuDefaut(owner.language) }));
});

export const exportMyReleveAnnuel = asyncHandler(async (req: Request, res: Response) => {
  const owner = await chargerProprietaireDuCompte(req);
  const releve = await computeReleveAnnuel(owner, resolveYear(req));
  const agencyName = await loadAgencyName(owner.managerId);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(generateReleveAnnuelHtml({ ...releve, agencyName, langue: langueOuDefaut(owner.language) }));
});
