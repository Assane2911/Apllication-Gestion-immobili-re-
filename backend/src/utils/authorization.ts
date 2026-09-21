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

/**
 * Vérifie qu'une ressource existe et appartient bien au gestionnaire courant
 * (`entity.managerId === managerId`, directement ou via un accesseur pour les
 * ressources jointes, ex. `(row) => row.property.managerId`), sinon lève une
 * ApiError (404 "introuvable" par défaut — un 403 se comporterait comme une
 * fuite d'existence : il révélerait qu'une ressource appartenant à un AUTRE
 * gestionnaire existe bien, simplement avec un identifiant différent).
 *
 * Ce contrôle était auparavant recopié à l'identique (31 occurrences) dans
 * 8 contrôleurs (`if (!x || x.managerId !== req.user!.userId) throw new
 * ApiError(404, "..."`) : chaque copie est un endroit où un correctif futur
 * (nouveau rôle, code d'erreur différent) peut être appliqué de façon
 * incohérente, créant une faille d'accès silencieuse sur les copies
 * oubliées (audit sept. 2026). `entity` est explicitement typé comme
 * potentiellement absent (`| null | undefined`) : c'est une fonction
 * d'assertion TypeScript (`asserts entity is NonNullable<T>`), donc tout le
 * code qui suit son appel voit `entity` comme non-nul, exactement comme
 * après le `if` qu'elle remplace.
 */
export function assertOwnership<T>(
  entity: T | null | undefined,
  getManagerId: (entity: NonNullable<T>) => string,
  managerId: string,
  message: string,
  statusCode = 404
): asserts entity is NonNullable<T> {
  if (!entity || getManagerId(entity as NonNullable<T>) !== managerId) {
    throw new ApiError(statusCode, message);
  }
}
