import { and, eq, lt } from "drizzle-orm";
import { db, DbClient } from "../db/client";
import { contracts, invoices } from "../db/schema";

type Contract = typeof contracts.$inferSelect;

/**
 * Génère les factures de loyer manquantes pour un contrat actif, du mois de
 * début du contrat jusqu'au mois courant (ou jusqu'à la fin du contrat si
 * elle est déjà passée). Idempotent grâce à l'index unique
 * (contractId, mois, année) — sûr à appeler plusieurs fois.
 */
export async function generateInvoicesForContract(contract: Contract, dbClient: DbClient = db) {
  const start = new Date(contract.startDate);
  const end = new Date(contract.endDate);
  const today = new Date();
  const cutoff = end < today ? end : today;

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const created: string[] = [];

  // Le mois déjà facturé par N'IMPORTE QUEL contrat de CE bien (pas
  // seulement celui-ci) ne doit jamais l'être une seconde fois. Un
  // renouvellement (voir renewContract) démarre le nouveau contrat le
  // lendemain de la fin de l'ancien, mais le curseur ci-dessus repart
  // toujours du 1er du mois de son startDate — sans ce garde-fou au niveau
  // du bien, le mois de transition recevait une facture PLEINE de l'ancien
  // contrat (déjà émise avant le renouvellement) ET une facture PLEINE du
  // nouveau (émise aussitôt après), soit le double du loyer réellement dû
  // pour ce mois. L'index unique (contractId, mois, année) ne pouvait pas
  // l'empêcher : il protège contre un doublon au sein d'un même contrat, pas
  // entre deux contrats successifs sur le même bien.
  //
  // Une facture ANNULÉE ne compte pas comme un mois facturé : elle n'est plus
  // réclamée à personne. Sans cette nuance, annuler une facture erronée gelait
  // son mois définitivement — le loyer ne pouvait plus jamais être facturé, ni
  // au même locataire ni à son successeur, et rien ne le signalait.
  const existingInvoices = await dbClient
    .select({
      contractId: invoices.contractId,
      periodMonth: invoices.periodMonth,
      periodYear: invoices.periodYear,
      status: invoices.status,
    })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .where(eq(contracts.propertyId, contract.propertyId));

  type LigneExistante = { contractId: string; periodMonth: number; periodYear: number; status: string };

  // Mois déjà couverts par une facture VIVANTE, quel que soit le contrat du
  // bien : c'est le garde anti-double-facturation décrit ci-dessus.
  const existingKeys = new Set(
    existingInvoices
      .filter((i: LigneExistante) => i.status !== "CANCELLED")
      .map((i: LigneExistante) => `${i.periodMonth}-${i.periodYear}`)
  );

  // Mois déjà présents pour CE contrat, annulations comprises : l'index unique
  // (contractId, mois, année) existe toujours, donc réinsérer ici échouerait.
  // Une facture annulée ne se régénère ainsi que via un AUTRE contrat du bien
  // (nouveau locataire), jamais en doublon sur le même.
  const clesDeCeContrat = new Set(
    existingInvoices
      .filter((i: LigneExistante) => i.contractId === contract.id)
      .map((i: LigneExistante) => `${i.periodMonth}-${i.periodYear}`)
  );

  while (cursor <= cutoff) {
    const periodMonth = cursor.getMonth() + 1;
    const periodYear = cursor.getFullYear();
    // new Date(year, month, day) déborde silencieusement sur le mois suivant
    // quand `day` dépasse le nombre de jours du mois visé (ex: un bail
    // démarrant le 31 janvier produisait une échéance "Février" au 3 mars).
    // On plafonne donc le jour souhaité au dernier jour réel du mois de la
    // période — new Date(year, month, 0) donne le dernier jour du mois
    // (month - 1) puisque le jour 0 recule d'un jour depuis le 1er du mois
    // suivant.
    const desiredDay = start.getDate() || 1;
    const lastDayOfPeriodMonth = new Date(periodYear, periodMonth, 0).getDate();
    const dueDate = new Date(periodYear, periodMonth - 1, Math.min(desiredDay, lastDayOfPeriodMonth));

    const cle = `${periodMonth}-${periodYear}`;
    if (!existingKeys.has(cle) && !clesDeCeContrat.has(cle)) {
      const [invoice] = await dbClient
        .insert(invoices)
        .values({
          contractId: contract.id,
          periodMonth,
          periodYear,
          amount: contract.rent,
          currency: contract.currency ?? "EUR",
          dueDate,
          status: dueDate < today ? "LATE" : "PENDING",
        })
        .returning();
      created.push(invoice.id);
    }

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return created;
}

/** Repasse en LATE les factures PENDING dont la date d'échéance est dépassée. */
export async function markOverdueInvoices() {
  const result = await db
    .update(invoices)
    .set({ status: "LATE" })
    .where(and(eq(invoices.status, "PENDING"), lt(invoices.dueDate, new Date())))
    .returning();
  return result.length;
}
