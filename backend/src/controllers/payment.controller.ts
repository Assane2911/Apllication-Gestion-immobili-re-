import { Request, Response } from "express";
import { moyensDePaiementDisponibles } from "../services/payment.service";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * Moyens de paiement réellement utilisables pour un montant dans la devise
 * demandée.
 *
 * Pourquoi cette route existe. L'interface listait les moyens en dur, et
 * masquait Stripe par un commentaire dans le composant. Résultat en
 * production : le seul bouton proposé (PayDunya) répondait « Ce moyen de
 * paiement est momentanément indisponible », et le message invitait à « en
 * choisir un autre » alors qu'il n'y en avait pas. Un moyen de paiement n'est
 * pas une constante d'affichage : il dépend des clés configurées et de la
 * devise du compte encaisseur, deux informations que seul le serveur connaît.
 *
 * La liste vient de la MÊME règle que celle qui refuse un paiement
 * (indisponibilite dans payment.service.ts) : l'interface ne peut donc pas
 * proposer un moyen que le serveur refuserait.
 */
export const getAvailableMethods = asyncHandler(async (req: Request, res: Response) => {
  const currency = (typeof req.query.currency === "string" ? req.query.currency : "EUR").toUpperCase();

  res.json({
    currency,
    methods: moyensDePaiementDisponibles(currency),
  });
});
