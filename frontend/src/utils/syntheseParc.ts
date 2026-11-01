import type { Owner, Property, PropertyStatus, Tenant } from "../types";
import { csvEscape, csvMontant, CSV_BOM } from "./csv";

/**
 * Calculs des listes de l'espace gestionnaire (biens, locataires, propriétaires), hors des écrans pour être testés.
 * Les loyers restent par devise : on n'additionne jamais deux monnaies.
 */

/** Loyer mensuel rapporté au mètre carré ; `null` sans surface exploitable. */
export function loyerAuM2(loyer: number, surface: number): number | null {
  return surface > 0 ? loyer / surface : null;
}

export interface SyntheseParcDevise {
  currency: string;
  /** Loyers des biens loués : ce que le parc rapporte chaque mois. */
  loyerLoue: number;
  /** Loyers des biens à louer : ce qui manque tant qu'ils restent vacants. */
  manqueAGagner: number;
  /** Loyer moyen au m² de la devise (surfaces et loyers cumulés), ou `null`. */
  loyerM2Moyen: number | null;
}

export interface SyntheseParc {
  parStatut: Record<PropertyStatus, number>;
  /** Part de biens loués, en % arrondi ; 0 sans bien. */
  tauxOccupation: number;
  parDevise: SyntheseParcDevise[];
}

export function syntheseBiens(biens: Property[], deviseParDefaut = "EUR"): SyntheseParc {
  const parStatut: Record<PropertyStatus, number> = { AVAILABLE: 0, OCCUPIED: 0, MAINTENANCE: 0 };
  const cumuls = new Map<string, { loue: number; vacant: number; loyer: number; surface: number }>();
  for (const b of biens) {
    parStatut[b.status] += 1;
    const devise = b.currency ?? deviseParDefaut;
    const c = cumuls.get(devise) ?? { loue: 0, vacant: 0, loyer: 0, surface: 0 };
    if (b.status === "OCCUPIED") c.loue += b.rent;
    if (b.status === "AVAILABLE") c.vacant += b.rent;
    c.loyer += b.rent;
    c.surface += b.surface;
    cumuls.set(devise, c);
  }
  return {
    parStatut,
    tauxOccupation: biens.length > 0 ? Math.round((parStatut.OCCUPIED / biens.length) * 100) : 0,
    parDevise: Array.from(cumuls.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, c]) => ({ currency, loyerLoue: c.loue, manqueAGagner: c.vacant, loyerM2Moyen: loyerAuM2(c.loyer, c.surface) })),
  };
}

export type CritereTriBien = "recent" | "loyerDesc" | "loyerAsc" | "surfaceDesc" | "titre";

/** Trie une copie de la liste. « recent » garde l'ordre du serveur (du plus récent au plus ancien). */
export function trierBiens(biens: Property[], critere: CritereTriBien): Property[] {
  const copie = [...biens];
  switch (critere) {
    case "loyerDesc":
      return copie.sort((a, b) => b.rent - a.rent);
    case "loyerAsc":
      return copie.sort((a, b) => a.rent - b.rent);
    case "surfaceDesc":
      return copie.sort((a, b) => b.surface - a.surface);
    case "titre":
      return copie.sort((a, b) => a.title.localeCompare(b.title));
    default:
      return copie;
  }
}

export function nomProprietaire(o: Pick<Owner, "firstName" | "lastName" | "companyName">): string {
  return o.companyName?.trim() ? o.companyName : `${o.firstName} ${o.lastName}`;
}

const ligne = (cases: Array<string | number>) => cases.map((c) => (typeof c === "number" ? String(c) : csvEscape(c))).join(";");

/** Biens en CSV pour un tableur francophone : une ligne par bien, montants à virgule, statut tel que l'écran l'affiche. */
export function csvBiens(
  biens: Property[],
  proprietaires: Map<string, string>,
  libelles: { title: string; address: string; surface: string; rent: string; currency: string; rentPerM2: string; status: string; owner: string },
  statut: (s: PropertyStatus) => string
): string {
  const sortie = [ligne([libelles.title, libelles.address, libelles.surface, libelles.rent, libelles.currency, libelles.rentPerM2, libelles.status, libelles.owner])];
  for (const b of biens) {
    const m2 = loyerAuM2(b.rent, b.surface);
    sortie.push(
      [
        csvEscape(b.title),
        csvEscape(b.address),
        csvMontant(b.surface),
        csvMontant(b.rent),
        csvEscape(b.currency ?? ""),
        m2 === null ? '""' : csvMontant(m2),
        csvEscape(statut(b.status)),
        csvEscape((b.ownerId && proprietaires.get(b.ownerId)) || ""),
      ].join(";")
    );
  }
  return CSV_BOM + sortie.join("\n");
}

/** Locataires en CSV : coordonnées, accès au portail et score de fiabilité. Une fiche anonymisée n'est pas exportée. */
export function csvLocataires(
  locataires: Tenant[],
  libelles: { name: string; phone: string; email: string; portal: string; reliability: string; yes: string; no: string }
): string {
  const sortie = [ligne([libelles.name, libelles.phone, libelles.email, libelles.portal, libelles.reliability])];
  for (const l of locataires) {
    if (l.anonymizedAt) continue;
    const f = l.fiabilite;
    sortie.push(
      [
        csvEscape(`${l.firstName} ${l.lastName}`),
        csvEscape(l.phone),
        csvEscape(l.email),
        csvEscape(l.userId ? libelles.yes : libelles.no),
        f && f.score !== null ? String(f.score) : '""',
      ].join(";")
    );
  }
  return CSV_BOM + sortie.join("\n");
}

/** Propriétaires en CSV : coordonnées, commission et accès au portail ; l'IBAN n'y figure pas (donnée bancaire). */
export function csvProprietaires(
  proprietaires: Owner[],
  libelles: { name: string; company: string; phone: string; email: string; feeRate: string; portal: string },
  statutPortail: (o: Owner) => string
): string {
  const sortie = [ligne([libelles.name, libelles.company, libelles.phone, libelles.email, libelles.feeRate, libelles.portal])];
  for (const o of proprietaires) {
    if (o.anonymizedAt) continue;
    sortie.push(
      [
        csvEscape(`${o.firstName} ${o.lastName}`),
        csvEscape(o.companyName ?? ""),
        csvEscape(o.phone),
        csvEscape(o.email),
        csvMontant(o.managementFeeRate),
        csvEscape(statutPortail(o)),
      ].join(";")
    );
  }
  return CSV_BOM + sortie.join("\n");
}

/** Locataire dont la ponctualité demande un œil : niveau « moyen » ou « risque », ou un loyer actuellement en retard. */
export function aSurveiller(l: Pick<Tenant, "fiabilite" | "anonymizedAt">): boolean {
  const f = l.fiabilite;
  if (!f || l.anonymizedAt) return false;
  return f.niveau === "risque" || f.niveau === "moyen" || f.enRetardActuel > 0;
}

export type CritereTriLocataire = "recent" | "nom" | "fiabilite";

/** Trie une copie. « fiabilite » met les scores les plus bas d'abord, ceux sans score (pas assez d'historique) à la fin. */
export function trierLocataires(locataires: Tenant[], critere: CritereTriLocataire): Tenant[] {
  const copie = [...locataires];
  if (critere === "nom") return copie.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
  if (critere === "fiabilite") {
    return copie.sort((a, b) => {
      const sa = a.fiabilite?.score ?? null;
      const sb = b.fiabilite?.score ?? null;
      if (sa === null && sb === null) return 0;
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sa - sb;
    });
  }
  return copie;
}

export type CritereTriProprietaire = "recent" | "nom" | "commission";

export function trierProprietaires(proprietaires: Owner[], critere: CritereTriProprietaire): Owner[] {
  const copie = [...proprietaires];
  if (critere === "nom") return copie.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
  if (critere === "commission") return copie.sort((a, b) => b.managementFeeRate - a.managementFeeRate);
  return copie;
}
