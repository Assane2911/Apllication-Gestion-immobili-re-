import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { platformSettings } from "../db/schema";
import { logAdminAction } from "../services/adminAudit.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { bicSchema, ibanSchema } from "../utils/iban";

/**
 * Identifiant fixe de l'unique ligne de cette table — voir schema.ts. Un
 * gestionnaire peut avoir SA propre agence (agencySettings, une ligne par
 * userId) ; la plateforme, elle, n'a qu'un seul compte bancaire, celui de son
 * exploitant, quel que soit le nombre de gestionnaires qui y règlent leur
 * abonnement.
 */
const PLATFORM_SETTINGS_ID = "platform";

export const getPlatformSettings = asyncHandler(async (_req: Request, res: Response) => {
  let [settings] = await db.select().from(platformSettings).where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));

  if (!settings) {
    [settings] = await db.insert(platformSettings).values({ id: PLATFORM_SETTINGS_ID }).returning();
  }

  res.json(settings);
});

const updatePlatformSettingsSchema = z.object({
  iban: ibanSchema,
  bic: bicSchema,
});

// L'IBAN/BIC complet n'est volontairement PAS recopié dans le journal : on y garde la trace du changement
// (qui, quand, quel champ), pas la valeur, pour que le journal ne devienne pas un second endroit où lire des
// coordonnées bancaires. Les quatre derniers caractères de l'IBAN suffisent à reconnaître le compte : c'est
// celui sur lequel toutes les agences virent leur abonnement, un remplacement doit se voir au premier coup d'œil.
function champsModifies(existant: { iban: string | null; bic: string | null } | undefined, body: { iban?: string | null; bic?: string | null }) {
  const modifies: string[] = [];
  if (body.iban !== undefined && (body.iban ?? null) !== (existant?.iban ?? null)) {
    modifies.push(body.iban ? `IBAN (…${body.iban.slice(-4)})` : "IBAN (effacé)");
  }
  if (body.bic !== undefined && (body.bic ?? null) !== (existant?.bic ?? null)) {
    modifies.push(body.bic ? "BIC" : "BIC (effacé)");
  }
  return modifies;
}

const journaliserModification = (req: Request, modifies: string[]) =>
  modifies.length === 0
    ? Promise.resolve()
    : logAdminAction({
        req,
        action: "platform.bank_details.update",
        details: `Coordonnées bancaires de la plateforme modifiées : ${modifies.join(", ")}`,
      });

export const updatePlatformSettings = asyncHandler(async (req: Request, res: Response) => {
  const body = updatePlatformSettingsSchema.parse(req.body);

  const [existing] = await db.select().from(platformSettings).where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));
  const modifies = champsModifies(existing, body);

  if (!existing) {
    const [created] = await db
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID, ...body })
      .returning();
    await journaliserModification(req, modifies);
    return res.json(created);
  }

  const [updated] = await db
    .update(platformSettings)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .returning();

  await journaliserModification(req, modifies);
  res.json(updated);
});

/**
 * Coordonnées bancaires de LA PLATEFORME, pour le gestionnaire qui règle son
 * abonnement SaaS par virement (voir SubscriptionPage.tsx). Volontairement un
 * sous-ensemble minimal — pas de date de création/mise à jour — puisqu'un
 * gestionnaire n'a besoin que de savoir où envoyer son virement, jamais
 * d'accéder aux réglages plateforme eux-mêmes (réservés à l'administrateur).
 */
export const getPlatformBankInfoForManager = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || req.user.role !== "MANAGER") {
    throw new ApiError(403, "Espace réservé aux gestionnaires");
  }

  const [settings] = await db
    .select({ iban: platformSettings.iban, bic: platformSettings.bic })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));

  res.json({
    iban: settings?.iban ?? null,
    bic: settings?.bic ?? null,
  });
});
