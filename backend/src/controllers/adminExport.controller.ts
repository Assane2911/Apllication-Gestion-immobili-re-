import { and, desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { adminAuditLogs } from "../db/schema";
import { ADMIN_AUDIT_ACTION_LABELS, logAdminAction } from "../services/adminAudit.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { CSV_BOM, csvEscape } from "../utils/csv";
import {
  chargerGestionnaires,
  listAuditLogsQuerySchema,
  listManagersQuerySchema,
  resumerGestionnaires,
} from "./admin.controller";
import { NOM_FORMULE } from "../utils/formules";

/**
 * Exports CSV de l'administration : la liste des gestionnaires et le journal
 * d'audit, avec les mêmes filtres que leurs pages.
 *
 * - Même format que les exports gestionnaire (séparateur « ; », BOM UTF-8 pour
 *   Excel) et même neutralisation des formules (csvEscape, CWE-1236) : un
 *   email, un nom d'agence ou un motif saisi à la main est une donnée non
 *   maîtrisée, jamais une formule à exécuter dans le tableur de l'administrateur.
 * - Plafonnés : un export non borné lirait toute la table en mémoire. Au-delà,
 *   on garde les plus récents.
 * - Chaque export est lui-même tracé dans le journal d'audit : sortir en bloc
 *   les emails des clients est précisément ce qu'une trace doit retrouver.
 *   L'entrée est écrite APRÈS la génération, le fichier ne contient donc pas
 *   sa propre trace.
 * - `no-store` : le fichier contient des données personnelles.
 */
export const MAX_LIGNES_EXPORT = 5000;

const STATUT_LABEL: Record<string, string> = { TRIAL: "Essai", ACTIVE: "Actif", CANCELLED: "Résilié", EXPIRED: "Expiré" };
const PLAN_LABEL: Record<string, string> = NOM_FORMULE;

const jour = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const dateHeure = (d: Date | string) => new Date(d).toISOString().slice(0, 19).replace("T", " ");

function envoyerCsv(res: Response, nomFichier: string, lignes: string[]) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${nomFichier}-${jour(new Date())}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(CSV_BOM + lignes.join("\n"));
}

export const exportManagersCsv = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listManagersQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, "Paramètres de recherche invalides");

  const tous = await chargerGestionnaires(parsed.data);
  const items = await resumerGestionnaires(tous.slice(0, MAX_LIGNES_EXPORT));

  const lignes = [
    ["Email", "Agence", "Formule", "Statut", "Suspendu", "Fin d'essai", "Fin d'abonnement", "Biens", "Locataires", "Inscrit le"].join(";"),
    ...items.map((m) =>
      [
        csvEscape(m.email),
        csvEscape(m.agencyName ?? ""),
        PLAN_LABEL[m.plan] ?? csvEscape(m.plan),
        STATUT_LABEL[m.status] ?? csvEscape(m.status),
        m.suspendedAt ? "Oui" : "Non",
        jour(m.trialEndsAt),
        jour(m.subscriptionEndsAt),
        m.propertiesCount,
        m.tenantsCount,
        jour(m.createdAt),
      ].join(";")
    ),
  ];
  envoyerCsv(res, "gestionnaires", lignes);

  const { plan, status, search } = parsed.data;
  const filtres = [plan && `formule ${plan}`, status && `statut ${status}`, search && "recherche"].filter(Boolean).join(", ");
  await logAdminAction({
    req,
    action: "export.managers",
    details: `Export CSV de ${items.length} gestionnaire(s)${filtres ? ` (filtres : ${filtres})` : ""}`,
  });
});

export const exportAuditCsv = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listAuditLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, "Paramètres de recherche invalides");
  const { action, targetUserId } = parsed.data;

  const conditions = [];
  if (action) conditions.push(eq(adminAuditLogs.action, action));
  if (targetUserId) conditions.push(eq(adminAuditLogs.targetUserId, targetUserId));

  const rows = await db
    .select()
    .from(adminAuditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id))
    .limit(MAX_LIGNES_EXPORT);

  const lignes = [
    ["Date (UTC)", "Administrateur", "Action", "Gestionnaire visé", "Détail"].join(";"),
    ...rows.map((r) =>
      [
        dateHeure(r.createdAt),
        csvEscape(r.adminEmail),
        // Une action inconnue (journal écrit par une version plus récente) reste lisible sous sa clé.
        csvEscape(ADMIN_AUDIT_ACTION_LABELS[r.action as keyof typeof ADMIN_AUDIT_ACTION_LABELS] ?? r.action),
        csvEscape(r.targetLabel ?? ""),
        csvEscape(r.details ?? ""),
      ].join(";")
    ),
  ];
  envoyerCsv(res, "journal-audit", lignes);

  await logAdminAction({
    req,
    action: "export.audit",
    details: `Export CSV de ${rows.length} entrée(s) du journal${action ? ` (action : ${action})` : ""}`,
  });
});
