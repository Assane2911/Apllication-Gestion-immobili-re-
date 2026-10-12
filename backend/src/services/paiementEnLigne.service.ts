import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { invoicePayments, invoices } from "../db/schema";
import { arrondir, resteDu } from "../utils/montants";

const ETATS_MODIFIABLES = ["PENDING", "LATE"];

/**
 * Règle EN LIGNE ce qu'il reste dû sur une facture (Stripe, PayDunya, démo).
 *
 * Le paiement en ligne couvre le RESTE DÛ, pas le montant total : sur une
 * facture déjà réglée en partie par le gestionnaire (voir markInvoicePaid), le
 * locataire ne repaie pas la part déjà versée. Le paiement est enregistré comme
 * un encaissement à part entière (ligne dans invoice_payments, comme un
 * paiement saisi à la main), puis la facture est soldée.
 *
 * Lecture et écriture dans UNE transaction, ligne verrouillée : une livraison
 * rejouée du même webhook (Stripe et PayDunya rejouent), ou deux instances qui
 * la reçoivent en même temps, ne soldent pas deux fois la facture. Renvoie
 * `undefined` quand la facture n'est plus réglable (déjà soldée, annulée) — le
 * seul cas où l'appelant ne doit ni écrire ni envoyer de quittance.
 */
export async function solderEnLigne(
  factureId: string,
  paiement: { methode: "STRIPE" | "PAYDUNYA" | "DEMO" | "BANK_TRANSFER"; reference?: string | null }
) {
  return db.transaction(async (tx) => {
    const [courante] = await tx.select().from(invoices).where(eq(invoices.id, factureId)).for("update");
    if (!courante || !ETATS_MODIFIABLES.includes(courante.status)) return undefined;

    const reste = resteDu(courante);
    const maintenant = new Date();
    const reference = paiement.reference ?? courante.paymentRef;

    await tx.insert(invoicePayments).values({
      invoiceId: courante.id,
      amount: reste,
      paidAt: maintenant,
      paymentMethod: paiement.methode,
      paymentRef: reference,
    });

    const [misAJour] = await tx
      .update(invoices)
      .set({
        status: "PAID",
        amountPaid: arrondir(courante.amount),
        paidAt: maintenant,
        paymentMethod: paiement.methode,
        paymentRef: reference,
      })
      .where(eq(invoices.id, courante.id))
      .returning();
    return misAJour;
  });
}
