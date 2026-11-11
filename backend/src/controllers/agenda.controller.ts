import { Request, Response } from "express";
import { z } from "zod";
import { chargerAgenda, JOURS_AGENDA_MAX, JOURS_AGENDA_PAR_DEFAUT } from "../services/agenda.service";
import { asyncHandler } from "../utils/asyncHandler";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(JOURS_AGENDA_MAX).default(JOURS_AGENDA_PAR_DEFAUT),
});

/** Échéances de l'agence : en retard, puis à venir dans les `days` prochains jours. */
export const getAgenda = asyncHandler(async (req: Request, res: Response) => {
  const { days } = querySchema.parse(req.query);
  res.json(await chargerAgenda(req.user!.userId, days));
});
