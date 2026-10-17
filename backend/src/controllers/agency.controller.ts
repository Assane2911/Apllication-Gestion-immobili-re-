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

  // Tampon : fonctionnalité Pro (CGU §3), comme le logo. Le reste des réglages d'agence (coordonnées
  // bancaires, mentions légales...) reste accessible à toutes les formules — un gestionnaire Starter doit
  // pouvoir renseigner son IBAN pour encaisser un virement, par exemple. On ne restreint donc que le
  // CHANGEMENT effectif du tampon, jamais le reste du formulaire (envoyé en entier à chaque enregistrement).
  const changeStamp = !!body.stampOrSignatureUrl && body.stampOrSignatureUrl !== (existing?.stampOrSignatureUrl ?? null);
  if (changeStamp) {
    assertPlanAtLeast(await chargerCompteCourant(req), "PRO");
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

/**
 * Logo de l'agence, imprimé sur les quittances. Envoi d'un fichier PNG ou JPEG (2 Mo au plus) : le contenu est
 * vérifié, le fichier part dans le stockage public, et l'ancien logo en est retiré. Marque blanche : formule
 * Professionnel et au-delà, comme le tampon (CGU §3).
 */
export const uploadLogo = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  assertPlanAtLeast(await chargerCompteCourant(req), "PRO");
  if (!req.file) throw new ApiError(400, "Aucun fichier reçu.");
  assertFileContentMatchesDeclaredType(req.file);

  const logoUrl = await uploadPublicFile(req.file, "agency");
  const [existing] = await db.select().from(agencySettings).where(eq(agencySettings.userId, req.user.userId));

  const [saved] = existing
    ? await db
        .update(agencySettings)
        .set({ logoUrl, updatedAt: new Date() })
        .where(eq(agencySettings.userId, req.user.userId))
        .returning()
    : await db.insert(agencySettings).values({ userId: req.user.userId, logoUrl }).returning();

  // Après l'enregistrement : un échec de nettoyage laisse un fichier orphelin, jamais un logo perdu.
  await deleteStorageObjectBestEffort(existing?.logoUrl);
  res.status(201).json(saved);
});

/** Retire le logo : les quittances reviennent à l'en-tête sans image. Toujours permis, quelle que soit la formule. */
export const deleteAgencyLogo = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const [existing] = await db.select().from(agencySettings).where(eq(agencySettings.userId, req.user.userId));
  if (!existing?.logoUrl) return res.status(204).send();

  await db.update(agencySettings).set({ logoUrl: null, updatedAt: new Date() }).where(eq(agencySettings.userId, req.user.userId));
  await deleteStorageObjectBestEffort(existing.logoUrl);
  res.status(204).send();
});
