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
  await Sentry.flush(2000).catch(() => {});

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }

  if (err instanceof Error) {
    return res.status(500).json({ error: err.message });
  }

  return res.status(500).json({ error: "Erreur interne du serveur" });
}
