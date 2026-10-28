/** Un taux de commission et le mois (1 à 12) à partir duquel il s'applique. */
export type TauxDepuis = { year: number; month: number; rate: number };

/** Année du premier taux enregistré : il vaut pour tous les mois antérieurs au premier changement. */
export const ANNEE_TAUX_INITIAL = 1970;

const rang = (year: number, month: number) => year * 12 + month;

/**
 * Taux de commission qui s'applique à un mois : celui de la dernière ligne datée de ce mois ou d'avant.
 * Sans historique (le propriétaire n'a jamais changé de taux), le taux actuel vaut pour tous les mois,
 * exactement comme avant l'existence de l'historique.
 */
export function tauxDuMois(tauxActuel: number, historique: TauxDepuis[], month: number, year: number): number {
  if (historique.length === 0) return tauxActuel;
  const tries = [...historique].sort((a, b) => rang(a.year, a.month) - rang(b.year, b.month));
  let retenu = tries[0];
  for (const t of tries) {
    if (rang(t.year, t.month) <= rang(year, month)) retenu = t;
  }
  return retenu.rate;
}
