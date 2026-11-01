// Sans 0/O, 1/l/I : un mot de passe dicté au téléphone ne doit pas prêter à confusion.
const MAJUSCULES = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MINUSCULES = "abcdefghijkmnpqrstuvwxyz";
const CHIFFRES = "23456789";
const TOUT = MAJUSCULES + MINUSCULES + CHIFFRES;

function tirer(alphabet: string, aleatoire: Uint32Array, i: number): string {
  return alphabet[aleatoire[i] % alphabet.length];
}

/**
 * Mot de passe provisoire pour l'accès au portail d'un locataire : tiré du générateur cryptographique du navigateur,
 * au moins une majuscule, une minuscule et un chiffre, sans caractères ambigus. Le locataire est invité à le changer.
 */
export function motDePasseTemporaire(longueur = 12): string {
  const n = Math.max(8, longueur);
  const aleatoire = new Uint32Array(n);
  crypto.getRandomValues(aleatoire);
  const caracteres = [tirer(MAJUSCULES, aleatoire, 0), tirer(MINUSCULES, aleatoire, 1), tirer(CHIFFRES, aleatoire, 2)];
  for (let i = 3; i < n; i++) caracteres.push(tirer(TOUT, aleatoire, i));
  // Mélange (Fisher-Yates) pour que les trois caractères garantis ne soient pas toujours en tête.
  const melange = new Uint32Array(n);
  crypto.getRandomValues(melange);
  for (let i = n - 1; i > 0; i--) {
    const j = melange[i] % (i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join("");
}
