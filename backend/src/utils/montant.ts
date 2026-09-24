import { DEVISES } from "./devises";

/**
 * Écrit un montant comme le portail l'écrit.
 *
 * Le frontend met en forme les sommes depuis toujours ; le serveur, lui, les
 * concaténait telles quelles — « 35000 XOF » là où le locataire lisait
 * « 35 000 FCFA » sur son espace. Tant que les rappels ne partaient pas, les
 * deux versions ne se croisaient jamais. Ce sont pourtant les seuls messages
 * qu'un locataire reçoit : l'email d'avis d'échéance et le rappel WhatsApp.
 *
 * Le formatage doit rester identique des deux côtés (voir
 * `frontend/src/context/CurrencyContext.tsx`) : locale fr-FR, aucune décimale
 * imposée, deux au maximum. Un loyer s'écrit « 450 € » et non « 450,00 € »,
 * mais une régularisation au centime garde ses centimes.
 *
 * Une devise inconnue affiche son code brut plutôt qu'un symbole de
 * remplacement — même parti pris qu'au portail : un montant visiblement
 * inhabituel se corrige, un montant faux d'apparence normale se découvre au
 * litige.
 */
export function formaterMontant(montant: number, devise?: string | null): string {
  const code = devise || "EUR";
  const nombre = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(montant);

  const presentation = DEVISES[code];
  if (!presentation) return `${nombre} ${code}`;

  return presentation.position === "avant"
    ? `${presentation.symbole}${nombre}`
    : `${nombre} ${presentation.symbole}`;
}
