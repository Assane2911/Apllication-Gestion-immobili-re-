import { asc, eq, gt, inArray, or } from "drizzle-orm";
import { db } from "../db/client";
import { invoicePayments, invoices } from "../db/schema";

/**
 * Encaissements : l'argent REÇU, paiement par paiement.
 *
 * Les bilans (bilan fiscal, grand livre, FEC, SYSCOHADA, compte-rendu de
 * gestion, tableaux de bord, exports) comptent en base ENCAISSEMENTS : un loyer
 * compte à la date où l'argent est arrivé. Quand une facture est réglée en
 * plusieurs fois, chaque paiement compte à SA date et pour SON montant — et non
 * le total de la facture à la date du dernier paiement, comme avant.
 *
 * Une facture réglée d'un coup (toutes celles d'avant les paiements partiels,
 * et celles que Stripe ou PayDunya règlent) n'a pas de ligne de paiement : elle
 * vaut UN encaissement de son montant, à `paidAt` (repli sur l'échéance si
 * `paidAt` manque, comme partout depuis l'origine). Les chiffres de ces
 * factures-là ne changent donc pas.
 */

type Facture = typeof invoices.$inferSelect;

/** Factures dont de l'argent a été reçu : réglées, ou ayant reçu au moins un acompte. */
export const factureEncaissee = or(eq(invoices.status, "PAID"), gt(invoices.amountPaid, 0));

const TAILLE_LOT = 5000;

/**
 * Remplace chaque ligne `{ invoice, ... }` par UNE LIGNE PAR ENCAISSEMENT, dont
 * la facture porte le montant, la date, le moyen et la référence DU PAIEMENT
 * (les autres champs de la ligne, et de la facture, sont conservés). Les
 * consommateurs n'ont donc rien à changer : ils lisent `invoice.amount` et
 * `invoice.paidAt` comme avant.
 */
export async function developperEncaissements<R extends { invoice: Facture }>(lignes: R[]): Promise<R[]> {
  if (lignes.length === 0) return [];

  const ids = Array.from(new Set(lignes.map((l) => l.invoice.id)));
  const parFacture = new Map<string, (typeof invoicePayments.$inferSelect)[]>();
  for (let i = 0; i < ids.length; i += TAILLE_LOT) {
    const paiements = await db
      .select()
      .from(invoicePayments)
      .where(inArray(invoicePayments.invoiceId, ids.slice(i, i + TAILLE_LOT)))
      .orderBy(asc(invoicePayments.paidAt), asc(invoicePayments.createdAt));
    for (const p of paiements) {
      const deja = parFacture.get(p.invoiceId);
      if (deja) deja.push(p);
      else parFacture.set(p.invoiceId, [p]);
    }
  }

  const resultat: R[] = [];
  for (const ligne of lignes) {
    const paiements = parFacture.get(ligne.invoice.id);
    if (paiements && paiements.length > 0) {
      for (const p of paiements) {
        resultat.push({
          ...ligne,
          invoice: { ...ligne.invoice, amount: p.amount, paidAt: p.paidAt, paymentMethod: p.paymentMethod, paymentRef: p.paymentRef },
        });
      }
    } else if (ligne.invoice.status === "PAID") {
      resultat.push(ligne);
    }
    // Une facture non payée sans aucun paiement n'a rien encaissé : aucune ligne.
  }
  return resultat;
}

/** Variante pour une liste de factures « nues » (sans jointure). */
export async function developperFactures(factures: Facture[]): Promise<Facture[]> {
  return (await developperEncaissements(factures.map((invoice) => ({ invoice })))).map((l) => l.invoice);
}
