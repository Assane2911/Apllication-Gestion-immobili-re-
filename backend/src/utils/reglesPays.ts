/**
 * Les règles de location propres à chaque pays, côté serveur.
 *
 * Le pays de l'agence (voir utils/pays.ts) fixe le droit qui s'applique à ses baux. Chaque pays a son propre droit : le
 * COCC est un code SÉNÉGALAIS, pas un texte de l'UEMOA, et la Côte d'Ivoire, le Togo ou la France ont les leurs. Une règle
 * n'entre donc ici qu'une fois le texte du pays lu ; tant qu'elle n'y est pas, le pays garde le comportement neutre d'avant
 * (rien n'est deviné ni transposé d'un pays à l'autre).
 *
 * Les règles de présentation (durée de bail proposée, jour d'échéance, avertissements du formulaire) sont dans
 * `frontend/src/data/reglesPays.ts`. Ici, seul ce que le serveur écrit lui-même : le délai par défaut et la mention de la
 * mise en demeure.
 *
 * Sénégal — sources lues : COCC (loi n° 66-70 du 13 juillet 1966), art. 571 ; décret n° 2023-382 du 24 février 2023 (JO n° 7605).
 * À faire relire par un professionnel sénégalais avant d'aller plus loin (voir la fiche Sénégal).
 */
interface ReglesPaysServeur {
  /** Délai laissé au locataire par une mise en demeure quand le gestionnaire n'en choisit pas, en jours. */
  delaiMiseEnDemeureJours: number;
  /** Phrase ajoutée au courrier de mise en demeure ; `null` : aucune. */
  mentionMiseEnDemeure: string | null;
}

const NEUTRES: ReglesPaysServeur = { delaiMiseEnDemeureJours: 8, mentionMiseEnDemeure: null };

const REGLES: Record<string, ReglesPaysServeur> = {
  SN: {
    // COCC art. 571 : la résiliation est constatée par le juge des référés après une mise en demeure de trente jours faite par acte extrajudiciaire.
    delaiMiseEnDemeureJours: 30,
    mentionMiseEnDemeure:
      "Au Sénégal, la résiliation d'un bail d'habitation pour défaut de paiement suppose une mise en demeure de trente jours " +
      "faite par acte extrajudiciaire (Code des obligations civiles et commerciales, article 571). " +
      "Le présent courrier ne remplace pas cet acte.",
  },
};

function reglesDuPays(pays: string | null | undefined): ReglesPaysServeur {
  return (pays && REGLES[pays]) || NEUTRES;
}

export function delaiMiseEnDemeureParDefaut(pays: string | null | undefined): number {
  return reglesDuPays(pays).delaiMiseEnDemeureJours;
}

export function mentionMiseEnDemeure(pays: string | null | undefined): string | null {
  return reglesDuPays(pays).mentionMiseEnDemeure;
}
