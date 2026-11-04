import { and, eq, isNull } from "drizzle-orm";
import { Request, Response } from "express";
import { env } from "../config/env";
import { db } from "../db/client";
import { users } from "../db/schema";
import { planAuMoins } from "../middleware/auth";
import { lireUsageWhatsapp } from "../services/whatsappUsage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

/** Nombre de mois renvoyés, le mois courant compris. */
const NB_MOIS = 6;

/**
 * Consommation WhatsApp d'une agence (messages que l'application a envoyés pour elle), par mois et par type, avec un coût
 * ESTIMÉ au tarif d'un message « utility ». C'est un décompte de l'application, pas la facture de Meta : voir
 * services/whatsappUsage.service.ts. Réservé à l'administrateur (le coût est celui de la plateforme, pas de l'agence).
 */
export const getManagerWhatsappUsage = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "MANAGER"), isNull(users.teamOwnerId)));
  if (!user) throw new ApiError(404, "Gestionnaire introuvable", "MANAGER_NOT_FOUND");

  const mois = await lireUsageWhatsapp(user.id, NB_MOIS);
  res.json({
    // La formule de l'agence donne-t-elle droit à WhatsApp (Pro et au-dessus, essai compris) ? Un compteur à zéro n'a pas le même sens sinon.
    inclus: planAuMoins(user, "PRO"),
    // Le service est-il branché côté plateforme (jeton et numéro Meta) ? Sinon les envois sont simulés et ne comptent pas.
    configure: Boolean(env.whatsapp.accessToken && env.whatsapp.phoneNumberId),
    tarifUsd: env.whatsapp.coutMessageUtilityUsd,
    mois,
  });
});
