/**
 * Calculs de l'espace administrateur : journal d'audit, suggestions. Fonctions pures (l'heure est
 * passée en argument) pour rester testables.
 */
import { correspond } from "./recherche";
import { type PeriodeJournal, dansLaPeriode } from "./syntheseExploitation";

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
