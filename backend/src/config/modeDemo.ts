import * as Sentry from "@sentry/node";

/**
 * Le mode démo des paiements ne vit qu'en développement local et dans les tests. Sur un déploiement (Vercel,
 * NODE_ENV=production), `PAYMENTS_DEMO_MODE=true` est ignoré : ce drapeau court-circuite Stripe et PayDunya, qui
 * renvoient alors un paiement simulé au statut PAID, et rouvrirait l'activation d'abonnements sans encaissement.
 *
 * `deploye` : vrai sur un hébergeur ou en production.
 */
export function resoudreModeDemo(valeur: string | undefined, deploye: boolean): { actif: boolean; ignore: boolean } {
  if (deploye) return { actif: false, ignore: valeur === "true" };
  return { actif: (valeur ?? "true") === "true", ignore: false };
}

/** Prévient (journal + Sentry) qu'un `PAYMENTS_DEMO_MODE=true` a été ignoré sur un déploiement, sans bloquer le démarrage. */
export function signalerModeDemoIgnore(ignore: boolean): void {
  if (!ignore) return;
  const message =
    "PAYMENTS_DEMO_MODE=true a été IGNORÉ : le mode démo des paiements n'existe qu'en local. Supprimez cette variable de l'hébergeur (Production et Preview) puis redéployez, pour que la configuration reflète la réalité.";
  console.error(`[config] ${message}`);
  try {
    Sentry.captureMessage(message, { level: "error", tags: { source: "config.paymentsDemoMode" }, fingerprint: ["payments-demo-mode-ignore"] });
  } catch {
    // Le signalement ne doit jamais empêcher l'application de démarrer.
  }
}
