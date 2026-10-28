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
 * France — texte lu : loi n° 89-462 du 6 juillet 1989, art. 24 (clause résolutoire : elle ne produit effet que six semaines après un
 * commandement de payer demeuré infructueux). Le courrier de l'agence n'est pas ce commandement : il le dit, sans dire qui le délivre
 * (la fiche France le demande à un professionnel). Le délai proposé reste de 8 jours, la loi n'en fixe aucun pour le courrier.
 *
 * Bénin — texte lu : loi n° 2022-30 du 20 décembre 2022 fixant le régime juridique du bail à usage d'habitation en République du Bénin
 * (141 articles, entièrement lue ; elle abroge les lois n° 2018-12 et n° 2021-02), art. 75 et 76 (mise en demeure : un mois pour payer).
 * À faire relire par un professionnel béninois.
 *
 * Burkina Faso — texte lu : loi n° 103-2015/CNT du 22 décembre 2015 portant bail d'habitation privée au Burkina Faso, art. 28 à 30
 * (commandement de payer, au moins quinze jours). À faire relire par un professionnel burkinabè.
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
  FR: {
    // Loi du 6 juillet 1989, art. 24 : aucun délai légal pour le courrier de mise en demeure, 8 jours comme avant.
    delaiMiseEnDemeureJours: 8,
    mentionMiseEnDemeure:
      "En France, la clause résolutoire d'un bail d'habitation ne produit effet que six semaines après un commandement de payer " +
      "demeuré infructueux (loi n° 89-462 du 6 juillet 1989, article 24). Le présent courrier ne remplace pas ce commandement.",
  },
  BJ: {
    // Loi n° 2022-30, art. 75 et 76 : la résiliation pour loyer impayé débute par une mise en demeure laissant trace écrite (ou une
    // sommation d'huissier) ; le locataire doit payer dans le mois qui suit, faute de quoi le bailleur saisit le président du tribunal en référé.
    delaiMiseEnDemeureJours: 30,
    mentionMiseEnDemeure:
      "Au Bénin, le locataire est tenu de payer dans le mois qui suit la mise en demeure ; à défaut, le bailleur peut saisir le " +
      "président du tribunal compétent en référé (loi n° 2022-30 du 20 décembre 2022, articles 75 et 76).",
  },
  BF: {
    // Loi n° 103-2015/CNT, art. 30 : le commandement de payer laisse au locataire un délai d'au moins quinze jours à compter de sa notification.
    delaiMiseEnDemeureJours: 15,
    mentionMiseEnDemeure:
      "Au Burkina Faso, le non-paiement du loyer donne lieu à un commandement de payer, qui laisse au locataire un délai d'au moins " +
      "quinze jours à compter de sa notification (loi n° 103-2015/CNT portant bail d'habitation privée, articles 28 à 30). " +
      "Le présent courrier ne remplace pas ce commandement.",
  },
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
