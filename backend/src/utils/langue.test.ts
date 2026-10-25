import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { choisirLangue, formaterDate, langueDeLaRequete, langueDemandee, langueOuDefaut, LOCALE_PAR_LANGUE, nomDuMois } from "./langue";

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

describe("langueOuDefaut — langue lue en base", () => {
  it("accepte les quatre langues", () => {
    for (const l of ["fr", "en", "es", "pt"]) expect(langueOuDefaut(l)).toBe(l);
  });

  it("retombe sur le français : vide, inconnue, d'un autre type", () => {
    for (const v of [null, undefined, "", "de", "EN", "en-GB", 3, {}]) expect(langueOuDefaut(v)).toBe("fr");
  });
});

describe("dates et noms de mois dans la langue du destinataire", () => {
  // Midi UTC : la même date calendaire quel que soit le fuseau du serveur.
  const date = new Date(Date.UTC(2026, 10, 5, 12, 0, 0));

  it("le français reste celui d'avant (toLocaleDateString fr-FR)", () => {
    expect(formaterDate(date, "fr")).toBe(date.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" }));
    expect(formaterDate(date, "fr")).toBe("5 novembre 2026");
  });

  it("anglais, espagnol, portugais", () => {
    expect(formaterDate(date, "en")).toBe("November 5, 2026");
    expect(formaterDate(date, "es")).toBe("5 de noviembre de 2026");
    expect(formaterDate(date, "pt")).toBe("5 de novembro de 2026");
  });

  it("sans langue, le français", () => {
    expect(formaterDate(date)).toBe("5 novembre 2026");
  });

  it("accepte une date en texte ou en nombre", () => {
    expect(formaterDate(date.toISOString(), "en")).toBe("November 5, 2026");
    expect(formaterDate(date.getTime(), "en")).toBe("November 5, 2026");
  });

  it("nomDuMois : les mêmes noms qu'avant en français, traduits ailleurs", () => {
    const avant = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    avant.forEach((nom, i) => expect(nomDuMois(i + 1, "fr")).toBe(nom));
    expect(nomDuMois(3, "en")).toBe("March");
    expect(nomDuMois(3, "es")).toBe("marzo");
    expect(nomDuMois(3, "pt")).toBe("março");
    expect(nomDuMois(8, "fr")).toBe("août");
  });

  it("nomDuMois : un mois hors de 1 à 12 s'écrit tel quel, comme avant", () => {
    expect(nomDuMois(0, "fr")).toBe("0");
    expect(nomDuMois(13, "en")).toBe("13");
  });

  it("LOCALE_PAR_LANGUE : la table du portail (frontend CurrencyContext)", () => {
    expect(LOCALE_PAR_LANGUE).toEqual({ fr: "fr-FR", en: "en", es: "es", pt: "pt-PT" });
  });
});

describe("langueDemandee — la langue seulement quand la requête en demande une", () => {
  const avec = (entete?: string) => ({ headers: entete === undefined ? {} : { "accept-language": entete } }) as unknown as Request;

  it("donne la langue demandée, français compris", () => {
    expect(langueDemandee(avec("fr-FR,fr;q=0.9"))).toBe("fr");
    expect(langueDemandee(avec("en"))).toBe("en");
  });

  it("donne null quand rien n'est demandé : en-tête absent, vide, ou langues non gérées", () => {
    expect(langueDemandee(avec())).toBeNull();
    expect(langueDemandee(avec(""))).toBeNull();
    expect(langueDemandee(avec("de-DE,de;q=0.9"))).toBeNull();
    expect(langueDemandee(avec("*"))).toBeNull();
  });
});
