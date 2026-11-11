import { describe, expect, it } from "vitest";
import { comparerEtatsDesLieux, lireReleve, normaliserNom, type ConstatEdl } from "./comparaisonEdl.service";

const vide: ConstatEdl = { rooms: [], meters: {}, keys: [] };

describe("normaliserNom", () => {
  it("ignore accents, casse et espaces multiples", () => {
    expect(normaliserNom("  Séjour   Principal ")).toBe("sejour principal");
  });
});

describe("lireReleve", () => {
  it.each([
    ["12345", 12345],
    ["12 345,6", 12345.6],
    ["004521 kWh", 4521],
    ["12345.5", 12345.5],
  ])("lit %s", (texte, attendu) => {
    expect(lireReleve(texte)).toBe(attendu);
  });
  it("renvoie null sans nombre exploitable", () => {
    expect(lireReleve("illisible")).toBeNull();
    expect(lireReleve("")).toBeNull();
    expect(lireReleve(undefined)).toBeNull();
  });
});

describe("comparerEtatsDesLieux — pièces", () => {
  it("repère dégradation, amélioration, ajout, suppression et pièce inchangée", () => {
    const entree: ConstatEdl = {
      ...vide,
      rooms: [
        { name: "Salon", condition: "BON", notes: "RAS" },
        { name: "Cuisine", condition: "MAUVAIS", notes: "plaques usées" },
        { name: "Cellier", condition: "BON" },
        { name: "Chambre", condition: "BON" },
      ],
    };
    const sortie: ConstatEdl = {
      ...vide,
      rooms: [
        { name: "salon", condition: "MAUVAIS", notes: "tache au mur" },
        { name: "Cuisine", condition: "MOYEN" },
        { name: "Chambre", condition: "BON" },
        { name: "Garage", condition: "BON" },
      ],
    };
    const r = comparerEtatsDesLieux(entree, sortie);
    const par = Object.fromEntries(r.rooms.map((p) => [p.name, p.variation]));
    expect(par).toEqual({ Salon: "DEGRADE", Cuisine: "AMELIORE", Cellier: "SUPPRIMEE", Chambre: "INCHANGE", Garage: "AJOUTEE" });
    expect(r.rooms[0].name).toBe("Salon"); // les dégradations d'abord
    expect(r.rooms[0].entry).toEqual({ condition: "BON", notes: "RAS" });
    expect(r.rooms[0].exit).toEqual({ condition: "MAUVAIS", notes: "tache au mur" });
    expect(r.summary).toMatchObject({ degraded: 1, improved: 1, unchanged: 1, added: 1, removed: 1 });
  });

  it("apparie deux pièces de même nom dans l'ordre de saisie", () => {
    const entree: ConstatEdl = { ...vide, rooms: [{ name: "Chambre", condition: "BON" }, { name: "Chambre", condition: "MOYEN" }] };
    const sortie: ConstatEdl = { ...vide, rooms: [{ name: "Chambre", condition: "BON" }, { name: "Chambre", condition: "MAUVAIS" }] };
    const r = comparerEtatsDesLieux(entree, sortie);
    expect(r.rooms.map((p) => p.variation).sort()).toEqual(["DEGRADE", "INCHANGE"]);
  });
});

describe("comparerEtatsDesLieux — compteurs et clés", () => {
  it("calcule la consommation quand les deux relevés sont des nombres", () => {
    const r = comparerEtatsDesLieux(
      { ...vide, meters: { electricity: "12 000", water: "abc", gas: "" } },
      { ...vide, meters: { electricity: "12 450,5", water: "300", gas: "" } },
    );
    expect(r.meters).toEqual([
      { type: "electricity", entry: "12 000", exit: "12 450,5", consumption: 450.5 },
      { type: "water", entry: "abc", exit: "300", consumption: null },
    ]);
  });

  it("compte les clés manquantes sans jamais de négatif", () => {
    const r = comparerEtatsDesLieux(
      { ...vide, keys: [{ label: "Porte d'entrée", quantity: 3 }, { label: "Boîte aux lettres", quantity: 1 }, { label: "Cave", quantity: 1 }] },
      { ...vide, keys: [{ label: "Porte d'entrée", quantity: 2 }, { label: "Boîte aux lettres", quantity: 2 }, { label: "Portail", quantity: 1 }] },
    );
    const par = Object.fromEntries(r.keys.map((k) => [k.label, k.missing]));
    expect(par).toEqual({ "Porte d'entrée": 1, "Boîte aux lettres": 0, Cave: 1, Portail: 0 });
    expect(r.summary.missingKeys).toBe(2);
  });
});
