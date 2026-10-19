import type { NextFunction, Request, Response } from "express";

/**
 * Une réponse qui contient des données personnelles ou financières (export comptable : noms de locataires,
 * loyers, dépenses) ne doit être conservée ni par le navigateur ni par un cache intermédiaire — même règle que
 * les documents imprimés (voir routes/document.routes.ts) et les exports d'administration.
 */
export function pasDeCache(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  next();
}
