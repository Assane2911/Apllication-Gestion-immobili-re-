// Doit être importé en tout premier (avant tout autre import) en tête de
// src/main.tsx, pour que Sentry puisse instrumenter automatiquement le plus
// de choses possible (erreurs JS non interceptées, promesses rejetées...) —
// même logique que backend/src/instrument.ts, adaptée au frontend (Vite).
import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN;

// DSN vide (par défaut si VITE_SENTRY_DSN n'est pas configuré sur Vercel) :
// Sentry reste totalement inactif, aucune donnée n'est envoyée nulle part.
// Ça permet de ne rien casser en local/dev tant que la variable n'est pas
// renseignée.
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Pourcentage de sessions/requêtes tracées en plus des erreurs (0 à 1).
    // 0.1 = 10%, suffisant pour repérer les lenteurs sans consommer tout le
    // quota gratuit (même valeur que le backend).
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
