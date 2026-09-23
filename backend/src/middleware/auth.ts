import { eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { db } from "../db/client";
import { users } from "../db/schema";
import { ApiError } from "../utils/asyncHandler";

export interface AuthPayload {
  userId: string;
  role: "MANAGER" | "TENANT" | "ADMIN" | "OWNER";
  tenantId?: string | null;
  // Id de la fiche propriétaire (table owners) associée à ce compte quand
  // role === "OWNER" — même principe que tenantId ci-dessus pour un locataire.
  ownerId?: string | null;
  // Numéro de version du jeton, recopié depuis users.tokenVersion à
  // l'émission. Optionnel : les jetons émis avant l'introduction du mécanisme
  // n'en portent pas et valent la version 0 (voir authenticate).
  tokenVersion?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
      /**
       * Ligne `users` du porteur du jeton, chargée une fois par `authenticate`
       * et réutilisée en aval (requireActiveSubscription,
       * chargerCompteCourant) pour ne pas relire la même ligne deux ou trois
       * fois dans la même requête.
       */
      compteCourant?: typeof users.$inferSelect;
    }
  }
}

/**
 * Authentifie le porteur du jeton, puis vérifie que son compte existe encore
 * et que le jeton n'a pas été révoqué.
 *
 * La signature seule ne suffit pas. Un JWT est autoporteur : rien, à
 * l'intérieur, ne dit que le compte existe toujours ni que son propriétaire
 * n'a pas demandé à couper les accès. Le serveur relit donc la ligne `users`
 * à chaque requête — c'est le prix de la révocation, et il est modéré : cette
 * lecture remplace celles que faisaient déjà requireActiveSubscription et les
 * contrôleurs, qu'ils reprennent maintenant sur `req.compteCourant`.
 *
 * Trois refus possibles, tous en 401 — le seul code que l'intercepteur du
 * frontend sait traiter en vidant la session (frontend/src/api/client.ts) :
 * signature invalide ou jeton expiré ; compte supprimé alors que le jeton lui
 * survit ; jeton antérieur à une révocation.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new ApiError(401, "Authentification requise"));
  }

  let payload: AuthPayload;
  try {
    payload = jwt.verify(header.slice("Bearer ".length), env.jwtSecret) as AuthPayload;
  } catch {
    return next(new ApiError(401, "Token invalide ou expiré"));
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, payload.userId));
    if (!user) {
      return next(new ApiError(401, "Ce compte n'existe plus. Veuillez vous reconnecter."));
    }

    // Un jeton émis avant l'introduction du mécanisme ne porte aucun numéro :
    // il vaut la version 0, donc il reste valable tant qu'aucune révocation
    // n'a eu lieu. Déployer ce contrôle ne déconnecte ainsi personne, alors
    // que la première révocation, elle, portera bien sur ces jetons-là aussi.
    if ((payload.tokenVersion ?? 0) !== user.tokenVersion) {
      return next(new ApiError(401, "Votre session a été fermée. Veuillez vous reconnecter."));
    }

    req.user = payload;
    req.compteCourant = user;
    next();
  } catch (err) {
    next(err);
  }
}

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

  // Chargée par authenticate, qui a déjà refusé la requête si le compte
  // n'existe plus : la relire ici serait une seconde lecture pour rien.
  const user = req.compteCourant;
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
