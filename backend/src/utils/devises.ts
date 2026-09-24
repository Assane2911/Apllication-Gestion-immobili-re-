import { z } from "zod";

/**
 * Devises acceptées par le Service.
 *
 * Cette liste est le reflet de celle du frontend (`frontend/src/context/
 * currency.ts`), qui seule porte la présentation — symbole, nom, position
 * avant ou après le nombre. Le dépôt n'ayant pas d'espace partagé entre
 * `backend` et `frontend`, on ne peut pas l'importer ; `devises.test.ts` lit
 * donc le fichier du frontend et échoue si les deux divergent. C'est
 * inhabituel, et c'est moins coûteux que de faire du dépôt un monorepo pour
 * une liste de douze codes.
 *
 * Pourquoi valider ici alors que le sélecteur ne propose que ces codes : le
 * serveur ne peut pas supposer que ses appels viennent de son interface.
 * `z.string().min(1).max(10)` acceptait « XYZ » — puis un montant s'affichait
 * avec un symbole choisi par défaut, donc faux sans en avoir l'air.
 */
export const DEVISES_ACCEPTEES = [
  "EUR",
  "USD",
  "XOF",
  "XAF",
  "STN",
  "GBP",
  "CAD",
  "CHF",
  "MAD",
  "GNF",
  "MRU",
  "CDF",
] as const;

export type DeviseAcceptee = (typeof DEVISES_ACCEPTEES)[number];

export const MESSAGE_DEVISE_INVALIDE = `Devise non prise en charge. Devises disponibles : ${DEVISES_ACCEPTEES.join(", ")}.`;

export function estDeviseAcceptee(code: string): boolean {
  return (DEVISES_ACCEPTEES as readonly string[]).includes(code);
}

/**
 * Champ `currency` d'un schéma de requête. Défini une fois : cinq contrôleurs
 * acceptaient une devise, chacun avec sa propre règle, et resserrer l'un sans
 * les autres aurait juste déplacé le trou.
 */
export const deviseSchema = z.string().refine(estDeviseAcceptee, MESSAGE_DEVISE_INVALIDE);
