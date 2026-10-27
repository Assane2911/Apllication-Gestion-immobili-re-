/**
 * Les règles de location propres à chaque pays, côté affichage — source unique des valeurs proposées et des avertissements.
 *
 * Le pays de l'agence (voir data/pays.ts) fixe le droit qui s'applique à ses baux. Chaque pays a son propre droit : le COCC
 * est un code SÉNÉGALAIS, pas un texte de l'UEMOA, et la Côte d'Ivoire, le Togo ou la France ont les leurs. Une règle n'entre
 * donc ici qu'une fois le texte du pays lu. Tant qu'elle n'y est pas, le pays garde le comportement NEUTRE d'avant : rien
 * n'est deviné ni transposé d'un pays à l'autre.
 *
 * Rien n'est jamais bloquant. Les valeurs sont des propositions que le gestionnaire peut changer, et les avertissements
 * informent sans interdire : il connaît son bail, et un texte n'a pas prévu tous les cas.
 *
 * Côte d'Ivoire — texte lu : loi n° 2019-576 du 26 juin 2019 instituant Code de la construction et de l'habitat (articles 414 à
 * 456, version de la DGI). Pas encore : l'enregistrement du bail, la révision triennale, les congés (3 mois) et la procédure
 * d'expulsion, qui demandent des décisions de produit. À faire relire par un professionnel ivoirien.
 *
 * France — textes lus : loi n° 89-462 du 6 juillet 1989 (articles 10 et 22). Pas encore : le commandement de payer (art. 24),
 * le contrat type complet (décret 2015-587) et les honoraires (décret 2014-890), qui demandent des décisions de produit.
 *
 * Sénégal — textes lus : Code des obligations civiles et commerciales (loi n° 66-70 du 13 juillet 1966), art. 571 ; décret
 * n° 2023-382 du 24 février 2023 (JO n° 7605), art. 1er. À faire relire par un professionnel sénégalais (voir la fiche Sénégal).
 * Côté serveur, le délai et la mention de la mise en demeure sont dans `backend/src/utils/reglesPays.ts`.
 */
export interface ReglesPays {
  /** Droit applicable prérempli dans un nouveau bail d'habitation ; vide : rien. */
  droitApplicable: string;
  /** Jour d'échéance proposé (« 31 » = dernier jour du mois, « 5 » = le 5). */
  jourEcheance: string;
  /** Durée proposée pour un bail d'habitation, en mois ; `null` : aucune durée proposée. */
  dureeBailMois: number | null;
  /** Délai proposé pour une mise en demeure, en jours. */
  delaiMiseEnDemeureJours: number;
}

const NEUTRES: ReglesPays = { droitApplicable: "", jourEcheance: "5", dureeBailMois: null, delaiMiseEnDemeureJours: 8 };

const REGLES: Record<string, ReglesPays> = {
  CI: {
    // Loi n° 2019-576, article 414 et suivants : le bail d'habitation est écrit, à durée déterminée ou indéterminée.
    droitApplicable: "Loi n° 2019-576 du 26 juin 2019 instituant Code de la construction et de l'habitat (art. 414 et suivants)",
    // Article 422 : « payé mensuellement à une date indiquée dans le contrat » — aucun jour imposé, on garde le 5 d'avant.
    jourEcheance: "5",
    // Article 414 : aucune durée minimale ni durée imposée (déterminée ou indéterminée) : aucune durée proposée.
    dureeBailMois: null,
    // Aucun délai légal lu pour la mise en demeure (la résiliation passe par une lettre, article 443) : 8 jours, comme avant.
    delaiMiseEnDemeureJours: 8,
  },
  FR: {
    // Loi n° 89-462 du 6 juillet 1989, article 3 : le contrat de location est écrit et précise la durée.
    droitApplicable: "Loi n° 89-462 du 6 juillet 1989 tendant à améliorer les rapports locatifs",
    jourEcheance: "5",
    // Loi du 6 juillet 1989, article 10 : au moins trois ans pour un bailleur personne physique (six ans pour une personne morale).
    dureeBailMois: 36,
    // Pas de délai légal pour la mise en demeure : le commandement de payer (article 24) est une autre procédure, non implémentée.
    delaiMiseEnDemeureJours: 8,
  },
  SN: {
    droitApplicable: "Code des obligations civiles et commerciales du Sénégal (art. 544 et suivants) ; décret n° 2023-382 du 24 février 2023",
    // Décret 2023-382 : « le loyer ne peut être payé à l'avance. Il est payable à la fin du mois de jouissance ».
    jourEcheance: "31",
    // COCC art. 571 : trois ans renouvelables par périodes triennales, ou durée indéterminée.
    dureeBailMois: 36,
    // COCC art. 571 : mise en demeure de trente jours faite par acte extrajudiciaire.
    delaiMiseEnDemeureJours: 30,
  },
};

export function reglesDuPays(pays: string | null | undefined): ReglesPays {
  return (pays && REGLES[pays]) || NEUTRES;
}

const TYPE_HABITATION = "HABITATION";

/** Durée d'un renouvellement, en mois : celle du pays pour un bail d'habitation, 12 mois sinon (comportement d'avant). */
export function dureeRenouvellementMois(pays: string | null | undefined, leaseType: string | null | undefined): number {
  return (leaseType ?? TYPE_HABITATION) === TYPE_HABITATION ? (reglesDuPays(pays).dureeBailMois ?? 12) : 12;
}

function ajouterMois(date: string, mois: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [annee, moisDebut, jour] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const cible = new Date(Date.UTC(annee, moisDebut + mois, 1));
  // Le jour est ramené au dernier jour du mois cible quand il n'existe pas (29 février, 31 d'un mois court).
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(jour, dernierJour));
  return cible.toISOString().slice(0, 10);
}

/**
 * Date de fin proposée quand la date de début est saisie : début + durée du pays, comme le renouvellement (le serveur y
 * ajoute les mois à la date de début). Vide quand le pays ne propose aucune durée, pour un bail commercial, ou sans début.
 */
export function dateDeFinParDefaut(pays: string | null | undefined, leaseType: string | null | undefined, debut: string): string {
  if ((leaseType ?? TYPE_HABITATION) !== TYPE_HABITATION) return "";
  const mois = reglesDuPays(pays).dureeBailMois;
  if (!mois || !debut) return "";
  return ajouterMois(debut, mois) ?? "";
}

export type CleAvertissement = "deposit" | "paymentDay" | "duration";

export interface AvertissementBail {
  /** Clé de traduction : `manager.contracts.regles.<cle>`. */
  cle: CleAvertissement;
}

export interface BailAControler {
  leaseType: string;
  rent: number;
  deposit: number;
  currency: string;
  /** Jour d'échéance saisi : « 1 » à « 31 », ou vide (jour de la date de début). */
  paymentDay: string;
  startDate: string;
  endDate: string;
}

/** Plafond du décret 2023-382 : les règles de caution et de commission valent pour les baux d'au plus 500 000 FCFA par mois. */
const SEUIL_DECRET_FCFA = 500000;

/**
 * Avertissements, non bloquants, sur un bail en cours de saisie. Vides pour un pays dont les règles n'ont pas été lues,
 * et pour un bail commercial (autre régime).
 */
export function avertissementsDuBail(pays: string | null | undefined, bail: BailAControler): AvertissementBail[] {
  if (bail.leaseType !== TYPE_HABITATION) return [];
  if (pays === "FR") return avertissementsFrance(bail);
  if (pays === "CI") return avertissementsCoteDIvoire(bail);
  if (pays !== "SN") return [];
  const avertissements: AvertissementBail[] = [];

  // Décret 2023-382 : caution d'au plus deux mois de loyer pour les baux d'au plus 500 000 FCFA par mois.
  if (bail.currency === "XOF" && bail.rent > 0 && bail.rent <= SEUIL_DECRET_FCFA && bail.deposit > 2 * bail.rent) {
    avertissements.push({ cle: "deposit" });
  }
  // Décret 2023-382 : loyer payable à la fin du mois de jouissance.
  if (bail.paymentDay !== "31") avertissements.push({ cle: "paymentDay" });
  // COCC art. 571 : trois ans renouvelables, ou durée indéterminée. La fin se compte au lendemain (comme le renouvellement)
  // ou au dernier jour (31 décembre) : les deux disent trois ans.
  if (bail.startDate && bail.endDate) {
    const lendemain = new Date(`${bail.endDate}T00:00:00Z`);
    lendemain.setUTCDate(lendemain.getUTCDate() + 1);
    const troisAns = [bail.endDate, lendemain.toISOString().slice(0, 10)].some((fin) => ajouterMois(bail.startDate, 36) === fin);
    if (!troisAns) avertissements.push({ cle: "duration" });
  }
  return avertissements;
}

/**
 * France, loi du 6 juillet 1989 : deux rappels, non bloquants, sur les deux points dont le texte est lu.
 * - Article 22 : le dépôt de garantie ne peut pas dépasser un mois de loyer en principal. Le loyer comparé est celui saisi
 *   dans ce formulaire, supposé hors charges.
 * - Article 10 : durée d'au moins trois ans (six ans pour une personne morale : le rappel ne se déclenche pas au-delà de trois ans).
 */
function avertissementsFrance(bail: BailAControler): AvertissementBail[] {
  const avertissements: AvertissementBail[] = [];
  if (bail.rent > 0 && bail.deposit > bail.rent) avertissements.push({ cle: "deposit" });
  if (bail.startDate && bail.endDate) {
    const debut = new Date(`${bail.startDate}T00:00:00Z`);
    const fin = new Date(`${bail.endDate}T00:00:00Z`);
    const minimum = ajouterMois(bail.startDate, 36);
    if (minimum && fin < new Date(`${minimum}T00:00:00Z`) && fin > debut) avertissements.push({ cle: "duration" });
  }
  return avertissements;
}

/**
 * Côte d'Ivoire, loi n° 2019-576 : un seul rappel, non bloquant, sur le point dont le texte est lu.
 * - Article 416 : le dépôt de garantie ne peut pas excéder deux mois de loyer (le loyer comparé est celui saisi ici).
 * Le texte lu ne fixe ni durée minimale ni jour d'échéance : aucun rappel là-dessus.
 */
function avertissementsCoteDIvoire(bail: BailAControler): AvertissementBail[] {
  return bail.rent > 0 && bail.deposit > 2 * bail.rent ? [{ cle: "deposit" }] : [];
}
