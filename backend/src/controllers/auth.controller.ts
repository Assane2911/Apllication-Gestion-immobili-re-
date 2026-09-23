import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq, inArray, or } from "drizzle-orm";
import { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt, { SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env";
import { db, Transaction } from "../db/client";
import { contracts, invoices, issueReports, listings, owners, properties, tenants, users } from "../db/schema";
import {
  accountAlreadyExistsEmail,
  emailVerificationEmail,
  passwordResetEmail,
  sendEmail,
} from "../services/email.service";
import { deleteStorageObjectBestEffort } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { chargerCompteCourant } from "../utils/authorization";
import { hashToken, RESET_TOKEN_TTL_MS } from "../utils/token";

// Durée de validité du lien de confirmation d'email envoyé à l'inscription.
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 heures

const registerManagerSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères"),
});

const loginSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1),
});

const googleLoginSchema = z.object({
  // Jeton d'identité (JWT) renvoyé par Google Identity Services côté
  // navigateur — jamais un code d'autorisation ni, a fortiori, un secret.
  credential: z.string().min(1),
});

// Un seul client, sans Client ID passé au constructeur : l'audience attendue
// est vérifiée explicitement à chaque appel de verifyIdToken (voir
// loginWithGoogle), ce qui permet à ce module de se charger même quand
// GOOGLE_CLIENT_ID n'est pas encore configuré (voir env.ts::googleClientId).
const googleClient = new OAuth2Client();

/**
 * Empreinte bcrypt d'une valeur qu'aucun mot de passe ne peut atteindre,
 * utilisee quand l'adresse est inconnue. bcrypt.compare la traite comme
 * n'importe quelle autre : meme cout, meme duree, et le resultat est
 * toujours faux. Cout 10, identique a celui des empreintes reelles (voir
 * bcrypt.hash a l'inscription) — un cout different se verrait, lui aussi.
 */
const EMPREINTE_FACTICE = "$2b$10$C6UzMDM.H6dfI/f/IKcEe.PjF5Qs7lQEJ7c4yQ0sVn5b6CYXcTQlS";

/**
 * `tokenVersion` est recopié depuis la ligne `users` : c'est lui que
 * `authenticate` compare à chaque requête pour savoir si le jeton a été
 * révoqué depuis son émission (voir middleware/auth.ts et
 * users.tokenVersion). Tout appel qui émet un jeton doit donc partir d'une
 * ligne fraîchement lue — sans quoi il délivrerait un jeton déjà périmé.
 */
function signToken(payload: {
  userId: string;
  role: "MANAGER" | "TENANT" | "ADMIN" | "OWNER";
  tenantId?: string | null;
  ownerId?: string | null;
  tokenVersion: number;
}) {
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
  // Même règle que requireActiveSubscription (middleware/auth.ts), et pour la
  // même raison : un abonnement résilié reste actif jusqu'au terme de la
  // période déjà payée. Les deux doivent rester d'accord — sinon l'interface
  // annonce « expiré » à un gestionnaire que le serveur laisse travailler,
  // ou l'inverse.
  const isSubscriptionActive =
    (user.subscriptionStatus === "ACTIVE" && (subEnds === null || subEnds > now)) ||
    (user.subscriptionStatus === "CANCELLED" && subEnds !== null && subEnds > now);

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
 * Inscription du gestionnaire (compte administrateur de l'application avec 15 jours d'essai).
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
    // Régression mineure, même famille que EMPREINTE_FACTICE (login) : le
    // chemin "adresse libre" ci-dessous hache le mot de passe (bcrypt, coût
    // 10, ~100 ms) avant de créer le compte. Sans un hachage équivalent ici,
    // une adresse déjà prise répondait mécaniquement plus vite qu'une
    // inscription réussie — un écart mesurable de l'extérieur, même une fois
    // le message et le statut rendus identiques. Le résultat est jeté : il
    // ne sert qu'à égaliser le temps de calcul entre les deux chemins.
    await bcrypt.hash(body.password, 10);

    // Le titulaire legitime qui a simplement oublie son inscription doit
    // pouvoir s'en sortir : on le lui dit par email, canal que seul lui peut
    // lire. Rien n'est ecrit en base — une tentative d'inscription sur une
    // adresse prise ne doit rien modifier du compte existant.
    const { subject, html } = accountAlreadyExistsEmail({
      loginUrl: `${env.frontendUrl}/login`,
      resetUrl: `${env.frontendUrl}/mot-de-passe-oublie`,
    });
    // Même correctif que forgotPassword/resendVerification : la réponse ne
    // doit plus dépendre de l'envoi SMTP, dont la durée réseau varie bien
    // plus que tout calcul local et créerait à elle seule un écart mesurable.
    sendEmail(existing.email, subject, html).catch((err) => {
      console.error("[auth] Échec de l'envoi de l'email « compte déjà existant » :", err);
    });
    return res.status(201).json(REPONSE_INSCRIPTION);
  }

  const passwordHash = await bcrypt.hash(body.password, 10);
  const trialEndsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 jours d'essai

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
  sendEmail(user.email, subject, html).catch((err) => {
    console.error("[auth] Échec de l'envoi de l'email de confirmation:", err);
  });

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

  let owner: typeof owners.$inferSelect | undefined;
  if (user.role === "OWNER") {
    [owner] = await db.select().from(owners).where(eq(owners.userId, user.id));
  }

  const token = signToken({
    userId: user.id,
    role: user.role as "MANAGER" | "TENANT" | "ADMIN" | "OWNER",
    tenantId: tenant?.id ?? null,
    ownerId: owner?.id ?? null,
    tokenVersion: user.tokenVersion,
  });

  const subscription = computeSubscriptionInfo(user);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      currency: user.currency ?? "EUR",
      hasPassword: user.hasPassword,
      tenantId: tenant?.id ?? null,
      tenantName: tenant ? `${tenant.firstName} ${tenant.lastName}` : null,
      ownerId: owner?.id ?? null,
      ownerName: owner ? `${owner.firstName} ${owner.lastName}` : null,
      subscription,
    },
  });
});

/**
 * Connexion / inscription automatique via Google (gestionnaires uniquement).
 *
 * Flux "Google Identity Services" côté navigateur : le frontend obtient un
 * jeton d'identité (ID token, un JWT signé par Google) et nous l'envoie tel
 * quel. On le vérifie ici via `verifyIdToken`, qui contrôle la signature,
 * l'émetteur et l'audience (notre GOOGLE_CLIENT_ID) — aucun Client Secret
 * n'est nécessaire pour ce flux, contrairement à un échange de code
 * d'autorisation OAuth classique, ce qui garde l'architecture sans session
 * serveur (JWT stateless) déjà en place pour login().
 */
export const loginWithGoogle = asyncHandler(async (req: Request, res: Response) => {
  if (!env.googleClientId) {
    throw new ApiError(503, "La connexion avec Google n'est pas configurée sur ce serveur");
  }

  const body = googleLoginSchema.parse(req.body);

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: body.credential,
      audience: env.googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw new ApiError(401, "Jeton Google invalide ou expiré");
  }

  if (!payload || !payload.sub || !payload.email) {
    throw new ApiError(401, "Jeton Google invalide");
  }

  // Google atteste lui-même la possession de l'adresse (écran de consentement
  // OAuth) ; sans cette vérification explicite, un compte Google avec une
  // adresse non confirmée (cas rare, ex. certains comptes Workspace) suffirait
  // à prouver une identité que ni nous ni Google n'avons vérifiée.
  if (!payload.email_verified) {
    throw new ApiError(403, "Ton adresse email Google n'est pas vérifiée");
  }

  const email = payload.email.trim().toLowerCase();
  const googleId = payload.sub;

  let [user] = await db.select().from(users).where(eq(users.googleId, googleId));

  if (!user) {
    [user] = await db.select().from(users).where(eq(users.email, email));

    if (user) {
      // Un compte existant sous cette adresse, mais créé par email/mot de
      // passe : la connexion Google est réservée aux gestionnaires (choix
      // produit), donc un compte locataire/propriétaire portant la même
      // adresse ne doit surtout pas se retrouver connecté à la place de son
      // titulaire réel via ce raccourci.
      if (user.role !== "MANAGER") {
        throw new ApiError(
          403,
          "La connexion avec Google est réservée aux comptes gestionnaire",
          "GOOGLE_LOGIN_WRONG_ROLE"
        );
      }

      const updates: Partial<typeof users.$inferInsert> = { googleId };
      // Google vient de prouver la possession de cette adresse : si
      // l'inscription email/mot de passe d'origine n'avait jamais été
      // confirmée, cette preuve équivalente lève le même blocage que
      // verifyEmail (EMAIL_NOT_VERIFIED), au lieu de laisser ce compte
      // bloqué malgré une identité désormais vérifiée.
      if (!user.emailVerifiedAt) {
        updates.emailVerifiedAt = new Date();
      }

      [user] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();
    } else {
      // Nouveau compte gestionnaire, même point de départ que
      // registerManager (essai STARTER 15 jours) : l'email est déjà vérifié
      // par Google, donc pas de double confirmation à envoyer. passwordHash
      // reste NOT NULL (voir schema.ts::googleId) : on y stocke le hash d'une
      // valeur aléatoire qu'aucun mot de passe ne peut atteindre, pour que
      // login() par mot de passe échoue naturellement sur ce compte.
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      const trialEndsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 jours d'essai

      [user] = await db
        .insert(users)
        .values({
          email,
          passwordHash,
          googleId,
          hasPassword: false,
          role: "MANAGER",
          subscriptionStatus: "TRIAL",
          subscriptionPlan: "STARTER",
          trialEndsAt,
          emailVerifiedAt: new Date(),
        })
        .returning();
    }
  }

  const token = signToken({ userId: user.id, role: user.role as "MANAGER", tokenVersion: user.tokenVersion });
  const subscription = computeSubscriptionInfo(user);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      currency: user.currency ?? "EUR",
      hasPassword: user.hasPassword,
      tenantId: null,
      tenantName: null,
      ownerId: null,
      ownerName: null,
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

  const token = signToken({ userId: updated.id, role: "MANAGER", tokenVersion: updated.tokenVersion });
  const subscription = computeSubscriptionInfo(updated);

  res.json({
    token,
    user: {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      currency: updated.currency ?? "EUR",
      hasPassword: updated.hasPassword,
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
  const user = await chargerCompteCourant(req);

  let tenant: typeof tenants.$inferSelect | undefined;
  if (user.role === "TENANT") {
    [tenant] = await db.select().from(tenants).where(eq(tenants.userId, user.id));
  }

  let owner: typeof owners.$inferSelect | undefined;
  if (user.role === "OWNER") {
    [owner] = await db.select().from(owners).where(eq(owners.userId, user.id));
  }

  const subscription = computeSubscriptionInfo(user);

  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    currency: user.currency ?? "EUR",
    hasPassword: user.hasPassword,
    tenant: tenant ?? null,
    owner: owner ?? null,
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
    // hasPassword: true — y compris pour un compte Google-only (googleId non
    // nul) qui vient, via ce flux, de se définir un vrai mot de passe pour la
    // première fois : deleteMyAccount doit désormais lui proposer la
    // confirmation par mot de passe plutôt que par reconnexion Google.
    .set({
      passwordHash,
      hasPassword: true,
      resetPasswordTokenHash: null,
      resetPasswordExpiresAt: null,
      // Changer son mot de passe doit couper les accès en cours, sinon le
      // geste est vide de sens : quelqu'un qui détenait déjà un jeton le
      // gardait valable une semaine, précisément dans la situation où la
      // victime croit avoir repris la main (voir users.tokenVersion).
      tokenVersion: user.tokenVersion + 1,
    })
    .where(eq(users.id, user.id));

  res.json({
    message: "Mot de passe mis à jour avec succès. Les sessions ouvertes sur vos autres appareils ont été fermées.",
  });
});

/** Mise à jour de la devise préférée de l'utilisateur. */
export const updateCurrency = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const currencySchema = z.object({
    currency: z.string().min(1).max(10),
  });
  const { currency } = currencySchema.parse(req.body);

  // Le compte est chargé AVANT l'écriture : sans cela, l'UPDATE ne touchait
  // aucune ligne pour un jeton dont le compte a été supprimé, et la lecture
  // de `updated.currency` sur `undefined` transformait ce cas prévisible en
  // erreur 500 (voir chargerCompteCourant).
  await chargerCompteCourant(req);

  const [updated] = await db
    .update(users)
    .set({ currency })
    .where(eq(users.id, req.user.userId))
    .returning();

  res.json({ success: true, currency: updated.currency });
});

/**
 * Ferme toutes les sessions du compte, y compris celle qui en fait la demande.
 *
 * C'est le seul recours quand on soupçonne qu'un jeton circule — ordinateur
 * partagé, téléphone perdu, session oubliée quelque part. Incrémenter le
 * numéro de version suffit : tous les jetons émis jusque-là cessent d'être
 * acceptés à la requête suivante (voir middleware/auth.ts).
 *
 * L'appareil qui formule la demande est déconnecté comme les autres. C'est
 * voulu : « partout » sans exception est une promesse vérifiable, alors
 * qu'épargner la session courante obligerait à réémettre un jeton et à
 * expliquer une exception.
 */
export const logoutAllDevices = asyncHandler(async (req: Request, res: Response) => {
  const user = await chargerCompteCourant(req);

  await db
    .update(users)
    .set({ tokenVersion: user.tokenVersion + 1 })
    .where(eq(users.id, user.id));

  res.json({
    success: true,
    message: "Toutes vos sessions ont été fermées, y compris celle-ci. Veuillez vous reconnecter.",
  });
});

const deleteAccountSchema = z.object({
  // L'un ou l'autre selon le type de compte (voir hasPassword sur le schéma
  // users) : un compte email/mot de passe envoie `password`, un compte créé
  // uniquement via "Se connecter avec Google" (qui n'a jamais eu de vrai mot
  // de passe à ressaisir) envoie `googleCredential`, un jeton d'identité
  // Google fraîchement obtenu. On ne peut pas savoir laquelle des deux
  // s'applique avant d'avoir chargé l'utilisateur, donc les deux champs
  // restent optionnels ici et la présence requise est vérifiée plus bas.
  password: z.string().min(1).optional(),
  googleCredential: z.string().min(1).optional(),
});

/**
 * Suppression définitive et immédiate du compte gestionnaire, à sa propre
 * demande (audit sept. 2026 : la politique de confidentialité promet un
 * droit à l'effacement, jusqu'ici non implémenté — voir PolitiqueConfidentialitePage.tsx §8).
 *
 * Portée (choix explicite du gestionnaire) : TOUT ce qui appartient à
 * l'agence — biens, locataires, propriétaires, contrats, factures,
 * signalements, annonces (+ leurs demandes), états des lieux, messages,
 * journal d'activité, paramètres d'agence, historique des abonnements SaaS —
 * est supprimé sans anonymisation ni conservation, y compris les données
 * comptables : aucune obligation légale de conservation ne s'applique à
 * cette plateforme pour le compte de sa propre agence.
 *
 * Les comptes de connexion "portail" d'un locataire/propriétaire (users liés
 * via tenants.userId / owners.userId) ne sont volontairement PAS supprimés :
 * ce sont des identités qui appartiennent à ces personnes, pas à l'agence qui
 * les gérait — seule la fiche locataire/propriétaire de CETTE agence disparaît.
 *
 * Confirmation par ressaisie du mot de passe actuel : une action irréversible
 * ne doit pas se contenter d'une simple confirmation textuelle. L'utilisateur
 * est déjà authentifié par JWT ; contrairement à login(), il n'y a ici aucune
 * énumération de compte à craindre, donc pas besoin du hachage à temps
 * constant utilisé là-bas.
 *
 * Cas particulier des comptes créés uniquement via "Se connecter avec
 * Google" (hasPassword = false) : ils n'ont jamais eu de vrai mot de passe
 * (passwordHash y contient un hash bcrypt d'une valeur aléatoire
 * inatteignable, voir loginWithGoogle), donc bcrypt.compare y échouerait
 * TOUJOURS, quel que soit le mot de passe saisi — un gestionnaire dans ce cas
 * ne pourrait jamais supprimer son propre compte. On exige à la place une
 * reconnexion Google fraîche (même vérification que loginWithGoogle), preuve
 * d'identité équivalente au mot de passe pour les autres comptes.
 */
export const deleteMyAccount = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || req.user.role !== "MANAGER") throw new ApiError(403, "Réservé aux gestionnaires");
  const body = deleteAccountSchema.parse(req.body);

  const [user] = await db.select().from(users).where(eq(users.id, req.user.userId));
  if (!user) throw new ApiError(404, "Utilisateur introuvable");

  if (user.hasPassword) {
    if (!body.password) throw new ApiError(400, "Mot de passe requis");
    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) throw new ApiError(401, "Mot de passe incorrect");
  } else {
    if (!env.googleClientId) {
      throw new ApiError(503, "La connexion avec Google n'est pas configurée sur ce serveur");
    }
    if (!body.googleCredential) throw new ApiError(400, "Confirmation Google requise");

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: body.googleCredential,
        audience: env.googleClientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new ApiError(401, "Jeton Google invalide ou expiré");
    }

    // payload.sub doit correspondre au googleId DÉJÀ lié à ce compte (et pas
    // seulement être un jeton Google valide pour n'importe quel compte) —
    // sinon quiconque possédant un compte Google pourrait confirmer la
    // suppression du compte d'un autre gestionnaire Google-only.
    if (!payload || !payload.email_verified || payload.sub !== user.googleId) {
      throw new ApiError(401, "Jeton Google invalide");
    }
  }

  // Récupère tout ce qu'il faut nettoyer sur Supabase Storage AVANT de
  // supprimer les lignes qui en gardent la référence (chemin ou URL) — une
  // fois ces lignes supprimées, la référence serait perdue.
  const [managerProperties, managerListings, managerTenants, managerContracts, managerIssues] = await Promise.all([
    db.select({ imageUrl: properties.imageUrl }).from(properties).where(eq(properties.managerId, user.id)),
    db.select({ imageUrl: listings.imageUrl }).from(listings).where(eq(listings.managerId, user.id)),
    db.select({ idDocument: tenants.idDocument }).from(tenants).where(eq(tenants.managerId, user.id)),
    db
      .select({ scannedContractUrl: contracts.scannedContractUrl })
      .from(contracts)
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(eq(properties.managerId, user.id)),
    db
      .select({ photoUrl: issueReports.photoUrl, additionalPhotos: issueReports.additionalPhotos })
      .from(issueReports)
      .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(eq(properties.managerId, user.id)),
  ]);

  await db.transaction(async (tx: Transaction) => {
    // contracts.propertyId / contracts.tenantId n'ont PAS de ON DELETE
    // CASCADE (voir schema.ts) : supprimer un bien ou un locataire qui porte
    // encore un contrat échouerait (violation de clé étrangère). Ces
    // contrats — et tout ce qui les référence sans cascade (invoices,
    // issueReports) — doivent donc être supprimés explicitement ici, avant
    // de s'appuyer sur les CASCADE existants pour le reste en supprimant
    // simplement la ligne `users`.
    const propertyRows = await tx.select({ id: properties.id }).from(properties).where(eq(properties.managerId, user.id));
    const tenantRows = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.managerId, user.id));
    const propertyIds = propertyRows.map((p: { id: string }) => p.id);
    const tenantIds = tenantRows.map((t: { id: string }) => t.id);

    const contractConditions = [];
    if (propertyIds.length > 0) contractConditions.push(inArray(contracts.propertyId, propertyIds));
    if (tenantIds.length > 0) contractConditions.push(inArray(contracts.tenantId, tenantIds));

    if (contractConditions.length > 0) {
      const contractRows = await tx.select({ id: contracts.id }).from(contracts).where(or(...contractConditions));
      const contractIds = contractRows.map((c: { id: string }) => c.id);

      if (contractIds.length > 0) {
        await tx.delete(invoices).where(inArray(invoices.contractId, contractIds));
        await tx.delete(issueReports).where(inArray(issueReports.contractId, contractIds));
        await tx.delete(contracts).where(inArray(contracts.id, contractIds));
      }
    }

    // Le reste (biens, locataires, propriétaires, annonces + leurs demandes,
    // états des lieux, messages, journal d'activité, paramètres d'agence,
    // historique des abonnements SaaS) est nettoyé par les contraintes
    // ON DELETE CASCADE déjà déclarées sur users.id (voir schema.ts) : il
    // suffit de supprimer la ligne `users` elle-même.
    await tx.delete(users).where(eq(users.id, user.id));
  });

  // Nettoyage Supabase Storage best-effort, APRÈS le commit : voir le
  // commentaire de deleteStorageObjectBestEffort — un échec ici ne doit
  // jamais remettre en cause une suppression de compte déjà actée en base.
  const storageCleanupTargets: Array<string | null | undefined> = [
    ...managerProperties.map((p) => p.imageUrl),
    ...managerListings.map((l) => l.imageUrl),
    ...managerTenants.map((t) => t.idDocument),
    ...managerContracts.map((c) => c.scannedContractUrl),
    ...managerIssues.flatMap((i) => {
      const extras: string[] = [];
      if (i.additionalPhotos) {
        try {
          extras.push(...(JSON.parse(i.additionalPhotos) as string[]));
        } catch {
          // Champ illisible : rien à nettoyer de plus fiable que d'ignorer.
        }
      }
      return [i.photoUrl, ...extras];
    }),
  ];
  await Promise.allSettled(storageCleanupTargets.map((target) => deleteStorageObjectBestEffort(target)));

  console.log(`[account] Compte gestionnaire supprimé définitivement (id=${user.id})`);

  res.status(204).send();
});
