import { and, count, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { env } from "../config/env";
import { db } from "../db/client";
import { users } from "../db/schema";
import { obtenirOuCreerCodeParrainage, REFERRAL_REWARD_DAYS } from "../services/referral.service";
import { asyncHandler } from "../utils/asyncHandler";
import { chargerCompteCourant } from "../utils/authorization";

/**
 * Code de parrainage du gestionnaire connecté (généré au premier appel, voir
 * referral.service.ts), son lien à partager, et le nombre de filleuls déjà
 * confirmés. Accessible dès l'essai — c'est justement pendant l'essai qu'un
 * parrainage réussi prolonge le plus utilement l'accès.
 */
export const getMyReferral = asyncHandler(async (req: Request, res: Response) => {
  const compte = await chargerCompteCourant(req);
  const referralCode = await obtenirOuCreerCodeParrainage(compte.id);

  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.referredByUserId, compte.id), eq(users.role, "MANAGER")));

  res.json({
    referralCode,
    referralUrl: `${env.frontendUrl}/inscription?ref=${referralCode}`,
    rewardDays: REFERRAL_REWARD_DAYS,
    totalReferred: total,
  });
});
