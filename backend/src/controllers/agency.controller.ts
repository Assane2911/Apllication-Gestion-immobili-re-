import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { agencySettings, tenants } from "../db/schema";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { bicSchema, ibanSchema } from "../utils/iban";
import { chargerCompteCourant, chargerLocataireDuCompte } from "../utils/authorization";
import { assertPlanAtLeast } from "../middleware/auth";
import { assertFileContentMatchesDeclaredType } from "../middleware/upload";
import { deleteStorageObjectBestEffort, uploadPublicFile } from "../services/storage.service";

export const getAgencySettings = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");

  let [settings] = await db
    .select()
    .from(agencySettings)
    .where(eq(agencySettings.userId, req.user.userId));

  if (!settings) {
    [settings] = await db
      .insert(agencySettings)
      // Seul le nom a une valeur de repli. Les coordonnées et mentions légales restent VIDES tant que
      // le gestionnaire ne les a pas saisies : elles s'impriment sur les quittances, les baux et les
      // mises en demeure, et des valeurs d'exemple (faux téléphone, faux email, fausse carte
      // professionnelle) y apparaissaient pour qui avait seulement ouvert la page.
      .values({
        userId: req.user.userId,
        agencyName: "Agence Immobilière Privée",
      })
      .returning();
  }

  res.json(settings);
});

const updateAgencySettingsSchema = z.object({
  agencyName: z.string().min(1),
  logoUrl: z.string().optional().nullable(),
  siretOrId: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  legalNotice: z.string().optional().nullable(),
  stampOrSignatureUrl: z.string().optional().nullable(),
  iban: ibanSchema,
  bic: bicSchema,
  // Relances graduées des impayés (voir services/relances.service.ts) ; absents : inchangés.
  overdueRemindersEnabled: z.boolean().optional(),
  overdueGraceDays: z.coerce.number().int().min(0, "Délai de grâce : 0 à 30 jours").max(30, "Délai de grâce : 0 à 30 jours").optional(),
  overdueIntervalDays: z.coerce.number().int().min(3, "Intervalle entre relances : 3 à 30 jours").max(30, "Intervalle entre relances : 3 à 30 jours").optional(),
  overdueNotifyGuarantors: z.boolean().optional(),
});

export const updateAgencySettings = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const body = updateAgencySettingsSchema.parse(req.body);

  const [existing] = await db
    .select()
    .from(agencySettings)
    .where(eq(agencySettings.userId, req.user.userId));

  // Le logo ne s'enregistre que par l'envoi d'un fichier (POST /logo) : une adresse libre ferait afficher
  // sur les documents, et télécharger par le serveur, n'importe quelle image d'un site tiers. Le formulaire
  // renvoie le logo actuel tel quel à chaque enregistrement : seule une VALEUR DIFFÉRENTE est refusée
  // (le retirer, en envoyant null, reste permis).
  if (body.logoUrl && body.logoUrl !== (existing?.logoUrl ?? null)) {
    throw new ApiError(400, "Logo : envoyez le fichier image depuis les paramètres de l'agence.");
  }

  // Même règle pour le tampon (POST /stamp, formule Pro — CGU §3) : le reste des réglages d'agence
  // (coordonnées bancaires, mentions légales...) reste accessible à toutes les formules, un gestionnaire
  // Starter doit pouvoir renseigner son IBAN. Seule une VALEUR DIFFÉRENTE du tampon actuel est refusée.
  if (body.stampOrSignatureUrl && body.stampOrSignatureUrl !== (existing?.stampOrSignatureUrl ?? null)) {
    throw new ApiError(400, "Tampon : envoyez le fichier image depuis les paramètres de l'agence.");
  }

  if (!existing) {
    const [created] = await db
      .insert(agencySettings)
      .values({
        userId: req.user.userId,
        ...body,
      })
      .returning();
    return res.json(created);
  }

  const [updated] = await db
    .update(agencySettings)
    .set({
      ...body,
      updatedAt: new Date(),
    })
    .where(eq(agencySettings.userId, req.user.userId))
    .returning();

  res.json(updated);
});

/**
 * Coordonnées bancaires de SON agence, pour le locataire qui choisit
 * "Virement bancaire" (voir TenantInvoicesPage.tsx). Volontairement un
 * sous-ensemble minimal des paramètres d'agence — pas de logo, de mentions
 * légales ni de tampon — puisqu'un locataire n'a besoin que de savoir où
 * envoyer son virement, pas d'accéder aux réglages de l'agence.
 */
export const getAgencyBankInfoForTenant = asyncHandler(async (req: Request, res: Response) => {

  const [tenant] = await db
    .select({ managerId: tenants.managerId })
    .from(tenants)
    .where(eq(tenants.id, (await chargerLocataireDuCompte(req)).id));
  if (!tenant) throw new ApiError(404, "Locataire introuvable");

  const [settings] = await db
    .select({ agencyName: agencySettings.agencyName, iban: agencySettings.iban, bic: agencySettings.bic })
    .from(agencySettings)
    .where(eq(agencySettings.userId, tenant.managerId));

  res.json({
    agencyName: settings?.agencyName ?? null,
    iban: settings?.iban ?? null,
    bic: settings?.bic ?? null,
  });
});

type ImageAgence = "logoUrl" | "stampOrSignatureUrl";

/**
 * Envoi d'une image d'agence (logo ou tampon), imprimée sur les quittances. PNG ou JPEG (2 Mo au plus) : le
 * contenu est vérifié, le fichier part dans le stockage public, et l'ancienne image en est retirée. Marque
 * blanche : formule Professionnel et au-delà (CGU §3).
 */
async function envoyerImageAgence(req: Request, res: Response, champ: ImageAgence) {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  assertPlanAtLeast(await chargerCompteCourant(req), "PRO");
  if (!req.file) throw new ApiError(400, "Aucun fichier reçu.");
  assertFileContentMatchesDeclaredType(req.file);

  const url = await uploadPublicFile(req.file, "agency");
  const [existing] = await db.select().from(agencySettings).where(eq(agencySettings.userId, req.user.userId));

  const [saved] = existing
    ? await db
        .update(agencySettings)
        .set({ [champ]: url, updatedAt: new Date() })
        .where(eq(agencySettings.userId, req.user.userId))
        .returning()
    : await db.insert(agencySettings).values({ userId: req.user.userId, [champ]: url }).returning();

  // Après l'enregistrement : un échec de nettoyage laisse un fichier orphelin, jamais une image perdue.
  await deleteStorageObjectBestEffort(existing?.[champ]);
  res.status(201).json(saved);
}

/** Retire une image d'agence : les quittances reviennent sans elle. Toujours permis, quelle que soit la formule. */
async function retirerImageAgence(req: Request, res: Response, champ: ImageAgence) {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const [existing] = await db.select().from(agencySettings).where(eq(agencySettings.userId, req.user.userId));
  if (!existing?.[champ]) return res.status(204).send();

  await db.update(agencySettings).set({ [champ]: null, updatedAt: new Date() }).where(eq(agencySettings.userId, req.user.userId));
  await deleteStorageObjectBestEffort(existing[champ]);
  res.status(204).send();
}

export const uploadLogo = asyncHandler((req: Request, res: Response) => envoyerImageAgence(req, res, "logoUrl"));
export const deleteAgencyLogo = asyncHandler((req: Request, res: Response) => retirerImageAgence(req, res, "logoUrl"));
export const uploadStamp = asyncHandler((req: Request, res: Response) => envoyerImageAgence(req, res, "stampOrSignatureUrl"));
export const deleteAgencyStamp = asyncHandler((req: Request, res: Response) => retirerImageAgence(req, res, "stampOrSignatureUrl"));
