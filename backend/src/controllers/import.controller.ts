import { Request, Response } from "express";
import { z } from "zod";
import { logActivity } from "../services/activity.service";
import {
  analyserBiens,
  analyserLocataires,
  ImportInvalide,
  importerBiens,
  importerLocataires,
  MODELES_CSV,
  type TypeImport,
} from "../services/import.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { chargerCompteCourant } from "../utils/authorization";
import { CsvInvalide, lireCsv, MAX_CARACTERES_IMPORT } from "../utils/csvImport";
import { computeSubscriptionInfo } from "./auth.controller";
import { maxPropertiesForPlan } from "./subscription.controller";

const importSchema = z.object({
  type: z.enum(["properties", "tenants"]),
  csv: z.string().min(1, "Le fichier est vide.").max(MAX_CARACTERES_IMPORT, "Le fichier est trop volumineux (1 Mo maximum)."),
});

const LIBELLES: Record<TypeImport, string> = { properties: "biens", tenants: "locataires" };

/** Lit et analyse le fichier : toute erreur de FORMAT (fichier vide, colonnes absentes…) devient un 400 lisible. */
async function analyser(req: Request) {
  const { type, csv } = importSchema.parse(req.body);
  const managerId = req.user!.userId;

  try {
    const lu = lireCsv(csv);
    if (type === "tenants") return { type, managerId, analyse: await analyserLocataires(managerId, lu) };

    const manager = await chargerCompteCourant(req);
    // Même plafond que la création à la main : formule effective Pro pendant l'essai.
    const abonnement = computeSubscriptionInfo(manager);
    const formule = abonnement?.isTrialActive ? "PRO" : manager.subscriptionPlan;
    return {
      type,
      managerId,
      analyse: await analyserBiens(managerId, lu, {
        deviseParDefaut: manager.currency || "EUR",
        maximumBiens: maxPropertiesForPlan(formule),
      }),
    };
  } catch (err) {
    if (err instanceof CsvInvalide || err instanceof ImportInvalide) throw new ApiError(400, err.message);
    throw err;
  }
}

/** Aperçu : lit et vérifie le fichier ligne par ligne, n'écrit RIEN. */
export const previsualiserImport = asyncHandler(async (req: Request, res: Response) => {
  const { analyse } = await analyser(req);
  res.json(analyse);
});

/**
 * Import : rejoue l'analyse sur le fichier reçu (jamais sur ce que l'aperçu a
 * affiché) et n'écrit que les lignes valides. Les erreurs et les doublons sont
 * renvoyés pour être corrigés, sans bloquer le reste.
 */
export const importerCsv = asyncHandler(async (req: Request, res: Response) => {
  const { type, managerId, analyse } = await analyser(req);

  const importees =
    type === "tenants"
      ? await importerLocataires(managerId, analyse as Awaited<ReturnType<typeof analyserLocataires>>)
      : await importerBiens(managerId, analyse as Awaited<ReturnType<typeof analyserBiens>>);

  await logActivity({
    req,
    managerId,
    action: `import.${type}`,
    entityType: "import",
    entityLabel: `Import CSV de ${LIBELLES[type]}`,
    details: `${importees} ${LIBELLES[type]} importé(s) sur ${analyse.resume.total} ligne(s) (${analyse.resume.doublons} doublon(s), ${analyse.resume.erreurs} erreur(s)).`,
  });

  res.status(201).json({ ...analyse, importees });
});

/** Modèle CSV à remplir (en-têtes attendus et une ligne d'exemple). */
export const telechargerModele = asyncHandler(async (req: Request, res: Response) => {
  const type = z.enum(["properties", "tenants"]).parse(req.params.type);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="modele-import-${type === "properties" ? "biens" : "locataires"}.csv"`);
  res.send("﻿" + MODELES_CSV[type]);
});
