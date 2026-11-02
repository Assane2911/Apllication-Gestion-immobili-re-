import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { platformSettings } from "../db/schema";
import { logAdminAction } from "../services/adminAudit.service";
import { annoncerMaintenanceAuxGestionnaires, BilanAnnonce } from "../services/maintenanceAnnonce.service";
import {
  DUREE_MAX_MAINTENANCE_MS,
  fenetreEnCours,
  FenetreMaintenance,
  invaliderCacheMaintenance,
  lireMaintenance,
  PLATFORM_SETTINGS_ID,
} from "../services/maintenance.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

const publique = (fenetre: FenetreMaintenance | null) =>
  fenetre
    ? { debut: fenetre.debut.toISOString(), fin: fenetre.fin.toISOString(), message: fenetre.message, enCours: fenetreEnCours(fenetre) }
    : null;

/**
 * État de la maintenance, SANS authentification : l'application l'interroge avant même qu'on se connecte, pour annoncer une
 * maintenance à venir ou afficher son écran de maintenance. N'expose que les dates et le message écrit pour être lu.
 */
export const etatMaintenance = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ maintenance: publique(await lireMaintenance()) });
});

const programmationSchema = z.object({
  debut: z.coerce.date({ message: "Date de début invalide" }),
  fin: z.coerce.date({ message: "Date de fin invalide" }),
  message: z.string().trim().max(500, "Le message ne peut pas dépasser 500 caractères").optional(),
  /** Prévenir aussi les gestionnaires par e-mail. Absent = non : l'envoi part tout de suite et ne se rattrape pas. */
  notifier: z.boolean().optional(),
});

/**
 * Programme (ou remplace) la maintenance. La fenêtre doit finir dans le futur, rester sous 24 h et avoir une durée positive.
 * Avec `notifier`, les gestionnaires sont prévenus par e-mail : seulement pour une maintenance qui n'a pas encore commencé
 * (annoncer une maintenance déjà en cours n'aurait aucun sens), et la réponse porte le bilan de l'envoi.
 */
export const programmerMaintenance = asyncHandler(async (req: Request, res: Response) => {
  const { debut, fin, message, notifier } = programmationSchema.parse(req.body);
  const maintenant = Date.now();
  if (fin.getTime() <= debut.getTime()) {
    throw new ApiError(400, "La fin de la maintenance doit être postérieure à son début.", "MAINTENANCE_WINDOW_INVALID");
  }
  if (fin.getTime() <= maintenant) {
    throw new ApiError(400, "La fin de la maintenance doit être dans le futur.", "MAINTENANCE_WINDOW_INVALID");
  }
  if (fin.getTime() - debut.getTime() > DUREE_MAX_MAINTENANCE_MS) {
    throw new ApiError(400, "Une maintenance ne peut pas durer plus de 24 heures.", "MAINTENANCE_TOO_LONG");
  }
  if (notifier && debut.getTime() <= maintenant) {
    throw new ApiError(400, "L'annonce par e-mail n'est possible que pour une maintenance qui n'a pas encore commencé.", "MAINTENANCE_NOTIFY_TOO_LATE");
  }

  const valeurs = { maintenanceStart: debut, maintenanceEnd: fin, maintenanceMessage: message?.trim() ? message.trim() : null };
  const [existant] = await db.select({ id: platformSettings.id }).from(platformSettings).where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));
  if (existant) {
    await db.update(platformSettings).set({ ...valeurs, updatedAt: new Date() }).where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));
  } else {
    await db.insert(platformSettings).values({ id: PLATFORM_SETTINGS_ID, ...valeurs });
  }
  invaliderCacheMaintenance();

  // L'e-mail part après l'enregistrement : une fenêtre refusée ne prévient personne.
  let annonce: BilanAnnonce | null = null;
  if (notifier) annonce = await annoncerMaintenanceAuxGestionnaires({ debut, fin, message: valeurs.maintenanceMessage });

  await logAdminAction({
    req,
    action: "platform.maintenance.schedule",
    details:
      `Maintenance programmée du ${debut.toISOString()} au ${fin.toISOString()}${valeurs.maintenanceMessage ? " (message joint)" : ""}` +
      (annonce ? ` ; annonce par e-mail : ${annonce.envoyes} envoyé(s) sur ${annonce.destinataires}, ${annonce.echecs} échec(s)` : ""),
  });
  res.json({ maintenance: publique(await lireMaintenance()), annonce });
});

/** Annule la maintenance à venir, ou termine celle qui est en cours : dans les deux cas la fenêtre disparaît. */
export const annulerMaintenance = asyncHandler(async (req: Request, res: Response) => {
  const avant = await lireMaintenance();
  await db
    .update(platformSettings)
    .set({ maintenanceStart: null, maintenanceEnd: null, maintenanceMessage: null, updatedAt: new Date() })
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));
  invaliderCacheMaintenance();
  if (avant) {
    await logAdminAction({
      req,
      action: fenetreEnCours(avant) ? "platform.maintenance.end" : "platform.maintenance.cancel",
      details: fenetreEnCours(avant) ? "Maintenance terminée avant l'heure prévue" : "Maintenance programmée annulée",
    });
  }
  res.json({ maintenance: null });
});
