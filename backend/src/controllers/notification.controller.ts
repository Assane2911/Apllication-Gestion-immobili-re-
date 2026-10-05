import { and, eq, inArray } from "drizzle-orm";
import { Request, Response } from "express";
import { env } from "../config/env";
import { db } from "../db/client";
import { contracts, invoices, issueReports, messages, properties, tenants } from "../db/schema";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { idLocataireDuCompte } from "../utils/authorization";

export type NotificationType = "message" | "invoice" | "issue" | "contract_ending";
export type NotificationSeverity = "info" | "warning" | "danger";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  description: string;
  link: string;
  createdAt: string;
}

// Fenêtre d'anticipation pour signaler un contrat qui arrive à échéance dans
// le centre de notifications — plus large que le rappel email automatique
// (voir CONTRACT_REMINDER_DAYS) pour donner de la visibilité en amont.
const CONTRACT_ENDING_WINDOW_DAYS = 14;

type MessageRow = {
  message: typeof messages.$inferSelect;
  contract: typeof contracts.$inferSelect;
  tenant: typeof tenants.$inferSelect;
  property: typeof properties.$inferSelect;
};
type InvoiceRow = {
  invoice: typeof invoices.$inferSelect;
  contract: typeof contracts.$inferSelect;
  tenant: typeof tenants.$inferSelect;
  property: typeof properties.$inferSelect;
};
type IssueRow = {
  issue: typeof issueReports.$inferSelect;
  tenant: typeof tenants.$inferSelect;
  contract: typeof contracts.$inferSelect;
  property: typeof properties.$inferSelect;
};
type ContractRow = {
  contract: typeof contracts.$inferSelect;
  tenant: typeof tenants.$inferSelect;
  property: typeof properties.$inferSelect;
};

/**
 * Centre de notifications du gestionnaire : agrège en un seul flux les
 * éléments qui nécessitent son attention (messages non lus des locataires,
 * factures en retard, signalements d'incidents ouverts, contrats arrivant à
 * échéance). Calculé à la volée à partir de l'état actuel des données plutôt
 * que stocké dans une table dédiée — plus simple et toujours à jour.
 */
export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.user!.userId;
  const notifications: NotificationItem[] = [];

  // --- Messages non lus envoyés par les locataires ---
  // Le filtre isRead=false est porté par le SQL, pas par une boucle JS après
  // coup : sans lui, cette requête chargeait l'intégralité de l'historique
  // des messages de l'agence (des années de conversations, la quasi-totalité
  // déjà lus) à chaque affichage du centre de notifications, pour n'en
  // retenir qu'une poignée.
  const unreadRows = (await db
    .select({ message: messages, contract: contracts, tenant: tenants, property: properties })
    .from(messages)
    .innerJoin(contracts, eq(messages.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(
      and(eq(messages.senderRole, "TENANT"), eq(messages.isRead, false), eq(properties.managerId, managerId))
    )) as MessageRow[];

  const unreadByContract = new Map<
    string,
    { count: number; tenantName: string; propertyTitle: string; latest: Date }
  >();
  for (const r of unreadRows) {
    const key = r.contract.id;
    const createdAt = new Date(r.message.createdAt);
    const existing = unreadByContract.get(key);
    if (existing) {
      existing.count += 1;
      if (createdAt > existing.latest) existing.latest = createdAt;
    } else {
      unreadByContract.set(key, {
        count: 1,
        tenantName: `${r.tenant.firstName} ${r.tenant.lastName}`,
        propertyTitle: r.property.title,
        latest: createdAt,
      });
    }
  }
  for (const [contractId, info] of unreadByContract) {
    notifications.push({
      id: `message-${contractId}`,
      type: "message",
      severity: "info",
      title: `${info.count} nouveau${info.count > 1 ? "x" : ""} message${info.count > 1 ? "s" : ""} de ${info.tenantName}`,
      description: info.propertyTitle,
      link: "/messages",
      createdAt: info.latest.toISOString(),
    });
  }

  // --- Factures en retard ---
  const lateInvoiceRows = (await db
    .select({ invoice: invoices, contract: contracts, tenant: tenants, property: properties })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(and(eq(invoices.status, "LATE"), eq(properties.managerId, managerId)))) as InvoiceRow[];

  for (const r of lateInvoiceRows) {
    notifications.push({
      id: `invoice-${r.invoice.id}`,
      type: "invoice",
      severity: "danger",
      title: `Loyer en retard — ${r.tenant.firstName} ${r.tenant.lastName}`,
      description: `${r.property.title} · échéance du ${new Date(r.invoice.dueDate).toLocaleDateString("fr-FR")}`,
      link: "/invoices",
      createdAt: new Date(r.invoice.dueDate).toISOString(),
    });
  }

  // --- Signalements d'incidents ouverts ---
  const openIssueRows = (await db
    .select({ issue: issueReports, tenant: tenants, contract: contracts, property: properties })
    .from(issueReports)
    .innerJoin(tenants, eq(issueReports.tenantId, tenants.id))
    .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(and(eq(issueReports.status, "OPEN"), eq(properties.managerId, managerId)))) as IssueRow[];

  for (const r of openIssueRows) {
    notifications.push({
      id: `issue-${r.issue.id}`,
      type: "issue",
      severity: "warning",
      title: `Signalement : ${r.issue.title}`,
      description: `${r.property.title} · ${r.tenant.firstName} ${r.tenant.lastName}`,
      link: "/issues",
      createdAt: new Date(r.issue.createdAt).toISOString(),
    });
  }

  // --- Contrats arrivant à échéance ---
  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + CONTRACT_ENDING_WINDOW_DAYS);

  const activeContractRows = (await db
    .select({ contract: contracts, tenant: tenants, property: properties })
    .from(contracts)
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(and(eq(contracts.status, "ACTIVE"), eq(properties.managerId, managerId)))) as ContractRow[];

  for (const r of activeContractRows) {
    const endDate = new Date(r.contract.endDate);
    if (endDate >= now && endDate <= windowEnd) {
      const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      notifications.push({
        id: `contract-${r.contract.id}`,
        type: "contract_ending",
        severity: daysLeft <= 7 ? "danger" : "warning",
        title: `Contrat se terminant dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}`,
        description: `${r.property.title} · ${r.tenant.firstName} ${r.tenant.lastName}`,
        link: "/contracts",
        createdAt: endDate.toISOString(),
      });
    }
  }

  notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ notifications, count: notifications.length });
});

/**
 * Centre de notifications du locataire (Espace résident) : même principe que
 * getNotifications côté gestionnaire — calculé à la volée, jamais stocké —
 * mais scopé à SES PROPRES contrats et limité à ce qui le concerne
 * directement : messages non lus envoyés par le gestionnaire, loyers à régler
 * (en retard, ou bientôt dus — même fenêtre que le rappel email automatique,
 * `env.reminder.rentDueSoonDays`), et bail arrivant à échéance.
 *
 * Volontairement SANS les signalements d'incidents : contrairement au
 * gestionnaire, qui doit être alerté d'un nouveau signalement, le locataire
 * qui l'a lui-même déposé n'a besoin d'aucun rappel pour une action qu'il a
 * déjà effectuée — il consulte son statut depuis la page Incidents.
 */
export const getTenantNotifications = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = await idLocataireDuCompte(req);
  if (!tenantId) throw new ApiError(403, "Aucune fiche locataire n'est rattachée à ce compte.");

  const notifications: NotificationItem[] = [];

  // --- Messages non lus envoyés par le gestionnaire ---
  const unreadRows = await db
    .select({ message: messages, contract: contracts })
    .from(messages)
    .innerJoin(contracts, eq(messages.contractId, contracts.id))
    .where(and(eq(contracts.tenantId, tenantId), eq(messages.senderRole, "MANAGER"), eq(messages.isRead, false)));

  if (unreadRows.length > 0) {
    const latest = unreadRows.reduce(
      (max, r) => (new Date(r.message.createdAt) > max ? new Date(r.message.createdAt) : max),
      new Date(unreadRows[0].message.createdAt)
    );
    notifications.push({
      id: "message-mine",
      type: "message",
      severity: "info",
      title: `${unreadRows.length} nouveau${unreadRows.length > 1 ? "x" : ""} message${unreadRows.length > 1 ? "s" : ""} de votre gestionnaire`,
      description: "Consultez votre messagerie",
      link: "/portail/messages",
      createdAt: latest.toISOString(),
    });
  }

  // --- Loyers à régler (en retard, ou bientôt dus) ---
  const now = new Date();
  const dueSoonWindowEnd = new Date(now);
  dueSoonWindowEnd.setDate(dueSoonWindowEnd.getDate() + env.reminder.rentDueSoonDays);

  const invoiceRows = await db
    .select({ invoice: invoices, contract: contracts })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .where(and(eq(contracts.tenantId, tenantId), inArray(invoices.status, ["LATE", "PENDING"])));

  for (const r of invoiceRows) {
    const dueDate = new Date(r.invoice.dueDate);
    const estEnRetard = r.invoice.status === "LATE";
    const estBientotDue = !estEnRetard && dueDate >= now && dueDate <= dueSoonWindowEnd;
    if (!estEnRetard && !estBientotDue) continue;

    notifications.push({
      id: `invoice-${r.invoice.id}`,
      type: "invoice",
      severity: estEnRetard ? "danger" : "warning",
      title: estEnRetard ? "Loyer en retard" : "Loyer à régler bientôt",
      description: `Échéance du ${dueDate.toLocaleDateString("fr-FR")}`,
      link: "/portail/paiements",
      createdAt: dueDate.toISOString(),
    });
  }

  // --- Bail arrivant à échéance ---
  // Fenêtre plus large que celle des loyers "bientôt dus" ci-dessus (3 jours,
  // trop courte pour un bail) : on reprend celle du centre de notifications
  // du gestionnaire (CONTRACT_ENDING_WINDOW_DAYS), pensée pour ça.
  const activeContractRows = await db
    .select({ contract: contracts })
    .from(contracts)
    .where(and(eq(contracts.tenantId, tenantId), eq(contracts.status, "ACTIVE")));

  const contractEndingWindowEnd = new Date(now);
  contractEndingWindowEnd.setDate(contractEndingWindowEnd.getDate() + CONTRACT_ENDING_WINDOW_DAYS);

  for (const r of activeContractRows) {
    const endDate = new Date(r.contract.endDate);
    if (endDate >= now && endDate <= contractEndingWindowEnd) {
      const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      notifications.push({
        id: `contract-${r.contract.id}`,
        type: "contract_ending",
        severity: daysLeft <= 7 ? "danger" : "warning",
        title: `Votre bail se termine dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}`,
        description: "Contactez votre gestionnaire pour un renouvellement",
        link: "/portail",
        createdAt: endDate.toISOString(),
      });
    }
  }

  notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ notifications, count: notifications.length });
});
