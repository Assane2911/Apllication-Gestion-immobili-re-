import { and, desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/client";
import { contracts, issueReports, issueStatusEnum, properties, tenants, vendors } from "../db/schema";
import { assertVendorOwnership } from "./vendor.controller";
import { logActivity } from "../services/activity.service";
import { issueStatusUpdateEmail, sendEmail } from "../services/email.service";
import { getSignedUrls, uploadPrivateFile } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { dateSaisieSchema } from "../utils/dates";
import { langueOuDefaut } from "../utils/langue";
import { assertAccesLocataireOuGestionnaire, assertOwnership, chargerLocataireDuCompte, estLocataireDuBail, idLocataireDuCompte } from "../utils/authorization";
import { assertFileContentMatchesDeclaredType } from "../middleware/upload";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";

function isIssueStatus(value: unknown): value is (typeof issueStatusEnum.enumValues)[number] {
  return typeof value === "string" && (issueStatusEnum.enumValues as readonly string[]).includes(value);
}

/** Une photo uploadée AVANT le passage au bucket privé est déjà une URL publique complète : on la laisse telle quelle. */
const estUrlComplete = (valeur: string) => /^https?:\/\//i.test(valeur);

/** Chemins du tableau JSON `additionalPhotos`, ou `null` si le champ est vide ou illisible. */
function lireAdditionalPhotos(valeur: string | null | undefined): string[] | null {
  if (!valeur) return null;
  try {
    const paths = JSON.parse(valeur);
    return Array.isArray(paths) ? paths : null;
  } catch {
    return null;
  }
}

/**
 * Signe `photoUrl` et chaque entrée de `additionalPhotos` (JSON stringifié) de TOUS les incidents donnés, avant de les renvoyer
 * au client, en UN SEUL appel au stockage (une page de 20 incidents à 10 photos en demandait 200, un par fichier).
 *
 * Une photo qui ne se signe pas (objet supprimé du stockage, stockage indisponible) ne fait PAS échouer la liste : tous les incidents
 * du locataire, ou de l'agence, disparaîtraient derrière un seul fichier manquant. L'incident reste listé sans l'image : `photoUrl`
 * devient une chaîne vide, et la photo disparaît de `additionalPhotos` (le site n'affiche alors qu'un message « photo indisponible »).
 * Compatibilité ascendante : les URL complètes (anciennes photos du bucket public) restent telles quelles.
 */
async function withSignedPhotos<T extends { photoUrl: string; additionalPhotos?: string | null }>(issues: T[]): Promise<T[]> {
  const photosSupplementaires = issues.map((issue) => lireAdditionalPhotos(issue.additionalPhotos));
  const aSigner: string[] = [];
  issues.forEach((issue, i) => {
    if (issue.photoUrl && !estUrlComplete(issue.photoUrl)) aSigner.push(issue.photoUrl);
    for (const chemin of photosSupplementaires[i] ?? []) if (chemin && !estUrlComplete(chemin)) aSigner.push(chemin);
  });
  const signees = await getSignedUrls(aSigner);
  const url = (valeur: string | null | undefined): string | null => {
    if (!valeur) return null;
    return estUrlComplete(valeur) ? valeur : (signees.get(valeur) ?? null);
  };

  return issues.map((issue, i) => {
    const extras = photosSupplementaires[i];
    return {
      ...issue,
      photoUrl: url(issue.photoUrl) ?? "",
      // Champ illisible : on le laisse tel quel plutôt que de faire échouer la réponse.
      additionalPhotos: extras ? JSON.stringify(extras.map(url).filter((u): u is string => u !== null)) : (issue.additionalPhotos ?? null),
    };
  });
}

/** Un seul incident (création, ajout de photo, changement de statut). */
async function withSignedPhoto<T extends { photoUrl: string; additionalPhotos?: string | null }>(issue: T): Promise<T> {
  return (await withSignedPhotos([issue]))[0];
}

/** Le gestionnaire voit tous les signalements (avec photo) de tous les locataires. */
export const listIssues = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);

  const conditions = [eq(properties.managerId, req.user!.userId)];
  if (isIssueStatus(req.query.status)) conditions.push(eq(issueReports.status, req.query.status));
  const whereClause = and(...conditions);

  // Colonnes lues : celles que l'écran affiche, pas les lignes entières répétées sur CHAQUE incident. Le bail porte les clauses,
  // les mentions légales et deux images de signature (jusqu'à 500 000 caractères chacune), le bien sa description, le locataire sa
  // fiche complète : une page de 20 incidents en renvoyait 20 exemplaires. L'écran lit le nom, le téléphone et l'e-mail du
  // locataire, le titre du bien, et le prestataire (petite fiche, gardée entière).
  const colonnesLocataire = { id: tenants.id, firstName: tenants.firstName, lastName: tenants.lastName, phone: tenants.phone, email: tenants.email };
  const colonnesBail = { id: contracts.id, propertyId: contracts.propertyId, currency: contracts.currency, startDate: contracts.startDate, endDate: contracts.endDate, status: contracts.status };
  const colonnesBien = { id: properties.id, title: properties.title, address: properties.address };

  type IssueRow = {
    issue: typeof issueReports.$inferSelect;
    tenant: { [K in keyof typeof colonnesLocataire]: unknown };
    contract: { [K in keyof typeof colonnesBail]: unknown };
    property: { [K in keyof typeof colonnesBien]: unknown };
    vendor: typeof vendors.$inferSelect | null;
  };

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({ issue: issueReports, tenant: colonnesLocataire, contract: colonnesBail, property: colonnesBien, vendor: vendors })
      .from(issueReports)
      .innerJoin(tenants, eq(issueReports.tenantId, tenants.id))
      .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .leftJoin(vendors, eq(issueReports.vendorId, vendors.id))
      .where(whereClause)
      .orderBy(desc(issueReports.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(issueReports)
      .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(whereClause),
  ]);

  const incidentsSignes = await withSignedPhotos(rows.map((r: IssueRow) => r.issue));
  const signedIssues = rows.map((r: IssueRow, i: number) => ({
    ...incidentsSignes[i],
    tenant: r.tenant,
    contract: { ...r.contract, property: r.property },
    vendor: r.vendor,
  }));

  res.json(buildPaginatedResult(signedIssues, count, pagination));
});

const updateIssueSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"]),
  managerNote: z.string().max(2000, "La note ne peut pas dépasser 2 000 caractères").optional(),
  // Prestataire assigné pour traiter l'incident — absent du corps : pas de
  // changement ; `null` explicite : désassigne. Voir assertVendorOwnership
  // (vendor.controller.ts) pour la raison de la vérification ci-dessous.
  vendorId: z.string().min(1).nullable().optional(),
  // Rendez-vous d'intervention pris avec le prestataire — même raisonnement
  // qu'ailleurs (expense.controller.ts, contract.controller.ts) :
  // z.coerce.date() plutôt que z.string(), pour qu'une date invalide ressorte
  // en 400 explicite plutôt qu'en Invalid Date silencieuse écrite en base.
  // .nullable() AVANT .optional() : c'est l'ordre qui fait que `null` reste
  // `null` (déprogrammer un rendez-vous) au lieu d'être coercé en epoch Unix.
  scheduledAt: dateSaisieSchema.nullable().optional(),
});

export const updateIssueStatus = asyncHandler(async (req: Request, res: Response) => {
  const body = updateIssueSchema.parse(req.body);
  const [owned] = await db
    .select({ issue: issueReports, property: properties })
    .from(issueReports)
    .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(issueReports.id, req.params.id));
  assertOwnership(owned, (o) => o.property.managerId, req.user!.userId, "Signalement introuvable", 404, "ISSUE_NOT_FOUND");

  if (body.vendorId) {
    await assertVendorOwnership(body.vendorId, req.user!.userId);
  }

  // Planifier la visite de personne n'a pas de sens : il faut un prestataire
  // assigné à l'issue de CETTE requête — déjà en base, affecté ici, ou (le
  // cas qui aurait été raté par une vérification plus naïve) pas désassigné
  // ici (vendorId: null) tout en fixant une date dans la même requête.
  const effectiveVendorId = body.vendorId !== undefined ? body.vendorId : owned.issue.vendorId;
  if (body.scheduledAt && !effectiveVendorId) {
    throw new ApiError(400, "Impossible de planifier une intervention sans prestataire assigné.", "ISSUE_SCHEDULE_NEEDS_VENDOR");
  }

  // Ce qui change VRAIMENT. Un enregistrement identique (double clic, onglet resté ouvert) ne réécrit rien, ne remplit pas
  // le journal et surtout ne renvoie pas au locataire un e-mail « statut mis à jour » qui ne dit rien de nouveau.
  const memeTexte = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") === (b ?? "");
  const memeDate = (a: Date | null | undefined, b: Date | null | undefined) => (a ? a.getTime() : null) === (b ? b.getTime() : null);
  const statutChange = body.status !== owned.issue.status;
  const noteChange = body.managerNote !== undefined && !memeTexte(body.managerNote, owned.issue.managerNote);
  const prestataireChange = body.vendorId !== undefined && (body.vendorId ?? null) !== (owned.issue.vendorId ?? null);
  const dateChange = body.scheduledAt !== undefined && !memeDate(body.scheduledAt, owned.issue.scheduledAt);
  if (!statutChange && !noteChange && !prestataireChange && !dateChange) {
    const vendorActuel = owned.issue.vendorId ? (await db.select().from(vendors).where(eq(vendors.id, owned.issue.vendorId)))[0] ?? null : null;
    return res.json({ ...(await withSignedPhoto(owned.issue)), vendor: vendorActuel });
  }

  const [updated] = await db
    .update(issueReports)
    .set({
      status: body.status,
      managerNote: body.managerNote,
      ...(body.vendorId !== undefined ? { vendorId: body.vendorId } : {}),
      ...(body.scheduledAt !== undefined ? { scheduledAt: body.scheduledAt } : {}),
    })
    .where(eq(issueReports.id, req.params.id))
    .returning();

  // Notifie par email la personne qui a SIGNALÉ le problème (issueReports.tenantId) de la mise à jour
  // — et non le titulaire du bail : sur un bail en colocation, le signalement d'un colocataire
  // arrivait chez le titulaire, qui ne savait pas de quoi on lui parlait, alors que l'auteur n'était
  // jamais prévenu. Ne doit jamais faire échouer la réponse si l'envoi échoue.
  const [row] = await db
    .select({ tenant: tenants, contract: contracts, property: properties })
    .from(issueReports)
    .innerJoin(tenants, eq(issueReports.tenantId, tenants.id))
    .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(issueReports.id, updated.id));

  // Le message contient le statut, la note et la date d'intervention : le prestataire n'y figure pas, donc l'assigner seul
  // ne prévient personne.
  if ((statutChange || noteChange || dateChange) && row?.tenant?.email) {
    const { subject, html } = issueStatusUpdateEmail({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      issueTitle: updated.title,
      propertyTitle: row.property.title,
      status: updated.status,
      managerNote: updated.managerNote,
      scheduledAt: updated.scheduledAt,
      frontendUrl: env.frontendUrl,
      langue: langueOuDefaut(row.tenant.language),
    });
    await sendEmail(row.tenant.email, subject, html).catch((err) =>
      console.error("[issue] Échec de l'envoi de la notification de statut:", err)
    );
  }

  await logActivity({
    req,
    managerId: owned.property.managerId,
    action: "issue.update_status",
    entityType: "issue",
    entityId: updated.id,
    entityLabel: updated.title,
    details: `Statut de l'incident « ${updated.title} » changé en ${updated.status}`,
  });

  const vendor = updated.vendorId ? (await db.select().from(vendors).where(eq(vendors.id, updated.vendorId)))[0] ?? null : null;
  res.json({ ...(await withSignedPhoto(updated)), vendor });
});

/** Signalements du locataire connecté (portail locataire). */
export const myIssues = asyncHandler(async (req: Request, res: Response) => {
  // Colonnes lues seulement (voir listIssues) : le locataire n'a pas à recevoir le bail entier, ses clauses et ses signatures,
  // ni la fiche complète du bien, en plusieurs exemplaires.
  const colonnesBail = { id: contracts.id, propertyId: contracts.propertyId, status: contracts.status };
  const colonnesBien = { id: properties.id, title: properties.title, address: properties.address };
  const rows = await db
    .select({ issue: issueReports, contract: colonnesBail, property: colonnesBien, vendor: vendors })
    .from(issueReports)
    .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .leftJoin(vendors, eq(issueReports.vendorId, vendors.id))
    .where(eq(issueReports.tenantId, (await chargerLocataireDuCompte(req)).id))
    .orderBy(desc(issueReports.createdAt));

  type MyIssueRow = {
    issue: typeof issueReports.$inferSelect;
    contract: { [K in keyof typeof colonnesBail]: unknown };
    property: { [K in keyof typeof colonnesBien]: unknown };
    vendor: typeof vendors.$inferSelect | null;
  };

  const incidentsSignes = await withSignedPhotos(rows.map((r: MyIssueRow) => r.issue));
  const signed = rows.map((r: MyIssueRow, i: number) => ({
    ...incidentsSignes[i],
    contract: { ...r.contract, property: r.property },
    // Nom et métier seulement : les coordonnées directes du prestataire
    // (téléphone, email) restent un contact professionnel du gestionnaire,
    // pas quelque chose à exposer au locataire sans qu'il l'ait demandé.
    vendor: r.vendor ? { name: r.vendor.name, trade: r.vendor.trade } : null,
  }));
  res.json(signed);
});

const createIssueSchema = z.object({
  contractId: z.string().min(1),
  // Bornés : le titre part dans l'email du locataire, le journal d'activité et la
  // liste du gestionnaire. Sans plafond, un champ multipart pouvait peser 1 Mo.
  title: z.string().trim().min(2).max(200, "Le titre ne peut pas dépasser 200 caractères"),
  description: z.string().trim().min(2).max(5000, "La description ne peut pas dépasser 5 000 caractères"),
});

/** Le locataire connecté signale un problème avec une photo prise/uploadée. */
export const createIssue = asyncHandler(async (req: Request, res: Response) => {
  const body = createIssueSchema.parse(req.body);
  if (!req.file) throw new ApiError(400, "Une photo du problème est requise", "ISSUE_PHOTO_REQUIRED");

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, body.contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");
  // 404 et non 403 : le bail d'un autre existe, mais le dire à un étranger révélerait l'existence de cet identifiant.
  if (!(await estLocataireDuBail(req, contract))) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");
  if (contract.status !== "ACTIVE") {
    throw new ApiError(400, "Les signalements d'incidents ne peuvent être créés que sur un contrat actif", "ISSUE_CONTRACT_NOT_ACTIVE");
  }

  assertFileContentMatchesDeclaredType(req.file);
  const photoUrl = await uploadPrivateFile(req.file, "issues");

  const [issue] = await db
    .insert(issueReports)
    .values({
      contractId: body.contractId,
      tenantId: (await chargerLocataireDuCompte(req)).id,
      title: body.title,
      description: body.description,
      photoUrl,
    })
    .returning();
  res.status(201).json(await withSignedPhoto(issue));
});

/** Photos d'un même incident, la photo principale comprise : 1 à la création + 9 ajoutées après coup. */
export const MAX_PHOTOS_PAR_INCIDENT = 10;

/** Le locataire ou le gestionnaire ajoute une nouvelle photo à un incident déjà signalé. */
export const addPhotoToIssue = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  if (!req.file) throw new ApiError(400, "Une photo est requise", "ISSUE_PHOTO_REQUIRED");

  const [row] = await db
    .select({ issue: issueReports, property: properties })
    .from(issueReports)
    .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(issueReports.id, req.params.id));
  if (!row) throw new ApiError(404, "Signalement introuvable", "ISSUE_NOT_FOUND");
  const { issue } = row;

  assertAccesLocataireOuGestionnaire(
    req.user.role,
    issue.tenantId === (await idLocataireDuCompte(req)),
    row.property.managerId === req.user.userId,
    { message: "Signalement introuvable", code: "ISSUE_NOT_FOUND" }
  );

  // Plafond vérifié AVANT l'upload : sinon un compte pourrait remplir le
  // stockage privé de photos d'un même incident, à nos frais. (Deux requêtes
  // simultanées peuvent dépasser le plafond d'une photo ; l'enjeu est de
  // borner le volume, pas de le garantir à l'unité près.)
  const dejaAjoutees = issue.additionalPhotos ? (JSON.parse(issue.additionalPhotos) as unknown[]).length : 0;
  if (1 + dejaAjoutees >= MAX_PHOTOS_PAR_INCIDENT) {
    throw new ApiError(409, `Ce signalement a déjà atteint le maximum de ${MAX_PHOTOS_PAR_INCIDENT} photos`, "ISSUE_PHOTO_LIMIT", { max: MAX_PHOTOS_PAR_INCIDENT });
  }

  assertFileContentMatchesDeclaredType(req.file);
  const newPhotoUrl = await uploadPrivateFile(req.file, "issues");

  // Régression corrigée : la version précédente lisait `additionalPhotos`
  // (déjà fait plus haut, dans `issue`), le combinait en mémoire avec la
  // nouvelle photo, puis réécrivait le tableau entier. Deux photos envoyées
  // à quelques millisecondes d'intervalle (deux onglets, ou l'appli mobile
  // qui retente) partaient toutes deux du même tableau de départ : la
  // seconde écriture remplaçait la première au lieu de s'y ajouter, et une
  // photo pourtant bien envoyée à Supabase Storage disparaissait de la liste
  // affichée sur le signalement.
  //
  // On ajoute donc la photo dans l'UPDATE lui-même plutôt qu'en mémoire :
  // Postgres verrouille la ligne pour la durée de l'écriture, et calcule
  // `additional_photos` à partir de sa valeur ACTUELLE en base au moment de
  // chaque écriture — deux écritures concurrentes sur la même ligne
  // s'exécutent l'une après l'autre, jamais à partir du même instantané.
  const [updated] = await db
    .update(issueReports)
    .set({
      additionalPhotos: sql`(
        COALESCE(${issueReports.additionalPhotos}::jsonb, '[]'::jsonb) || jsonb_build_array(${newPhotoUrl}::text)
      )::text`,
      updatedAt: new Date(),
    })
    .where(eq(issueReports.id, req.params.id))
    .returning();

  res.json(await withSignedPhoto(updated));
});

