import { AnyColumn, SQL, sql } from "drizzle-orm";

/**
 * Expression SQL qui remplace, dans une colonne de texte libre, chacune des valeurs données (nom, email, téléphone
 * d'une personne anonymisée) par son remplaçant. Pour une colonne vide (NULL), l'expression reste NULL.
 *
 * C'est le même geste que `effacerIdentiteDuJournal` (activity.service.ts), appliqué aux textes que le locataire ou
 * son gestionnaire ont écrits à son sujet. La recherche porte sur la valeur exacte de la fiche : un nom écrit
 * autrement dans une note (initiale, faute de frappe, majuscules) ne peut pas être retrouvé de façon fiable.
 */
export function remplacerDansTexte(colonne: AnyColumn, remplacements: Array<[recherche: string, remplacement: string]>): SQL {
  return remplacements
    .filter(([recherche]) => recherche.trim() !== "")
    .reduce<SQL>((expression, [recherche, remplacement]) => sql`replace(${expression}, ${recherche}, ${remplacement})`, sql`${colonne}`);
}
