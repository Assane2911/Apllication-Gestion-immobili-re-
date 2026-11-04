import { Request, Response } from "express";
import { z } from "zod";
import { logActivity } from "../services/activity.service";
import {
  basculerCompteAgence,
  chiffrementDisponible,
  enregistrerCompteAgence,
  lireResumeAgence,
  supprimerCompteAgence,
} from "../services/comptePaiementAgence.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

/**
 * Compte PayDunya de l'agence, pour que ses locataires lui paient leur loyer en ligne (Mobile Money, carte) directement
 * sur SON compte. Les identifiants ne sont jamais renvoyés : seul un résumé (mode, devise, fin du jeton) l'est.
 * Réservé au propriétaire de l'agence : un collaborateur invité ne branche pas le compte bancaire de l'agence.
 */
function exigerProprietaire(req: Request) {
  if (req.user?.collaboratorId) {
    throw new ApiError(403, "Seul le propriétaire de l'agence peut gérer le compte de paiement.", "AGENCY_PAYMENT_OWNER_ONLY");
  }
}

export const getComptePaiement = asyncHandler(async (req: Request, res: Response) => {
  const resume = await lireResumeAgence(req.user!.userId);
  // `disponible` : la plateforme sait-elle chiffrer des identifiants ? Sinon le formulaire n'a pas à être proposé.
  res.json({ ...resume, disponible: chiffrementDisponible() });
});

const identifiant = (libelle: string) =>
  z
    .string()
    .trim()
    .min(8, `${libelle} : valeur trop courte`)
    .max(200, `${libelle} : valeur trop longue`)
    .regex(/^\S+$/, `${libelle} : ne doit contenir ni espace ni retour à la ligne`);

const comptePaiementSchema = z.object({
  masterKey: identifiant("Clé principale"),
  privateKey: identifiant("Clé privée"),
  token: identifiant("Jeton"),
  mode: z.enum(["test", "live"]),
  currency: z.string().trim().length(3, "La devise doit être un code de 3 lettres (par exemple XOF)").transform((v) => v.toUpperCase()),
  enabled: z.boolean().optional().default(true),
});

export const putComptePaiement = asyncHandler(async (req: Request, res: Response) => {
  exigerProprietaire(req);
  const body = comptePaiementSchema.parse(req.body);
  await enregistrerCompteAgence(req.user!.userId, body);
  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "agency.payment_account_set",
    entityType: "agency",
    entityId: req.user!.userId,
    entityLabel: "Compte PayDunya",
    // Jamais les identifiants : le mode, la devise et la fin du jeton suffisent à reconnaître le compte.
    details: `Compte PayDunya de l'agence enregistré (mode ${body.mode}, devise ${body.currency}, jeton …${body.token.slice(-4)}).`,
  });
  res.json({ ...(await lireResumeAgence(req.user!.userId)), disponible: true });
});

export const patchComptePaiement = asyncHandler(async (req: Request, res: Response) => {
  exigerProprietaire(req);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  const trouve = await basculerCompteAgence(req.user!.userId, enabled);
  if (!trouve) throw new ApiError(404, "Aucun compte de paiement n'est enregistré.", "AGENCY_PAYMENT_NOT_FOUND");
  await logActivity({
    req,
    managerId: req.user!.userId,
    action: enabled ? "agency.payment_account_enabled" : "agency.payment_account_disabled",
    entityType: "agency",
    entityId: req.user!.userId,
    entityLabel: "Compte PayDunya",
    details: enabled ? "Paiement du loyer en ligne activé." : "Paiement du loyer en ligne suspendu.",
  });
  res.json({ ...(await lireResumeAgence(req.user!.userId)), disponible: chiffrementDisponible() });
});

export const deleteComptePaiement = asyncHandler(async (req: Request, res: Response) => {
  exigerProprietaire(req);
  await supprimerCompteAgence(req.user!.userId);
  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "agency.payment_account_removed",
    entityType: "agency",
    entityId: req.user!.userId,
    entityLabel: "Compte PayDunya",
    details: "Compte PayDunya de l'agence supprimé : le loyer ne peut plus se payer en ligne.",
  });
  res.status(204).end();
});
