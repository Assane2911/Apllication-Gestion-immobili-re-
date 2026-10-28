/**
 * Mentions du logement du contrat type de bail français (décret n° 2015-587 du 29 mai 2015), côté formulaire. Même liste que
 * `backend/src/utils/mentionsLogement.ts`, qui les valide et les imprime sur le bail.
 *
 * Toutes sont FACULTATIVES : le formulaire les propose pour un logement en France, rappelle sans bloquer celles de la liste de base
 * qui manquent, et la plateforme n'atteste la conformité d'aucun bail. Les loyers de référence ne concernent que les zones
 * d'encadrement des loyers : ils ne sont jamais rappelés.
 */
export const CLASSES_DPE = ["A", "B", "C", "D", "E", "F", "G"] as const;

/** Mentions de base, rappelées quand elles manquent. */
export const MENTIONS_DE_BASE = ["dpe", "identifiantFiscal", "periodeConstruction", "chauffage"] as const;
/** Mentions propres aux zones d'encadrement des loyers : montants, jamais rappelées. */
export const MENTIONS_MONTANTS = ["loyerReference", "loyerReferenceMajore", "dernierLoyer"] as const;

export type CleMention = (typeof MENTIONS_DE_BASE)[number] | (typeof MENTIONS_MONTANTS)[number];
export type MentionsDuFormulaire = Record<CleMention, string>;

export const MENTIONS_VIDES: MentionsDuFormulaire = {
  dpe: "",
  identifiantFiscal: "",
  periodeConstruction: "",
  chauffage: "",
  loyerReference: "",
  loyerReferenceMajore: "",
  dernierLoyer: "",
};

/** Le formulaire propose ces mentions pour un logement en France, en habitation vide ou meublée. */
export function proposeMentionsLogement(pays: string | null | undefined, leaseType: string | null | undefined): boolean {
  return pays === "FR" && (leaseType === "HABITATION" || leaseType === "MEUBLE");
}

/** Mentions de base absentes du formulaire, dans l'ordre du contrat type. */
export function mentionsAbsentes(form: MentionsDuFormulaire): Array<(typeof MENTIONS_DE_BASE)[number]> {
  return MENTIONS_DE_BASE.filter((cle) => form[cle].trim() === "");
}

/** Objet envoyé au serveur : les seules mentions renseignées, montants en nombres ; `null` quand il n'y en a aucune. */
export function mentionsDepuisFormulaire(form: MentionsDuFormulaire): Record<string, string | number> | null {
  const mentions: Record<string, string | number> = {};
  for (const cle of MENTIONS_DE_BASE) {
    const valeur = form[cle].trim();
    if (valeur) mentions[cle] = valeur;
  }
  for (const cle of MENTIONS_MONTANTS) {
    const valeur = form[cle].trim().replace(",", ".");
    if (valeur !== "" && Number.isFinite(Number(valeur))) mentions[cle] = Number(valeur);
  }
  return Object.keys(mentions).length > 0 ? mentions : null;
}

/** Valeurs du formulaire pour les mentions d'un contrat existant. */
export function formulaireDepuisMentions(mentions: Partial<Record<CleMention, string | number>> | null | undefined): MentionsDuFormulaire {
  const form = { ...MENTIONS_VIDES };
  for (const cle of Object.keys(form) as CleMention[]) {
    const valeur = mentions?.[cle];
    if (valeur !== undefined && valeur !== null) form[cle] = String(valeur);
  }
  return form;
}
