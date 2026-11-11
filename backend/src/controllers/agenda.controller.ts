import { Request, Response } from "express";
import { z } from "zod";
import { chargerAgenda, JOURS_AGENDA_MAX, JOURS_AGENDA_PAR_DEFAUT, resumeAgenda } from "../services/agenda.service";
import { calendrierDuJeton, etatDuLien, genererLien, supprimerLien } from "../services/agendaFeed.service";
import { asyncHandler } from "../utils/asyncHandler";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(JOURS_AGENDA_MAX).default(JOURS_AGENDA_PAR_DEFAUT),
});

/** Échéances de l'agence : en retard, puis à venir dans les `days` prochains jours. */
export const getAgenda = asyncHandler(async (req: Request, res: Response) => {
  const { days } = querySchema.parse(req.query);
  res.json(await chargerAgenda(req.user!.userId, days));
});

/** Les chiffres de l'agenda (en retard, à venir sous 7 jours) : de quoi allumer la pastille du menu sans charger toute la liste. */
export const getAgendaSummary = asyncHandler(async (req: Request, res: Response) => {
  res.json(await resumeAgenda(req.user!.userId));
});

/** Où en est le lien d'abonnement au calendrier : actif ou non, créé quand, lu pour la dernière fois quand. Jamais le jeton. */
export const getAgendaFeed = asyncHandler(async (req: Request, res: Response) => {
  res.json(await etatDuLien(req.user!.userId));
});

/** Crée le lien d'abonnement, ou le régénère (l'ancien cesse de fonctionner). Le jeton n'est renvoyé que cette fois. */
export const createAgendaFeed = asyncHandler(async (req: Request, res: Response) => {
  const { token, createdAt } = await genererLien(req.user!.userId);
  res.status(201).json({ token, path: `/agenda/ics/${token}.ics`, active: true, createdAt, lastUsedAt: null });
});

/** Désactive le lien : les calendriers abonnés ne reçoivent plus rien. */
export const deleteAgendaFeed = asyncHandler(async (req: Request, res: Response) => {
  await supprimerLien(req.user!.userId);
  res.status(204).end();
});

/**
 * Le flux lu par les calendriers (Google Agenda, Outlook, iPhone) : public, le jeton du lien en tient lieu de session.
 * Toute impossibilité (jeton mal formé, inconnu, révoqué, agence suspendue, abonnement échu) donne la même 404 sans
 * détail : ce sont des applications qui lisent, pas des personnes, et rien ne doit aider à deviner un jeton.
 */
export const getAgendaIcs = asyncHandler(async (req: Request, res: Response) => {
  const fichier = String(req.params.fichier ?? "");
  const token = fichier.endsWith(".ics") ? fichier.slice(0, -".ics".length) : "";
  const calendrier = token ? await calendrierDuJeton(token) : null;
  if (calendrier === null) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  res
    .status(200)
    .set({
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="agenda.ics"',
      // Le contenu est propre à une agence et le lien est secret : ni cache partagé, ni indexation.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    })
    .send(calendrier);
});
