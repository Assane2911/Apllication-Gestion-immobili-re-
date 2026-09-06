// Doit être importé en tout premier (avant tout autre import) en tête de
// src/app.ts, pour que Sentry puisse instrumenter automatiquement le plus de
// choses possible (voir https://docs.sentry.io/platforms/javascript/guides/express/).
import * as Sentry from "@sentry/node";
import { env } from "./config/env";

// DSN vide (par défaut si SENTRY_DSN n'est pas configuré sur Vercel) : Sentry
// reste totalement inactif, aucune donnée n'est envoyée nulle part. Ça permet
// de ne rien casser en local/dev tant que la variable n'est pas renseignée.
if (env.sentryDsn) {
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    // Pourcentage de requêtes tracées en plus des erreurs (0 à 1). 0.1 = 10%,
    // suffisant pour repérer les lenteurs sans consommer tout le quota gratuit.
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
