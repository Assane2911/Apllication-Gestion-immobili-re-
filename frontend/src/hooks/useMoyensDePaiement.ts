import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { PaymentMethod } from "../types";

/**
 * Moyens de paiement réellement utilisables pour un montant dans cette devise.
 *
 * Les écrans listaient les moyens en dur, avec Stripe masqué par un
 * commentaire. En production, le seul bouton proposé répondait « Ce moyen de
 * paiement est momentanément indisponible » et invitait à en choisir un autre
 * — alors qu'il n'y en avait pas. La disponibilité dépend des clés
 * configurées et de la devise du compte encaisseur : seul le serveur le sait.
 *
 * `null` signifie « pas encore chargé », à distinguer d'une liste vide.
 *
 * En cas d'échec réseau, on retombe sur le virement bancaire seul. Ce n'est
 * pas une supposition optimiste : côté serveur, le virement est une
 * déclaration et non un encaissement, il est donc toujours accepté (voir
 * indisponibilite dans payment.service.ts). Proposer davantage sans réponse du
 * serveur reviendrait à réintroduire le bouton qui échoue.
 */
export function useMoyensDePaiement(currency: string | null | undefined): PaymentMethod[] | null {
  const [moyens, setMoyens] = useState<PaymentMethod[] | null>(null);

  useEffect(() => {
    if (!currency) {
      setMoyens(null);
      return;
    }

    let annule = false;
    api
      .get<{ currency: string; methods: PaymentMethod[] }>(
        `/payments/methods?currency=${encodeURIComponent(currency)}`
      )
      .then((res) => {
        if (!annule) setMoyens(res.data.methods);
      })
      .catch(() => {
        if (!annule) setMoyens(["BANK_TRANSFER"]);
      });

    return () => {
      annule = true;
    };
  }, [currency]);

  return moyens;
}
