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

  const existingInvoices = await dbClient.select().from(invoices).where(eq(invoices.contractId, contract.id));
  const existingKeys = new Set(existingInvoices.map((i: typeof invoices.$inferSelect) => `${i.periodMonth}-${i.periodYear}`));

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

    if (!existingKeys.has(`${periodMonth}-${periodYear}`)) {
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
