import { useEffect, useRef, useState } from "react";

export type RetourDePaiement = "succes" | "annule" | null;

/**
 * Lit le retour d'un prestataire de paiement après redirection.
 *
 * Stripe et PayDunya ramènent le payeur sur l'application avec `?stripe=succes`
 * ou `?paydunya=annule` (voir payment.service.ts). Jusqu'ici aucune page ne
 * lisait ce paramètre : le client revenait, ne voyait aucun message, et son
 * abonnement n'était pas encore confirmé — la confirmation arrive par webhook,
 * en parallèle du retour du navigateur, et peut le devancer de quelques
 * secondes. De quoi croire à un échec et payer une seconde fois.
 *
 * D'où les deux comportements ci-dessous :
 *
 *  - le paramètre est retiré de l'URL aussitôt lu, pour qu'un rafraîchissement
 *    ne ré-annonce pas un paiement déjà traité ;
 *  - en cas de succès, les données sont rechargées plusieurs fois sur une
 *    quinzaine de secondes. Un seul rechargement immédiat arriverait presque
 *    toujours avant le webhook et afficherait un état périmé.
 */
export function useRetourDePaiement(recharger: () => void): RetourDePaiement {
  const [retour, setRetour] = useState<RetourDePaiement>(null);

  // La fonction de rechargement est souvent redéfinie à chaque rendu ; la
  // passer en dépendance relancerait l'effet en boucle. On garde la dernière
  // version dans une référence, et l'effet ne s'exécute qu'au montage.
  const rechargerRef = useRef(recharger);
  rechargerRef.current = recharger;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const valeur = params.get("stripe") ?? params.get("paydunya");
    if (!valeur) return;

    setRetour(valeur === "succes" ? "succes" : "annule");

    params.delete("stripe");
    params.delete("paydunya");
    const reste = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (reste ? `?${reste}` : ""));

    if (valeur !== "succes") return;

    const minuteries = [2000, 5000, 10000].map((delai) =>
      window.setTimeout(() => rechargerRef.current(), delai)
    );
    return () => minuteries.forEach((id) => window.clearTimeout(id));
  }, []);

  return retour;
}
