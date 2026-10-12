import { describe, expect, it } from "vitest";
import { CsvInvalide, lireCsv, lireNombre, normaliserEntete, MAX_LIGNES_IMPORT } from "./csvImport";

describe("normaliserEntete", () => {
  it.each([
    ["Prénom", "prenom"],
    ["PRÉNOM", "prenom"],
    ["Loyer mensuel", "loyermensuel"],
    ["  e-mail ", "email"],
    ["Téléphone (mobile)", "telephonemobile"],
  ])("%s → %s", (brut, attendu) => expect(normaliserEntete(brut)).toBe(attendu));
});

describe("lireCsv", () => {
  it("lit un export Excel français : point-virgule, BOM, fins de ligne Windows", () => {
    const csv = "﻿Titre;Adresse;Loyer\r\nStudio A;1 rue de Paris;500\r\nVilla B;2 avenue Ndiaye;250000\r\n";
    const lu = lireCsv(csv);
    expect(lu.delimiteur).toBe(";");
    expect(lu.entetes).toEqual(["titre", "adresse", "loyer"]);
    expect(lu.lignes.map((l) => l.valeurs.titre)).toEqual(["Studio A", "Villa B"]);
  });

  it("détecte la virgule et la tabulation", () => {
    expect(lireCsv("a,b\n1,2").delimiteur).toBe(",");
    expect(lireCsv("a\tb\n1\t2").delimiteur).toBe("\t");
  });

  it("respecte les guillemets : séparateur, guillemet doublé et retour à la ligne dans un champ", () => {
    const lu = lireCsv('titre;description\n"Studio; centre";"Il dit ""bonjour""\nsur deux lignes"');
    expect(lu.lignes[0].valeurs.titre).toBe("Studio; centre");
    expect(lu.lignes[0].valeurs.description).toBe('Il dit "bonjour"\nsur deux lignes');
  });

  it("numérote les lignes comme le tableur (l'en-tête est la ligne 1, les lignes vides comptent)", () => {
    const lu = lireCsv("a;b\n1;2\n\n3;4");
    expect(lu.lignes.map((l) => l.ligne)).toEqual([2, 4]);
  });

  it("ignore une ligne entièrement vide, garde une cellule vide", () => {
    const lu = lireCsv("a;b;c\n1;;3\n;;\n");
    expect(lu.lignes).toHaveLength(1);
    expect(lu.lignes[0].valeurs).toEqual({ a: "1", b: "", c: "3" });
  });

  it("une ligne plus courte que l'en-tête laisse les dernières colonnes vides", () => {
    expect(lireCsv("a;b;c\n1").lignes[0].valeurs).toEqual({ a: "1", b: "", c: "" });
  });

  it("refuse un fichier vide, sans données, trop gros, trop long ou aux guillemets ouverts", () => {
    expect(() => lireCsv("")).toThrow(CsvInvalide);
    expect(() => lireCsv("   \n  ")).toThrow(/vide/);
    expect(() => lireCsv("a;b\n")).toThrow(/aucune ligne de données/);
    expect(() => lireCsv('a;b\n"ouvert;1')).toThrow(/guillemet/);
    expect(() => lireCsv("a\n" + "x".repeat(1_000_001))).toThrow(/trop volumineux/);
    const lignes = Array.from({ length: MAX_LIGNES_IMPORT + 1 }, (_, i) => `v${i}`).join("\n");
    expect(() => lireCsv("a\n" + lignes)).toThrow(new RegExp(`limité à ${MAX_LIGNES_IMPORT}`));
  });
});

describe("lireNombre", () => {
  it.each([
    ["500", 500],
    ["1250.5", 1250.5],
    ["1250,5", 1250.5],
    ["1 250,50", 1250.5],
    ["1.250,50", 1250.5],
    ["1,250.50", 1250.5],
    ["250 000", 250000],
    ["250.000", 250000],
    ["1,250", 1250],
    ["0,5", 0.5],
    ["1.250.000", 1250000],
    ["-12,5", -12.5],
  ])("%s → %s", (brut, attendu) => expect(lireNombre(brut)).toBe(attendu));

  it.each(["", "abc", "12abc", "1,2,3x", "€500", "--5", "1,2,3", "1,250,50", "12,"])("%j n'est pas un nombre", (brut) => {
    expect(lireNombre(brut)).toBeNull();
  });
});
