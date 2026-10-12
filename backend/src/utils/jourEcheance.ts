/**
 * Jour d'échéance du loyer d'un contrat.
 *
 * C'est aujourd'hui le jour du mois de la date de début du bail (un bail qui
 * démarre le 24 est dû le 24 de chaque mois) : la génération des factures
 * (invoice.service.ts) et les documents remis au locataire doivent lire la
 * MÊME règle, sans quoi le locataire lit « avant le 5 » alors que sa facture
 * n'est due que le 24.
 *
 * Le gestionnaire peut fixer ce jour sur le contrat (`paymentDay`, 1 à 31 ; 31
 * signifie « dernier jour du mois »). Sans lui, c'est le jour de la date de
 * début : le comportement de tous les contrats antérieurs à ce champ.
 */
export interface ContratEcheance {
  paymentDay?: number | null;
  startDate: Date | string;
}

export function jourEcheanceDuContrat(contrat: ContratEcheance): number {
  return contrat.paymentDay ?? (new Date(contrat.startDate).getDate() || 1);
}

/**
 * Échéance d'un mois donné : le jour d'échéance, plafonné au dernier jour réel
 * du mois (un bail démarrant un 31 est dû le 28 ou le 29 février, pas le 3 mars).
 */
export function echeanceDuMois(jour: number, annee: number, mois1a12: number): Date {
  const dernierJour = new Date(annee, mois1a12, 0).getDate();
  return new Date(annee, mois1a12 - 1, Math.min(jour, dernierJour));
}

/** Libellé du jour d'échéance pour le bail : « payable mensuellement au plus tard le 24 de chaque mois ». */
export function libelleEcheance(contrat: ContratEcheance): string {
  const jour = jourEcheanceDuContrat(contrat);
  // Choix explicite du gestionnaire : « le dernier jour du mois », sans ambiguïté.
  if (contrat.paymentDay === 31) return "payable mensuellement au plus tard le dernier jour de chaque mois";
  const ordinal = jour === 1 ? "1er" : String(jour);
  const base = `payable mensuellement au plus tard le ${ordinal} de chaque mois`;
  // Jour issu de la date de début (29 à 31) : les mois courts, l'échéance tombe
  // le dernier jour (voir echeanceDuMois).
  return jour > 28 ? `${base}, ou le dernier jour du mois lorsque celui-ci est plus court` : base;
}
