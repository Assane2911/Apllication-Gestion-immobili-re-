import * as Sentry from "@sentry/node";

/**
 * Clé de chiffrement des secrets de double authentification : 32 octets aléatoires, en base64
 * (`openssl rand -base64 32`). Absente : pas de chiffrement (comportement d'avant). Présente mais de mauvaise forme :
 * `invalide`, signalé au démarrage, et traitée comme absente plutôt que de bloquer les connexions.
 */
export function lireCleTotp(valeur: string | undefined): { cle: Buffer | null; invalide: boolean } {
  const texte = (valeur ?? "").trim();
  if (!texte) return { cle: null, invalide: false };
  const cle = Buffer.from(texte, "base64");
  // Buffer.from tolère les caractères hors base64 : on exige que la relecture redonne la même valeur.
  if (cle.length !== 32 || cle.toString("base64").replace(/=+$/, "") !== texte.replace(/=+$/, "")) return { cle: null, invalide: true };
  return { cle, invalide: false };
}

/** Prévient (journal + Sentry) en production quand les secrets TOTP ne sont pas chiffrés. Ne bloque jamais le démarrage. */
export function signalerCleTotp(production: boolean, cle: Buffer | null, invalide: boolean): void {
  if (!production || cle) return;
  const message = invalide
    ? "TOTP_ENCRYPTION_KEY est invalide (il faut 32 octets en base64 : openssl rand -base64 32) : les secrets de double authentification sont stockés EN CLAIR."
    : "TOTP_ENCRYPTION_KEY est absente : les secrets de double authentification sont stockés en clair en base. Générez-la avec « openssl rand -base64 32 », ajoutez-la sur l'hébergeur (type sensible) et conservez-la hors de GitHub.";
  console.error(`[config] ${message}`);
  try {
    Sentry.captureMessage(message, { level: "warning", tags: { source: "config.totpEncryptionKey" }, fingerprint: ["totp-encryption-key", invalide ? "invalide" : "absente"] });
  } catch {
    // Le signalement ne doit jamais empêcher l'application de démarrer.
  }
}
