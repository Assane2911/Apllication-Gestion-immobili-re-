import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { agencySettings, contracts, invoices, leaseNotices, leaseSettlements, properties, tenants } from "../db/schema";
import { ApiError } from "../utils/asyncHandler";
import { arrondir, montantRegle } from "../utils/montants";
import { colocatairesActifs, nomsDesLocataires } from "./colocation.service";
import { etapesDeSortie, indexDuMois } from "./conge.service";
import { periodeCouverte } from "./invoice.service";

/**
 * Solde de tout compte : l'état financier d'un bail à la sortie du locataire. Il rassemble ce que le locataire doit encore
 * (loyers impayés jusqu'au mois de sa sortie), ce qui lui revient (dépôt de garantie, trop-perçu) et ce qui est retenu sur
 * le dépôt (retenues déjà enregistrées avec la restitution : voir recordDepositRefund). Le résultat est un solde SIGNÉ :
 * positif, la somme à restituer ; négatif, le reste dû par le locataire ; nul, le compte est soldé.
 *
 * Aucun calcul ne s'ajoute à ceux qui existent : les restes dus viennent de `montantRegle` et de `arrondir` (paiements
 * partiels), la couverture d'un mois de `periodeCouverte` (prorata), les retenues de la restitution du dépôt.
 */
export type ModeDernierMois = "FULL" | "PRORATA";
export const MODES_DERNIER_MOIS: readonly ModeDernierMois[] = ["FULL", "PRORATA"];

export interface LigneLoyerSolde {
  periodMonth: number;
  periodYear: number;
  /** Montant facturé pour la période. */
  amount: number;
  /** Montant retenu pour le calcul : égal à `amount`, sauf mois de sortie au prorata. */
  retenu: number;
  /** Déjà réglé. */
  paid: number;
  /** Reste dû sur le montant retenu. */
  due: number;
  /** Trop-perçu à rendre : le locataire a réglé plus que le montant retenu. */
  credit: number;
}

export interface RetenueDepot {
  label: string;
  amount: number;
}

export interface CalculSolde {
  currency: string;
  exitDate: Date;
  lastMonthMode: ModeDernierMois;
  depositAmount: number;
  deductions: RetenueDepot[];
  deductionsTotal: number;
  /** Faux : aucune restitution n'est encore enregistrée, donc aucune retenue n'est comptée. */
  restitutionEnregistree: boolean;
  /** Part du dépôt déjà rendue au locataire. */
  depositRefunded: number;
  lignes: LigneLoyerSolde[];
  unpaidTotal: number;
  creditTotal: number;
  /** Factures non annulées postérieures au mois de la sortie : ignorées, signalées. */
  facturesApresSortie: number;
  /** Positif : à restituer au locataire. Négatif : reste dû par le locataire. */
  balance: number;
  /** Un état des lieux de sortie finalisé existe pour ce bail. */
  etatDesLieuxDeSortie: boolean;
}

function lireRetenues(brut: string | null): RetenueDepot[] {
  if (!brut) return [];
  try {
    const liste = JSON.parse(brut);
    return Array.isArray(liste) ? liste.filter((r) => r && typeof r.label === "string" && Number.isFinite(r.amount)) : [];
  } catch {
    return [];
  }
}

/** Date de sortie à retenir : celle demandée, sinon le congé en cours, sinon la fin du bail (au plus aujourd'hui). */
export async function dateDeSortiePourSolde(contract: typeof contracts.$inferSelect, demandee?: Date | null): Promise<Date> {
  if (demandee) return demandee;
  const [conge] = await db
    .select({ exitDate: leaseNotices.exitDate })
    .from(leaseNotices)
    .where(and(eq(leaseNotices.contractId, contract.id), eq(leaseNotices.status, "ACTIVE")))
    .limit(1);
  if (conge) return new Date(conge.exitDate);
  const fin = new Date(contract.endDate);
  const aujourdhui = new Date();
  return fin < aujourdhui ? fin : aujourdhui;
}

export async function calculerSolde(
  contract: typeof contracts.$inferSelect,
  options: { exitDate?: Date | null; lastMonthMode?: ModeDernierMois } = {}
): Promise<CalculSolde> {
  const exitDate = await dateDeSortiePourSolde(contract, options.exitDate);
  const mode = options.lastMonthMode ?? "FULL";
  const limite = indexDuMois(exitDate);

  const factures = await db.select().from(invoices).where(eq(invoices.contractId, contract.id));
  const vivantes = factures
    .filter((f: typeof invoices.$inferSelect) => f.status !== "CANCELLED")
    .sort((a: typeof invoices.$inferSelect, b: typeof invoices.$inferSelect) => a.periodYear * 12 + a.periodMonth - (b.periodYear * 12 + b.periodMonth));

  const lignes: LigneLoyerSolde[] = [];
  let facturesApresSortie = 0;
  for (const f of vivantes) {
    const indexPeriode = f.periodYear * 12 + (f.periodMonth - 1);
    if (indexPeriode > limite) {
      facturesApresSortie += 1;
      continue;
    }
    let retenu = arrondir(f.amount);
    if (mode === "PRORATA" && indexPeriode === limite) {
      // Même règle que la facturation : chaque locataire paie ses propres jours. Le montant facturé est ramené au nombre de
      // jours réellement occupés jusqu'à la sortie, par rapport aux jours que la facture couvrait déjà.
      const avant = periodeCouverte(contract, f.periodMonth, f.periodYear);
      const finEffective = exitDate < new Date(contract.endDate) ? exitDate : new Date(contract.endDate);
      const apres = periodeCouverte({ startDate: contract.startDate, endDate: finEffective }, f.periodMonth, f.periodYear);
      if (avant.jours > 0 && apres.jours < avant.jours) retenu = arrondir((f.amount * apres.jours) / avant.jours);
    }
    const paye = montantRegle(f);
    lignes.push({
      periodMonth: f.periodMonth,
      periodYear: f.periodYear,
      amount: arrondir(f.amount),
      retenu,
      paid: paye,
      due: Math.max(0, arrondir(retenu - paye)),
      credit: Math.max(0, arrondir(paye - retenu)),
    });
  }

  const unpaidTotal = arrondir(lignes.reduce((s, l) => s + l.due, 0));
  const creditTotal = arrondir(lignes.reduce((s, l) => s + l.credit, 0));

  const restitutionEnregistree = contract.depositRefundedAt !== null;
  const deductions = restitutionEnregistree ? lireRetenues(contract.depositDeductions) : [];
  const deductionsTotal = arrondir(deductions.reduce((s, d) => s + d.amount, 0));
  const depositRefunded = restitutionEnregistree ? Math.max(0, arrondir(contract.deposit - deductionsTotal)) : 0;

  const balance = arrondir(contract.deposit - deductionsTotal - unpaidTotal + creditTotal - depositRefunded);

  const { etatDesLieuxDeSortie } = await etapesDeSortie(contract);

  return {
    currency: contract.currency ?? "EUR",
    exitDate,
    lastMonthMode: mode,
    depositAmount: arrondir(contract.deposit),
    deductions,
    deductionsTotal,
    restitutionEnregistree,
    depositRefunded,
    lignes,
    unpaidTotal,
    creditTotal,
    facturesApresSortie,
    balance,
    etatDesLieuxDeSortie: etatDesLieuxDeSortie === "COMPLETED",
  };
}

export type SoldeEmis = typeof leaseSettlements.$inferSelect;

/** Détail figé d'un solde émis (JSON en base). */
export interface DetailsSolde {
  lignes: LigneLoyerSolde[];
  deductions: RetenueDepot[];
  facturesApresSortie: number;
}

export function lireDetails(solde: Pick<SoldeEmis, "details">): DetailsSolde {
  try {
    const d = JSON.parse(solde.details) as Partial<DetailsSolde>;
    return { lignes: d.lignes ?? [], deductions: d.deductions ?? [], facturesApresSortie: d.facturesApresSortie ?? 0 };
  } catch {
    return { lignes: [], deductions: [], facturesApresSortie: 0 };
  }
}

export async function listerSoldes(contractId: string): Promise<SoldeEmis[]> {
  return db.select().from(leaseSettlements).where(eq(leaseSettlements.contractId, contractId)).orderBy(desc(leaseSettlements.createdAt));
}

/** Référence imprimée sur le document, stable : SOLDE-AAAA-XXXXXXXX. */
export function referenceSolde(solde: Pick<SoldeEmis, "id" | "createdAt">): string {
  return `SOLDE-${new Date(solde.createdAt).getUTCFullYear()}-${solde.id.slice(0, 8).toUpperCase()}`;
}

/** Données du document : le solde figé, avec l'agence, le bien et les locataires. */
export async function donneesDuSolde(solde: SoldeEmis) {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, solde.contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");
  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, contract.tenantId));
  const [agency] = await db.select().from(agencySettings).where(eq(agencySettings.userId, solde.managerId));
  const details = lireDetails(solde);
  return {
    reference: referenceSolde(solde),
    createdAt: solde.createdAt,
    exitDate: solde.exitDate,
    lastMonthMode: solde.lastMonthMode as ModeDernierMois,
    currency: solde.currency,
    depositAmount: solde.depositAmount,
    deductions: details.deductions,
    deductionsTotal: solde.deductionsTotal,
    depositRefunded: solde.depositRefunded,
    lignes: details.lignes,
    unpaidTotal: solde.unpaidTotal,
    creditTotal: solde.creditTotal,
    balance: solde.balance,
    settledAt: solde.settledAt,
    destinataires: tenant ? nomsDesLocataires([tenant, ...(await colocatairesActifs(contract.id))]) : "",
    adresse: property?.address ?? "",
    propertyTitle: property?.title ?? "",
    contractStartDate: contract.startDate,
    agency: {
      name: agency?.agencyName || "Agence Immobilière",
      address: agency?.address ?? null,
      phone: agency?.phone ?? null,
      email: agency?.email ?? null,
      siretOrId: agency?.siretOrId ?? null,
    },
  };
}

export type DonneesSolde = Awaited<ReturnType<typeof donneesDuSolde>>;
