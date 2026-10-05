import * as Sentry from "@sentry/node";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq, inArray, or, sql } from "drizzle-orm";
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
import { consommerCodeSecours, verifierCodeTotp } from "../services/totp.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { chargerCompteCourant } from "../utils/authorization";
import { clearAuthCookie, setAuthCookie } from "../utils/authCookie";
import { hashToken, RESET_TOKEN_TTL_MS } from "../utils/token";
import { deviseSchema } from "../utils/devises";

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
  collaboratorId?: string | null;
}) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as SignOptions);
}

/**
 * Jeton intermédiaire émis quand le mot de passe est correct mais que le
 * compte exige un second facteur (voir login ci-dessous) : il ne porte QUE
 * l'id du compte dont l'identité reste à prouver — ni rôle, ni tokenVersion,
 * ni aucun des claims de signToken — pour qu'authenticate (middleware/auth.ts)
 * ne puisse jamais le confondre avec une vraie session. 5 minutes : assez pour
 * saisir un code, pas assez pour qu'un jeton intercepté serve longtemps à
 * autre chose qu'à cette seule vérification.
 */
const DUREE_JETON_2FA_EN_ATTENTE = "5m";

function signerJeton2faEnAttente(userId: string): string {
  return jwt.sign({ userId, purpose: "2fa_pending" }, env.jwtSecret, { expiresIn: DUREE_JETON_2FA_EN_ATTENTE });
}

function verifierJeton2faEnAttente(token: string): string {
  let payload: unknown;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new ApiError(401, "Session de connexion expirée. Veuillez vous reconnecter.");
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as Record<string, unknown>).purpose !== "2fa_pending" ||
    typeof (payload as Record<string, unknown>).userId !== "string"
  ) {
    throw new ApiError(401, "Jeton invalide.");
  }
  return (payload as { userId: string }).userId;
}

/**
 * Résout l'identité à porter dans le jeton d'un compte MANAGER : un
 * collaborateur (users.teamOwnerId renseigné, voir team.controller.ts) se
 * voit délivrer un jeton portant l'id du PROPRIÉTAIRE de l'agence — jamais
 * le sien — pour que tout le code existant (déjà scopé sur userId partout)
 * continue de fonctionner sans modification. collaboratorId garde sa
 * véritable identité pour l'attribution et les actions réservées au
 * propriétaire.
 */
function identiteJetonPourManager(user: typeof users.$inferSelect): { userId: string; collaboratorId: string | null } {
  if (user.teamOwnerId) {
    return { userId: user.teamOwnerId, collaboratorId: user.id };
  }
  return { userId: user.id, collaboratorId: null };
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
    // Attendu, comme dans l'autre branche — voir l'explication au moment de
    // créer le compte, plus bas.
    await sendEmail(existing.email, subject, html);
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

  // Cet `await` revient sur une décision antérieure, et la raison mérite
  // d'être écrite.
  //
  // L'envoi avait été détaché pour que la réponse ne dépende pas de la durée
  // SMTP — protection contre l'énumération des comptes par le temps de
  // réponse. Mais sur Vercel, l'exécution peut s'arrêter dès la réponse
  // envoyée : la promesse en vol est alors perdue. Le compte existait, sans
  // email de confirmation, et `login` refuse tout gestionnaire dont
  // `emailVerifiedAt` est nul. Un compte créé puis inutilisable, sans aucune
  // trace — le `console.error` du `.catch()` ne s'exécutait pas non plus.
  //
  // Attendre ici ne rouvre pas la faille d'énumération, parce que les DEUX
  // chemins envoient exactement un email à la même adresse : adresse déjà
  // prise ou libre, le travail réseau est le même, donc le temps de réponse
  // ne distingue plus rien. C'est ce qui différencie cette route de
  // forgotPassword et resendVerification, où une adresse inconnue n'a
  // strictement rien à envoyer — là, l'envoi détaché reste nécessaire, et son
  // risque de perte est acceptable puisque l'utilisateur peut simplement
  // redemander le lien.
  await sendEmail(user.email, subject, html);

  res.status(201).json(REPONSE_INSCRIPTION);
});

/**
 * Termine une connexion déjà entièrement prouvée (mot de passe seul, ou
 * mot de passe + second facteur) : émet le jeton de session et la réponse.
 * Partagée par login() (compte sans 2FA) et verifyTwoFactorLogin() (compte
 * avec 2FA, une fois le code vérifié) pour qu'il n'existe qu'un seul endroit
 * où une session est réellement ouverte.
 */
async function finalizeLogin(user: typeof users.$inferSelect, res: Response) {
  let tenant: typeof tenants.$inferSelect | undefined;
  if (user.role === "TENANT") {
    [tenant] = await db.select().from(tenants).where(eq(tenants.userId, user.id));
  }

  let owner: typeof owners.$inferSelect | undefined;
  if (user.role === "OWNER") {
    [owner] = await db.select().from(owners).where(eq(owners.userId, user.id));
  }

  // Multi-utilisateurs : un collaborateur se voit délivrer un jeton portant
  // l'id du gestionnaire PROPRIÉTAIRE de l'agence (voir
  // identiteJetonPourManager) — la formule/abonnement affichés doivent donc
  // aussi refléter CETTE ligne-là, jamais celle (vide, sans objet) du compte
  // collaborateur lui-même.
  const identite = user.role === "MANAGER" ? identiteJetonPourManager(user) : { userId: user.id, collaboratorId: null };
  const compteFacturation = identite.collaboratorId
    ? (await db.select().from(users).where(eq(users.id, identite.userId)))[0]
    : user;

  const token = signToken({
    userId: identite.userId,
    role: user.role as "MANAGER" | "TENANT" | "ADMIN" | "OWNER",
    tenantId: tenant?.id ?? null,
    ownerId: owner?.id ?? null,
    tokenVersion: user.tokenVersion,
    collaboratorId: identite.collaboratorId,
  });
  setAuthCookie(res, token);

  const subscription = compteFacturation ? computeSubscriptionInfo(compteFacturation) : null;

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
      collaboratorId: identite.collaboratorId,
      subscription,
    },
  });
}

/** Connexion (gestionnaire, locataire, propriétaire...). */
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

  // Mot de passe prouvé, mais pas encore l'identité complète : ce compte a
  // activé la double authentification (voir twoFactor.controller.ts). Aucun
  // jeton de session n'est émis ici — seulement un jeton intermédiaire, sans
  // valeur pour accéder à quoi que ce soit, que verifyTwoFactorLogin échangera
  // contre une vraie session une fois le second facteur vérifié.
  if (user.totpEnabledAt) {
    res.json({ twoFactorRequired: true, pendingToken: signerJeton2faEnAttente(user.id) });
    return;
  }

  await finalizeLogin(user, res);
});

const verifyTwoFactorLoginSchema = z.object({
  pendingToken: z.string().min(1),
  // 6 chiffres pour un code TOTP, 10 caractères hexadécimaux pour un code de
  // secours (voir totp.service.ts) : la longueur seule ne les distingue pas
  // de façon fiable, donc verifyTwoFactorLogin essaie les deux.
  code: z.string().min(6).max(12),
});

/**
 * Deuxième étape de la connexion pour un compte avec 2FA activée : échange le
 * jeton intermédiaire de login() contre une vraie session, après vérification
 * du code TOTP ou, à défaut, d'un code de secours.
 */
export const verifyTwoFactorLogin = asyncHandler(async (req: Request, res: Response) => {
  const body = verifyTwoFactorLoginSchema.parse(req.body);
  const userId = verifierJeton2faEnAttente(body.pendingToken);

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  // totpEnabledAt/totpSecret pourraient avoir été désactivés entre l'émission
  // du jeton intermédiaire et cette vérification (ex. deux onglets) : le
  // jeton seul ne suffit alors plus, il faut se reconnecter proprement.
  if (!user || !user.totpEnabledAt || !user.totpSecret) {
    throw new ApiError(401, "Session de connexion expirée. Veuillez vous reconnecter.");
  }

  const code = body.code.trim();
  const codeTotpValide = await verifierCodeTotp(user.totpSecret, code);

  if (codeTotpValide) {
    await finalizeLogin(user, res);
    return;
  }

  // Repli : un code de secours, pour le cas où le téléphone qui génère les
  // codes TOTP n'est plus disponible. Chaque code ne sert qu'une fois — la
  // liste de hachages restante (sans celui qui vient d'être consommé)
  // remplace l'ancienne.
  const hachesRestants = await consommerCodeSecours(code, user.totpBackupCodesHash);
  if (hachesRestants === null) {
    throw new ApiError(401, "Code invalide ou expiré.");
  }

  await db.update(users).set({ totpBackupCodesHash: JSON.stringify(hachesRestants) }).where(eq(users.id, user.id));
  await finalizeLogin(user, res);
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

  // Un compte avec la 2FA activée ne doit pas pouvoir la contourner en
  // passant par Google plutôt que par le mot de passe — même garde qu'en
  // login() : Google atteste l'adresse email, pas le second facteur propre à
  // ce Service.
  if (user.totpEnabledAt) {
    res.json({ twoFactorRequired: true, pendingToken: signerJeton2faEnAttente(user.id) });
    return;
  }

  // Un collaborateur (voir identiteJetonPourManager) peut lier son compte à
  // Google comme n'importe quel gestionnaire : même résolution qu'à la
  // connexion par mot de passe (login).
  await finalizeLogin(user, res);
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
  setAuthCookie(res, token);
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
      // Un simple console.error ne remonte à rien : Sentry n'instrumente que
      // les erreurs qui traversent errorHandler, pas un .catch() qui les
      // avale ici (même raison que activity.service.ts::logActivity). Sans
      // capture explicite, un SMTP mal configuré ou en panne privait
      // silencieusement TOUT gestionnaire de son email de confirmation, sans
      // que rien ne le signale hors lecture manuelle des journaux serveur.
      console.error("[auth] Échec de l'envoi de l'email de confirmation:", err);
      Sentry.captureException(err, { tags: { source: "auth.controller.resendVerification" } });
    });
  }

  res.json({
    message: "Si un compte non confirmé existe avec cet email, un nouveau lien de confirmation vient de lui être envoyé.",
  });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  // Pour un collaborateur, req.user.userId porte l'id du PROPRIÉTAIRE de
  // l'agence (voir identiteJetonPourManager) : `user` ci-dessous est donc la
  // bonne ligne pour la formule/abonnement (partagés par toute l'agence),
  // mais PAS pour l'identité affichée (email, mot de passe) — celle-ci doit
  // rester la sienne propre.
  const user = await chargerCompteCourant(req);
  const identite = req.user.collaboratorId
    ? ((await db.select().from(users).where(eq(users.id, req.user.collaboratorId)))[0] ?? user)
    : user;

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
    id: identite.id,
    email: identite.email,
    role: identite.role,
    currency: user.currency ?? "EUR",
    hasPassword: identite.hasPassword,
    // `identite` ci-dessus est déjà la ligne du compte RÉELLEMENT connecté
    // (son email/mot de passe propres) — jamais celle du propriétaire de
    // l'agence pour un collaborateur, qui n'a pas nécessairement activé la
    // 2FA lui-même.
    twoFactorEnabled: !!identite.totpEnabledAt,
    tenant: tenant ?? null,
    owner: owner ?? null,
    collaboratorId: req.user.collaboratorId ?? null,
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
      // Voir le commentaire équivalent dans resendVerification ci-dessus.
      console.error("[auth] Échec de l'envoi de l'email de réinitialisation:", err);
      Sentry.captureException(err, { tags: { source: "auth.controller.forgotPassword" } });
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

  // Le cookie éventuellement posé sur CE navigateur référence l'ancienne
  // version du jeton, désormais révoquée par le tokenVersion+1 ci-dessus : le
  // laisser en place ne ferait qu'échouer en 401 à la prochaine requête.
  clearAuthCookie(res);

  res.json({
    message: "Mot de passe mis à jour avec succès. Les sessions ouvertes sur vos autres appareils ont été fermées.",
  });
});

/** Mise à jour de la devise préférée de l'utilisateur. */
export const updateCurrency = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const currencySchema = z.object({
    currency: deviseSchema,
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
  // Multi-utilisateurs : req.user.userId porte l'id du PROPRIÉTAIRE pour un
  // collaborateur (voir identiteJetonPourManager) — révoquer SES sessions à
  // LUI doit toucher sa propre ligne, jamais celle du propriétaire (qui
  // continuerait sinon de travailler pendant que le collaborateur croit
  // avoir fermé ses accès, ou pire : verrouillerait le propriétaire lui-même).
  const idAvoirRevoquer = req.user?.collaboratorId ?? (await chargerCompteCourant(req)).id;

  await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, idAvoirRevoquer));

  clearAuthCookie(res);

  res.json({
    success: true,
    message: "Toutes vos sessions ont été fermées, y compris celle-ci. Veuillez vous reconnecter.",
  });
});

/**
 * Déconnexion d'un seul appareil : contrairement à logoutAllDevices, ne
 * révoque rien (le jeton reste valable ailleurs, ex. l'app mobile qui garde
 * le sien) — elle se contente d'effacer le cookie httpOnly du navigateur
 * appelant, la seule chose qu'un frontend web ne peut plus faire lui-même
 * pour un jeton qu'il ne lit ni ne stocke plus (voir api/client.ts). Aucune
 * authentification requise : un cookie déjà expiré ou absent doit pouvoir
 * être "nettoyé" sans finir en 401.
 */
export const logout = asyncHandler(async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.status(204).send();
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
 * demande — l'exercice du droit à l'effacement (RGPD art. 17) promis par la
 * politique de confidentialité (§8) pour ce rôle-ci. Pour un locataire ou un
 * propriétaire, qui n'ont pas la main sur les données que leur Gestionnaire a
 * saisies à leur sujet, voir anonymiserTenant (tenant.controller.ts) et
 * anonymiserOwner (owner.controller.ts), déclenchées par le Gestionnaire lui-même.
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
  // Multi-utilisateurs : seul le PROPRIÉTAIRE de l'agence peut la supprimer,
  // jamais un collaborateur invité (voir users.teamOwnerId) — sans quoi la
  // confirmation ci-dessous porterait de toute façon sur le mot de passe/
  // compte Google du propriétaire (req.user.userId le désigne, pas le
  // collaborateur), que celui-ci ne connaît pas.
  if (req.user.collaboratorId) {
    throw new ApiError(403, "Seul le gestionnaire propriétaire de l'agence peut supprimer ce compte.");
  }
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

  // Le compte n'existe plus : un cookie encore présent référencerait un
  // userId qu'authenticate ne pourrait plus jamais résoudre.
  clearAuthCookie(res);

  res.status(204).send();
});
