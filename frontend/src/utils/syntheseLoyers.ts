import type { Contract, Invoice } from "../types";
import { csvEscape, csvMontant, CSV_BOM } from "./csv";
import { ecartEnJours } from "./jourCivil";

/**
 * Calculs des listes « Factures » et « Contrats » de l'espace gestionnaire, hors des écrans pour être testés.
 * Les montants restent par devise : on n'additionne jamais deux monnaies.
 */

/** Une facture encore due : ni réglée, ni annulée. */
export const estDue = (f: Pick<Invoice, "status">): boolean => f.status === "PENDING" || f.status === "LATE";

/** Jours écoulés depuis l'échéance d'une facture encore due ; 0 si elle n'est pas échue ou déjà soldée. */
export function joursDeRetard(f: Pick<Invoice, "status" | "dueDate">, maintenant: Date = new Date()): number {
  if (!estDue(f)) return 0;
  return Math.max(0, -ecartEnJours(f.dueDate, maintenant));
}

export interface SyntheseFacturesDevise {
  currency: string;
  /** Ce qu'il reste à encaisser sur les factures dues (acomptes déduits). */
  resteADu: number;
  /** Part de ce reste qui concerne des factures en retard. */
  enRetard: number;
  nbEnRetard: number;
  /** Total réglé (factures payées, plus acomptes des factures dues). */
  encaisse: number;
  /** Part encaissée du total facturé hors annulations, en % arrondi ; `null` sans rien facturé. */
  tauxRecouvrement: number | null;
}

export function syntheseFactures(factures: Invoice[], deviseParDefaut = "EUR"): SyntheseFacturesDevise[] {
  const cumuls = new Map<string, { reste: number; retard: number; nb: number; encaisse: number; facture: number }>();
  for (const f of factures) {
    if (f.status === "CANCELLED") continue;
    const devise = f.currency ?? deviseParDefaut;
    const c = cumuls.get(devise) ?? { reste: 0, retard: 0, nb: 0, encaisse: 0, facture: 0 };
    const regle = f.status === "PAID" ? f.amount : (f.montantRegle ?? f.amountPaid ?? 0);
    c.facture += f.amount;
    c.encaisse += regle;
    if (estDue(f)) {
      const reste = f.resteDu ?? f.amount - regle;
      c.reste += reste;
      if (f.status === "LATE") {
        c.retard += reste;
        c.nb += 1;
      }
    }
    cumuls.set(devise, c);
  }
  return Array.from(cumuls.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, c]) => ({
      currency,
      resteADu: c.reste,
      enRetard: c.retard,
      nbEnRetard: c.nb,
      encaisse: c.encaisse,
      tauxRecouvrement: c.facture > 0 ? Math.round((c.encaisse / c.facture) * 100) : null,
    }));
}

/** Factures en CSV pour un tableur francophone : une ligne par facture, mois au format AAAA-MM, montants à virgule. */
export function csvFactures(
  factures: Invoice[],
  libelles: { period: string; tenant: string; property: string; currency: string; amount: string; paid: string; remaining: string; dueDate: string; status: string },
  statut: (s: Invoice["status"]) => string
): string {
  const ligne = (cases: string[]) => cases.map(csvEscape).join(";");
  const sortie = [ligne([libelles.period, libelles.tenant, libelles.property, libelles.currency, libelles.amount, libelles.paid, libelles.remaining, libelles.dueDate, libelles.status])];
  for (const f of factures) {
    const regle = f.status === "PAID" ? f.amount : (f.montantRegle ?? f.amountPaid ?? 0);
    sortie.push(
      [
        csvEscape(`${f.periodYear}-${String(f.periodMonth).padStart(2, "0")}`),
        csvEscape(`${f.contract?.tenant?.firstName ?? ""} ${f.contract?.tenant?.lastName ?? ""}`.trim()),
        csvEscape(f.contract?.property?.title ?? ""),
        csvEscape(f.currency ?? ""),
        csvMontant(f.amount),
        csvMontant(regle),
        csvMontant(f.status === "CANCELLED" ? 0 : (f.resteDu ?? f.amount - regle)),
        csvEscape(f.dueDate.slice(0, 10)),
        csvEscape(statut(f.status)),
      ].join(";")
    );
  }
  return CSV_BOM + sortie.join("\n");
}

// ───────────────────────────── Contrats ─────────────────────────────

/** Fenêtre « fin de bail proche » du bandeau et du filtre, en jours. */
export const FIN_PROCHE_JOURS = 60;

export interface AvancementBail {
  /** Part de la durée écoulée, bornée entre 0 et 100. */
  pourcentage: number;
  joursRestants: number;
  dureeJours: number;
}

function jourUtc(valeur: string): [number, number, number] {
  const d = new Date(valeur);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

export function avancementBail(debut: string, fin: string, maintenant: Date = new Date()): AvancementBail {
  // Durée = jours de calendrier entre le début et la fin (deux jours enregistrés en UTC : l'écart est exact).
  const dureeJours = Math.max(1, Math.round((Date.UTC(...jourUtc(fin)) - Date.UTC(...jourUtc(debut))) / 86_400_000));
  const ecoules = dureeJours - ecartEnJours(fin, maintenant);
  return {
    pourcentage: Math.max(0, Math.min(100, Math.round((ecoules / dureeJours) * 100))),
    joursRestants: ecartEnJours(fin, maintenant),
    dureeJours,
  };
}

const actif = (c: Pick<Contract, "status">) => c.status === "ACTIVE";
/** Un bail actif attend une signature si l'agence ou le locataire n'a pas signé. */
export const signatureEnAttente = (c: Pick<Contract, "status" | "signedByManagerAt" | "signedByTenantAt">): boolean => actif(c) && (!c.signedByManagerAt || !c.signedByTenantAt);
export const finProche = (c: Pick<Contract, "status" | "endDate">, maintenant: Date = new Date()): boolean => actif(c) && ecartEnJours(c.endDate, maintenant) <= FIN_PROCHE_JOURS;

export interface SyntheseBaux {
  actifs: number;
  loyers: Array<{ currency: string; total: number }>;
  finsProches: number;
  signaturesEnAttente: number;
}

export function syntheseBaux(contrats: Contract[], maintenant: Date = new Date(), deviseParDefaut = "EUR"): SyntheseBaux {
  const loyers = new Map<string, number>();
  let actifs = 0;
  for (const c of contrats) {
    if (!actif(c)) continue;
    actifs += 1;
    const devise = c.currency ?? deviseParDefaut;
    loyers.set(devise, (loyers.get(devise) ?? 0) + c.rent);
  }
  return {
    actifs,
    loyers: Array.from(loyers.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, total]) => ({ currency, total })),
    finsProches: contrats.filter((c) => finProche(c, maintenant)).length,
    signaturesEnAttente: contrats.filter(signatureEnAttente).length,
  };
}

export type CritereTriBail = "recent" | "fin" | "loyerDesc";

/** Trie une copie. « fin » met en tête les baux actifs qui se terminent le plus tôt, puis les autres par date de fin. */
export function trierBaux(contrats: Contract[], critere: CritereTriBail): Contract[] {
  const copie = [...contrats];
  if (critere === "loyerDesc") return copie.sort((a, b) => b.rent - a.rent);
  if (critere === "fin") {
    return copie.sort((a, b) => {
      if (actif(a) !== actif(b)) return actif(a) ? -1 : 1;
      return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
    });
  }
  return copie;
}

/** Baux en CSV : bien, locataire, loyer, dates, statut et signatures. */
export function csvBaux(
  contrats: Contract[],
  libelles: { property: string; tenant: string; rent: string; currency: string; start: string; end: string; status: string; agencySigned: string; tenantSigned: string; yes: string; no: string },
  statut: (s: Contract["status"]) => string
): string {
  const ligne = (cases: string[]) => cases.map(csvEscape).join(";");
  const sortie = [ligne([libelles.property, libelles.tenant, libelles.rent, libelles.currency, libelles.start, libelles.end, libelles.status, libelles.agencySigned, libelles.tenantSigned])];
  for (const c of contrats) {
    sortie.push(
      [
        csvEscape(c.property?.title ?? ""),
        csvEscape(`${c.tenant?.firstName ?? ""} ${c.tenant?.lastName ?? ""}`.trim()),
        csvMontant(c.rent),
        csvEscape(c.currency ?? ""),
        csvEscape(c.startDate.slice(0, 10)),
        csvEscape(c.endDate.slice(0, 10)),
        csvEscape(statut(c.status)),
        csvEscape(c.signedByManagerAt ? libelles.yes : libelles.no),
        csvEscape(c.signedByTenantAt ? libelles.yes : libelles.no),
      ].join(";")
    );
  }
  return CSV_BOM + sortie.join("\n");
}
