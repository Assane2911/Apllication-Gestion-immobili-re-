import { z } from "zod";
import { avecCode } from "./validationExplicite";

/** Longueur minimale d'un NOUVEAU mot de passe (les comptes existants se connectent quel que soit leur mot de passe). */
export const MOT_DE_PASSE_LONGUEUR_MIN = 8;
/** bcrypt ne lit que les 72 premiers OCTETS : au-delà, la fin du mot de passe serait ignorée sans que personne ne le sache. */
export const MOT_DE_PASSE_OCTETS_MAX = 72;

/**
 * Mots de passe que des listes de fuites placent en tête des essais automatiques (anglais et français), en minuscules.
 * Ce n'est pas un dictionnaire exhaustif : il écarte ce qu'un attaquant essaie en premier sur n'importe quel compte,
 * pas plus. Aucune règle de composition (« une majuscule, un chiffre… ») : elle pousse à `Password1!`, que cette liste
 * ne peut pas non plus tout couvrir, alors que la longueur et le refus des choix évidents protègent mieux.
 */
const MOTS_DE_PASSE_COURANTS = new Set([
  "12345678", "123456789", "1234567890", "12345678910", "11111111", "00000000", "87654321", "98765432", "987654321",
  "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "p@ssword", "pass1234", "motdepasse",
  "motdepasse1", "motdepasse123", "mdp12345", "mdp123456", "azertyui", "azertyuiop", "azerty123", "azerty1234",
  "azerty12", "qwertyui", "qwertyuiop", "qwerty12", "qwerty123", "qwerty1234", "qwertz123", "abcd1234", "abcdefgh",
  "abcdefg1", "abc12345", "abc123456", "1q2w3e4r", "1q2w3e4r5t", "1qaz2wsx", "q1w2e3r4", "iloveyou", "jetaime1",
  "jetaime123", "bonjour1", "bonjour123", "bienvenue", "bienvenue1", "soleil123", "doudou123", "football", "football1",
  "marseille", "marseille13", "senegal221", "senegal123", "dakar2020", "admin123", "administrator", "welcome1",
  "welcome123", "letmein1", "letmein123", "changeme", "changeme1", "azerty@123", "immobilier", "immobilier1", "gestion123",
  "immoplatform", "immoplatform1", "immoplatformpro",
]);

/** Le mot de passe n'est qu'un mot commun, ou le même caractère répété (« aaaaaaaa »). */
export function estMotDePasseEvident(motDePasse: string): boolean {
  const minuscules = motDePasse.toLowerCase();
  return MOTS_DE_PASSE_COURANTS.has(minuscules) || new Set(Array.from(minuscules)).size === 1;
}

/** Le mot de passe reprend l'adresse e-mail (entière ou seulement la partie avant @) : le premier essai de quiconque la connaît. */
export function reprendLAdresse(motDePasse: string, email: string): boolean {
  const adresse = email.trim().toLowerCase();
  const local = adresse.split("@")[0] ?? "";
  const saisi = motDePasse.trim().toLowerCase();
  return saisi === adresse || (local.length >= 4 && saisi === local);
}

const MESSAGE_TROP_LONG = `Le mot de passe ne peut pas dépasser ${MOT_DE_PASSE_OCTETS_MAX} octets (environ ${MOT_DE_PASSE_OCTETS_MAX} caractères ; les accents et symboles en comptent davantage).`;
const MESSAGE_EVIDENT = "Ce mot de passe est trop courant ou trop prévisible : choisissez-en un plus personnel, d'au moins 8 caractères.";
const MESSAGE_ADRESSE = "Le mot de passe ne doit pas reprendre votre adresse e-mail.";

/**
 * Règles d'un NOUVEAU mot de passe (inscription, réinitialisation, accès au portail créé par le gestionnaire).
 * Elles ne s'appliquent jamais à la connexion : un compte créé avant leur durcissement doit pouvoir se connecter.
 */
export const motDePasseSchema = z
  .string()
  .min(MOT_DE_PASSE_LONGUEUR_MIN, "Le mot de passe doit contenir au moins 8 caractères")
  .max(1024)
  .refine((valeur) => Buffer.byteLength(valeur, "utf8") <= MOT_DE_PASSE_OCTETS_MAX, avecCode(MESSAGE_TROP_LONG, "PASSWORD_TOO_LONG", { max: MOT_DE_PASSE_OCTETS_MAX }))
  .refine((valeur) => !estMotDePasseEvident(valeur), avecCode(MESSAGE_EVIDENT, "PASSWORD_TOO_COMMON"));

/** Contrôle qui dépend de l'adresse du compte (connue seulement avec le corps de l'inscription, ou la ligne du compte). */
export function refuserMotDePasseDeLAdresse(motDePasse: string, email: string): void {
  if (reprendLAdresse(motDePasse, email)) {
    throw new z.ZodError([{ code: "custom", path: ["password"], message: MESSAGE_ADRESSE, params: { code: "PASSWORD_IS_EMAIL" } }]);
  }
}
