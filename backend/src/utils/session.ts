import jwt from "jsonwebtoken";
import { env } from "../config/env";

/**
 * Déconnexion à l'inactivité, côté serveur. Une règle posée seulement dans l'interface se contourne : le jeton,
 * lui, resterait valable une semaine. Sur le web, le jeton du cookie est donc COURT et ne se prolonge que sur un
 * geste de l'utilisateur (POST /auth/session/refresh) : les requêtes automatiques de l'interface (rafraîchissement
 * des notifications...) ne doivent pas garder une session ouverte indéfiniment.
 *
 * L'app mobile (jeton dans l'en-tête Authorization, voir authenticate) garde son jeton long : se reconnecter
 * toutes les 30 minutes sur un téléphone gênerait beaucoup, pour un risque bien plus faible qu'un navigateur partagé.
 */
export const DUREE_INACTIVITE_ADMIN_MS = 15 * 60_000;
export const DUREE_INACTIVITE_MS = 30 * 60_000;
/** Durée maximale d'une session web depuis la connexion, même en activité continue. */
export const DUREE_SESSION_MAX_MS = 12 * 3_600_000;

export type RoleSession = "MANAGER" | "TENANT" | "ADMIN" | "OWNER";

export interface ClaimsSession {
  userId: string;
  role: RoleSession;
  tenantId?: string | null;
  ownerId?: string | null;
  tokenVersion: number;
  collaboratorId?: string | null;
}

export function dureeInactiviteMs(role: RoleSession): number {
  return role === "ADMIN" ? DUREE_INACTIVITE_ADMIN_MS : DUREE_INACTIVITE_MS;
}

/**
 * Jeton du cookie web : expire à `maintenant` + durée d'inactivité du rôle, sans jamais dépasser
 * `debutSession` + 12 h. `sst` (début de session) est conservé d'un renouvellement à l'autre. Renvoie `null`
 * quand les 12 h sont écoulées : il n'y a plus de session à prolonger.
 */
export function signerJetonWeb(
  claims: ClaimsSession,
  debutSession: Date = new Date(),
  maintenant: Date = new Date()
): { token: string; expireLe: Date } | null {
  const limite = debutSession.getTime() + DUREE_SESSION_MAX_MS;
  const expireLeMs = Math.min(maintenant.getTime() + dureeInactiviteMs(claims.role), limite);
  if (expireLeMs <= maintenant.getTime()) return null;

  const token = jwt.sign(
    { ...claims, sst: Math.floor(debutSession.getTime() / 1000), iat: Math.floor(maintenant.getTime() / 1000), exp: Math.floor(expireLeMs / 1000) },
    env.jwtSecret
  );
  return { token, expireLe: new Date(expireLeMs) };
}
