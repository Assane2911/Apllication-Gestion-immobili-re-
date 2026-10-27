import { z } from "zod";
import { avecCode } from "./validationExplicite";

/**
 * Pays dans lesquels l'application ouvre un compte : la France et les huit pays de l'UEMOA.
 *
 * Cette liste est le reflet de la table du frontend (`frontend/src/data/pays.ts`), qui seule porte le téléphone et
 * l'affichage ; `pays.test.ts` lit ce fichier et échoue si les deux divergent (même principe que `devises.ts`).
 * Le serveur n'a besoin que des codes, pour refuser ce qui n'est pas dans la zone, et de la devise, pour régler
 * celle d'un compte quand son pays est choisi.
 */
const DEVISE_PAR_PAYS: Record<string, string> = {
  SN: "XOF",
  CI: "XOF",
  ML: "XOF",
  BF: "XOF",
  BJ: "XOF",
  TG: "XOF",
  NE: "XOF",
  GW: "XOF",
  FR: "EUR",
};

export const CODES_PAYS_ACCEPTES = Object.keys(DEVISE_PAR_PAYS);

export const MESSAGE_PAYS_INVALIDE = `Pays non pris en charge. Pays disponibles : ${CODES_PAYS_ACCEPTES.join(", ")}.`;

export function estPaysAccepte(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEVISE_PAR_PAYS, code);
}

/** Devise d'un pays accepté. Lève sur un autre pays plutôt que d'en inventer une : un montant faux a l'air normal. */
export function deviseDuPays(code: string): string {
  if (!estPaysAccepte(code)) throw new Error(`Pays non pris en charge : ${code}`);
  return DEVISE_PAR_PAYS[code];
}

/** Champ `country` d'une requête : un code ISO de la zone, accepté en minuscules et rendu en majuscules. */
export const paysSchema = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .refine(estPaysAccepte, avecCode(MESSAGE_PAYS_INVALIDE, "COUNTRY_UNSUPPORTED", { countries: CODES_PAYS_ACCEPTES.join(", ") }));
