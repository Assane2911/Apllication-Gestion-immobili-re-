import type { LeadStatus, Listing, ListingLead } from "../types";
import { csvEscape, CSV_BOM } from "./csv";

/**
 * Calculs des pages « Location et échanges » (annonces, demandes, messages), hors des écrans pour être testés.
 */

const JOUR = 86_400_000;

// ───────────────────────────── Annonces ─────────────────────────────

export interface SyntheseAnnonces {
  publiees: number;
  brouillons: number;
  archivees: number;
  vedettes: number;
  /** Annonces masquées par l'administration : elles ne sont plus visibles de la vitrine. */
  masquees: number;
}

export function syntheseAnnonces(annonces: Listing[]): SyntheseAnnonces {
  return {
    publiees: annonces.filter((a) => a.status === "PUBLISHED").length,
    brouillons: annonces.filter((a) => a.status === "DRAFT").length,
    archivees: annonces.filter((a) => a.status === "ARCHIVED").length,
    vedettes: annonces.filter((a) => a.featured).length,
    masquees: annonces.filter((a) => a.hiddenByAdminAt).length,
  };
}

export type CritereTriAnnonce = "recent" | "prixDesc" | "prixAsc" | "titre";

/** Trie une copie. « recent » garde l'ordre du serveur (du plus récent au plus ancien). */
export function trierAnnonces(annonces: Listing[], critere: CritereTriAnnonce): Listing[] {
  const copie = [...annonces];
  if (critere === "prixDesc") return copie.sort((a, b) => b.price - a.price);
  if (critere === "prixAsc") return copie.sort((a, b) => a.price - b.price);
  if (critere === "titre") return copie.sort((a, b) => a.title.localeCompare(b.title));
  return copie;
}

/** Adresse publique d'une annonce sur la vitrine, à coller dans un message ou un réseau social. */
export function lienVitrine(origine: string, id: string): string {
  return `${origine}/vitrine/annonces/${id}`;
}

// ───────────────────────────── Demandes ─────────────────────────────

/** Une demande reçue depuis plus de ce nombre de jours sans réponse passe en « à relancer ». */
export const JOURS_AVANT_RELANCE = 2;

export function ageEnJours(creeLe: string, maintenant: Date = new Date()): number {
  return Math.max(0, Math.floor((maintenant.getTime() - new Date(creeLe).getTime()) / JOUR));
}

/** Demande restée « nouvelle » au-delà du délai : le prospect attend une réponse. */
export function aRepondreVite(d: Pick<ListingLead, "status" | "createdAt">, maintenant: Date = new Date()): boolean {
  return d.status === "NEW" && ageEnJours(d.createdAt, maintenant) >= JOURS_AVANT_RELANCE;
}

export interface SyntheseDemandes {
  nouvelles: number;
  aRepondre: number;
  /** Visites demandées et pas encore faites (nouvelles ou contactées). */
  visitesAOrganiser: number;
  enCours: number;
  abouties: number;
  /** Part des demandes abouties parmi celles qui ne sont pas archivées, en % ; `null` sans demande. */
  tauxAboutissement: number | null;
}

export function syntheseDemandes(demandes: ListingLead[], maintenant: Date = new Date()): SyntheseDemandes {
  const compte = (statuts: LeadStatus[]) => demandes.filter((d) => statuts.includes(d.status)).length;
  const actives = demandes.filter((d) => d.status !== "ARCHIVED");
  const abouties = compte(["CONVERTED"]);
  return {
    nouvelles: compte(["NEW"]),
    aRepondre: demandes.filter((d) => aRepondreVite(d, maintenant)).length,
    visitesAOrganiser: demandes.filter((d) => d.requestType === "VISIT" && (d.status === "NEW" || d.status === "CONTACTED")).length,
    enCours: compte(["CONTACTED", "VISITED"]),
    abouties,
    tauxAboutissement: actives.length > 0 ? Math.round((abouties / actives.length) * 100) : null,
  };
}

/**
 * Lien WhatsApp d'un numéro, seulement s'il est écrit au format international (« + » ou « 00 » au début) : WhatsApp
 * n'ouvre aucune conversation avec un numéro local sans indicatif.
 */
export function lienWhatsapp(telephone: string): string | null {
  const brut = telephone.trim();
  const international = brut.startsWith("+") || brut.startsWith("00");
  const chiffres = brut.replace(/\D/g, "").replace(/^00/, "");
  return international && chiffres.length >= 8 ? `https://wa.me/${chiffres}` : null;
}

/** Demandes en CSV pour un tableur francophone ; le téléphone passe par csvEscape (le « + » est neutralisé). */
export function csvDemandes(
  demandes: ListingLead[],
  libelles: { date: string; name: string; email: string; phone: string; listing: string; type: string; status: string; message: string },
  type: (t: ListingLead["requestType"]) => string,
  statut: (s: LeadStatus) => string
): string {
  const ligne = (cases: string[]) => cases.map(csvEscape).join(";");
  const sortie = [ligne([libelles.date, libelles.name, libelles.email, libelles.phone, libelles.listing, libelles.type, libelles.status, libelles.message])];
  for (const d of demandes) {
    sortie.push(ligne([d.createdAt.slice(0, 10), d.prospectName, d.prospectEmail, d.prospectPhone, d.listingTitle ?? "", type(d.requestType), statut(d.status), d.message ?? ""]));
  }
  return CSV_BOM + sortie.join("\n");
}
