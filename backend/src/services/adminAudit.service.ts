import * as Sentry from "@sentry/node";
import { eq } from "drizzle-orm";
import { Request } from "express";
import { db } from "../db/client";
import { adminAuditLogs, users } from "../db/schema";

/**
 * Actions admin journalisées. Liste fermée : le filtre de la page d'audit et
 * les libellés du frontend s'appuient dessus, et une faute de frappe dans une
 * chaîne libre produirait une entrée introuvable par filtre.
 */
export const ADMIN_AUDIT_ACTIONS = [
  "subscription.bank_transfer.confirm",
  "subscription.bank_transfer.reject",
  "platform.bank_details.update",
  "manager.suspend",
  "manager.reactivate",
  "subscription.grant_days",
  "subscription.change_plan",
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export interface LogAdminActionParams {
  req?: Request;
  action: AdminAuditAction;
  targetUserId?: string | null;
  targetLabel?: string | null;
  // Description courte en français. Jamais de valeur sensible (IBAN, jeton…).
  details?: string;
}

/**
 * Enregistre une action de l'administration dans le journal d'audit. Appelée
 * APRÈS l'action métier, et — comme logActivity — ne doit jamais la faire
 * échouer : l'erreur est remontée à Sentry plutôt qu'avalée en silence, car un
 * trou dans la traçabilité d'actions financières doit rester visible.
 */
export async function logAdminAction(params: LogAdminActionParams) {
  try {
    const adminId = params.req?.user?.userId ?? null;
    let adminEmail = "Administrateur";
    if (adminId) {
      const [admin] = await db.select({ email: users.email }).from(users).where(eq(users.id, adminId));
      if (admin) adminEmail = admin.email;
    }

    await db.insert(adminAuditLogs).values({
      adminId,
      adminEmail,
      action: params.action,
      targetUserId: params.targetUserId ?? null,
      targetLabel: params.targetLabel ?? null,
      details: params.details,
    });
  } catch (err) {
    console.error("[admin-audit] Échec de l'enregistrement du journal d'audit:", err);
    Sentry.captureException(err, { tags: { source: "adminAudit.service.logAdminAction" } });
  }
}
