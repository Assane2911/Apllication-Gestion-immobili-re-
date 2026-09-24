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
export interface PresentationDevise {
  /** Ce qui s'écrit à côté du nombre : « FCFA », « € », « $ »… */
  symbole: string;
  /**
   * Côté du nombre où se place le symbole. L'usage n'est pas le même partout
   * — « 450 € » mais « $1 200 » — et se tromper donne immédiatement l'air
   * d'un message mal fabriqué.
   */
  position: "avant" | "apres";
}

export const DEVISES: Record<string, PresentationDevise> = {
  EUR: { symbole: "€", position: "apres" },
  USD: { symbole: "$", position: "avant" },
  XOF: { symbole: "FCFA", position: "apres" },
  XAF: { symbole: "FCFA", position: "apres" },
  STN: { symbole: "Db", position: "apres" },
  GBP: { symbole: "£", position: "avant" },
  CAD: { symbole: "$CA", position: "avant" },
  CHF: { symbole: "CHF", position: "apres" },
  MAD: { symbole: "DH", position: "apres" },
  GNF: { symbole: "FG", position: "apres" },
  MRU: { symbole: "UM", position: "apres" },
  CDF: { symbole: "FC", position: "apres" },
};

export const DEVISES_ACCEPTEES = Object.keys(DEVISES);

export type DeviseAcceptee = string;

export const MESSAGE_DEVISE_INVALIDE = `Devise non prise en charge. Devises disponibles : ${DEVISES_ACCEPTEES.join(", ")}.`;

export function estDeviseAcceptee(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEVISES, code);
}

/**
 * Champ `currency` d'un schéma de requête. Défini une fois : cinq contrôleurs
 * acceptaient une devise, chacun avec sa propre règle, et resserrer l'un sans
 * les autres aurait juste déplacé le trou.
 */
export const deviseSchema = z.string().refine(estDeviseAcceptee, MESSAGE_DEVISE_INVALIDE);
