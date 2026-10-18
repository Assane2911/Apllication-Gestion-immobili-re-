import * as Sentry from "@sentry/node";
import { eq, sql } from "drizzle-orm";
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
    // Multi-utilisateurs : pour un collaborateur, req.user.userId porte l'id
    // du PROPRIÉTAIRE de l'agence (voir identiteJetonPourManager), jamais le
    // sien — l'attribution doit pourtant nommer qui a RÉELLEMENT agi.
    const acteurReelId = params.req?.user?.collaboratorId ?? params.req?.user?.userId;

    let actorLabel = "Système";
    if (acteurReelId) {
      const [actor] = await db.select().from(users).where(eq(users.id, acteurReelId));
      const roleLabel = params.req!.user!.role === "TENANT" ? "Locataire" : "Gestionnaire";
      actorLabel = actor ? `${roleLabel} (${actor.email})` : roleLabel;
    }

    await db.insert(activityLogs).values({
      managerId: params.managerId,
      actorId: acteurReelId ?? null,
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


/** Une adresse email, où qu'elle apparaisse dans un texte libre. */
const MOTIF_EMAIL = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";

/**
 * Valeurs à écrire dans `entityLabel` et `details` des lignes du journal qui concernent une personne anonymisée
 * (droit à l'effacement) : son nom est remplacé ET toute adresse email est effacée.
 *
 * Remplacer le seul nom laissait l'email, que la création d'un locataire ou d'un propriétaire écrit dans le
 * journal (« Locataire ajouté : Awa Sow (awa@exemple.com) »), lisible jusqu'à la purge du journal, un an plus tard.
 * Le motif cherche toute adresse plutôt que l'adresse actuelle de la fiche : une personne change d'email au fil
 * des ans, et les anciennes ne sont plus nulle part ailleurs que dans ces lignes.
 *
 * À n'appliquer qu'aux lignes de la personne (entités rattachées à elle) : l'adresse du gestionnaire qui a agi est
 * dans `actorLabel`, une autre colonne, que ceci ne touche jamais.
 */
export function effacerIdentiteDuJournal(nom: string, nomAnonyme: string) {
  const sansEmail = (colonne: typeof activityLogs.entityLabel | typeof activityLogs.details) =>
    sql`replace(regexp_replace(${colonne}, ${MOTIF_EMAIL}, 'adresse effacée', 'g'), ${nom}, ${nomAnonyme})`;
  return { entityLabel: sansEmail(activityLogs.entityLabel), details: sansEmail(activityLogs.details) };
}
