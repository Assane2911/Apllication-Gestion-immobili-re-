import type { NextFunction, Request, Response } from "express";

/**
 * PostgreSQL refuse le caractère nul (U+0000) dans un texte. Une requête qui en contient — un identifiant dans
 * l'URL (`/api/properties/%00`), un paramètre de recherche, un champ du corps — faisait échouer la requête
 * en base : 500, trace d'erreur, envoi à Sentry et jusqu'à 2 s d'attente avant de répondre, y compris sur les
 * routes publiques. Rien de légitime n'en contient : c'est une requête invalide, refusée ici avant toute route.
 */
const PROFONDEUR_MAX = 20;

function contientNul(valeur: unknown, profondeur = 0): boolean {
  if (typeof valeur === "string") return valeur.includes("\u0000");
  if (Buffer.isBuffer(valeur)) return false; // corps brut du webhook Stripe : rien à parcourir
  if (profondeur >= PROFONDEUR_MAX || valeur === null || typeof valeur !== "object") return false;
  for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
    if (cle.includes("\u0000") || contientNul(v, profondeur + 1)) return true;
  }
  return false;
}

function urlContientNul(url: string): boolean {
  if (/%00/i.test(url) || url.includes("\u0000")) return true;
  // Un double encodage (%2500) n'est décodé qu'une fois par Express : on ne le suit pas plus loin.
  return false;
}

export function sansCaractereNul(req: Request, res: Response, next: NextFunction): void {
  if (urlContientNul(req.originalUrl) || contientNul(req.query) || contientNul(req.body)) {
    res.status(400).json({ error: "Requête invalide : caractère interdit.", code: "CARACTERE_INTERDIT" });
    return;
  }
  next();
}
