import { LANGUE_PAR_DEFAUT, type Langue } from "./langue";

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
const LIBELLES: Record<Langue, Record<string, string>> = {
  fr: {
    BANK_TRANSFER: "Virement bancaire",
    STRIPE: "Carte bancaire (en ligne)",
    PAYDUNYA: "Mobile Money / carte (en ligne)",
    DEMO: "Paiement de démonstration",
    CASH: "Espèces",
    CHEQUE: "Chèque",
    MOBILE_MONEY: "Mobile Money",
  },
  en: {
    BANK_TRANSFER: "Bank transfer",
    STRIPE: "Bank card (online)",
    PAYDUNYA: "Mobile Money / card (online)",
    DEMO: "Demo payment",
    CASH: "Cash",
    CHEQUE: "Cheque",
    MOBILE_MONEY: "Mobile Money",
  },
  es: {
    BANK_TRANSFER: "Transferencia bancaria",
    STRIPE: "Tarjeta bancaria (en línea)",
    PAYDUNYA: "Mobile Money / tarjeta (en línea)",
    DEMO: "Pago de demostración",
    CASH: "Efectivo",
    CHEQUE: "Cheque",
    MOBILE_MONEY: "Mobile Money",
  },
  pt: {
    BANK_TRANSFER: "Transferência bancária",
    STRIPE: "Cartão bancário (online)",
    PAYDUNYA: "Mobile Money / cartão (online)",
    DEMO: "Pagamento de demonstração",
    CASH: "Dinheiro",
    CHEQUE: "Cheque",
    MOBILE_MONEY: "Mobile Money",
  },
};

const NON_PRECISE: Record<Langue, string> = { fr: "Non précisé", en: "Not specified", es: "No especificado", pt: "Não especificado" };

/** Le libellé dans la langue donnée (français par défaut, comme avant que les personnes aient une langue). */
export function libelleMoyenPaiement(moyen: string | null | undefined, langue: Langue = LANGUE_PAR_DEFAUT): string {
  if (!moyen) return NON_PRECISE[langue];
  // Une valeur inconnue (moyen ajouté plus tard à l'énumération sans mise à
  // jour d'ici) s'affiche telle quelle plutôt que de disparaître.
  return LIBELLES[langue][moyen] ?? moyen;
}
