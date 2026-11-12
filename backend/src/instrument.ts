// Doit être importé en tout premier (avant tout autre import) en tête de
// src/app.ts, pour que Sentry puisse instrumenter automatiquement le plus de
// choses possible (voir https://docs.sentry.io/platforms/javascript/guides/express/).
import * as Sentry from "@sentry/node";
import { env } from "./config/env";

// DSN vide (par défaut si SENTRY_DSN n'est pas configuré sur Vercel) : Sentry
// reste totalement inactif, aucune donnée n'est envoyée nulle part. Ça permet
// de ne rien casser en local/dev tant que la variable n'est pas renseignée.
/**
 * Décide si une erreur mérite d'être remontée à Sentry.
 *
 * Le filtre par défaut de Sentry ne remonte que les erreurs de statut >= 500,
 * mais il traite comme un 500 toute erreur ne portant AUCUN statut. Or son
 * middleware s'exécute AVANT errorHandler (voir app.ts) : une requête mal
 * formée (ZodError) ou un upload refusé (MulterError) n'ont pas encore été
 * traduites en 400 quand Sentry les examine, et remontaient donc comme des
 * défauts applicatifs. C'est exactement le bruit que la branche ZodError
 * d'errorHandler cherchait à éviter, sans pouvoir y parvenir depuis sa
 * position dans la chaîne.
 *
 * Ces deux familles sont identifiées par leur `name` plutôt que par
 * `instanceof` : ce fichier est chargé en tout premier, avant Sentry.init,
 * précisément pour qu'express et consorts soient instrumentés au chargement ;
 * y importer zod ou multer les chargerait trop tôt. Le test associé vérifie
 * que ces noms correspondent bien aux vraies classes.
 */
export function shouldReportToSentry(error: {
  name?: string;
  status?: number | string;
  statusCode?: number | string;
}): boolean {
  if (error?.name === "ZodError" || error?.name === "MulterError") return false;

  const rawStatus = error?.statusCode ?? error?.status;
  const status = typeof rawStatus === "string" ? parseInt(rawStatus, 10) : rawStatus;
  if (typeof status === "number" && !Number.isNaN(status)) return status >= 500;

  // Erreur sans statut identifiable : on la remonte, comme Sentry par défaut.
  return true;
}

/**
 * Le lien d'abonnement au calendrier porte son jeton dans l'adresse (`/api/agenda/ics/<jeton>.ics`) : c'est le secret qui tient lieu
 * de session aux calendriers externes. Une erreur ou une trace envoyée à Sentry contient l'adresse de la requête, ses fils d'Ariane
 * et le nom des opérations : sans ce masquage, le jeton s'y retrouvait en clair, lisible par quiconque consulte Sentry.
 * Le masquage s'applique à l'événement entier (texte JSON) plutôt qu'à des champs choisis, pour n'en oublier aucun.
 */
const JETON_AGENDA_DANS_ADRESSE = /(\/agenda\/ics\/)[A-Za-z0-9_%-]{16,}/g;

export function masquerJetonsAgenda<T>(evenement: T): T {
  const texte = JSON.stringify(evenement);
  if (texte === undefined || !JETON_AGENDA_DANS_ADRESSE.test(texte)) return evenement;
  JETON_AGENDA_DANS_ADRESSE.lastIndex = 0;
  return JSON.parse(texte.replace(JETON_AGENDA_DANS_ADRESSE, "$1[masqué]")) as T;
}

if (env.sentryDsn) {
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    beforeSend: (evenement) => masquerJetonsAgenda(evenement),
    beforeSendTransaction: (evenement) => masquerJetonsAgenda(evenement),
    integrations: [Sentry.expressIntegration({ shouldHandleError: shouldReportToSentry })],
    // Pourcentage de requêtes tracées en plus des erreurs (0 à 1). 0.1 = 10%,
    // suffisant pour repérer les lenteurs sans consommer tout le quota gratuit.
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
