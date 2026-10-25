import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { choisirLangue, langueDeLaRequete } from "./langue";

describe("choisirLangue — lecture de l'en-tête Accept-Language", () => {
  it.each([
    ["fr", "fr"],
    ["en", "en"],
    ["es", "es"],
    ["pt", "pt"],
  ])("« %s » donne %s", (entete, attendu) => {
    expect(choisirLangue(entete)).toBe(attendu);
  });

  it("ignore la région : fr-FR, en-GB, pt-BR, es-MX", () => {
    expect(choisirLangue("fr-FR")).toBe("fr");
    expect(choisirLangue("en-GB")).toBe("en");
    expect(choisirLangue("pt-BR")).toBe("pt");
    expect(choisirLangue("es-MX")).toBe("es");
  });

  it("ignore la casse", () => {
    expect(choisirLangue("EN")).toBe("en");
    expect(choisirLangue("Pt-br")).toBe("pt");
  });

  it("prend la préférence la mieux classée parmi les langues gérées", () => {
    expect(choisirLangue("de-DE,de;q=0.9,en;q=0.8")).toBe("en");
    expect(choisirLangue("en;q=0.5,es;q=0.9")).toBe("es");
    expect(choisirLangue("pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("pt");
  });

  it("un q à zéro veut dire « surtout pas cette langue »", () => {
    expect(choisirLangue("en;q=0, es;q=0.4")).toBe("es");
  });

  it("retombe sur le français : en-tête absent, vide, inconnu ou illisible", () => {
    expect(choisirLangue(undefined)).toBe("fr");
    expect(choisirLangue("")).toBe("fr");
    expect(choisirLangue("de, it;q=0.8, ja")).toBe("fr");
    expect(choisirLangue("*")).toBe("fr");
    expect(choisirLangue(";;;,,,q=")).toBe("fr");
  });

  it("n'est pas dérouté par un en-tête démesuré", () => {
    expect(choisirLangue("x".repeat(10_000) + ",en")).toBe("fr");
    expect(choisirLangue(Array(200).fill("de").join(",") + ",es")).toBe("es");
  });
});

describe("langueDeLaRequete", () => {
  it("lit Accept-Language sur la requête", () => {
    const req = { headers: { "accept-language": "pt-BR,pt;q=0.9" } } as unknown as Request;
    expect(langueDeLaRequete(req)).toBe("pt");
  });

  it("sans en-tête, ou avec une valeur multiple, donne le français ou la première valeur", () => {
    expect(langueDeLaRequete({ headers: {} } as unknown as Request)).toBe("fr");
    expect(langueDeLaRequete({ headers: { "accept-language": ["es", "en"] } } as unknown as Request)).toBe("es");
  });
});
