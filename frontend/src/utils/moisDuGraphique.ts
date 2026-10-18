/**
 * Axe des mois du graphique « revenus et dépenses ».
 *
 * L'API ne renvoie que les mois où il s'est passé quelque chose (`revenueByMonth`, `expensesByMonth`) : un mois
 * sans aucun encaissement ni dépense — précisément celui qu'un gestionnaire cherche à repérer — disparaissait de
 * l'axe, et les barres voisines semblaient se suivre. On trace donc toujours les six derniers mois, vides compris.
 */
const MOIS_AFFICHES = 6;

function cle(annee: number, moisZeroBase: number): string {
  const d = new Date(annee, moisZeroBase, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Les six derniers mois (le courant compris), plus tout mois fourni par le serveur hors de cette fenêtre : le
 * serveur calcule les mois dans son fuseau, le navigateur dans le sien, et un encaissement à la frontière ne doit
 * jamais disparaître. Trié du plus ancien au plus récent, sans doublon.
 */
export function fenetreDesMois(maintenant: Date, presents: string[]): string[] {
  const fenetre: string[] = [];
  for (let i = MOIS_AFFICHES - 1; i >= 0; i--) fenetre.push(cle(maintenant.getFullYear(), maintenant.getMonth() - i));
  return Array.from(new Set([...fenetre, ...presents])).sort((a, b) => a.localeCompare(b));
}

/** « 2026-05 » → « mai 26 », dans la langue de l'interface. Une clé qui n'est pas un mois est rendue telle quelle. */
export function libelleDuMois(cleMois: string, langue: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(cleMois);
  if (!m) return cleMois;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return new Intl.DateTimeFormat(langue, { month: "short", year: "2-digit" }).format(date);
}
