import type { AuthUser } from "../types";

/**
 * Le guide de démarrage fait partie de l'accompagnement de la formule Agence & Multi-Comptes (identifiant
 * ENTERPRISE) : le menu ne le propose pas aux autres formules, et la page renvoie leurs gestionnaires au
 * tableau de bord. Une seule règle, lue par les deux, pour qu'elles ne divergent pas.
 */
export function aLaFormuleAgence(user: Pick<AuthUser, "subscription"> | null | undefined): boolean {
  return user?.subscription?.plan === "ENTERPRISE";
}
