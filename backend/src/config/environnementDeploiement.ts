/**
 * Dans quel déploiement tourne ce serveur ? Sur Vercel, `VERCEL_ENV` vaut « production », « preview » (un aperçu par branche ou par commit)
 * ou « development » ; `VERCEL=1` et `NODE_ENV=production` valent, eux, pour TOUS ces déploiements, aperçus compris.
 *
 * Deux conséquences qui ont coûté cher en bruit : l'alerte « TOTP_ENCRYPTION_KEY est absente » partait de chaque aperçu (une
 * cinquantaine d'alertes en trois semaines, JAMAIS depuis la vraie production, où la clé est posée), et les erreurs d'un aperçu
 * étaient étiquetées « production » dans Sentry.
 */

/** Vrai pour la vraie production : sur Vercel, uniquement le déploiement « production » ; hors Vercel (démarrage réel de la CI), NODE_ENV=production. */
export function estProductionReelle(vercelEnv: string | undefined, vercel: string | undefined, nodeEnv: string): boolean {
  if (vercelEnv) return vercelEnv === "production";
  // Sur Vercel sans VERCEL_ENV (ne devrait pas arriver) : on garde la prudence d'avant et on traite le déploiement comme la production.
  return vercel === "1" || nodeEnv === "production";
}

/**
 * Faut-il mettre le schéma de la base à jour (initDb()) à la première requête ? Pas dans un aperçu Vercel : un aperçu (branche ou commit
 * non fusionné) partage la base de production. Constat du 18/11/2026 : une seule base Supabase, aucune branche, et DATABASE_URL, les clés
 * Supabase et JWT_SECRET attribués à « production » ET « aperçu ». initDb() ne fait pas que créer : il supprime des contraintes, change le
 * type de colonnes et met des lignes à jour. Une branche non relue qui le modifie l'exécutait donc sur la vraie base dès la première
 * requête de son aperçu, avant toute fusion. L'aperçu tourne maintenant sur le schéma de la production ; un aperçu qui a SA PROPRE base
 * le demande avec PREVIEW_DB_MIGRATIONS=true.
 */
export function schemaAMettreAJour(vercelEnv: string | undefined, autorisationApercu: string | undefined): boolean {
  return vercelEnv !== "preview" || autorisationApercu === "true";
}

/** L'étiquette d'environnement pour Sentry : « preview » pour un aperçu Vercel, sinon ce que valait NODE_ENV (comportement d'avant). */
export function environnementSentry(vercelEnv: string | undefined, nodeEnv: string): string {
  return vercelEnv === "preview" ? "preview" : nodeEnv;
}
