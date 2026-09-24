import bcrypt from "bcryptjs";
import { and, desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db, Transaction } from "../db/client";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { contracts, issueReports, properties, tenants, users } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { construireExportLocataire, nomFichierExport } from "../services/exportDonnees.service";
import { getSignedUrl, uploadPrivateFile } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertFileContentMatchesDeclaredType } from "../middleware/upload";
import { deleteStorageObjectBestEffort } from "../services/storage.service";
import { assertOwnership } from "../utils/authorization";
import { CIVILITES } from "../utils/nom";
import { MESSAGE_TELEPHONE_INVALIDE, versE164 } from "../utils/phone";
import { resolveScannedUrl } from "./contract.controller";

const tenantSchema = z.object({
  // Facultative, et c'est le point : une personne peut ne pas vouloir en
  // donner, et le document reste correct sans (voir utils/nom.ts).
  civility: z.enum(CIVILITES).optional().nullable(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // Le numéro est enregistré au format international, et pas seulement
  // contrôlé : c'est le seul format que l'API WhatsApp accepte, et le laisser
  // en texte libre revenait à découvrir des mois plus tard qu'un rappel n'est
  // jamais parti. `versE164` refuse de deviner l'indicatif d'un numéro qui n'en
  // porte pas — c'est au gestionnaire de le choisir, ce que le champ de saisie
  // lui demande désormais explicitement.
  phone: z
    .string()
    .refine((v) => versE164(v) !== null, MESSAGE_TELEPHONE_INVALIDE)
    .transform((v) => versE164(v)!),
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
});

export const listTenants = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const whereClause = eq(tenants.managerId, req.user!.userId);

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(tenants)
      .where(whereClause)
      .orderBy(desc(tenants.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(tenants).where(whereClause),
  ]);

  res.json(buildPaginatedResult(rows, count, pagination));
});

export const getTenant = asyncHandler(async (req: Request, res: Response) => {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  assertOwnership(tenant, (t) => t.managerId, req.user!.userId, "Locataire introuvable");

  const tenantContracts = await db
    .select({ contract: contracts, property: properties })
    .from(contracts)
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(contracts.tenantId, tenant.id));

  const issues = await db.select().from(issueReports).where(eq(issueReports.tenantId, tenant.id));

  const contractsWithScans = await Promise.all(
    tenantContracts.map(async (r: { contract: typeof contracts.$inferSelect; property: typeof properties.$inferSelect }) => ({
      ...r.contract,
      scannedContractUrl: await resolveScannedUrl(r.contract.scannedContractUrl),
      property: r.property,
    }))
  );

  res.json({
    ...tenant,
    contracts: contractsWithScans,
    issues,
  });
});

export const createTenant = asyncHandler(async (req: Request, res: Response) => {
  const body = tenantSchema.parse(req.body);
  assertFileContentMatchesDeclaredType(req.file);
  const idDocument = req.file ? await uploadPrivateFile(req.file, "tenants") : undefined;

  const [existing] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.managerId, req.user!.userId), eq(tenants.email, body.email)));
  if (existing) throw new ApiError(409, "Un locataire avec cet email existe déjà");

  const [tenant] = await db
    .insert(tenants)
    .values({ ...body, idDocument, managerId: req.user!.userId })
    .returning();

  await logActivity({
    req,
    managerId: tenant.managerId,
    action: "tenant.create",
    entityType: "tenant",
    entityId: tenant.id,
    entityLabel: `${tenant.firstName} ${tenant.lastName}`,
    details: `Locataire ajouté : ${tenant.firstName} ${tenant.lastName} (${tenant.email})`,
  });

  res.status(201).json(tenant);
});

export const updateTenant = asyncHandler(async (req: Request, res: Response) => {
  const body = tenantSchema.partial().parse(req.body);

  const [existing] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  assertOwnership(existing, (e) => e.managerId, req.user!.userId, "Locataire introuvable");

  // La vérification de propriété doit précéder l'upload : sinon, un
  // gestionnaire pouvait faire uploader (et donc stocker, sur notre
  // infrastructure, à nos frais) n'importe quel fichier arbitraire en visant
  // simplement l'id du locataire d'un AUTRE gestionnaire — le 404 n'arrivait
  // qu'après coup, une fois le fichier déjà écrit sans jamais être utilisé.
  assertFileContentMatchesDeclaredType(req.file);
  const idDocument = req.file ? await uploadPrivateFile(req.file, "tenants") : undefined;

  const [tenant] = await db
    .update(tenants)
    .set({ ...body, ...(idDocument ? { idDocument } : {}) })
    .where(eq(tenants.id, req.params.id))
    .returning();

  await logActivity({
    req,
    managerId: tenant.managerId,
    action: "tenant.update",
    entityType: "tenant",
    entityId: tenant.id,
    entityLabel: `${tenant.firstName} ${tenant.lastName}`,
    details: `Locataire modifié : ${tenant.firstName} ${tenant.lastName}`,
  });

  res.json(tenant);
});

/**
 * Droit d'accès (art. 15) et portabilité (art. 20), côté Gestionnaire : il
 * est responsable de traitement pour les données de ses locataires, c'est
 * donc à lui que la demande est normalement adressée.
 */
export const exporterTenant = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  assertOwnership(existing, (e) => e.managerId, req.user!.userId, "Locataire introuvable");

  await envoyerExport(res, existing.id, existing);
});

/**
 * Le même droit, exercé par le locataire lui-même depuis son portail.
 *
 * La fiche est résolue par le COMPTE (tenants.userId), jamais par le
 * `tenantId` que porte le jeton. Les deux coïncident aujourd'hui, le jeton
 * étant émis à partir de cette même jointure — mais faire dépendre la
 * livraison d'un dossier personnel d'une valeur recopiée dans le jeton
 * signifierait qu'une erreur d'émission, un jour, livrerait le dossier de
 * quelqu'un d'autre. La base tranche, pas le jeton.
 */
export const exporterMesDonnees = asyncHandler(async (req: Request, res: Response) => {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.userId, req.user!.userId));
  if (!tenant) {
    throw new ApiError(403, "Aucune fiche locataire n'est rattachée à ce compte.");
  }

  await envoyerExport(res, tenant.id, tenant);
});

async function envoyerExport(
  res: Response,
  tenantId: string,
  tenant: { firstName: string; lastName: string }
) {
  const donnees = await construireExportLocataire(tenantId);
  if (!donnees) throw new ApiError(404, "Locataire introuvable");

  // En pièce jointe, et non affiché dans le navigateur : c'est un document
  // qu'on remet à quelqu'un, qu'il doit pouvoir conserver et rouvrir
  // ailleurs — c'est le sens même de la portabilité.
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${nomFichierExport(tenant)}"`);
  res.send(JSON.stringify(donnees, null, 2));
}

/**
 * Exercice du droit à l'effacement (RGPD art. 17) pour un locataire qui a un
 * historique.
 *
 * `deleteTenant` refuse — à juste titre — toute suppression dès qu'un contrat
 * existe : on ne détruit pas les quittances d'un loyer réellement encaissé,
 * que le gestionnaire a l'obligation de conserver. Le locataire qui demandait
 * l'effacement n'avait donc aucune issue. L'anonymisation en est une : ce qui
 * l'IDENTIFIE disparaît — nom, email, téléphone, pièce d'identité, compte
 * d'accès au portail — et les écritures restent, rattachées à une fiche
 * devenue anonyme.
 *
 * L'adresse de remplacement vise le domaine `.invalid`, réservé par la
 * RFC 2606 et garanti sans existence : même une erreur de code ne pourrait
 * plus atteindre qui que ce soit. Elle reste unique par agence, la contrainte
 * composite (manager_id, email) continuant de s'appliquer.
 *
 * Le geste est déclenché par le Gestionnaire, qui est le responsable de
 * traitement pour les données de ses locataires (voir la politique de
 * confidentialité) : c'est à lui que le locataire adresse sa demande.
 *
 * Limite connue et assumée : les messages échangés via la messagerie
 * intégrée ne sont pas touchés. Leur contenu appartient à l'échange entre les
 * deux parties et peut servir de preuve au gestionnaire ; s'il contient des
 * éléments identifiants, ils doivent être traités au cas par cas.
 */
export const anonymiserTenant = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  assertOwnership(existing, (e) => e.managerId, req.user!.userId, "Locataire introuvable");

  if (existing.anonymizedAt) {
    throw new ApiError(409, "Ce locataire a déjà été anonymisé : il ne reste aucune donnée identifiante à effacer.");
  }

  const nomAffiche = `${existing.firstName} ${existing.lastName}`;
  const pieceIdentite = existing.idDocument;
  const comptePortail = existing.userId;

  await db.transaction(async (tx: Transaction) => {
    await tx
      .update(tenants)
      .set({
        civility: null,
        firstName: "Locataire",
        lastName: "anonymisé",
        email: `anonyme-${existing.id}@supprime.invalid`,
        phone: "",
        idDocument: null,
        userId: null,
        anonymizedAt: new Date(),
      })
      .where(eq(tenants.id, existing.id));

    // Le compte d'accès au portail porte lui aussi une adresse email, et
    // permet de se connecter : le laisser viderait l'anonymisation de son
    // sens. tenants.userId est déjà remis à null ci-dessus, donc la
    // suppression ne casse aucune référence.
    if (comptePortail) {
      await tx.delete(users).where(eq(users.id, comptePortail));
    }
  });

  // Après la transaction, best-effort : un stockage indisponible ne doit pas
  // annuler une anonymisation que la base a déjà enregistrée (même principe
  // que les suppressions, voir nettoyageStockage.test.ts).
  if (pieceIdentite) {
    await deleteStorageObjectBestEffort(pieceIdentite).catch(() => undefined);
  }

  await logActivity({
    req,
    managerId: existing.managerId,
    action: "tenant.anonymize",
    entityType: "tenant",
    entityId: existing.id,
    entityLabel: nomAffiche,
    details: `Données identifiantes de ${nomAffiche} effacées à sa demande (droit à l'effacement). L'historique locatif et comptable est conservé.`,
  });

  res.json({
    success: true,
    message:
      "Les données identifiantes de ce locataire ont été effacées. Son historique de contrats et de paiements est conservé, comme l'exige la réglementation comptable.",
  });
});

export const deleteTenant = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  assertOwnership(existing, (e) => e.managerId, req.user!.userId, "Locataire introuvable");

  const [tenantContracts, tenantIssues] = await Promise.all([
    db.select().from(contracts).where(eq(contracts.tenantId, req.params.id)),
    db.select().from(issueReports).where(eq(issueReports.tenantId, req.params.id)),
  ]);

  if (tenantContracts.some((c: typeof contracts.$inferSelect) => c.status === "ACTIVE")) {
    throw new ApiError(409, "Impossible de supprimer un locataire ayant un contrat actif");
  }
  if (tenantContracts.length > 0) {
    throw new ApiError(
      409,
      "Impossible de supprimer un locataire associé à un historique de contrats. Veuillez d'abord supprimer les contrats associés."
    );
  }
  if (tenantIssues.length > 0) {
    throw new ApiError(
      409,
      "Impossible de supprimer un locataire ayant des signalements d'incidents enregistrés."
    );
  }

  await db.delete(tenants).where(eq(tenants.id, req.params.id));

  // Le fichier doit partir avec la ligne qui le référence : une fois celle-ci
  // supprimée, plus rien ne permet de le retrouver pour le purger ensuite.
  // Nettoyage best-effort et APRÈS la suppression en base (voir
  // deleteStorageObjectBestEffort) : un stockage indisponible ne doit jamais
  // faire échouer une suppression demandée par l'utilisateur.
  // Le `catch` est ici, et pas seulement dans le service : best-effort
  // signifie que la suppression déjà enregistrée en base doit répondre
  // succès même si le stockage est indisponible.
  await deleteStorageObjectBestEffort(existing.idDocument).catch(() => undefined);

  await logActivity({
    req,
    managerId: existing.managerId,
    action: "tenant.delete",
    entityType: "tenant",
    entityId: existing.id,
    entityLabel: `${existing.firstName} ${existing.lastName}`,
    details: `Locataire supprimé : ${existing.firstName} ${existing.lastName}`,
  });

  res.status(204).send();
});

/** Génère une URL signée temporaire pour consulter la pièce d'identité d'un locataire (bucket privé). */
export const getTenantIdDocumentUrl = asyncHandler(async (req: Request, res: Response) => {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  assertOwnership(tenant, (t) => t.managerId, req.user!.userId, "Locataire introuvable");
  if (!tenant.idDocument) throw new ApiError(404, "Aucune pièce d'identité enregistrée pour ce locataire");

  const url = await getSignedUrl(tenant.idDocument);
  res.json({ url });
});

const createPortalAccountSchema = z.object({
  password: z.string().min(8),
});

/** Le gestionnaire crée l'accès au portail (email/mot de passe) d'un locataire. */
export const createTenantPortalAccount = asyncHandler(async (req: Request, res: Response) => {
  const body = createPortalAccountSchema.parse(req.body);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  assertOwnership(tenant, (t) => t.managerId, req.user!.userId, "Locataire introuvable");

  const [existingUser] = await db.select().from(users).where(eq(users.email, tenant.email));
  if (existingUser) throw new ApiError(409, "Un compte existe déjà pour cet email");

  const passwordHash = await bcrypt.hash(body.password, 10);

  // Les deux écritures doivent réussir ensemble : sans transaction, un échec
  // de la seconde laissait un compte de connexion valide mais jamais relié
  // à aucun locataire (userId manquant sur tenants).
  const user = await db.transaction(async (tx: Transaction) => {
    const [created] = await tx
      .insert(users)
      .values({ email: tenant.email, passwordHash, role: "TENANT" })
      .returning();
    await tx.update(tenants).set({ userId: created.id }).where(eq(tenants.id, tenant.id));
    return created;
  });

  res.status(201).json({ message: "Accès portail créé", userId: user.id, email: user.email });
});
