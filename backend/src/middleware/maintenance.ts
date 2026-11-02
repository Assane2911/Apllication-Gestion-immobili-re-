import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AUTH_COOKIE_NAME } from "../utils/authCookie";
import { fenetreEnCours, lireMaintenance } from "../services/maintenance.service";

/**
 * Ce qui reste joignable pendant une maintenance :
 *  - les sondes de santé et l'état de la maintenance, que le frontend interroge pour s'afficher ;
 *  - les rapports du navigateur (CSP) ;
 *  - les notifications de paiement (Stripe, PayDunya) : le prestataire doit pouvoir confirmer un paiement, sans quoi il réessaie
 *    et finit par abandonner, et un loyer réglé resterait « en attente » ;
 *  - les tâches planifiées, qui s'authentifient elles-mêmes ;
 *  - l'ouverture et la fermeture de session, pour que l'administrateur puisse se connecter et clore la maintenance.
 */
const AUTORISES: RegExp[] = [
  /^\/api\/health(\/|$)/,
  /^\/api\/maintenance\/?$/,
  /^\/api\/csp-report\/?$/,
  /^\/api\/payments\/stripe\/webhook\/?$/,
  /^\/api\/payments\/paydunya\/ipn\/?$/,
  /^\/api\/cron(\/|$)/,
  /^\/api\/auth\/(login|google|logout|me|2fa\/verify-login)\/?$/,
];

/** Le porteur du jeton est-il administrateur ? Signature vérifiée ; chaque route fait ensuite sa propre authentification complète. */
function estAdministrateur(req: Request): boolean {
  const entete = req.headers.authorization;
  const jeton = entete && entete.startsWith("Bearer ") ? entete.slice("Bearer ".length) : req.cookies?.[AUTH_COOKIE_NAME];
  if (!jeton) return false;
  try {
    return (jwt.verify(jeton, env.jwtSecret) as { role?: string }).role === "ADMIN";
  } catch {
    return false;
  }
}

/**
 * Pendant la fenêtre de maintenance, toute requête de l'API répond 503 `MAINTENANCE` — avec `Retry-After` et les dates de la
 * fenêtre, pour que l'application affiche son écran de maintenance et sache quand revenir. L'administrateur passe : c'est lui qui
 * mène l'opération (et peut la terminer).
 *
 * La réponse est écrite ici, et non lancée comme ApiError : une maintenance voulue n'est pas une erreur, et ne doit pas être
 * remontée à Sentry comme une panne.
 */
export async function bloquerPendantMaintenance(req: Request, res: Response, next: NextFunction) {
  if (req.method === "OPTIONS") return next();
  const fenetre = await lireMaintenance();
  if (!fenetreEnCours(fenetre)) return next();
  // Chemin complet, sans la chaîne de requête : ce garde est monté sur toute l'application.
  const chemin = req.originalUrl.split("?")[0];
  if (AUTORISES.some((motif) => motif.test(chemin))) return next();
  if (estAdministrateur(req)) return next();

  const secondes = Math.max(1, Math.min(3600, Math.ceil((fenetre.fin.getTime() - Date.now()) / 1000)));
  res.setHeader("Retry-After", String(secondes));
  res.status(503).json({
    error: "Maintenance en cours : l'application sera de nouveau disponible à la fin de l'opération.",
    code: "MAINTENANCE",
    params: { debut: fenetre.debut.toISOString(), fin: fenetre.fin.toISOString(), message: fenetre.message ?? "" },
  });
}
