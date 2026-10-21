import { Request, Response } from "express";
import { z } from "zod";
import { logAdminAction } from "../services/adminAudit.service";
import { supprimerCompteGestionnaire } from "../services/suppressionCompte.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { trouverGestionnaire } from "./admin.controller";

const deleteManagerSchema = z.object({
  // Ressaisie de l'email du compte : une action irréversible ne se contente pas
  // d'un clic. Comparée sans tenir compte de la casse ni des espaces de bord.
  email: z.string().trim().min(1, "Saisissez l'email du compte à supprimer"),
  reason: z.string().trim().min(3, "Indiquez le motif de la suppression").max(500),
});

/**
 * Suppression DÉFINITIVE et irréversible d'un compte gestionnaire par
 * l'administration, avec tout ce qui appartient à son agence (voir
 * supprimerCompteGestionnaire : même règle que la suppression à la demande du
 * gestionnaire). Les comptes portail des locataires et bailleurs sont conservés.
 *
 * Trois garde-fous, dans cet ordre :
 *  1. le compte doit être SUSPENDU : un délai de réflexion, et la facturation
 *     Stripe est déjà en pause (voir suspendManager) — on ne passe jamais d'un
 *     compte actif à un compte effacé en un seul geste ;
 *  2. l'email du compte doit être ressaisi à l'identique ;
 *  3. un motif est obligatoire.
 * Seul le gestionnaire propriétaire peut être visé : 404 pour un id inconnu, un
 * collaborateur invité (supprimé avec son propriétaire) ou un administrateur.
 *
 * L'abonnement Stripe à renouvellement automatique est résilié AVANT toute
 * écriture ; son échec (502) annule la suppression et le compte reste intact.
 *
 * La trace d'audit est écrite APRÈS la suppression, avec l'email et la
 * volumétrie en instantané : l'utilisateur n'existe plus pour la retrouver.
 * `targetUserId` n'est pas une clé étrangère, la trace survit donc au compte.
 */
export const deleteManager = asyncHandler(async (req: Request, res: Response) => {
  const { email, reason } = deleteManagerSchema.parse(req.body);

  const manager = await trouverGestionnaire(req.params.id);
  if (!manager.suspendedAt) {
    throw new ApiError(409, "Suspendez d'abord ce compte : seul un compte suspendu peut être supprimé définitivement.", "ACCOUNT_SUSPEND_FIRST");
  }
  if (email.toLowerCase() !== manager.email.trim().toLowerCase()) {
    throw new ApiError(400, "L'email saisi ne correspond pas à celui du compte.", "ACCOUNT_EMAIL_MISMATCH");
  }

  const facturationResiliee = Boolean(manager.stripeSubscriptionId);
  const supprime = await supprimerCompteGestionnaire(manager);

  await logAdminAction({
    req,
    action: "manager.delete",
    targetUserId: manager.id,
    targetLabel: manager.email,
    details:
      `Compte supprimé définitivement (${supprime.biens} bien(s), ${supprime.locataires} locataire(s), ` +
      `${supprime.annonces} annonce(s), ${supprime.collaborateurs} collaborateur(s)` +
      `${facturationResiliee ? ", abonnement Stripe résilié" : ""}). Motif : ${reason}`,
  });

  res.json({ success: true, subscriptionCancelled: facturationResiliee });
});
