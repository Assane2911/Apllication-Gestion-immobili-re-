import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/client";
import { users } from "../db/schema";
import { logActivity } from "../services/activity.service";
import {
  genererCodesSecours,
  genererOtpauthUrl,
  genererQrCodeDataUrl,
  genererSecretTotp,
  verifierCodeTotp,
} from "../services/totp.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

const googleClient = new OAuth2Client();

/**
 * Charge la ligne `users` du compte RÉELLEMENT connecté — son propre
 * email/mot de passe — et non celle que `req.user.userId` désigne.
 *
 * Pour un collaborateur (voir identiteJetonPourManager, auth.controller.ts),
 * `req.user.userId` porte l'id du PROPRIÉTAIRE de l'agence (abonnement/
 * formule partagés), jamais le sien. La 2FA protège un LOGIN, donc le secret
 * TOTP, les codes de secours et leur activation doivent être rattachés au
 * compte qui saisit réellement l'email et le mot de passe — sans cette
 * distinction, un collaborateur activerait ou désactiverait la 2FA du
 * propriétaire de l'agence à sa place.
 */
async function chargerCompteLoginCourant(req: Request) {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const id = req.user.collaboratorId ?? req.user.userId;
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) throw new ApiError(401, "Ce compte n'existe plus. Veuillez vous reconnecter.");
  return user;
}

/**
 * Démarre l'enrôlement : génère un nouveau secret TOTP et le stocke en
 * attente de confirmation (totpEnabledAt reste NULL — voir schema.ts). Un
 * appel répété avant confirmation remplace simplement le secret précédent :
 * aucun risque, puisque rien n'est encore exigé à la connexion.
 */
export const setupTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const user = await chargerCompteLoginCourant(req);
  if (user.totpEnabledAt) {
    throw new ApiError(409, "La double authentification est déjà activée sur ce compte. Désactivez-la avant d'en reconfigurer une.");
  }

  const secret = genererSecretTotp();
  await db.update(users).set({ totpSecret: secret }).where(eq(users.id, user.id));

  const otpauthUrl = genererOtpauthUrl(user.email, secret);
  const qrCodeDataUrl = await genererQrCodeDataUrl(otpauthUrl);

  res.json({ secret, otpauthUrl, qrCodeDataUrl });
});

const confirmTwoFactorSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Le code doit contenir 6 chiffres"),
});

/**
 * Confirme l'enrôlement : prouve que le secret généré par `setupTwoFactor` a
 * bien été scanné par une application d'authentification, en exigeant le
 * code qu'elle affiche. C'est CETTE étape, et elle seule, qui active
 * réellement la 2FA (totpEnabledAt) — avant, aucune connexion n'est bloquée.
 *
 * Les codes de secours ne sont générés qu'ici, et renvoyés EN CLAIR une seule
 * fois : seuls leurs hachages bcrypt sont conservés (comme un mot de passe),
 * donc ce message est la seule occasion de les noter.
 */
export const confirmTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const body = confirmTwoFactorSchema.parse(req.body);
  const user = await chargerCompteLoginCourant(req);

  if (user.totpEnabledAt) {
    throw new ApiError(409, "La double authentification est déjà activée sur ce compte.");
  }
  if (!user.totpSecret) {
    throw new ApiError(400, "Aucun enrôlement en cours : lancez d'abord la configuration.");
  }

  const valide = await verifierCodeTotp(user.totpSecret, body.code);
  if (!valide) throw new ApiError(401, "Code invalide. Vérifiez l'heure de votre téléphone et réessayez.");

  const { codes, hashes } = await genererCodesSecours();

  await db
    .update(users)
    .set({ totpEnabledAt: new Date(), totpBackupCodesHash: JSON.stringify(hashes) })
    .where(eq(users.id, user.id));

  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "account.2fa_enable",
    entityType: "account",
    entityId: user.id,
    entityLabel: user.email,
    details: "Double authentification activée sur ce compte.",
  });

  res.json({ success: true, backupCodes: codes });
});

const disableTwoFactorSchema = z.object({
  // Même alternative que deleteMyAccount (auth.controller.ts), et pour la
  // même raison : un compte créé uniquement via "Se connecter avec Google"
  // n'a jamais eu de vrai mot de passe à ressaisir (voir hasPassword).
  password: z.string().min(1).optional(),
  googleCredential: z.string().min(1).optional(),
});

/**
 * Désactive la 2FA — ressaisie du mot de passe (ou reconnexion Google fraîche
 * pour un compte Google-only) exigée avant un geste qui, sinon, suffirait à
 * annuler toute la protection avec un jeton déjà en poche.
 */
export const disableTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const body = disableTwoFactorSchema.parse(req.body);
  const user = await chargerCompteLoginCourant(req);

  if (!user.totpEnabledAt) {
    throw new ApiError(409, "La double authentification n'est pas activée sur ce compte.");
  }

  if (user.hasPassword) {
    if (!body.password) throw new ApiError(400, "Mot de passe requis");
    const valide = await bcrypt.compare(body.password, user.passwordHash);
    if (!valide) throw new ApiError(401, "Mot de passe incorrect");
  } else {
    if (!env.googleClientId) {
      throw new ApiError(503, "La connexion avec Google n'est pas configurée sur ce serveur");
    }
    if (!body.googleCredential) throw new ApiError(400, "Confirmation Google requise");

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: body.googleCredential, audience: env.googleClientId });
      payload = ticket.getPayload();
    } catch {
      throw new ApiError(401, "Jeton Google invalide ou expiré");
    }
    if (!payload || !payload.email_verified || payload.sub !== user.googleId) {
      throw new ApiError(401, "Jeton Google invalide");
    }
  }

  await db
    .update(users)
    .set({ totpSecret: null, totpEnabledAt: null, totpBackupCodesHash: null })
    .where(eq(users.id, user.id));

  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "account.2fa_disable",
    entityType: "account",
    entityId: user.id,
    entityLabel: user.email,
    details: "Double authentification désactivée sur ce compte.",
  });

  res.json({ success: true, message: "Double authentification désactivée." });
});

/**
 * Régénère les codes de secours (ex. presque tous consommés). Exige le code
 * TOTP courant — pas de ressaisie du mot de passe : l'application
 * d'authentification EST déjà le facteur qui prouve l'identité ici, et c'est
 * justement la perte des codes de secours (pas du téléphone) que ce geste
 * couvre.
 */
const regenerateBackupCodesSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Le code doit contenir 6 chiffres"),
});

export const regenerateBackupCodes = asyncHandler(async (req: Request, res: Response) => {
  const body = regenerateBackupCodesSchema.parse(req.body);
  const user = await chargerCompteLoginCourant(req);

  if (!user.totpEnabledAt || !user.totpSecret) {
    throw new ApiError(409, "La double authentification n'est pas activée sur ce compte.");
  }

  const valide = await verifierCodeTotp(user.totpSecret, body.code);
  if (!valide) throw new ApiError(401, "Code invalide.");

  const { codes, hashes } = await genererCodesSecours();
  await db.update(users).set({ totpBackupCodesHash: JSON.stringify(hashes) }).where(eq(users.id, user.id));

  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "account.2fa_backup_codes_regenerate",
    entityType: "account",
    entityId: user.id,
    entityLabel: user.email,
    details: "Codes de secours de la double authentification régénérés (les précédents sont invalidés).",
  });

  res.json({ success: true, backupCodes: codes });
});
