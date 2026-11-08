import type { LeaseNoticePeriodUnit } from "../types";

/**
 * Date de sortie proposée = date de signification (ou de réception) + durée du préavis, en jours civils. Même règle que le
 * serveur (`calculerDateDeSortie`) : un préavis en mois ajoute des mois de calendrier, et un quantième absent du mois d'arrivée
 * (31 janvier + 1 mois) retombe sur le dernier jour de ce mois. Aucune durée n'est proposée : elle dépend du droit applicable.
 * Entrée et sortie au format AAAA-MM-JJ ; chaîne vide quand la date ou la durée n'est pas exploitable.
 */
export function dateDeSortieProposee(servedAt: string, valeur: number, unite: LeaseNoticePeriodUnit): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(servedAt);
  if (!m || !Number.isInteger(valeur) || valeur < 1) return "";
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  let resultat: Date;
  if (unite === "DAYS") {
    resultat = new Date(Date.UTC(annee, mois, jour + valeur));
  } else {
    const total = mois + valeur;
    const anneeCible = annee + Math.floor(total / 12);
    const moisCible = ((total % 12) + 12) % 12;
    const dernierJour = new Date(Date.UTC(anneeCible, moisCible + 1, 0)).getUTCDate();
    resultat = new Date(Date.UTC(anneeCible, moisCible, Math.min(jour, dernierJour)));
  }
  return resultat.toISOString().slice(0, 10);
}
