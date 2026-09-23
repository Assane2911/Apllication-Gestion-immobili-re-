import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { AuthPayload } from "../middleware/auth";
import { ApiError } from "./asyncHandler";

/**
 * Charge le compte désigné par le jeton, ou refuse la requête en 401.
 *
 * Un JWT reste valide jusqu'à son expiration : rien, dans un jeton signé, ne
 * dit que le compte existe encore. Depuis que le gestionnaire peut supprimer
 * son compte lui-même (deleteMyAccount), le cas n'a plus rien de théorique —
 * le jeton présent dans son navigateur lui survit.
 *
 * Deux traitements s'en tiraient mal. updateCurrency et cancelSubscription
 * mettaient à jour la ligne `users` puis lisaient le résultat sans vérifier
 * qu'une ligne avait été touchée : `undefined.currency` levait une erreur, et
 * le client recevait un 500 pour une situation parfaitement prévisible. Les
 * autres répondaient 404, ce qui n'est pas faux mais ne sert à rien :
 * l'intercepteur du frontend ne vide la session que sur un 401 (voir
 * api/client.ts), donc l'utilisateur restait devant une application qui le
 * croyait connecté, sans aucun moyen d'en sortir sinon vider son navigateur.
 *
 * 401 est la seule réponse utile : le jeton ne vaut plus rien, et c'est le
 * seul code que le frontend sait traiter.
 */
export async function chargerCompteCourant(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    throw new ApiError(401, "Ce compte n'existe plus. Veuillez vous reconnecter.");
  }
  return user;
}

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
