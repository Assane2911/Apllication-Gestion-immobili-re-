import { Request, Response } from "express";
import { donneesArriveesAEcheance } from "../services/conservation.service";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * Ce que la règle de durée désigne, pour le gestionnaire connecté.
 *
 * Volontairement en LECTURE SEULE. Le Service ne détruit pas les données
 * locatives de ses clients : pour elles, le Gestionnaire est responsable de
 * traitement et le Service sous-traitant. Il signale, le Gestionnaire décide —
 * et lui seul sait si un litige en cours suspend l'effacement, ou de quel type
 * de gestion relève un bail. L'effacement proprement dit passe par
 * anonymiserTenant, à son initiative.
 */
export const listerEcheances = asyncHandler(async (req: Request, res: Response) => {
  res.json(await donneesArriveesAEcheance(req.user!.userId));
});
