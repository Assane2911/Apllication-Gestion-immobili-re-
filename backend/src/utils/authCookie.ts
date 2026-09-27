import { Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

/**
 * Nom du cookie httpOnly qui porte le jeton pour un navigateur (voir
 * frontend/src/api/client.ts). L'app mobile Capacitor continue de recevoir le
 * même jeton dans le corps JSON `{ token }` et de le gérer elle-même via
 * l'en-tête Authorization (voir authenticate ci-dessous et
 * Capacitor.isNativePlatform() côté frontend) : un WebView natif n'est pas
 * exposé au même risque de vol par script tiers (XSS) qu'une page web, et la
 * portée d'un cookie cross-site y est de toute façon peu fiable.
 */
export const AUTH_COOKIE_NAME = "token";

// Frontend et backend sont TOUJOURS sur des origines distinctes sur Vercel —
// y compris en preview, où chaque déploiement (front comme back) reçoit son
// propre sous-domaine *.vercel.app généré par PR, donc deux "sites" distincts
// au sens de SameSite. Seul SameSite=None laisse alors le cookie suivre la
// requête, ce qui impose Secure. `NODE_ENV` n'est PAS fiable ici : Vercel ne
// le positionne pas automatiquement à l'exécution (seul `VERCEL=1` l'est,
// voir la liste officielle de ses "System Environment Variables" — déjà
// utilisé pour la même raison par `trust proxy` dans app.ts). Sans ce
// repli, la valeur par défaut de env.nodeEnv ("development") aurait posé un
// cookie Lax + non-Secure en production réelle : jamais renvoyé par le
// navigateur sur une requête cross-site, donc une authentification web
// silencieusement cassée dès le premier déploiement. En local/dev (hors
// Vercel), les deux serveurs tournent sur des ports différents de
// "localhost" mais RESTENT le même site — Lax suffit, et évite d'exiger
// HTTPS localement, où il n'existe pas.
function cookieOptions(maxAge?: number) {
  const surVercel = env.nodeEnv === "production" || process.env.VERCEL === "1";
  return {
    httpOnly: true,
    secure: surVercel,
    sameSite: (surVercel ? "none" : "lax") as "none" | "lax",
    path: "/",
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

/**
 * Pose le cookie avec la même durée de vie que le jeton lui-même : `exp` est
 * décodé plutôt que reparsé depuis JWT_EXPIRES_IN, pour rester exact quel que
 * soit le format accepté par cette variable d'environnement (voir
 * env.ts::jwtExpiresIn, passé tel quel à jwt.sign).
 */
export function setAuthCookie(res: Response, token: string) {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  const maxAge = decoded?.exp ? decoded.exp * 1000 - Date.now() : undefined;
  res.cookie(AUTH_COOKIE_NAME, token, cookieOptions(maxAge));
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
}
