import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ApiError } from "../utils/asyncHandler";

export interface AuthPayload {
  userId: string;
  role: "MANAGER" | "TENANT" | "ADMIN" | "OWNER";
  tenantId?: string | null;
  // Id de la fiche propriétaire (table owners) associée à ce compte quand
  // role === "OWNER" — même principe que tenantId ci-dessus pour un locataire.
  ownerId?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new ApiError(401, "Authentification requise");
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    throw new ApiError(401, "Token invalide ou expiré");
  }
}

import { db } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

export function requireRole(...roles: Array<AuthPayload["role"]>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ApiError(403, "Accès refusé");
    }
    next();
  };
}

/**
 * Middleware qui vérifie qu'un gestionnaire dispose d'une période d'essai valide (15 jours)
 * ou d'un abonnement payant actif. Si expiré, bloque l'accès aux opérations de gestion.
 */
export async function requireActiveSubscription(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new ApiError(401, "Authentification requise"));
  }

  // Les locataires accèdent toujours à leur portail pour payer et déclarer
  if (req.user.role !== "MANAGER") {
    return next();
  }

  // 401 et non 404 : l'identifiant vient du jeton, donc « introuvable » ne
  // peut vouloir dire qu'une chose — le compte a été supprimé et le jeton lui
  // survit. C'est le seul code que l'intercepteur du frontend sait traiter en
  // vidant la session (voir utils/authorization.ts::chargerCompteCourant).
  const [user] = await db.select().from(users).where(eq(users.id, req.user.userId));
  if (!user) {
    return next(new ApiError(401, "Ce compte n'existe plus. Veuillez vous reconnecter."));
  }

  const now = new Date();
  const trialEnds = user.trialEndsAt ? new Date(user.trialEndsAt) : null;
  const subEnds = user.subscriptionEndsAt ? new Date(user.subscriptionEndsAt) : null;

  const isTrialValid = user.subscriptionStatus === "TRIAL" && trialEnds !== null && trialEnds > now;
  // Un abonnement résilié garde ses droits jusqu'au terme de la période déjà
  // payée : résilier arrête la RECONDUCTION, pas le temps acheté — c'est la
  // règle qu'énonce subscriptionPeriod.service.ts et que cancelSubscription
  // applique en laissant subscriptionEndsAt intact. Sans ce cas, une année
  // réglée d'avance était perdue au clic sur « annuler le renouvellement ».
  // L'absence de date de fin ne vaut en revanche accès que pour un abonnement
  // ACTIVE (accès à vie) : résilié sans période payée connue, il n'y a aucun
  // jour à honorer.
  const isSubscriptionValid =
    (user.subscriptionStatus === "ACTIVE" && (subEnds === null || subEnds > now)) ||
    (user.subscriptionStatus === "CANCELLED" && subEnds !== null && subEnds > now);

  if (!isTrialValid && !isSubscriptionValid) {
    return next(
      new ApiError(
        402,
        "Votre période d'essai de 15 jours est terminée. Veuillez souscrire à un abonnement pour continuer."
      )
    );
  }

  next();
}

