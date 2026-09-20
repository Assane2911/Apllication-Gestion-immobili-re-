// CWE-1236 (injection de formule CSV) : un titre de bien, de dépense ou un
// nom de locataire est une donnée saisie par l'utilisateur, jamais
// contrôlée par nous. Si elle commence par =, +, -, @, une tabulation ou un
// retour chariot, Excel/Google Sheets/LibreOffice l'interprètent comme le
// début d'une formule lors de l'ouverture du CSV exporté (ex: un locataire
// nommé "=CMD|'/C calc'!A1" ou "@SUM(1+1)*cmd|..." exécutant du code côté
// gestionnaire qui ouvre le fichier). On neutralise en préfixant d'une
// apostrophe, convention reconnue par les tableurs pour forcer une lecture
// en texte brut, avant d'appliquer l'échappement CSV usuel des guillemets.
//
// Centralisé ici (plutôt que dupliqué dans chaque contrôleur qui exporte un
// CSV) pour que ce correctif de sécurité ne puisse pas dériver d'un export à
// l'autre : expense.controller.ts (rapport financier) et fiscal.controller.ts
// (synthèse annuelle / Grand Livre) partagent la même implémentation.
const FORMULA_TRIGGER_CHARS = /^[=+\-@\t\r]/;

export function csvEscape(value: string | number): string {
  let text = String(value);
  if (FORMULA_TRIGGER_CHARS.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

/** BOM UTF-8 à préfixer au contenu d'un CSV exporté, pour qu'Excel détecte l'encodage. */
export const CSV_BOM = "﻿";
