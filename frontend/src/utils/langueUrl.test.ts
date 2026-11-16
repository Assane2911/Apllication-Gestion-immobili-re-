import { describe, expect, it } from "vitest";
import { cheminDansLaLangue, estPageTraduite, langueDuChemin, sansPrefixeLangue, versionsDeLaPage } from "./langueUrl";

describe("adresses par langue", () => {
  it("reconnaît le préfixe de langue, et seulement lui", () => {
    expect(langueDuChemin("/en")).toBe("en");
    expect(langueDuChemin("/es/vitrine")).toBe("es");
    expect(langueDuChemin("/pt/vitrine/annonces/abc")).toBe("pt");
    expect(langueDuChemin("/")).toBeNull();
    expect(langueDuChemin("/vitrine")).toBeNull();
    expect(langueDuChemin("/enigme")).toBeNull();
    expect(langueDuChemin("/fr")).toBeNull(); // le français n'a pas de préfixe
  });

  it("retire le préfixe", () => {
    expect(sansPrefixeLangue("/en")).toBe("/");
    expect(sansPrefixeLangue("/en/vitrine")).toBe("/vitrine");
    expect(sansPrefixeLangue("/vitrine")).toBe("/vitrine");
    expect(sansPrefixeLangue("/login")).toBe("/login");
  });

  it("seules l'accueil et la vitrine existent dans chaque langue", () => {
    for (const p of ["/", "/landing", "/vitrine", "/en", "/pt/vitrine"]) expect(estPageTraduite(p), p).toBe(true);
    for (const p of ["/login", "/inscription", "/cgu", "/vitrine/annonces/abc", "/dashboard", "/en/login"]) expect(estPageTraduite(p), p).toBe(false);
  });

  it("donne l'adresse d'une page dans une langue ; le français garde l'adresse d'origine", () => {
    expect(cheminDansLaLangue("/", "en")).toBe("/en");
    expect(cheminDansLaLangue("/landing", "es")).toBe("/es");
    expect(cheminDansLaLangue("/vitrine", "pt")).toBe("/pt/vitrine");
    expect(cheminDansLaLangue("/en/vitrine", "fr")).toBe("/vitrine");
    expect(cheminDansLaLangue("/en", "fr")).toBe("/");
    expect(cheminDansLaLangue("/es/vitrine", "en")).toBe("/en/vitrine");
  });

  it("laisse telle quelle une page qui n'existe pas en plusieurs langues", () => {
    expect(cheminDansLaLangue("/login", "en")).toBe("/login");
    expect(cheminDansLaLangue("/vitrine/annonces/abc", "pt")).toBe("/vitrine/annonces/abc");
    expect(cheminDansLaLangue("/cgu", "es")).toBe("/cgu");
  });

  it("liste les quatre versions d'une page", () => {
    expect(versionsDeLaPage("/vitrine")).toEqual({ fr: "/vitrine", en: "/en/vitrine", es: "/es/vitrine", pt: "/pt/vitrine" });
    expect(versionsDeLaPage("/")).toEqual({ fr: "/", en: "/en", es: "/es", pt: "/pt" });
  });
});
