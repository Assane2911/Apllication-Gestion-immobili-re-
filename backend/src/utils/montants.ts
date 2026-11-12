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

/**
 * Devises dont l'unité n'a pas de sous-division : un « franc CFA » ne se divise pas en centimes. Stripe attend toujours un entier
 * dans la plus petite unité de la devise (voir payment.service.ts) : 15000 pour 15 000 XOF, mais 2900 pour 29,00 EUR.
 *
 * Liste des devises sans décimale prises en charge par Stripe.
 */
export const DEVISES_SANS_DECIMALE = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
  "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export function estDeviseSansDecimale(devise?: string | null): boolean {
  return DEVISES_SANS_DECIMALE.has((devise ?? "").toUpperCase());
}

/**
 * Arrondit un montant CALCULÉ (prorata, révision) à la plus petite unité de sa devise : au franc entier pour le franc CFA, au
 * centime sinon. Un loyer au prorata de 54 838,71 FCFA n'a pas de sens — ni à l'écran, ni sur une quittance, ni chez un
 * prestataire de paiement, qui encaisse des francs entiers. Ne s'applique jamais à un montant SAISI (loyer, paiement).
 */
export function arrondirPourDevise(montant: number, devise?: string | null): number {
  return estDeviseSansDecimale(devise) ? Math.round(montant) : arrondir(montant);
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
