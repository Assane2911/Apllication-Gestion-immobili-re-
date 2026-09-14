import { AuthPayload } from "../middleware/auth";
import { ApiError } from "./asyncHandler";

/**
 * Vérifie qu'un utilisateur authentifié a le droit d'accéder à une ressource
 * rattachée à un contrat (messages, bail, quittance, photo d'incident...) :
 * seuls le locataire du contrat, ou le gestionnaire propriétaire du bien
 * concerné, y ont accès.
 *
 * Ce contrôle était auparavant écrit, à six endroits différents
 * (message.controller.ts, document.controller.ts, issue.controller.ts),
 * comme deux `if` indépendants — un pour TENANT, un pour MANAGER — au lieu
 * d'un if/else exhaustif. Comme le rôle ADMIN n'est ni l'un ni l'autre,
 * aucune des deux conditions ne se déclenchait : l'accès n'était alors
 * JAMAIS refusé pour un compte ADMIN, qui pouvait ainsi lire ou modifier les
 * données privées de n'importe quel gestionnaire ou locataire de la
 * plateforme. Centraliser le contrôle ici, avec un refus explicite par
 * défaut pour tout rôle qui n'est ni le locataire ni le gestionnaire
 * propriétaires, empêche que ce bug ne se reproduise ailleurs.
 */
export function assertAccesLocataireOuGestionnaire(
  role: AuthPayload["role"],
  estLocataireProprietaire: boolean,
  estGestionnaireProprietaire: boolean
): void {
  if (role === "TENANT") {
    if (!estLocataireProprietaire) throw new ApiError(403, "Accès refusé");
    return;
  }
  if (role === "MANAGER") {
    if (!estGestionnaireProprietaire) throw new ApiError(403, "Accès refusé");
    return;
  }
  // Tout autre rôle (ADMIN compris) n'est ni le locataire ni le
  // gestionnaire propriétaires de cette ressource : refus par défaut.
  throw new ApiError(403, "Accès refusé");
}
