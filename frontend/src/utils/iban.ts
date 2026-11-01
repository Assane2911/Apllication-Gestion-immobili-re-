/** Retire les espaces et passe en majuscules : la forme sous laquelle un IBAN ou un BIC se compare. */
export function compacter(valeur: string): string {
  return valeur.replace(/\s+/g, "").toUpperCase();
}

/** Écrit un IBAN par groupes de quatre caractères, comme sur un RIB (« FR76 3000 1007 … »). */
export function grouperIban(iban: string): string {
  return compacter(iban).replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * Vérifie la clé d'un IBAN (contrôle modulo 97 de la norme ISO 13616). Elle détecte une faute de frappe ou deux
 * caractères inversés ; elle ne dit pas que le compte existe. Sert d'indication à l'administrateur, jamais de
 * condition d'enregistrement : l'autorité reste le serveur.
 */
export function ibanValide(saisie: string): boolean {
  const iban = compacter(saisie);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const deplace = iban.slice(4) + iban.slice(0, 4);
  let reste = 0;
  for (const caractere of deplace) {
    // Les lettres valent 10 (A) à 35 (Z) ; on réduit au fil de l'eau pour ne jamais dépasser les entiers sûrs.
    const chiffres = /\d/.test(caractere) ? caractere : String(caractere.charCodeAt(0) - 55);
    for (const chiffre of chiffres) reste = (reste * 10 + Number(chiffre)) % 97;
  }
  return reste === 1;
}

/** Un BIC compte 8 ou 11 caractères : 4 lettres (banque), 2 lettres (pays), 2 caractères (place), 3 facultatifs (agence). */
export function bicValide(saisie: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compacter(saisie));
}
