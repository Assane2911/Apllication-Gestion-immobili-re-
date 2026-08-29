import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { contracts, invoices, issueReports, messages, properties, tenants } from "../db/schema";
import { asyncHandler } from "../utils/asyncHandler";

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
export const getNotifications = asyncHandler(async (_req: Request, res: Response) => {
  const notifications: NotificationItem[] = [];

  // --- Messages non lus envoyés par les locataires ---
  const unreadRows = (await db
    .select({ message: messages, contract: contracts, tenant: tenants, property: properties })
    .from(messages)
    .innerJoin(contracts, eq(messages.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(messages.senderRole, "TENANT"))) as MessageRow[];

  const unreadByContract = new Map<
    string,
    { count: number; tenantName: string; propertyTitle: string; latest: Date }
  >();
  for (const r of unreadRows) {
    if (r.message.isRead !== "false") continue;
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
    .where(eq(invoices.status, "LATE"))) as InvoiceRow[];

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
    .where(eq(issueReports.status, "OPEN"))) as IssueRow[];

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
    .where(eq(contracts.status, "ACTIVE"))) as ContractRow[];

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
