import { ApiError } from "./asyncHandler";

/**
 * Date d'encaissement saisie par le gestionnaire quand il marque un loyer réglé.
 *
 * Jusqu'ici elle valait toujours l'instant du clic. Or le bilan fiscal, le
 * compte-rendu de gestion, le tableau de bord et la fiabilité des locataires
 * comptent par date d'ENCAISSEMENT : un loyer reçu le 28 décembre et enregistré
 * le 2 janvier tombait dans la mauvaise année.
 *
 * Règles :
 *  - absente → maintenant (comportement d'avant) ;
 *  - « AAAA-MM-JJ » (champ date du formulaire) → midi UTC ce jour-là, pour que
 *    la date affichée ne glisse d'un jour dans aucun fuseau d'usage ; si ce
 *    jour est AUJOURD'HUI, l'instant réel est conservé ;
 *  - jamais dans le futur (tolérance de 14 h : un gestionnaire en avance sur
 *    l'UTC dont « aujourd'hui » est déjà « demain » ici) ;
 *  - jamais plus d'un an avant l'échéance : au-delà, c'est une faute de frappe.
 *    Un loyer payé D'AVANCE reste légitime, d'où l'absence de borne à la période.
 */
const TOLERANCE_FUTUR_MS = 14 * 3_600_000;
const BORNE_ANTERIEURE_MS = 366 * 24 * 3_600_000;

export function resoudreDateEncaissement(saisie: string | null | undefined, maintenant: Date, echeance: Date): Date {
  if (saisie === undefined || saisie === null || saisie === "") return maintenant;

  let date: Date;
  const jour = /^(\d{4})-(\d{2})-(\d{2})$/.exec(saisie);
  if (jour) {
    const [annee, mois, quantieme] = [Number(jour[1]), Number(jour[2]), Number(jour[3])];
    date = new Date(Date.UTC(annee, mois - 1, quantieme, 12));
    // Refuse le 31 février, que Date.UTC « corrigerait » en mars.
    if (date.getUTCFullYear() !== annee || date.getUTCMonth() !== mois - 1 || date.getUTCDate() !== quantieme) {
      throw new ApiError(400, "La date d'encaissement n'est pas une date valide.");
    }
    if (saisie === maintenant.toISOString().slice(0, 10)) date = maintenant;
  } else {
    // Date-heure ISO uniquement : `new Date("12/10/2026")` serait comprise
    // comme le 10 décembre ou le 12 octobre selon l'environnement.
    date = /^\d{4}-\d{2}-\d{2}T/.test(saisie) ? new Date(saisie) : new Date(Number.NaN);
    if (Number.isNaN(date.getTime())) {
      throw new ApiError(400, "La date d'encaissement n'est pas une date valide.");
    }
  }

  if (date.getTime() > maintenant.getTime() + TOLERANCE_FUTUR_MS) {
    throw new ApiError(400, "La date d'encaissement ne peut pas être dans le futur.");
  }
  if (date.getTime() < echeance.getTime() - BORNE_ANTERIEURE_MS) {
    throw new ApiError(400, "La date d'encaissement est trop ancienne par rapport à l'échéance de cette facture.");
  }
  return date;
}
