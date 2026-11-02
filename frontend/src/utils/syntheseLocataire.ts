/**
 * Calculs de l'espace locataire : situation des loyers, filtres de la liste, suivi des signalements.
 * Fonctions pures (l'heure est passée en argument) pour rester testables.
 */
import type { Invoice, IssueReport } from "../types";
import { ecartEnJours } from "./jourCivil";
import { estDue, joursDeRetard } from "./syntheseLoyers";
import { ageEnJours } from "./syntheseLocation";

// ───────────────────────────── Loyers ─────────────────────────────

export interface MontantDevise {
  devise: string;
  montant: number;
}

export interface SituationLoyers {
  /** Reste à payer, par devise (un loyer en francs CFA ne s'additionne pas à un autre en euros). */
  resteDu: MontantDevise[];
  /** Échéances à régler (en attente ou en retard). */
  aRegler: number;
  /** Échéances dont le jour est passé. */
  enRetard: number;
  /** Retard de l'échéance la plus ancienne encore due, en jours. */
  retardMax: number;
  /** Échéance la plus proche à régler : la plus ancienne des factures encore dues. */
  prochaine: { id: string; dueDate: string; jours: number } | null;
  /** Total réglé pendant l'année en cours, par devise. */
  regleCetteAnnee: MontantDevise[];
}

function ajouter(cumul: Map<string, number>, devise: string, montant: number) {
  cumul.set(devise, (cumul.get(devise) ?? 0) + montant);
}

const enListe = (cumul: Map<string, number>): MontantDevise[] => [...cumul].map(([devise, montant]) => ({ devise, montant: Math.round(montant * 100) / 100 }));

export function situationLoyers(factures: Invoice[], maintenant: Date = new Date()): SituationLoyers {
  const reste = new Map<string, number>();
  const regle = new Map<string, number>();
  const dues = factures.filter(estDue).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  let enRetard = 0;
  let retardMax = 0;

  for (const f of dues) {
    ajouter(reste, f.currency ?? "", f.resteDu ?? f.amount);
    const retard = joursDeRetard(f, maintenant);
    if (retard > 0) enRetard++;
    retardMax = Math.max(retardMax, retard);
  }
  for (const f of factures) {
    if (f.status !== "PAID") continue;
    const annee = f.paidAt ? new Date(f.paidAt).getFullYear() : f.periodYear;
    if (annee === maintenant.getFullYear()) ajouter(regle, f.currency ?? "", f.montantRegle ?? f.amount);
  }

  const premiere = dues[0];
  return {
    resteDu: enListe(reste),
    aRegler: dues.length,
    enRetard,
    retardMax,
    prochaine: premiere ? { id: premiere.id, dueDate: premiere.dueDate, jours: ecartEnJours(premiere.dueDate, maintenant) } : null,
    regleCetteAnnee: enListe(regle),
  };
}

export type FiltreLoyers = "all" | "due" | "paid";

export function filtrerLoyers(factures: Invoice[], filtre: FiltreLoyers, annee: number | "all"): Invoice[] {
  return factures.filter((f) => {
    if (annee !== "all" && f.periodYear !== annee) return false;
    if (filtre === "due") return estDue(f);
    if (filtre === "paid") return f.status === "PAID";
    return true;
  });
}

/** Années couvertes par les factures, de la plus récente à la plus ancienne. */
export function anneesDesLoyers(factures: Invoice[]): number[] {
  return [...new Set(factures.map((f) => f.periodYear))].sort((a, b) => b - a);
}

// ───────────────────────────── Signalements ─────────────────────────────

export type FiltreSignalements = "all" | "active" | "done";

export const estEnCours = (i: Pick<IssueReport, "status">): boolean => i.status === "OPEN" || i.status === "IN_PROGRESS";

export interface SituationSignalements {
  enCours: number;
  traites: number;
  /** Interventions planifiées à venir sur les signalements en cours. */
  planifies: number;
  /** Ancienneté en jours du signalement en cours le plus ancien (0 sans signalement en cours). */
  plusAncien: number;
}

export function situationSignalements(signalements: IssueReport[], maintenant: Date = new Date()): SituationSignalements {
  const enCours = signalements.filter(estEnCours);
  return {
    enCours: enCours.length,
    traites: signalements.filter((i) => i.status === "RESOLVED" || i.status === "REJECTED").length,
    planifies: enCours.filter((i) => i.scheduledAt && new Date(i.scheduledAt).getTime() >= maintenant.getTime()).length,
    plusAncien: enCours.reduce((max, i) => Math.max(max, ageEnJours(i.createdAt, maintenant)), 0),
  };
}

export function filtrerSignalements(signalements: IssueReport[], filtre: FiltreSignalements): IssueReport[] {
  if (filtre === "active") return signalements.filter(estEnCours);
  if (filtre === "done") return signalements.filter((i) => !estEnCours(i));
  return signalements;
}

/** Délai écoulé depuis le signalement, pour une ligne « Signalé il y a N j ». */
export const ancienneteSignalement = (i: Pick<IssueReport, "createdAt">, maintenant: Date = new Date()): number => ageEnJours(i.createdAt, maintenant);

/** Motifs courants proposés en un clic pour le titre d'un signalement. */
export const MOTIFS_SIGNALEMENT = ["leak", "electricity", "lock", "heating", "internet"] as const;
