import { describe, expect, it } from "vitest";
import { fenetreDesMois, libelleDuMois, moisCourt } from "./moisDuGraphique";

describe("fenetreDesMois", () => {
  const maintenant = new Date(2026, 9, 18); // 18 octobre 2026

  it("couvre les six derniers mois, mois courant compris, même sans aucune donnée", () => {
    expect(fenetreDesMois(maintenant, [])).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  });

  it("garde les mois sans encaissement ni dépense : un mois vide doit se voir sur le graphique", () => {
    const mois = fenetreDesMois(maintenant, ["2026-08"]);
    expect(mois).toHaveLength(6);
    expect(mois).toContain("2026-09");
  });

  it("franchit le changement d'année", () => {
    expect(fenetreDesMois(new Date(2027, 1, 3), [])).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("n'écarte pas un mois fourni par le serveur hors de la fenêtre (décalage de fuseau)", () => {
    const mois = fenetreDesMois(maintenant, ["2026-04", "2026-11"]);
    expect(mois[0]).toBe("2026-04");
    expect(mois[mois.length - 1]).toBe("2026-11");
    expect(new Set(mois).size).toBe(mois.length);
  });
});

describe("libelleDuMois", () => {
  it("affiche le mois dans la langue de l'interface, pas une clé technique", () => {
    const fr = libelleDuMois("2026-05", "fr");
    expect(fr).not.toBe("2026-05");
    expect(fr.toLowerCase()).toContain("mai");
    expect(libelleDuMois("2026-05", "en").toLowerCase()).toContain("may");
  });

  it("renvoie la clé telle quelle si elle n'est pas une date", () => {
    expect(libelleDuMois("ce mois-ci", "fr")).toBe("ce mois-ci");
  });
});

describe("moisCourt", () => {
  it("écrit le mois dans la langue de l'interface, pas celle du navigateur", () => {
    expect(moisCourt(2026, 3, "fr")).toBe("mars");
    expect(moisCourt(2026, 3, "en")).toBe("Mar");
    expect(moisCourt(2026, 8, "fr")).toMatch(/^août/);
    expect(moisCourt(2026, 8, "en")).toBe("Aug");
  });
});
