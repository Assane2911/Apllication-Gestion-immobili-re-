import type { InsurancePolicy } from "../types";
import { ecartEnJours } from "./jourCivil";

/**
 * Calculs des pages financières (dépenses, assurances, bilan fiscal), hors des écrans pour être testés. Les montants
 * restent par devise : on ne rapporte jamais un total en euros à un total en francs CFA.
 */

/** Part des dépenses dans les revenus, en % arrondi, quand il n'y a qu'une devise et des revenus ; sinon `null`. */
export function partDesDepenses(revenus: Record<string, number>, depenses: Record<string, number>): number | null {
  const devises = new Set([...Object.keys(revenus), ...Object.keys(depenses)]);
  if (devises.size !== 1) return null;
  const [devise] = Array.from(devises);
  const recu = Number(revenus[devise] ?? 0);
  return recu > 0 ? Math.round((Number(depenses[devise] ?? 0) / recu) * 100) : null;
}

export interface LigneCategorie {
  categorie: string;
  parDevise: Record<string, number>;
  /** Part de la catégorie dans le total, en % ; `null` quand les dépenses sont en plusieurs devises. */
  part: number | null;
}

/** Dépenses par catégorie, de la plus lourde à la plus légère (dans la devise unique, sinon par ordre alphabétique). */
export function repartitionParCategorie(parCategorie: Record<string, Record<string, number>>): LigneCategorie[] {
  const entrees = Object.entries(parCategorie);
  const devises = new Set(entrees.flatMap(([, montants]) => Object.keys(montants)));
  const devise = devises.size === 1 ? Array.from(devises)[0] : null;
  const total = devise ? entrees.reduce((somme, [, montants]) => somme + Number(montants[devise] ?? 0), 0) : 0;
  const lignes = entrees.map(([categorie, parDevise]) => ({
    categorie,
    parDevise,
    part: devise && total > 0 ? Math.round((Number(parDevise[devise] ?? 0) / total) * 100) : null,
  }));
  return lignes.sort((a, b) => (devise ? Number(b.parDevise[devise] ?? 0) - Number(a.parDevise[devise] ?? 0) : a.categorie.localeCompare(b.categorie)));
}

// ───────────────────────────── Assurances ─────────────────────────────

/** Même seuil que le rappel serveur par défaut (INSURANCE_REMINDER_DAYS). */
export const JOURS_ALERTE_ECHEANCE = 30;

export type EtatPolice = "expired" | "soon" | "valid";

export function etatPolice(expiryDate: string, maintenant: Date = new Date()): EtatPolice {
  const jours = ecartEnJours(expiryDate, maintenant);
  if (jours < 0) return "expired";
  return jours <= JOURS_ALERTE_ECHEANCE ? "soon" : "valid";
}

export interface SyntheseAssurances {
  total: number;
  echues: number;
  bientot: number;
  /** Primes annuelles cumulées des polices non échues, par devise. */
  primes: Array<{ currency: string; total: number }>;
}

export function syntheseAssurances(polices: InsurancePolicy[], maintenant: Date = new Date()): SyntheseAssurances {
  let echues = 0;
  let bientot = 0;
  const primes = new Map<string, number>();
  for (const p of polices) {
    const etat = etatPolice(p.expiryDate, maintenant);
    if (etat === "expired") echues += 1;
    else {
      if (etat === "soon") bientot += 1;
      if (p.premiumAmount != null) primes.set(p.currency, (primes.get(p.currency) ?? 0) + p.premiumAmount);
    }
  }
  return {
    total: polices.length,
    echues,
    bientot,
    primes: Array.from(primes.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, total]) => ({ currency, total })),
  };
}

/** Variation en % d'un total par rapport à l'année précédente, dans une devise ; `null` sans base de comparaison. */
export function variationAnnuelle(actuel: number, precedent: number | undefined): number | null {
  return precedent && precedent > 0 ? Math.round(((actuel - precedent) / precedent) * 100) : null;
}
