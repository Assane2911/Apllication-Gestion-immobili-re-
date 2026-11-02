/**
 * Calculs de l'espace administrateur : virements en attente, journal d'audit, suggestions. Fonctions pures (l'heure est
 * passée en argument) pour rester testables.
 */
import { CSV_BOM, csvEscape, csvMontant } from "./csv";
import { correspond } from "./recherche";
import { type PeriodeJournal, dansLaPeriode } from "./syntheseExploitation";

const ligne = (cases: Array<string | number>) => cases.map(csvEscape).join(";");
const JOUR_MS = 86_400_000;

/** Au-delà de ce délai, un virement annoncé et toujours non traité attend depuis trop longtemps. */
export const SEUIL_ATTENTE_VIREMENT_JOURS = 3;

// ───────────────────────────── Virements en attente ─────────────────────────────

export interface VirementAttente {
  id: string;
  managerEmail: string;
  plan: string;
  amount: number;
  currency: string;
  billingCycle: string;
  paymentRef: string | null;
  startDate: string;
  endDate: string;
  createdAt: string;
}

export function joursAttente(v: Pick<VirementAttente, "createdAt">, maintenant: Date = new Date()): number {
  return Math.max(0, Math.floor((maintenant.getTime() - new Date(v.createdAt).getTime()) / JOUR_MS));
}

export type FiltreVirements = "all" | "late";

/** Recherche par e-mail du gestionnaire ou référence du virement ; « late » garde ceux qui attendent depuis trop longtemps. */
export function filtrerVirements<T extends VirementAttente>(virements: T[], requete: string, filtre: FiltreVirements, maintenant: Date = new Date()): T[] {
  return virements.filter((v) => correspond(requete, v.managerEmail, v.paymentRef) && (filtre === "all" || joursAttente(v, maintenant) >= SEUIL_ATTENTE_VIREMENT_JOURS));
}

export function csvVirements(
  virements: VirementAttente[],
  libelles: { manager: string; plan: string; cycle: string; amount: string; currency: string; reference: string; since: string; waiting: string },
  formaterDate: (iso: string) => string,
  maintenant: Date = new Date()
): string {
  const sortie = [ligne([libelles.manager, libelles.plan, libelles.cycle, libelles.amount, libelles.currency, libelles.reference, libelles.since, libelles.waiting])];
  for (const v of virements) {
    sortie.push(ligne([v.managerEmail, v.plan, v.billingCycle, csvMontant(v.amount), v.currency, v.paymentRef ?? "", formaterDate(v.createdAt), joursAttente(v, maintenant)]));
  }
  return CSV_BOM + sortie.join("\n");
}

// ───────────────────────────── Journal d'audit ─────────────────────────────

export interface EntreeAudit {
  id: string;
  adminEmail: string;
  action: string;
  targetLabel: string | null;
  details: string | null;
  createdAt: string;
}

/** Recherche dans l'administrateur, l'action (traduite), la cible et le détail, puis filtre par période. */
export function filtrerAudit<T extends EntreeAudit>(entrees: T[], requete: string, periode: PeriodeJournal, libelleAction: (action: string) => string, maintenant: Date = new Date()): T[] {
  return entrees.filter((e) => dansLaPeriode(e, periode, maintenant) && correspond(requete, e.adminEmail, libelleAction(e.action), e.targetLabel, e.details));
}

// ───────────────────────────── Suggestions ─────────────────────────────

export interface SuggestionRecherchable {
  authorLabel: string;
  page: string | null;
  message: string;
  adminNote?: string | null;
}

export function filtrerSuggestions<T extends SuggestionRecherchable>(suggestions: T[], requete: string): T[] {
  return suggestions.filter((s) => correspond(requete, s.authorLabel, s.page, s.message, s.adminNote));
}
