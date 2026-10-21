import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { agencySettings, tenants } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { bicSchema, ibanSchema } from "../utils/iban";
import { chargerCompteCourant, chargerLocataireDuCompte } from "../utils/authorization";
import { assertPlanAtLeast } from "../middleware/auth";
import { assertFileContentMatchesDeclaredType } from "../middleware/upload";
import { deleteStorageObjectBestEffort, uploadPublicFile } from "../services/storage.service";

export const getAgencySettings = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");

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
  // Ces textes s'impriment sur chaque quittance, bail et mise en demeure : bornés.
  agencyName: z.string().min(1).max(200),
  logoUrl: z.string().max(2000).optional().nullable(),
  siretOrId: z.string().max(100).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().max(254).optional().nullable(),
  legalNotice: z.string().max(5000).optional().nullable(),
  stampOrSignatureUrl: z.string().max(2000).optional().nullable(),
  iban: ibanSchema,
  bic: bicSchema,
  // Relances graduées des impayés (voir services/relances.service.ts) ; absents : inchangés.
  overdueRemindersEnabled: z.boolean().optional(),
  overdueGraceDays: z.coerce.number().int().min(0, "Délai de grâce : 0 à 30 jours").max(30, "Délai de grâce : 0 à 30 jours").optional(),
  overdueIntervalDays: z.coerce.number().int().min(3, "Intervalle entre relances : 3 à 30 jours").max(30, "Intervalle entre relances : 3 à 30 jours").optional(),
  overdueNotifyGuarantors: z.boolean().optional(),
});

/**
 * Réglages dont une modification est tracée au journal d'activité, avec le libellé affiché. Le journal
 * nomme les champs changés sans jamais reproduire leur valeur : un IBAN complet n'a rien à y faire, et seuls
 * ses quatre derniers caractères permettent de reconnaître de quel compte il s'agit.
 */
const REGLAGES_TRACES = [
  ["agencyName", "nom de l'agence"],
  ["siretOrId", "SIRET / identifiant"],
  ["address", "adresse"],
  ["phone", "téléphone"],
  ["email", "email"],
  ["legalNotice", "mentions légales"],
  ["iban", "IBAN"],
  ["bic", "BIC"],
  ["overdueRemindersEnabled", "relances des impayés"],
  ["overdueGraceDays", "délai de grâce des relances"],
  ["overdueIntervalDays", "intervalle des relances"],
  ["overdueNotifyGuarantors", "relances aux garants"],
] as const;

function reglagesModifies(existant: Record<string, unknown> | undefined, body: Record<string, unknown>): string[] {
  const modifies: string[] = [];
  for (const [champ, libelle] of REGLAGES_TRACES) {
    const nouveau = body[champ];
    if (nouveau === undefined) continue;
    const avant = existant?.[champ] ?? null;
    if ((nouveau ?? null) === avant) continue;
    modifies.push(champ === "iban" && typeof nouveau === "string" ? `${libelle} (…${nouveau.slice(-4)})` : libelle);
  }
  return modifies;
}

export const updateAgencySettings = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
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
    throw new ApiError(400, "Logo : envoyez le fichier image depuis les paramètres de l'agence.", "AGENCY_LOGO_FILE_REQUIRED");
  }

  // Même règle pour le tampon (POST /stamp, formule Pro — CGU §3) : le reste des réglages d'agence
  // (coordonnées bancaires, mentions légales...) reste accessible à toutes les formules, un gestionnaire
  // Starter doit pouvoir renseigner son IBAN. Seule une VALEUR DIFFÉRENTE du tampon actuel est refusée.
  if (body.stampOrSignatureUrl && body.stampOrSignatureUrl !== (existing?.stampOrSignatureUrl ?? null)) {
    throw new ApiError(400, "Tampon : envoyez le fichier image depuis les paramètres de l'agence.", "AGENCY_STAMP_FILE_REQUIRED");
  }

  if (!existing) {
    const [created] = await db
      .insert(agencySettings)
      .values({
        userId: req.user.userId,
        ...body,
      })
      .returning();
    await tracerReglages(req, created, reglagesModifies(undefined, body));
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

  await tracerReglages(req, updated, reglagesModifies(existing, body));
  res.json(updated);
});

/** Une entrée de journal par enregistrement qui change vraiment quelque chose (le formulaire renvoie tout à chaque fois). */
async function tracerReglages(req: Request, reglages: { id: string; agencyName: string }, modifies: string[]) {
  if (modifies.length === 0) return;
  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "agency.update",
    entityType: "agency",
    entityId: reglages.id,
    entityLabel: reglages.agencyName,
    details: `Réglages de l'agence modifiés : ${modifies.join(", ")}.`,
  });
}

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
  if (!tenant) throw new ApiError(404, "Locataire introuvable", "TENANT_NOT_FOUND");

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
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  assertPlanAtLeast(await chargerCompteCourant(req), "PRO");
  if (!req.file) throw new ApiError(400, "Aucun fichier reçu.", "NO_FILE_RECEIVED");
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
  await tracerImage(req, saved, champ, "upload");
  res.status(201).json(saved);
}

const LIBELLE_IMAGE: Record<ImageAgence, string> = { logoUrl: "logo", stampOrSignatureUrl: "tampon" };

async function tracerImage(req: Request, reglages: { id: string; agencyName: string }, champ: ImageAgence, geste: "upload" | "delete") {
  await logActivity({
    req,
    managerId: req.user!.userId,
    action: `agency.image_${geste}`,
    entityType: "agency",
    entityId: reglages.id,
    entityLabel: reglages.agencyName,
    details: `${geste === "upload" ? "Envoi du" : "Retrait du"} ${LIBELLE_IMAGE[champ]} de l'agence.`,
  });
}

/** Retire une image d'agence : les quittances reviennent sans elle. Toujours permis, quelle que soit la formule. */
async function retirerImageAgence(req: Request, res: Response, champ: ImageAgence) {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const [existing] = await db.select().from(agencySettings).where(eq(agencySettings.userId, req.user.userId));
  if (!existing?.[champ]) return res.status(204).send();

  await db.update(agencySettings).set({ [champ]: null, updatedAt: new Date() }).where(eq(agencySettings.userId, req.user.userId));
  await deleteStorageObjectBestEffort(existing[champ]);
  await tracerImage(req, existing, champ, "delete");
  res.status(204).send();
}

export const uploadLogo = asyncHandler((req: Request, res: Response) => envoyerImageAgence(req, res, "logoUrl"));
export const deleteAgencyLogo = asyncHandler((req: Request, res: Response) => retirerImageAgence(req, res, "logoUrl"));
export const uploadStamp = asyncHandler((req: Request, res: Response) => envoyerImageAgence(req, res, "stampOrSignatureUrl"));
export const deleteAgencyStamp = asyncHandler((req: Request, res: Response) => retirerImageAgence(req, res, "stampOrSignatureUrl"));
