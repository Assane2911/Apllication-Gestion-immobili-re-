/**
 * Montants d'une facture et paiements partiels.
 *
 * Les montants sont des nombres à virgule (double precision) : une somme de
 * paiements comme 0,1 + 0,2 ne vaut pas exactement 0,3. Tout calcul de reste dû
 * passe donc par `arrondir`, au centime, et un reste inférieur à un demi-centime
 * est un reste nul — sans quoi une facture réglée en deux fois resterait
 * « soldée à 0,0000000001 près », donc impayée.
 */
export function arrondir(montant: number): number {
  return Math.round((montant + Number.EPSILON) * 100) / 100;
}

interface FactureMontants {
  amount: number;
  amountPaid: number;
  status: string;
}

/** Montant déjà réglé : une facture PAYÉE l'est en totalité, quelle que soit la colonne amountPaid. */
export function montantRegle(facture: FactureMontants): number {
  return facture.status === "PAID" ? arrondir(facture.amount) : arrondir(facture.amountPaid);
}

/** Reste dû : nul pour une facture payée ou annulée. */
export function resteDu(facture: FactureMontants): number {
  if (facture.status === "PAID" || facture.status === "CANCELLED") return 0;
  return Math.max(0, arrondir(facture.amount - facture.amountPaid));
}
