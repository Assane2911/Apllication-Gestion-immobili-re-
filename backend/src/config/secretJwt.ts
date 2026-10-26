import * as Sentry from "@sentry/node";

const LONGUEUR_MINIMALE = 32;
/** Le début du texte d'exemple de `.env.example` : public, donc inutilisable comme secret. */
const TEXTE_EXEMPLE = "changez-cette-cle";

export type ProblemeSecretJwt = "exemple" | "court";

/** Ce qui rend un `JWT_SECRET` inutilisable en production, ou `null` s'il est acceptable. */
export function problemeSecretJwt(secret: string): ProblemeSecretJwt | null {
  if (secret.toLowerCase().includes(TEXTE_EXEMPLE)) return "exemple";
  if (secret.length < LONGUEUR_MINIMALE) return "court";
  return null;
}

/**
 * Signale un `JWT_SECRET` faible en production, sans empêcher le démarrage (changer le secret déconnecte tout le monde :
 * c'est à la personne qui gère le déploiement d'en décider). La valeur elle-même n'est jamais écrite ni envoyée.
 */
export function verifierSecretJwt(secret: string, production: boolean): void {
  if (!production) return;
  const cause = problemeSecretJwt(secret);
  if (!cause) return;
  const detail = cause === "exemple" ? "c'est le texte d'exemple du dépôt, public" : `il fait moins de ${LONGUEUR_MINIMALE} caractères`;
  const message = `JWT_SECRET est faible : ${detail}. Quiconque le connaît peut fabriquer un jeton de connexion valide. Générez-en un avec « openssl rand -base64 48 » (tous les utilisateurs devront se reconnecter).`;
  console.error(`[config] ${message}`);
  try {
    Sentry.captureMessage(message, { level: "error", tags: { source: "config.jwtSecret", cause }, fingerprint: ["jwt-secret-faible", cause] });
  } catch {
    // Le signalement ne doit jamais empêcher l'application de démarrer.
  }
}
