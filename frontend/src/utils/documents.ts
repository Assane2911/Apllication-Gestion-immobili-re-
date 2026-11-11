import type { CategorieDocument, StoredDocument } from "../types";
import { ecartEnJours } from "./jourCivil";

export const CATEGORIES_DOCUMENT: readonly CategorieDocument[] = ["DIAGNOSTIC", "INSURANCE", "IDENTITY", "INCOME", "GUARANTEE", "TAX", "OTHER"];

/** Un document qui expire dans ce délai est signalé « à renouveler » (la même fenêtre que les polices d'assurance). */
export const JOURS_ALERTE_DOCUMENT = 30;

export type EtatDocument = "none" | "valid" | "soon" | "expired";

/** Sans date d'expiration, un document ne périme pas. Le jour même de l'expiration, il est encore valable. */
export function etatDocument(doc: Pick<StoredDocument, "expiresAt">, maintenant: Date = new Date()): EtatDocument {
  if (!doc.expiresAt) return "none";
  const ecart = ecartEnJours(doc.expiresAt, maintenant);
  if (ecart < 0) return "expired";
  return ecart <= JOURS_ALERTE_DOCUMENT ? "soon" : "valid";
}

export interface SyntheseDocuments {
  total: number;
  expires: number;
  bientot: number;
  sansDate: number;
}

export function syntheseDocuments(documents: StoredDocument[], maintenant: Date = new Date()): SyntheseDocuments {
  const etats = documents.map((d) => etatDocument(d, maintenant));
  return {
    total: documents.length,
    expires: etats.filter((e) => e === "expired").length,
    bientot: etats.filter((e) => e === "soon").length,
    sansDate: etats.filter((e) => e === "none").length,
  };
}

/** Taille lisible d'un fichier : « 842 Ko », « 1,2 Mo ». */
export function tailleLisible(octets: number, langue: string): string {
  const format = (n: number) => n.toLocaleString(langue, { maximumFractionDigits: 1 });
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${format(octets / 1024)} Ko`;
  return `${format(octets / (1024 * 1024))} Mo`;
}

/** Intitulé proposé à partir du nom du fichier : sans l'extension, ni les séparateurs usuels. */
export function titreDepuisNomDeFichier(nom: string): string {
  return nom.replace(/\.[^./\\]+$/, "").replace(/[_]+/g, " ").trim().slice(0, 200);
}
