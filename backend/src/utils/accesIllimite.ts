/**
 * Un abonnement ACTIVE sans échéance est un accès illimité (voir requireActiveSubscription) : il n'existe
 * que par un geste de l'administration (grantUnlimitedAccess), jamais par un paiement.
 */
export function aAccesIllimite(compte: { subscriptionStatus: string; subscriptionEndsAt: Date | null }): boolean {
  return compte.subscriptionStatus === "ACTIVE" && compte.subscriptionEndsAt === null;
}
