import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import jwt, { SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/client";
import { tenants, users } from "../db/schema";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

const registerManagerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function signToken(payload: { userId: string; role: "MANAGER" | "TENANT"; tenantId?: string | null }) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as SignOptions);
}

export function computeSubscriptionInfo(user: typeof users.$inferSelect) {
  if (user.role !== "MANAGER") {
    return null;
  }

  const now = new Date();
  const trialEnds = user.trialEndsAt ? new Date(user.trialEndsAt) : null;
  const subEnds = user.subscriptionEndsAt ? new Date(user.subscriptionEndsAt) : null;

  const isTrialActive = user.subscriptionStatus === "TRIAL" && trialEnds !== null && trialEnds > now;
  const isSubscriptionActive =
    user.subscriptionStatus === "ACTIVE" && (subEnds === null || subEnds > now);

  const isExpired = !isTrialActive && !isSubscriptionActive;

  let trialDaysRemaining = 0;
  if (trialEnds && trialEnds > now) {
    trialDaysRemaining = Math.max(0, Math.ceil((trialEnds.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  }

  return {
    status: isExpired ? ("EXPIRED" as const) : user.subscriptionStatus,
    plan: user.subscriptionPlan,
    trialEndsAt: user.trialEndsAt,
    subscriptionEndsAt: user.subscriptionEndsAt,
    trialDaysRemaining,
    isTrialActive,
    isSubscriptionActive,
    isExpired,
  };
}

/** Inscription du gestionnaire (compte administrateur de l'application avec 15 jours d'essai). */
export const registerManager = asyncHandler(async (req: Request, res: Response) => {
  const body = registerManagerSchema.parse(req.body);

  const [existing] = await db.select().from(users).where(eq(users.email, body.email));
  if (existing) throw new ApiError(409, "Un compte existe déjà avec cet email");

  const passwordHash = await bcrypt.hash(body.password, 10);
  const trialEndsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 jours d'essai

  const [user] = await db
    .insert(users)
    .values({
      email: body.email,
      passwordHash,
      role: "MANAGER",
      subscriptionStatus: "TRIAL",
      subscriptionPlan: "PRO",
      trialEndsAt,
    })
    .returning();

  const token = signToken({ userId: user.id, role: "MANAGER" });
  const subscription = computeSubscriptionInfo(user);

  res.status(201).json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      subscription,
    },
  });
});

/** Connexion (gestionnaire ou locataire). */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = loginSchema.parse(req.body);

  const [user] = await db.select().from(users).where(eq(users.email, body.email));
  if (!user) throw new ApiError(401, "Email ou mot de passe incorrect");

  const valid = await bcrypt.compare(body.password, user.passwordHash);
  if (!valid) throw new ApiError(401, "Email ou mot de passe incorrect");

  let tenant: typeof tenants.$inferSelect | undefined;
  if (user.role === "TENANT") {
    [tenant] = await db.select().from(tenants).where(eq(tenants.userId, user.id));
  }

  const token = signToken({
    userId: user.id,
    role: user.role as "MANAGER" | "TENANT",
    tenantId: tenant?.id ?? null,
  });

  const subscription = computeSubscriptionInfo(user);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: tenant?.id ?? null,
      tenantName: tenant ? `${tenant.firstName} ${tenant.lastName}` : null,
      subscription,
    },
  });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const [user] = await db.select().from(users).where(eq(users.id, req.user.userId));
  if (!user) throw new ApiError(404, "Utilisateur introuvable");

  let tenant: typeof tenants.$inferSelect | undefined;
  if (user.role === "TENANT") {
    [tenant] = await db.select().from(tenants).where(eq(tenants.userId, user.id));
  }

  const subscription = computeSubscriptionInfo(user);

  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    tenant: tenant ?? null,
    subscription,
  });
});
