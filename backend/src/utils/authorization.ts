import { eq } from "drizzle-orm";
import { Request } from "express";
import { db } from "../db/client";
import { owners, users } from "../db/schema";
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
export async function chargerCompteCourant(req: Request) {
  if (!req.user) {
    throw new ApiError(401, "Authentification requise");
  }
  // `authenticate` a déjà chargé la ligne et refusé la requête si le compte
  // n'existe plus : on la reprend telle quelle plutôt que de relire la même
  // ligne une deuxième fois dans la même requête. Le repli n'existe que pour
  // un appel hors de cette chaîne de middlewares.
  if (req.compteCourant) {
    return req.compteCourant;
  }
  const [user] = await db.select().from(users).where(eq(users.id, req.user.userId));
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

/**
 * Charge la fiche propriétaire RATTACHÉE AU COMPTE connecté.
 *
 * Le jeton porte bien un `ownerId`, mais il ne fait pas foi : il est signé,
 * donc infalsifiable, et pourtant il peut avoir cessé d'être vrai. Il reste
 * valable sept jours, et sa version n'est pas incrémentée quand une agence
 * retire un accès ou réaffecte une fiche. Le porteur d'un jeton devenu
 * obsolète continuait donc de lire le compte-rendu de gestion qu'il désigne —
 * IBAN, taux de commission, loyers encaissés bien par bien.
 *
 * C'est la règle que le portail locataire applique déjà (voir
 * `exporterMesDonnees`) : la base tranche, pas le jeton. On la reporte ici.
 *
 * 403 et non 404 : la question n'est pas de savoir si une fiche existe
 * quelque part — le demandeur est authentifié et sa propre fiche, elle, est
 * simplement absente. Il n'y a donc aucune existence à dissimuler.
 */
export async function chargerProprietaireDuCompte(req: Request) {
  const [owner] = await db.select().from(owners).where(eq(owners.userId, req.user!.userId));
  if (!owner) {
    throw new ApiError(403, "Aucune fiche propriétaire n'est rattachée à ce compte.");
  }
  return owner;
}
