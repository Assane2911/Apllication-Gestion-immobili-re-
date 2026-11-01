export interface ForceMotDePasse {
  /** 0 = rien saisi ; 1 = trop court (moins de 8 caractères) ; 2 = moyen ; 3 = bon ; 4 = excellent. */
  niveau: 0 | 1 | 2 | 3 | 4;
  criteres: { longueur: boolean; casse: boolean; chiffre: boolean; symbole: boolean };
}

/** Longueur à partir de laquelle un mot de passe gagne un point de force. */
export const LONGUEUR_CONFORTABLE = 12;
/** Longueur minimale acceptée par le serveur. */
export const LONGUEUR_MINIMALE = 8;

/**
 * Évalue un mot de passe pour l'indicateur de l'inscription. C'est une aide à la saisie, jamais une condition :
 * la seule règle qui bloque est la longueur minimale, que le serveur impose aussi. Quatre critères comptent chacun
 * pour un point (12 caractères ou plus, majuscules ET minuscules, un chiffre, un symbole) ; moins de deux points
 * donnent « moyen », deux ou trois « bon », les quatre « excellent ».
 */
export function forceMotDePasse(motDePasse: string): ForceMotDePasse {
  const criteres = {
    longueur: motDePasse.length >= LONGUEUR_CONFORTABLE,
    casse: /[a-zà-ÿ]/.test(motDePasse) && /[A-ZÀ-ß]/.test(motDePasse),
    chiffre: /\d/.test(motDePasse),
    symbole: /[^A-Za-z0-9À-ÿ\s]/.test(motDePasse),
  };
  if (motDePasse.length === 0) return { niveau: 0, criteres };
  if (motDePasse.length < LONGUEUR_MINIMALE) return { niveau: 1, criteres };
  const points = Object.values(criteres).filter(Boolean).length;
  return { niveau: points <= 1 ? 2 : points === 4 ? 4 : 3, criteres };
}
