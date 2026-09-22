/**
 * Mêmes règles d'export CSV que côté serveur (backend/src/utils/csv.ts), pour
 * les exports construits directement dans le navigateur.
 *
 * Ce fichier existe parce que la règle avait déjà dérivé : l'export des
 * dépenses échappait les guillemets de certaines colonnes mais pas de toutes
 * (un bien nommé « Villa "Les Palmiers" » décalait les colonnes et faisait
 * atterrir le montant dans la mauvaise case), et n'avait aucune protection
 * contre l'injection de formule, pourtant centralisée côté serveur
 * précisément « pour qu'elle ne puisse pas dériver d'un export à l'autre ».
 */

// CWE-1236 : une valeur saisie par l'utilisateur qui commence par =, +, -, @,
// une tabulation ou un retour chariot est interprétée comme une formule par
// Excel, LibreOffice et Google Sheets à l'ouverture du fichier. L'apostrophe
// de tête force une lecture en texte brut.
const CARACTERES_DECLENCHEURS_DE_FORMULE = /^[=+\-@\t\r]/;

export function csvEscape(value: string | number): string {
  let texte = String(value);
  if (CARACTERES_DECLENCHEURS_DE_FORMULE.test(texte)) {
    texte = `'${texte}`;
  }
  return `"${texte.replace(/"/g, '""')}"`;
}

/**
 * Montant prêt pour un tableur francophone : deux décimales, séparateur
 * virgule. Sans cela, un montant brut (`1234.56`) exporté entre des
 * point-virgules est lu comme du TEXTE dans un tableur configuré en français —
 * aucune somme possible sur un fichier dont c'est le seul usage.
 */
export function csvMontant(value: number): string {
  return (value || 0).toFixed(2).replace(".", ",");
}

/** BOM UTF-8 à préfixer au contenu, pour qu'Excel détecte l'encodage. */
export const CSV_BOM = "﻿";
