/**
 * Jour d'échéance du loyer d'un contrat.
 *
 * C'est aujourd'hui le jour du mois de la date de début du bail (un bail qui
 * démarre le 24 est dû le 24 de chaque mois) : la génération des factures
 * (invoice.service.ts) et les documents remis au locataire doivent lire la
 * MÊME règle, sans quoi le locataire lit « avant le 5 » alors que sa facture
 * n'est due que le 24.
 */
export function jourEcheanceDuContrat(dateDebut: Date | string): number {
  return new Date(dateDebut).getDate() || 1;
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
export function libelleEcheance(dateDebut: Date | string): string {
  const jour = jourEcheanceDuContrat(dateDebut);
  const ordinal = jour === 1 ? "1er" : String(jour);
  const base = `payable mensuellement au plus tard le ${ordinal} de chaque mois`;
  // Les mois courts : l'échéance tombe le dernier jour (voir echeanceDuMois).
  return jour > 28 ? `${base}, ou le dernier jour du mois lorsque celui-ci est plus court` : base;
}
