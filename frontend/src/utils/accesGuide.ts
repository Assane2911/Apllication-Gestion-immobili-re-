import type { AuthUser } from "../types";

/**
 * Qui voit le guide de démarrage : la formule Agence & Multi-Comptes (identifiant ENTERPRISE), dont il fait
 * partie de l'accompagnement, ET tout compte en essai gratuit — une nouvelle inscription démarre en Starter
 * et n'a donc, hors essai, aucune raison d'être orientée vers un guide qu'elle ne retrouvera qu'en payant la
 * formule Agence ; c'est pourtant pendant l'essai qu'une agence en a le plus besoin. Le menu et la page lisent
 * cette seule règle, pour ne jamais diverger.
 */
export function peutVoirLeGuide(user: Pick<AuthUser, "subscription"> | null | undefined): boolean {
  const abonnement = user?.subscription;
  return abonnement?.plan === "ENTERPRISE" || abonnement?.isTrialActive === true;
}
