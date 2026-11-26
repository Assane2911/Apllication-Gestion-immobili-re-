import * as Sentry from "@sentry/node";

/** Attente maximale de l'envoi : la même que celle d'errorHandler.ts, pour ne jamais retarder longtemps la réponse. */
const ATTENTE_ENVOI_MS = 2000;

/**
 * Envoie un message à Sentry, puis ATTEND qu'il soit parti. Ne lève jamais.
 *
 * Sur Vercel (serverless), l'exécution peut s'arrêter juste après l'envoi de la réponse, avant que Sentry ait fini d'expédier
 * l'événement en tâche de fond : un message émis depuis un webhook, sans cette attente, pouvait ne jamais arriver. C'est la raison du
 * `flush` d'errorHandler.ts, qui ne couvre que les erreurs : un webhook qui répond 200 n'y passe pas. Les signalements d'un paiement
 * remboursé, contesté ou encaissé sans être appliqué — pour l'abonnement à la plateforme, Sentry est le SEUL signal — doivent donc
 * attendre eux-mêmes.
 *
 * Un suivi d'erreurs indisponible ne doit jamais faire échouer le webhook : toute erreur, à l'envoi comme à l'attente, est absorbée.
 */
export async function signalerASentry(message: string, contexte: Parameters<typeof Sentry.captureMessage>[1]): Promise<void> {
  try {
    Sentry.captureMessage(message, contexte);
    await Sentry.flush(ATTENTE_ENVOI_MS);
  } catch {
    // Voir ci-dessus.
  }
}
