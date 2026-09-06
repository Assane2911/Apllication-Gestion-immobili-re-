import * as Sentry from "@sentry/node";
import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/asyncHandler";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route introuvable: ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  console.error(err);

  // Sur Vercel (serverless), l'execution peut s'arreter juste apres l'envoi
  // de la reponse, avant que Sentry ait fini d'envoyer l'evenement en tache
  // de fond (meme cause que le bug d'email non "awaite" corrige plus tot).
  // On attend explicitement la fin de l'envoi (2s max) avant de repondre.
  // TEMPORAIRE (diagnostic) : on log le resultat pour savoir si l'envoi a
  // reellement abouti (true) ou a expire sans reponse du serveur Sentry
  // (false), ce qui distinguerait un souci reseau/egress d'un souci de
  // configuration SDK. A retirer une fois le probleme identifie.
  const flushed = await Sentry.flush(5000).catch(() => false);
  console.log(`[sentry] flush() a renvoye: ${flushed}`);

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }

  if (err instanceof Error) {
    return res.status(500).json({ error: err.message });
  }

  return res.status(500).json({ error: "Erreur interne du serveur" });
}
