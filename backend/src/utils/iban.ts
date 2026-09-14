/**
 * Validation IBAN/BIC pour les coordonnées bancaires de l'agence.
 *
 * Ces coordonnées sont montrées telles quelles au locataire pour qu'il sache
 * où envoyer son virement (voir agency.controller.ts / TenantInvoicesPage.tsx).
 * Un IBAN mal saisi n'y ferait pas obstacle — le champ est un simple texte —
 * mais laisserait le gestionnaire diriger ses locataires vers un compte qui
 * n'existe pas, ou vers le sien mal recopié, sans qu'aucun message ne le
 * prévienne avant qu'un premier virement n'échoue à l'autre bout.
 */

/** Retire espaces/tirets et met en majuscules, pour un stockage et une comparaison uniformes. */
export function normaliserIban(brut: string): string {
  return brut.replace(/[\s-]/g, "").toUpperCase();
}

export function normaliserBic(brut: string): string {
  return brut.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Vérifie la structure ISO 13616 (2 lettres pays + 2 chiffres de contrôle +
 * jusqu'à 30 caractères alphanumériques) et la clé de contrôle MOD 97-10
 * (ISO 7064) : la même vérification qu'un site bancaire applique à la saisie,
 * sans quoi une simple faute de frappe (chiffre inversé, lettre oubliée)
 * passerait pour un IBAN valide jusqu'au premier virement resté sans suite.
 */
export function ibanValide(iban: string): boolean {
  const valeur = normaliserIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(valeur)) return false;

  // Déplace les 4 premiers caractères à la fin, puis convertit chaque lettre
  // en son rang alphabétique (A=10 ... Z=35) : c'est l'algorithme MOD 97-10
  // tel que défini par la norme, pas une vérification maison approximative.
  const rearrange = valeur.slice(4) + valeur.slice(0, 4);
  const numerique = rearrange.replace(/[A-Z]/g, (lettre) => String(lettre.charCodeAt(0) - 55));

  // Le nombre dépasse la précision d'un entier JS : le modulo se calcule
  // chiffre par chiffre plutôt que via BigInt/Number sur la chaîne entière.
  let reste = 0;
  for (const chiffre of numerique) {
    reste = (reste * 10 + Number(chiffre)) % 97;
  }
  return reste === 1;
}

/** Structure ISO 9362 : 4 lettres banque + 2 lettres pays + 2 alphanumériques + 3 optionnels (agence). */
export function bicValide(bic: string): boolean {
  const valeur = normaliserBic(bic);
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(valeur);
}
