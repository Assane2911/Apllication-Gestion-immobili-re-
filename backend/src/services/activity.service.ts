import { eq } from "drizzle-orm";
import { Request } from "express";
import { db } from "../db/client";
import { activityLogs, users } from "../db/schema";

export interface LogActivityParams {
  req?: Request;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel: string;
  details?: string;
}

/**
 * Enregistre une entrée dans le journal d'activité (audit log). Ne doit
 * jamais faire échouer l'action métier en cours : toute erreur est
 * silencieusement journalisée en console plutôt que propagée.
 */
export async function logActivity(params: LogActivityParams) {
  try {
    let actorLabel = "Système";
    if (params.req?.user) {
      const [actor] = await db.select().from(users).where(eq(users.id, params.req.user.userId));
      const roleLabel = params.req.user.role === "TENANT" ? "Locataire" : "Gestionnaire";
      actorLabel = actor ? `${roleLabel} (${actor.email})` : roleLabel;
    }

    await db.insert(activityLogs).values({
      actorId: params.req?.user?.userId ?? null,
      actorRole: params.req?.user?.role ?? null,
      actorLabel,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      entityLabel: params.entityLabel,
      details: params.details,
    });
  } catch (err) {
    console.error("[activity] Échec de l'enregistrement du journal d'activité:", err);
  }
}
