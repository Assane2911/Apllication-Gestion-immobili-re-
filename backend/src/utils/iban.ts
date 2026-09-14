/**
 * Validation IBAN/BIC pour des coordonnées bancaires affichées telles quelles
 * à qui doit faire un virement : celles d'une agence pour son locataire (voir
 * agency.controller.ts / TenantInvoicesPage.tsx) comme celles de la
 * plateforme pour un gestionnaire qui règle son abonnement par virement (voir
 * platformSettings.controller.ts / SubscriptionPage.tsx). Un IBAN mal saisi
 * n'y ferait pas obstacle — le champ est un simple texte — mais dirigerait le
 * payeur vers un compte qui n'existe pas, ou mal recopié, sans qu'aucun
 * message ne le prévienne avant qu'un premier virement n'échoue à l'autre
 * bout.
 */
import { z } from "zod";

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

/**
 * Schémas Zod prêts à l'emploi pour un champ IBAN/BIC optionnel dans un
 * formulaire de paramètres (agence ou plateforme) : une chaîne vide (""),
 * comme quand le formulaire efface le champ, est traitée comme absente
 * (null) plutôt que comme un IBAN invalide.
 */
export const ibanSchema = z
  .string()
  .optional()
  .nullable()
  .transform((valeur) => (valeur ? normaliserIban(valeur) : valeur || null))
  .refine((valeur) => !valeur || ibanValide(valeur), {
    message: "IBAN invalide — vérifiez qu'il est complet et sans erreur de saisie.",
  });

export const bicSchema = z
  .string()
  .optional()
  .nullable()
  .transform((valeur) => (valeur ? normaliserBic(valeur) : valeur || null))
  .refine((valeur) => !valeur || bicValide(valeur), {
    message: "BIC/SWIFT invalide — 8 ou 11 caractères attendus (ex: BNPAFRPPXXX).",
  });
