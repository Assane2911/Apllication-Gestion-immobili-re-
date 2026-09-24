import type { SupportedCountryCode } from "./countries";
import { SUPPORTED_COUNTRY_CODES } from "./countries";

/**
 * Indicatifs téléphoniques des pays déjà retenus par la plateforme.
 *
 * On ne crée PAS une seconde liste de pays : `SUPPORTED_COUNTRY_CODES` existe
 * déjà (annonces, filtre de la vitrine) et porte le même arbitrage — l'Afrique
 * francophone, la France et quelques pays de la diaspora. Ajouter ici une liste
 * parallèle, c'est se garantir qu'un jour les deux divergeront. Le libellé
 * affiché vient de `countryLabel`, donc traduit dans les quatre langues de
 * l'app sans table de correspondance à maintenir.
 *
 * `prefixeNational` est le chiffre de mise en route que l'on compose à
 * l'intérieur du pays et qui DISPARAÎT au format international : le « 0 » de
 * « 06 12 34 56 78 » qui devient « +33 6 12 34 56 78 ». Il n'est renseigné que
 * pour les plans de numérotation où il est certain. Partout ailleurs il vaut
 * `null` et rien n'est retiré : en Côte d'Ivoire ou au Bénin, le zéro de tête
 * fait partie du numéro, et l'enlever appellerait quelqu'un d'autre.
 *
 * `exemple` sert de placeholder : un numéro local plausible, écrit comme on
 * l'écrit sur place.
 */
export interface IndicatifPays {
  code: SupportedCountryCode;
  indicatif: string;
  prefixeNational: string | null;
  exemple: string;
}

const INDICATIFS: Record<SupportedCountryCode, Omit<IndicatifPays, "code">> = {
  SN: { indicatif: "221", prefixeNational: null, exemple: "77 123 45 67" },
  CI: { indicatif: "225", prefixeNational: null, exemple: "07 01 23 45 67" },
  ML: { indicatif: "223", prefixeNational: null, exemple: "70 12 34 56" },
  BF: { indicatif: "226", prefixeNational: null, exemple: "70 12 34 56" },
  BJ: { indicatif: "229", prefixeNational: null, exemple: "01 97 12 34 56" },
  TG: { indicatif: "228", prefixeNational: null, exemple: "90 12 34 56" },
  NE: { indicatif: "227", prefixeNational: null, exemple: "90 12 34 56" },
  GN: { indicatif: "224", prefixeNational: null, exemple: "62 12 34 56 7" },
  CM: { indicatif: "237", prefixeNational: null, exemple: "6 71 23 45 67" },
  GA: { indicatif: "241", prefixeNational: null, exemple: "06 12 34 56" },
  CG: { indicatif: "242", prefixeNational: null, exemple: "06 123 45 67" },
  CD: { indicatif: "243", prefixeNational: "0", exemple: "081 234 56 78" },
  TD: { indicatif: "235", prefixeNational: null, exemple: "66 12 34 56" },
  MR: { indicatif: "222", prefixeNational: null, exemple: "22 12 34 56" },
  MA: { indicatif: "212", prefixeNational: "0", exemple: "06 12 34 56 78" },
  FR: { indicatif: "33", prefixeNational: "0", exemple: "06 12 34 56 78" },
  BE: { indicatif: "32", prefixeNational: "0", exemple: "0475 12 34 56" },
  CH: { indicatif: "41", prefixeNational: "0", exemple: "079 123 45 67" },
  CA: { indicatif: "1", prefixeNational: null, exemple: "514 123 4567" },
};

/** Dans l'ordre de `SUPPORTED_COUNTRY_CODES` : marché principal en tête. */
export const PAYS_TELEPHONE: IndicatifPays[] = SUPPORTED_COUNTRY_CODES.map((code) => ({
  code,
  ...INDICATIFS[code],
}));

/**
 * Pays présélectionné à la création d'une fiche. Le Sénégal est le marché
 * principal ; un gestionnaire d'un autre pays change l'indicatif une fois et
 * le voit ensuite repris tel quel, puisque la valeur enregistrée le porte.
 */
export const PAYS_PAR_DEFAUT = PAYS_TELEPHONE.find((p) => p.code === "SN") ?? PAYS_TELEPHONE[0];

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
export function decomposer(valeur: string): { pays: IndicatifPays | null; national: string } {
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
    const candidats = [...PAYS_TELEPHONE].sort((a, b) => b.indicatif.length - a.indicatif.length);
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
export function composer(pays: IndicatifPays | null, national: string): string {
  if (!pays) return national.trim();

  let chiffres = national.replace(/\D/g, "");
  if (pays.prefixeNational && chiffres.startsWith(pays.prefixeNational)) {
    chiffres = chiffres.slice(pays.prefixeNational.length);
  }

  return chiffres ? `+${pays.indicatif}${chiffres}` : "";
}
