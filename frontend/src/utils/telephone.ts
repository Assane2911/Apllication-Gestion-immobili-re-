import { PAYS, type Pays } from "../data/pays";

/**
 * Composition et relecture d'un numéro de téléphone à partir de l'indicatif
 * du pays.
 *
 * Les indicatifs ne sont pas listés ici : ils vivent dans `data/pays.ts`, avec
 * le reste de ce qui décrit un pays. Une seconde liste, même juste le jour où
 * on l'écrit, finit par diverger de la première.
 */

/** Les pays de la table, dans son ordre : marché principal en tête. */
export const PAYS_TELEPHONE: readonly Pays[] = PAYS;

/**
 * Pays présélectionné à la création d'une fiche. Le Sénégal est le marché
 * principal ; un gestionnaire d'un autre pays change l'indicatif une fois et
 * le voit ensuite repris tel quel, puisque la valeur enregistrée le porte.
 */
export const PAYS_PAR_DEFAUT: Pays = PAYS.find((p) => p.code === "SN") ?? PAYS[0];

/** Même contrôle que `versE164` côté serveur — les deux doivent rester d'accord. */
export function estE164Valide(valeur: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(valeur);
}

/**
 * Sépare une valeur enregistrée en (pays, partie nationale).
 *
 * Trois cas, et le troisième est le seul délicat. Une valeur qui ne porte
 * aucun indicatif reconnaissable — « 0600000000 », héritée d'avant ce champ —
 * ne peut pas se voir attribuer un pays par défaut : ce serait inventer un
 * indicatif et, à l'envoi, joindre un inconnu. On renvoie donc `pays: null`,
 * ce que le champ traduit par « choisissez l'indicatif », et la valeur reste
 * intacte tant que personne n'a tranché.
 */
export function decomposer(valeur: string): { pays: Pays | null; national: string } {
  const nettoye = (valeur ?? "").replace(/[\s().-]/g, "");
  if (!nettoye) return { pays: PAYS_PAR_DEFAUT, national: "" };

  const international = nettoye.startsWith("+")
    ? nettoye.slice(1)
    : nettoye.startsWith("00")
      ? nettoye.slice(2)
      : null;

  if (international) {
    // Du plus long au plus court : « +1 » ne doit pas rafler un numéro dont
    // l'indicatif complet est « +1... » d'un autre pays du même plan.
    const candidats = [...PAYS].sort((a, b) => b.indicatif.length - a.indicatif.length);
    const trouve = candidats.find((p) => international.startsWith(p.indicatif));
    if (trouve) return { pays: trouve, national: international.slice(trouve.indicatif.length) };
  }

  return { pays: null, national: valeur };
}

/**
 * Reconstitue la valeur à enregistrer. Tant qu'aucun pays n'est choisi, on
 * rend la saisie telle quelle : mieux vaut une valeur que le serveur refusera
 * qu'un numéro faux qu'il acceptera.
 */
export function composer(pays: Pays | null, national: string): string {
  if (!pays) return national.trim();

  let chiffres = national.replace(/\D/g, "");
  if (pays.prefixeNational && chiffres.startsWith(pays.prefixeNational)) {
    chiffres = chiffres.slice(pays.prefixeNational.length);
  }

  return chiffres ? `+${pays.indicatif}${chiffres}` : "";
}
