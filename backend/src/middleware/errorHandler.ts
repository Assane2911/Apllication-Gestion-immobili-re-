import * as Sentry from "@sentry/node";
import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/asyncHandler";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route introuvable: ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  // Une requête mal formée (champ requis manquant, type incorrect...) rejetée
  // par un schema.parse(req.body) n'est pas une erreur serveur : c'est une
  // erreur du client. On la traduit en 400 avec la liste des champs en cause,
  // plutôt que de la laisser tomber dans la branche générique 500 ci-dessous
  // (qui, en plus de mentir sur la nature de l'erreur, la faisait remonter à
  // Sentry comme si l'application était en défaut).
  if (err instanceof ZodError) {
    const fields = err.errors.map((issue) => issue.path.join(".")).filter(Boolean);
    const suffix = fields.length > 0 ? ` (champ${fields.length > 1 ? "s" : ""} concerné${fields.length > 1 ? "s" : ""} : ${fields.join(", ")})` : "";
    return res.status(400).json({
      error: `Requête invalide : données manquantes ou incorrectes${suffix}.`,
      code: "VALIDATION_ERROR",
    });
  }

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
    // On ne renvoie jamais le message brut d'une erreur inattendue au client
    // (il peut contenir des details internes : nom de colonne, contrainte
    // SQL, chemin de fichier...). Le message complet est deja logge
    // ci-dessus via console.error(err) pour le debogage.
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }

  return res.status(500).json({ error: "Erreur interne du serveur" });
}
