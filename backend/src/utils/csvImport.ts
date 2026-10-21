/**
 * Lecture d'un fichier CSV déposé par le gestionnaire (import de biens, de
 * locataires…). Pensé pour ce que produisent réellement les tableurs :
 *
 *  - séparateur « ; » (Excel en français), « , » ou tabulation, détecté ;
 *  - champs entre guillemets, avec guillemets doublés et retours à la ligne ;
 *  - BOM UTF-8 en tête, fins de ligne Windows, lignes vides ignorées ;
 *  - en-têtes comparés sans accents, sans casse et sans ponctuation
 *    (« Prénom », « prenom », « PRÉNOM » sont la même colonne).
 */
export const MAX_LIGNES_IMPORT = 500;
export const MAX_CARACTERES_IMPORT = 1_000_000;

export interface CsvLu {
  delimiteur: ";" | "," | "\t";
  /** En-têtes normalisés (voir normaliserEntete), dans l'ordre du fichier. */
  entetes: string[];
  /** Une entrée par ligne de données ; `ligne` est le numéro dans le fichier (l'en-tête est la ligne 1). */
  lignes: Array<{ ligne: number; valeurs: Record<string, string> }>;
}

export class CsvInvalide extends Error {
  /** Code que l'interface traduit (voir apiErrorMessage), avec les valeurs à insérer dans la traduction. */
  constructor(
    message: string,
    readonly code?: string,
    readonly params?: Record<string, string | number>
  ) {
    super(message);
  }
}

/** « Prénom » → « prenom », « Loyer mensuel » → « loyermensuel ». */
export function normaliserEntete(brut: string): string {
  return brut
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function detecterDelimiteur(texte: string): ";" | "," | "\t" {
  const premiereLigne = texte.split(/\r\n|\n|\r/, 1)[0] ?? "";
  let enGuillemets = false;
  const compte = { ";": 0, ",": 0, "\t": 0 };
  for (const c of premiereLigne) {
    if (c === '"') enGuillemets = !enGuillemets;
    else if (!enGuillemets && c in compte) compte[c as keyof typeof compte]++;
  }
  // En cas d'égalité (ou de première ligne sans séparateur), « ; » : l'usage du tableur français.
  if (compte[";"] >= compte[","] && compte[";"] >= compte["\t"]) return ";";
  return compte[","] >= compte["\t"] ? "," : "\t";
}

/** Découpe en champs, en respectant les guillemets. Renvoie un tableau de lignes de champs. */
function decouper(texte: string, delimiteur: string): string[][] {
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = "";
  let enGuillemets = false;

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (enGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') {
          champ += '"';
          i++;
        } else {
          enGuillemets = false;
        }
      } else {
        champ += c;
      }
    } else if (c === '"') {
      enGuillemets = true;
    } else if (c === delimiteur) {
      ligne.push(champ);
      champ = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = "";
    } else {
      champ += c;
    }
  }
  if (enGuillemets) throw new CsvInvalide("Le fichier contient un guillemet non refermé : vérifiez les champs entre guillemets.", "CSV_UNCLOSED_QUOTE");
  if (champ !== "" || ligne.length > 0) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  return lignes;
}

export function lireCsv(contenu: string): CsvLu {
  if (contenu.length > MAX_CARACTERES_IMPORT) {
    throw new CsvInvalide("Le fichier est trop volumineux (1 Mo maximum).", "CSV_TOO_LARGE");
  }
  const texte = contenu.replace(/^﻿/, "");
  if (!texte.trim()) throw new CsvInvalide("Le fichier est vide.", "CSV_EMPTY");

  const delimiteur = detecterDelimiteur(texte);
  const brutes = decouper(texte, delimiteur);

  // Un numéro de ligne par ligne du FICHIER (lignes vides comprises), pour que
  // « ligne 14 » désigne bien la ligne 14 dans le tableur du gestionnaire.
  const [enteteBrut, ...donnees] = brutes;
  const entetes = enteteBrut.map(normaliserEntete);

  const lignes: CsvLu["lignes"] = [];
  donnees.forEach((champs, index) => {
    if (champs.every((v) => v.trim() === "")) return;
    const valeurs: Record<string, string> = {};
    entetes.forEach((entete, i) => {
      if (entete && valeurs[entete] === undefined) valeurs[entete] = (champs[i] ?? "").trim();
    });
    lignes.push({ ligne: index + 2, valeurs });
  });

  if (lignes.length === 0) throw new CsvInvalide("Le fichier ne contient aucune ligne de données sous l'en-tête.", "CSV_NO_DATA_ROWS");
  if (lignes.length > MAX_LIGNES_IMPORT) {
    throw new CsvInvalide(`Le fichier contient ${lignes.length} lignes : l'import est limité à ${MAX_LIGNES_IMPORT} lignes à la fois. Découpez-le en plusieurs fichiers.`, "CSV_TOO_MANY_ROWS", {
      count: lignes.length,
      max: MAX_LIGNES_IMPORT,
    });
  }

  return { delimiteur, entetes, lignes };
}

/**
 * Nombre saisi dans un tableur : « 1 250,50 », « 1250.5 », « 1.250,50 »,
 * « 1,250.50 ». Le dernier séparateur rencontré est la virgule décimale ; sans
 * point ni virgule, c'est un entier. Renvoie null pour tout ce qui n'est pas un
 * nombre — jamais NaN, jamais une valeur devinée.
 */
export function lireNombre(brut: string): number | null {
  const sansEspaces = brut.replace(/[\s\u00a0\u202f]/g, "");
  // Entier ou décimal simple, ou groupes de milliers (« 1.250 », « 1,250.50 », « 1.250,50 »).
  const forme = /^[+-]?(\d+|\d{1,3}([.,]\d{3})+)([.,]\d+)?$/.exec(sansEspaces);
  if (!forme) return null;

  const separateurs = sansEspaces.match(/[.,]/g) ?? [];
  if (separateurs.length === 0) {
    // Un entier de plusieurs centaines de chiffres vaut Infinity.
    const entier = Number(sansEspaces);
    return Number.isFinite(entier) ? entier : null;
  }

  const dernier = separateurs[separateurs.length - 1];
  const posDecimal = sansEspaces.lastIndexOf(dernier);
  const partieDecimale = sansEspaces.slice(posDecimal + 1);
  const avant = sansEspaces.slice(0, posDecimal);
  const aDesGroupes = /[.,]/.test(avant);

  let normalise: string;
  if (aDesGroupes) {
    // Plusieurs séparateurs : les groupes de milliers ne peuvent pas utiliser le même
    // caractère que la virgule décimale (« 1,250,50 » est ambigu → refusé).
    const groupe = avant.match(/[.,]/)![0];
    if (new Set(avant.match(/[.,]/g)).size > 1) return null;
    if (partieDecimale.length === 3 && separateurs.every((c) => c === groupe)) {
      normalise = avant.replace(/[.,]/g, "") + partieDecimale; // « 1.250.000 »
    } else if (groupe === dernier) {
      return null;
    } else {
      normalise = `${avant.replace(/[.,]/g, "")}.${partieDecimale}`;
    }
  } else if (separateurs.length === 1 && partieDecimale.length === 3) {
    // « 1,250 » / « 250.000 » : un seul séparateur suivi de trois chiffres = milliers (un loyer de 1 250).
    normalise = avant + partieDecimale;
  } else {
    normalise = `${avant}.${partieDecimale}`;
  }
  const n = Number(normalise);
  return Number.isFinite(n) ? n : null;
}

/**
 * Date saisie dans un tableur : « 2025-03-01 », « 01/03/2025 », « 1-3-2025 »,
 * « 01.03.2025 » (jour avant mois, comme partout où l'on parle français). Renvoie
 * minuit UTC, ou null pour tout ce qui n'est pas une date réelle (« 31/02/2025 »,
 * « mars »…) — jamais une date corrigée en silence.
 */
export function lireDate(brut: string): Date | null {
  const texte = brut.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(texte);
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(texte);
  const [annee, mois, jour] = iso ? [iso[1], iso[2], iso[3]] : fr ? [fr[3], fr[2], fr[1]] : [];
  if (!annee) return null;
  const date = new Date(Date.UTC(Number(annee), Number(mois) - 1, Number(jour)));
  const coherente = date.getUTCFullYear() === Number(annee) && date.getUTCMonth() === Number(mois) - 1 && date.getUTCDate() === Number(jour);
  return coherente ? date : null;
}
