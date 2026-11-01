import type { DashboardStats } from "../types";
import { csvEscape, csvMontant, CSV_BOM } from "./csv";

/**
 * Calculs du tableau de bord gestionnaire, hors de l'écran pour être testés : ce qu'il y a à traiter, le mois en cours
 * devise par devise, et l'export des six mois. Aucune addition entre devises : chaque monnaie reste sur sa ligne.
 */

export type CleAction = "late" | "issues" | "vacant" | "maintenance" | "remaining";

export interface ActionATraiter {
  cle: CleAction;
  /** Nombre d'éléments concernés (factures, incidents, biens) ; 0 pour le reste à encaisser, qui se dit en montants. */
  compte: number;
  lien: string;
  /** Un impayé ou un incident attend une réponse ; un bien vacant ou en travaux est une information. */
  urgent: boolean;
}

/** Reste à encaisser ce mois-ci, par devise : seulement les devises où le loyer attendu dépasse l'encaissé. */
export function resteAEncaisser(stats: Pick<DashboardStats, "monthlyRevenueByCurrency" | "monthlyExpectedByCurrency">): Record<string, number> {
  const reste: Record<string, number> = {};
  for (const [devise, attendu] of Object.entries(stats.monthlyExpectedByCurrency ?? {})) {
    const difference = Number(attendu) - Number(stats.monthlyRevenueByCurrency?.[devise] ?? 0);
    if (difference > 0.005) reste[devise] = difference;
  }
  return reste;
}

/** Ce qui demande une action, du plus pressant au moins pressant. Liste vide : tout est à jour. */
export function actionsATraiter(stats: DashboardStats): ActionATraiter[] {
  const actions: ActionATraiter[] = [];
  if ((stats.lateInvoices ?? 0) > 0) actions.push({ cle: "late", compte: stats.lateInvoices, lien: "/invoices", urgent: true });
  if ((stats.openIssues ?? 0) > 0) actions.push({ cle: "issues", compte: stats.openIssues, lien: "/issues", urgent: true });
  if (Object.keys(resteAEncaisser(stats)).length > 0) actions.push({ cle: "remaining", compte: 0, lien: "/invoices", urgent: false });
  const vacants = stats.propertiesByStatus?.AVAILABLE ?? 0;
  if (vacants > 0) actions.push({ cle: "vacant", compte: vacants, lien: "/annonces", urgent: false });
  const travaux = stats.propertiesByStatus?.MAINTENANCE ?? 0;
  if (travaux > 0) actions.push({ cle: "maintenance", compte: travaux, lien: "/properties", urgent: false });
  return actions;
}

export interface SyntheseDevise {
  currency: string;
  encaisse: number;
  attendu: number;
  reste: number;
  /** Part du loyer attendu déjà encaissée (0 à 100) ; `null` quand rien n'est attendu. */
  taux: number | null;
  depenses: number;
  /** Encaissé moins dépenses du mois : peut être négatif. */
  net: number;
  /** Écart en % de l'encaissé par rapport au mois précédent ; `null` quand le mois précédent est à zéro. */
  variation: number | null;
}

/** Clés « AAAA-MM » du mois en cours et du précédent, dans le fuseau du navigateur (comme l'axe du graphique). */
export function moisCourantEtPrecedent(maintenant: Date): { courant: string; precedent: string } {
  const cle = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return {
    courant: cle(new Date(maintenant.getFullYear(), maintenant.getMonth(), 1)),
    precedent: cle(new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 1)),
  };
}

/** Le mois en cours, une ligne par devise, triées par code. */
export function syntheseDuMois(stats: DashboardStats, maintenant: Date): SyntheseDevise[] {
  const { courant, precedent } = moisCourantEtPrecedent(maintenant);
  const depensesDuMois = stats.expensesByMonth?.[courant] ?? {};
  const devises = Array.from(
    new Set([...Object.keys(stats.monthlyRevenueByCurrency ?? {}), ...Object.keys(stats.monthlyExpectedByCurrency ?? {}), ...Object.keys(depensesDuMois)])
  ).sort();
  return devises.map((currency) => {
    const encaisse = Number(stats.monthlyRevenueByCurrency?.[currency] ?? 0);
    const attendu = Number(stats.monthlyExpectedByCurrency?.[currency] ?? 0);
    const depenses = Number(depensesDuMois[currency] ?? 0);
    const avant = Number(stats.revenueByMonth?.[precedent]?.[currency] ?? 0);
    return {
      currency,
      encaisse,
      attendu,
      reste: Math.max(0, attendu - encaisse),
      taux: attendu > 0 ? Math.round((encaisse / attendu) * 100) : null,
      depenses,
      net: encaisse - depenses,
      variation: avant > 0 ? Math.round(((encaisse - avant) / avant) * 100) : null,
    };
  });
}

export interface LigneMois {
  month: string;
  currency: string;
  revenue: number;
  expense: number;
}

/** Six mois en CSV pour un tableur francophone : une ligne par mois et par devise, mois au format AAAA-MM. */
export function csvSixMois(lignes: LigneMois[], libelles: { month: string; currency: string; revenue: string; expense: string; net: string }): string {
  const sortie = [[libelles.month, libelles.currency, libelles.revenue, libelles.expense, libelles.net].map(csvEscape).join(";")];
  for (const l of lignes) {
    sortie.push([csvEscape(l.month), csvEscape(l.currency), csvMontant(l.revenue), csvMontant(l.expense), csvMontant(l.revenue - l.expense)].join(";"));
  }
  return CSV_BOM + sortie.join("\n");
}
