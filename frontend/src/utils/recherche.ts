/** Minuscules sans accents : « Élodie » et « elodie » se valent dans une recherche. */
export function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Ligatures : « cœur » se tape « coeur », « Æ » se tape « ae ».
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .trim();
}

/**
 * Vrai quand chaque mot de la requête figure dans l'un des champs (dans n'importe quel ordre, accents et casse ignorés).
 * Une requête vide correspond à tout.
 */
export function correspond(requete: string, ...champs: Array<string | null | undefined>): boolean {
  const mots = normaliser(requete).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return true;
  const meule = normaliser(champs.filter(Boolean).join(" "));
  return mots.every((mot) => meule.includes(mot));
}
