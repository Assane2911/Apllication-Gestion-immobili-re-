import * as Sentry from "@sentry/node";
import { eq } from "drizzle-orm";
import { Request } from "express";
import { db } from "../db/client";
import { activityLogs, users } from "../db/schema";

export interface LogActivityParams {
  req?: Request;
  // Gestionnaire (agence) à qui appartient cette entrée de journal. Obligatoire :
  // l'acteur (params.req.user) peut être un locataire, donc on ne peut pas
  // déduire l'agence propriétaire à partir du seul acteur.
  managerId: string;
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
      managerId: params.managerId,
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
    // Ne doit jamais faire échouer l'action métier (voir le commentaire de
    // fonction), mais un simple console.error ne remonte à rien : Sentry
    // n'instrumente que les erreurs qui traversent errorHandler (voir
    // instrument.ts), pas un catch qui les avale ici. Sans capture explicite,
    // une panne DB qui casse l'écriture du journal d'audit (traçabilité
    // légale des actions gestionnaire/locataire) restait invisible en prod
    // hors lecture manuelle des logs serveur (audit sept. 2026).
    console.error("[activity] Échec de l'enregistrement du journal d'activité:", err);
    Sentry.captureException(err, { tags: { source: "activity.service.logActivity" } });
  }
}
