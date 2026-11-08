import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, DbClient } from "../db/client";
import { contracts, inspections, invoices, leaseNotices } from "../db/schema";

/**
 * Congés : l'application ENREGISTRE un congé donné par un autre moyen (acte d'huissier, lettre recommandée, remise en main
 * propre…). Elle ne le notifie pas et ne fournit aucun acte. Aucune durée de préavis n'est proposée : elle dépend du droit
 * applicable, et le projet ne devine jamais une règle d'un pays à l'autre (voir data/reglesPays.ts côté site).
 */
export const MODES_DE_NOTIFICATION = ["BAILIFF", "REGISTERED_MAIL", "HAND_DELIVERY", "EMAIL", "OTHER"] as const;
export const AUTEURS_DE_CONGE = ["TENANT", "LANDLORD"] as const;
export const UNITES_DE_PREAVIS = ["DAYS", "MONTHS"] as const;

export type ModeDeNotification = (typeof MODES_DE_NOTIFICATION)[number];
export type UniteDePreavis = (typeof UNITES_DE_PREAVIS)[number];
export type Conge = typeof leaseNotices.$inferSelect;

/**
 * Date de sortie = date de signification ou de réception + durée du préavis. Calcul en jours civils (UTC) : un préavis en
 * mois ajoute des mois de calendrier, et un jour qui n'existe pas dans le mois d'arrivée (31 janvier + 1 mois) retombe sur
 * le dernier jour de ce mois (28 ou 29 février), jamais sur le mois suivant.
 */
export function calculerDateDeSortie(servedAt: Date, valeur: number, unite: UniteDePreavis): Date {
  const depart = new Date(servedAt);
  if (unite === "DAYS") {
    return new Date(Date.UTC(depart.getUTCFullYear(), depart.getUTCMonth(), depart.getUTCDate() + valeur));
  }
  const mois = depart.getUTCMonth() + valeur;
  const annee = depart.getUTCFullYear() + Math.floor(mois / 12);
  const moisCible = ((mois % 12) + 12) % 12;
  const dernierJour = new Date(Date.UTC(annee, moisCible + 1, 0)).getUTCDate();
  return new Date(Date.UTC(annee, moisCible, Math.min(depart.getUTCDate(), dernierJour)));
}

/** Index absolu du mois d'une date (année × 12 + mois), pour comparer des périodes de facturation. */
export function indexDuMois(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/**
 * Index du dernier mois à facturer pour un bail dont le congé est en cours, ou null s'il n'y en a pas. Le mois de la
 * sortie reste facturé (en entier, sauf si le bail se termine avant) ; les mois suivants ne le sont plus.
 */
export async function dernierMoisFacturable(contractId: string, dbClient: DbClient = db): Promise<number | null> {
  const [conge] = await dbClient
    .select({ exitDate: leaseNotices.exitDate })
    .from(leaseNotices)
    .where(and(eq(leaseNotices.contractId, contractId), eq(leaseNotices.status, "ACTIVE")))
    .limit(1);
  return conge ? indexDuMois(new Date(conge.exitDate)) : null;
}

/** Factures non annulées dont la période tombe après le mois de sortie : à vérifier ou annuler par le gestionnaire. */
export async function facturesApresLaSortie(contractId: string, exitDate: Date): Promise<number> {
  const limite = indexDuMois(new Date(exitDate));
  const lignes = await db
    .select({ periodMonth: invoices.periodMonth, periodYear: invoices.periodYear })
    .from(invoices)
    .where(and(eq(invoices.contractId, contractId), ne(invoices.status, "CANCELLED")));
  return lignes.filter((l: { periodMonth: number; periodYear: number }) => l.periodYear * 12 + (l.periodMonth - 1) > limite).length;
}

export interface ResumeConge {
  id: string;
  givenBy: string;
  deliveryMode: string;
  servedAt: Date;
  exitDate: Date;
}

/** Congé en cours de chaque bail de la liste, en une requête. */
export async function congesActifsParBail(contractIds: string[]): Promise<Map<string, ResumeConge>> {
  if (contractIds.length === 0) return new Map();
  const lignes = await db
    .select({
      id: leaseNotices.id,
      contractId: leaseNotices.contractId,
      givenBy: leaseNotices.givenBy,
      deliveryMode: leaseNotices.deliveryMode,
      servedAt: leaseNotices.servedAt,
      exitDate: leaseNotices.exitDate,
    })
    .from(leaseNotices)
    .where(and(inArray(leaseNotices.contractId, contractIds), eq(leaseNotices.status, "ACTIVE")));
  return new Map(
    lignes.map((l: ResumeConge & { contractId: string }) => [
      l.contractId,
      { id: l.id, givenBy: l.givenBy, deliveryMode: l.deliveryMode, servedAt: l.servedAt, exitDate: l.exitDate },
    ])
  );
}

export interface EtapesDeSortie {
  /** NONE : aucun état des lieux de sortie ; DRAFT : commencé ; COMPLETED : finalisé. */
  etatDesLieuxDeSortie: "NONE" | "DRAFT" | "COMPLETED";
  depotRestitue: boolean;
}

/** Où en est la sortie : l'état des lieux de sortie et la restitution du dépôt, déjà gérés ailleurs. */
export async function etapesDeSortie(contract: Pick<typeof contracts.$inferSelect, "id" | "depositRefundedAt">): Promise<EtapesDeSortie> {
  const sorties = await db
    .select({ status: inspections.status })
    .from(inspections)
    .where(and(eq(inspections.contractId, contract.id), eq(inspections.type, "EXIT")))
    .orderBy(desc(inspections.createdAt));
  const etat = sorties.some((s: { status: string }) => s.status === "COMPLETED") ? "COMPLETED" : sorties.length > 0 ? "DRAFT" : "NONE";
  return { etatDesLieuxDeSortie: etat, depotRestitue: contract.depositRefundedAt !== null };
}
