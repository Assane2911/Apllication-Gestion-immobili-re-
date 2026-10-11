/**
 * Libellé lisible d'un moyen de paiement, pour les documents remis au locataire.
 *
 * La quittance affichait jusqu'ici la valeur technique de l'énumération
 * (« BANK_TRANSFER », « DEMO »…) dans la colonne « Moyen de paiement » : un
 * document officiel remis à un locataire ne doit pas contenir un identifiant
 * de code. Une facture sans moyen enregistré (paiement saisi à la main avant
 * l'ajout du choix, ou donnée ancienne) n'affiche plus non plus un moyen
 * inventé (« DEMO » dans le courriel, « VIREMENT » dans la quittance en ligne,
 * deux valeurs différentes pour le même cas) : « Non précisé », sans rien
 * affirmer qui n'ait été saisi.
 */
const LIBELLES: Record<string, string> = {
  BANK_TRANSFER: "Virement bancaire",
  STRIPE: "Carte bancaire (en ligne)",
  PAYDUNYA: "Mobile Money / carte (en ligne)",
  DEMO: "Paiement de démonstration",
};

export function libelleMoyenPaiement(moyen: string | null | undefined): string {
  if (!moyen) return "Non précisé";
  // Une valeur inconnue (moyen ajouté plus tard à l'énumération sans mise à
  // jour d'ici) s'affiche telle quelle plutôt que de disparaître.
  return LIBELLES[moyen] ?? moyen;
}
