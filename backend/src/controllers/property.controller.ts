import { and, desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, owners, properties, tenants, users } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { uploadPublicFile } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertFileContentMatchesDeclaredType } from "../middleware/upload";
import { deleteStorageObjectBestEffort } from "../services/storage.service";
import { assertOwnership, chargerCompteCourant } from "../utils/authorization";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { computeSubscriptionInfo } from "./auth.controller";
import { maxPropertiesForPlan } from "./subscription.controller";

const propertySchema = z.object({
  title: z.string().min(2),
  address: z.string().min(2),
  surface: z.coerce.number().positive(),
  rent: z.coerce.number().positive(),
  status: z.enum(["AVAILABLE", "OCCUPIED", "MAINTENANCE"]).optional(),
  description: z.string().optional(),
  currency: z.string().min(1).max(10).optional(),
  // Propriétaire réel du bien (Espace propriétaire) — nullable pour pouvoir
  // retirer explicitement l'association (dissocier un bien de son propriétaire).
  ownerId: z.string().min(1).nullable().optional(),
});

/**
 * Vérifie que l'id propriétaire fourni existe et appartient bien au
 * gestionnaire courant — sans ce contrôle, un gestionnaire pourrait associer
 * un de ses biens à la fiche propriétaire d'un AUTRE gestionnaire, lui
 * donnant de fait accès (via l'Espace propriétaire) à des chiffres qui ne le
 * regardent pas.
 */
async function assertOwnerBelongsToManager(ownerId: string, managerId: string) {
  const [owner] = await db.select({ managerId: owners.managerId }).from(owners).where(eq(owners.id, ownerId));
  if (!owner || owner.managerId !== managerId) {
    throw new ApiError(400, "Propriétaire invalide");
  }
}

export const listProperties = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const whereClause = eq(properties.managerId, req.user!.userId);

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(properties)
      .where(whereClause)
      .orderBy(desc(properties.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(properties).where(whereClause),
  ]);

  res.json(buildPaginatedResult(rows, count, pagination));
});

export const getProperty = asyncHandler(async (req: Request, res: Response) => {
  const [property] = await db.select().from(properties).where(eq(properties.id, req.params.id));
  assertOwnership(property, (p) => p.managerId, req.user!.userId, "Bien introuvable");

  const propertyContracts = await db
    .select({ contract: contracts, tenant: tenants })
    .from(contracts)
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(eq(contracts.propertyId, property.id))
    .orderBy(desc(contracts.createdAt));

  res.json({ ...property, contracts: propertyContracts.map((r: { contract: typeof contracts.$inferSelect; tenant: typeof tenants.$inferSelect }) => ({ ...r.contract, tenant: r.tenant })) });
});

export const createProperty = asyncHandler(async (req: Request, res: Response) => {
  const body = propertySchema.parse(req.body);
  if (body.ownerId) await assertOwnerBelongsToManager(body.ownerId, req.user!.userId);
  assertFileContentMatchesDeclaredType(req.file);
  const imageUrl = req.file ? await uploadPublicFile(req.file, "properties") : undefined;

  // Le bien hérite de la devise de règlement choisie par le gestionnaire, à
  // moins qu'une devise soit explicitement fournie. C'est le premier maillon
  // de la chaîne : le contrat hérite ensuite du bien (voir
  // contract.controller.ts) et la facture du contrat (voir invoice.service.ts).
  // Sans cet héritage, un bien restait en EUR par défaut et toute la cascade
  // avec lui — un gestionnaire réglé en XOF voyait ses loyers, ses quittances
  // et ses baux libellés en euros.
  const manager = await chargerCompteCourant(req.user!.userId);

  // Plafond de biens de la formule (audit sept. 2026 : jamais vérifié
  // jusqu'ici, alors que les CGU l'annoncent — Starter 5 / Pro 25 /
  // Entreprise illimité). Pendant l'essai gratuit, la formule effective est
  // Pro (promis par les CGU), quelle que soit la formule par défaut
  // (Starter) attribuée à l'inscription.
  const subscription = computeSubscriptionInfo(manager);
  const effectivePlan = subscription?.isTrialActive ? "PRO" : manager.subscriptionPlan;
  const maxProperties = maxPropertiesForPlan(effectivePlan);
  if (maxProperties !== null) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(properties)
      .where(eq(properties.managerId, req.user!.userId));
    if (count >= maxProperties) {
      throw new ApiError(
        403,
        `Limite de ${maxProperties} biens atteinte pour votre formule actuelle. Passez à une formule supérieure pour en ajouter davantage.`
      );
    }
  }

  const [property] = await db
    .insert(properties)
    .values({
      ...body,
      currency: body.currency || manager?.currency || "EUR",
      imageUrl,
      managerId: req.user!.userId,
    })
    .returning();

  await logActivity({
    req,
    managerId: property.managerId,
    action: "property.create",
    entityType: "property",
    entityId: property.id,
    entityLabel: property.title,
    details: `Bien ajouté : ${property.title} (${property.address})`,
  });

  res.status(201).json(property);
});

export const updateProperty = asyncHandler(async (req: Request, res: Response) => {
  const body = propertySchema.partial().parse(req.body);

  const [existing] = await db.select().from(properties).where(eq(properties.id, req.params.id));
  assertOwnership(existing, (e) => e.managerId, req.user!.userId, "Bien introuvable");

  if (body.ownerId) await assertOwnerBelongsToManager(body.ownerId, req.user!.userId);

  // La vérification de propriété doit précéder l'upload : sinon, un
  // gestionnaire pouvait faire uploader (et donc stocker, sur notre
  // infrastructure, à nos frais) n'importe quel fichier arbitraire en visant
  // simplement l'id du bien d'un AUTRE gestionnaire — le 404 n'arrivait
  // qu'après coup, une fois le fichier déjà écrit sans jamais être utilisé.
  assertFileContentMatchesDeclaredType(req.file);
  const imageUrl = req.file ? await uploadPublicFile(req.file, "properties") : undefined;

  // Le statut d'un bien (AVAILABLE/OCCUPIED/MAINTENANCE) est normalement
  // synchronisé automatiquement par contract.controller.ts au gré des
  // contrats (OCCUPIED à la création d'un contrat actif, AVAILABLE quand le
  // dernier contrat actif se termine). Rien n'empêchait pourtant un
  // gestionnaire de changer ce statut à la main via ce formulaire pendant
  // qu'un contrat de location est en cours — un bien réellement loué pouvait
  // ainsi se retrouver affiché "disponible" (risque de double location) ou
  // "en maintenance" alors qu'un locataire y habite sous bail actif. Un
  // changement manuel n'est donc accepté que si aucun contrat actif n'existe
  // sur ce bien ; sinon, c'est la clôture du contrat (voir updateContract)
  // qui doit remettre le bien à AVAILABLE.
  //
  // Même garde pour la devise : createContract fige currency sur le contrat
  // au moment de sa création (`body.currency || property.currency || "EUR"`,
  // voir contract.controller.ts), et invoice.service.ts hérite ensuite du
  // contrat, jamais du bien. Changer la devise du bien pendant qu'un contrat
  // actif existe ne touche donc à rien de ce contrat ni de ses factures déjà
  // libellées dans l'ancienne devise — seul l'affichage du bien change,
  // créant un bien et son contrat/ses quittances dans deux devises
  // différentes, sans qu'aucun montant n'ait réellement été reconverti.
  const changeStatus = body.status !== undefined && body.status !== existing.status;
  const changeCurrency = body.currency !== undefined && body.currency !== existing.currency;

  if (changeStatus || changeCurrency) {
    const [contratActif] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.propertyId, req.params.id), eq(contracts.status, "ACTIVE")))
      .limit(1);
    if (contratActif) {
      if (changeStatus) {
        throw new ApiError(
          409,
          "Impossible de changer le statut d'un bien ayant un contrat de location actif. Clôturez d'abord le contrat."
        );
      }
      throw new ApiError(
        409,
        "Impossible de changer la devise d'un bien ayant un contrat de location actif : le contrat et ses factures resteraient dans l'ancienne devise. Clôturez d'abord le contrat."
      );
    }
  }

  const [property] = await db
    .update(properties)
    .set({ ...body, ...(imageUrl ? { imageUrl } : {}) })
    .where(eq(properties.id, req.params.id))
    .returning();

  await logActivity({
    req,
    managerId: property.managerId,
    action: "property.update",
    entityType: "property",
    entityId: property.id,
    entityLabel: property.title,
    details: `Bien modifié : ${property.title}`,
  });

  res.json(property);
});

export const deleteProperty = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await db.select().from(properties).where(eq(properties.id, req.params.id));
  assertOwnership(existing, (e) => e.managerId, req.user!.userId, "Bien introuvable");

  const propertyContracts = await db
    .select()
    .from(contracts)
    .where(eq(contracts.propertyId, req.params.id));
  if (propertyContracts.some((c: typeof contracts.$inferSelect) => c.status === "ACTIVE")) {
    throw new ApiError(409, "Impossible de supprimer un bien ayant un contrat actif");
  }
  if (propertyContracts.length > 0) {
    throw new ApiError(
      409,
      "Impossible de supprimer un bien ayant un historique de contrats. Veuillez d'abord supprimer les contrats associés."
    );
  }

  await db.delete(properties).where(eq(properties.id, req.params.id));

  // Le fichier doit partir avec la ligne qui le référence : une fois celle-ci
  // supprimée, plus rien ne permet de le retrouver pour le purger ensuite.
  // Nettoyage best-effort et APRÈS la suppression en base (voir
  // deleteStorageObjectBestEffort) : un stockage indisponible ne doit jamais
  // faire échouer une suppression demandée par l'utilisateur.
  // Ici le fichier vit dans le bucket PUBLIC : sans ce nettoyage il resterait
  // accessible par son URL, sans authentification ni expiration.
  // Le `catch` est ici, et pas seulement dans le service : best-effort
  // signifie que la suppression déjà enregistrée en base doit répondre
  // succès même si le stockage est indisponible.
  await deleteStorageObjectBestEffort(existing.imageUrl).catch(() => undefined);

  await logActivity({
    req,
    managerId: existing.managerId,
    action: "property.delete",
    entityType: "property",
    entityId: existing.id,
    entityLabel: existing.title,
    details: `Bien supprimé : ${existing.title}`,
  });

  res.status(204).send();
});
