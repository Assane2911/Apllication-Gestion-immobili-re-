import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import jwt, { SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/client";
import { tenants, users } from "../db/schema";
import {
  accountAlreadyExistsEmail,
  emailVerificationEmail,
  passwordResetEmail,
  sendEmail,
} from "../services/email.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

// Durée de validité du lien de réinitialisation de mot de passe.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 heure

// Durée de validité du lien de confirmation d'email envoyé à l'inscription.
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 heures

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

const registerManagerSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères"),
});

const loginSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1),
});

/**
 * Empreinte bcrypt d'une valeur qu'aucun mot de passe ne peut atteindre,
 * utilisee quand l'adresse est inconnue. bcrypt.compare la traite comme
 * n'importe quelle autre : meme cout, meme duree, et le resultat est
 * toujours faux. Cout 10, identique a celui des empreintes reelles (voir
 * bcrypt.hash a l'inscription) — un cout different se verrait, lui aussi.
 */
const EMPREINTE_FACTICE = "$2b$10$C6UzMDM.H6dfI/f/IKcEe.PjF5Qs7lQEJ7c4yQ0sVn5b6CYXcTQlS";

function signToken(payload: { userId: string; role: "MANAGER" | "TENANT" | "ADMIN"; tenantId?: string | null }) {
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

/**
 * Inscription du gestionnaire (compte administrateur de l'application avec 10 jours d'essai).
 * Le compte est créé immédiatement mais reste bloqué à la connexion tant que
 * l'adresse email n'a pas été confirmée via le lien envoyé par email.
 */
/**
 * Reponse unique de l'inscription, quel que soit le sort de la demande.
 *
 * Une seule constante et non deux objets identiques : deux reponses ecrites
 * separement finissent par diverger d'un mot ou d'un champ, et il suffit de
 * cet ecart pour rouvrir la fuite que cette reponse est censee fermer.
 * `email` en a d'ailleurs disparu : le renvoyer depuis la base aurait suffi
 * a distinguer les deux cas.
 */
const REPONSE_INSCRIPTION = {
  pendingVerification: true,
  message: "Compte créé. Vérifie ta boîte email pour confirmer ton adresse et activer ton compte.",
} as const;

export const registerManager = asyncHandler(async (req: Request, res: Response) => {
  const body = registerManagerSchema.parse(req.body);

  // Reponse IDENTIQUE que l'adresse soit libre ou deja prise. Un 409
  // "Un compte existe deja avec cet email" laissait tester une liste
  // d'adresses et apprendre lesquelles ont un compte ici — un renseignement
  // qui a de la valeur pour qui prepare du hameconnage, et que la plateforme
  // n'a aucune raison de donner. /forgot-password etait deja muet ;
  // l'inscription etait le dernier endroit qui parlait.
  const [existing] = await db.select().from(users).where(eq(users.email, body.email));
  if (existing) {
    // Le titulaire legitime qui a simplement oublie son inscription doit
    // pouvoir s'en sortir : on le lui dit par email, canal que seul lui peut
    // lire. Rien n'est ecrit en base — une tentative d'inscription sur une
    // adresse prise ne doit rien modifier du compte existant.
    const { subject, html } = accountAlreadyExistsEmail({
      loginUrl: `${env.frontendUrl}/login`,
      resetUrl: `${env.frontendUrl}/mot-de-passe-oublie`,
    });
    try {
      await sendEmail(existing.email, subject, html);
    } catch (err) {
      console.error("[auth] Échec de l'envoi de l'email « compte déjà existant » :", err);
    }
    return res.status(201).json(REPONSE_INSCRIPTION);
  }

  const passwordHash = await bcrypt.hash(body.password, 10);
  const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 jours d'essai

  const rawToken = crypto.randomBytes(32).toString("hex");
  const emailVerificationTokenHash = hashToken(rawToken);
  const emailVerificationExpiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

  const [user] = await db
    .insert(users)
    .values({
      email: body.email,
      passwordHash,
      role: "MANAGER",
      subscriptionStatus: "TRIAL",
      // Le nouveau compte n'a choisi aucun plan : on demarre sur le plan de
      // base (STARTER), pas sur "PRO" (bug precedent qui attribuait le plan
      // le plus cher a tout le monde des l'inscription, avant meme qu'un
      // choix ou un paiement ait eu lieu).
      subscriptionPlan: "STARTER",
      trialEndsAt,
      emailVerificationTokenHash,
      emailVerificationExpiresAt,
    })
    .returning();

  const verifyUrl = `${env.frontendUrl}/verifier-email?token=${rawToken}`;
  const { subject, html } = emailVerificationEmail({ verifyUrl });
  try {
    await sendEmail(user.email, subject, html);
  } catch (err) {
    console.error("[auth] Échec de l'envoi de l'email de confirmation:", err);
  }

  res.status(201).json(REPONSE_INSCRIPTION);
});

/** Connexion (gestionnaire ou locataire). */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = loginSchema.parse(req.body);

  const [user] = await db.select().from(users).where(eq(users.email, body.email));

  // Le message d'erreur etait deja le meme dans les deux cas, mais pas le
  // TEMPS de reponse : une adresse inconnue repondait aussitot, une adresse
  // connue apres un bcrypt.compare (~100 ms). L'ecart se mesure de
  // l'exterieur, et suffit a distinguer les deux — la meme fuite que le 409
  // de l'inscription, par un autre canal.
  //
  // On hache donc TOUJOURS, contre une empreinte de rattrapage quand le
  // compte n'existe pas, pour que les deux chemins coutent le meme temps.
  const empreinte = user?.passwordHash ?? EMPREINTE_FACTICE;
  const valid = await bcrypt.compare(body.password, empreinte);
  if (!user || !valid) throw new ApiError(401, "Email ou mot de passe incorrect");

  if (user.role === "MANAGER" && !user.emailVerifiedAt) {
    throw new ApiError(
      403,
      "Merci de confirmer ton email avant de te connecter. Vérifie ta boîte de réception (et tes spams).",
      "EMAIL_NOT_VERIFIED"
    );
  }

  let tenant: typeof tenants.$inferSelect | undefined;
  if (user.role === "TENANT") {
    [tenant] = await db.select().from(tenants).where(eq(tenants.userId, user.id));
  }

  const token = signToken({
    userId: user.id,
    role: user.role as "MANAGER" | "TENANT" | "ADMIN",
    tenantId: tenant?.id ?? null,
  });

  const subscription = computeSubscriptionInfo(user);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      currency: user.currency ?? "EUR",
      tenantId: tenant?.id ?? null,
      tenantName: tenant ? `${tenant.firstName} ${tenant.lastName}` : null,
      subscription,
    },
  });
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

/**
 * Confirmation d'adresse email suite à l'inscription. Si le token est valide
 * et non expiré, active le compte (emailVerifiedAt) et connecte directement
 * l'utilisateur (cliquer sur le lien prouve la possession de l'adresse email).
 */
export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const body = verifyEmailSchema.parse(req.body);
  const emailVerificationTokenHash = hashToken(body.token);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.emailVerificationTokenHash, emailVerificationTokenHash));

  if (!user || !user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
    throw new ApiError(400, "Ce lien de confirmation est invalide ou a expiré");
  }

  const [updated] = await db
    .update(users)
    .set({
      emailVerifiedAt: new Date(),
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
    })
    .where(eq(users.id, user.id))
    .returning();

  const token = signToken({ userId: updated.id, role: "MANAGER" });
  const subscription = computeSubscriptionInfo(updated);

  res.json({
    token,
    user: {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      currency: updated.currency ?? "EUR",
      tenantId: null,
      tenantName: null,
      subscription,
    },
  });
});

const resendVerificationSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
});

/**
 * Renvoi de l'email de confirmation. Répond TOUJOURS avec le même message
 * générique (même logique anti-énumération que forgotPassword) : on ne
 * régénère et renvoie un email que si un compte gestionnaire non vérifié
 * existe réellement pour cette adresse.
 */
export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  const body = resendVerificationSchema.parse(req.body);

  const [user] = await db.select().from(users).where(eq(users.email, body.email));

  if (user && user.role === "MANAGER" && !user.emailVerifiedAt) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const emailVerificationTokenHash = hashToken(rawToken);
    const emailVerificationExpiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

    await db
      .update(users)
      .set({ emailVerificationTokenHash, emailVerificationExpiresAt })
      .where(eq(users.id, user.id));

    // Régression corrigée : un `await` ici faisait dépendre la réponse de
    // l'envoi SMTP réel — une opération réseau, bien plus longue et bien
    // plus variable que tout ce que fait cette route pour une adresse
    // inconnue ou déjà vérifiée. Une adresse à qui il restait quelque chose
    // à renvoyer répondait donc systématiquement plus lentement, d'un écart
    // mesurable de l'extérieur : même faille que le temps de réponse de
    // login() (voir EMPREINTE_FACTICE), par un autre canal. Contrairement à
    // login(), il n'existe rien à hacher pour une adresse sans compte — la
    // réponse ne doit donc plus jamais attendre l'envoi, dans aucun des deux
    // cas ; il continue en arrière-plan, capturé uniquement pour le journal
    // en cas d'échec.
    const verifyUrl = `${env.frontendUrl}/verifier-email?token=${rawToken}`;
    const { subject, html } = emailVerificationEmail({ verifyUrl });
    sendEmail(user.email, subject, html).catch((err) => {
      console.error("[auth] Échec de l'envoi de l'email de confirmation:", err);
    });
  }

  res.json({
    message: "Si un compte non confirmé existe avec cet email, un nouveau lien de confirmation vient de lui être envoyé.",
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
    currency: user.currency ?? "EUR",
    tenant: tenant ?? null,
    subscription,
  });
});

const forgotPasswordSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
});

/**
 * Demande de réinitialisation de mot de passe. Répond TOUJOURS avec le même
 * message générique, que l'email existe ou non en base — pour ne jamais
 * révéler à un tiers si une adresse est inscrite sur la plateforme.
 */
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const body = forgotPasswordSchema.parse(req.body);

  const [user] = await db.select().from(users).where(eq(users.email, body.email));

  if (user) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const resetPasswordTokenHash = hashToken(rawToken);
    const resetPasswordExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await db
      .update(users)
      .set({ resetPasswordTokenHash, resetPasswordExpiresAt })
      .where(eq(users.id, user.id));

    // Régression corrigée : voir le commentaire équivalent dans
    // resendVerification ci-dessus. Un `await` sur l'envoi SMTP faisait
    // répondre plus lentement une adresse connue qu'une adresse inconnue,
    // d'un écart mesurable de l'extérieur — la même fuite que le temps de
    // réponse de login(), par un autre canal. La réponse ne doit donc plus
    // dépendre de l'envoi, qui continue en arrière-plan.
    const resetUrl = `${env.frontendUrl}/reinitialiser-mot-de-passe?token=${rawToken}`;
    const { subject, html } = passwordResetEmail({ resetUrl });
    sendEmail(user.email, subject, html).catch((err) => {
      console.error("[auth] Échec de l'envoi de l'email de réinitialisation:", err);
    });
  }

  res.json({
    message: "Si un compte existe avec cet email, un lien de réinitialisation vient de lui être envoyé.",
  });
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères"),
});

/** Applique le nouveau mot de passe si le token reçu est valide et non expiré. */
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const body = resetPasswordSchema.parse(req.body);
  const resetPasswordTokenHash = hashToken(body.token);

  const [user] = await db.select().from(users).where(eq(users.resetPasswordTokenHash, resetPasswordTokenHash));

  if (!user || !user.resetPasswordExpiresAt || user.resetPasswordExpiresAt < new Date()) {
    throw new ApiError(400, "Ce lien de réinitialisation est invalide ou a expiré");
  }

  const passwordHash = await bcrypt.hash(body.password, 10);

  await db
    .update(users)
    .set({ passwordHash, resetPasswordTokenHash: null, resetPasswordExpiresAt: null })
    .where(eq(users.id, user.id));

  res.json({ message: "Mot de passe mis à jour avec succès" });
});

/** Mise à jour de la devise préférée de l'utilisateur. */
export const updateCurrency = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const currencySchema = z.object({
    currency: z.string().min(1).max(10),
  });
  const { currency } = currencySchema.parse(req.body);

  const [updated] = await db
    .update(users)
    .set({ currency })
    .where(eq(users.id, req.user.userId))
    .returning();

  res.json({ success: true, currency: updated.currency });
});
