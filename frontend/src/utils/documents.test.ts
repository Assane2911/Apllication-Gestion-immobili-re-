import { describe, expect, it } from "vitest";
import type { StoredDocument } from "../types";
import { etatDocument, syntheseDocuments, tailleLisible, titreDepuisNomDeFichier } from "./documents";

const MAINTENANT = new Date(2026, 5, 15, 9, 0, 0);
const doc = (expiresAt: string | null) => ({ expiresAt }) as StoredDocument;

describe("etatDocument", () => {
  it.each([
    [null, "none"],
    ["2026-06-14T00:00:00.000Z", "expired"],
    ["2026-06-15T00:00:00.000Z", "soon"], // le jour même, il est encore valable
    ["2026-07-15T00:00:00.000Z", "soon"], // dans 30 jours
    ["2026-07-16T00:00:00.000Z", "valid"],
  ])("%s → %s", (date, attendu) => {
    expect(etatDocument(doc(date), MAINTENANT)).toBe(attendu);
  });
});

describe("syntheseDocuments", () => {
  it("compte les documents expirés, à renouveler et sans date", () => {
    const s = syntheseDocuments([doc("2026-01-01T00:00:00.000Z"), doc("2026-06-20T00:00:00.000Z"), doc(null), doc("2030-01-01T00:00:00.000Z")], MAINTENANT);
    expect(s).toEqual({ total: 4, expires: 1, bientot: 1, sansDate: 1 });
  });
});

describe("tailleLisible", () => {
  it("choisit l'unité", () => {
    expect(tailleLisible(500, "fr")).toBe("500 o");
    expect(tailleLisible(2048, "fr")).toBe("2 Ko");
    expect(tailleLisible(1_258_291, "fr")).toBe("1,2 Mo");
  });
});

describe("titreDepuisNomDeFichier", () => {
  it("retire l'extension et les soulignés", () => {
    expect(titreDepuisNomDeFichier("DPE_villa_2026.pdf")).toBe("DPE villa 2026");
    expect(titreDepuisNomDeFichier("sans-extension")).toBe("sans-extension");
  });
});
