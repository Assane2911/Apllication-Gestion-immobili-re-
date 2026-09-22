import { describe, expect, it } from "vitest";
import { csvEscape, csvMontant } from "./csv";

describe("csvEscape (export construit dans le navigateur)", () => {
  it("double les guillemets de TOUTES les valeurs, y compris un nom de bien", () => {
    // L'export des dépenses échappait le titre et les notes, mais pas le nom
    // du bien : « Villa "Les Palmiers" » fermait le champ en plein milieu,
    // décalait les colonnes, et faisait atterrir le montant dans la mauvaise
    // case du tableur.
    expect(csvEscape('Villa "Les Palmiers"')).toBe('"Villa ""Les Palmiers"""');
  });

  it("neutralise une valeur qui ressemble à une formule (CWE-1236)", () => {
    expect(csvEscape("=cmd|'/C calc'!A1")).toBe("\"'=cmd|'/C calc'!A1\"");
    expect(csvEscape("+1+1")).toBe("\"'+1+1\"");
    expect(csvEscape("@SUM(1)")).toBe("\"'@SUM(1)\"");
    expect(csvEscape("-2")).toBe("\"'-2\"");
  });

  it("laisse une valeur ordinaire intacte, simplement entre guillemets", () => {
    expect(csvEscape("Villa Ngor")).toBe('"Villa Ngor"');
  });
});

describe("csvMontant", () => {
  it("écrit deux décimales avec une virgule, lisible comme nombre en locale française", () => {
    expect(csvMontant(1234.56)).toBe("1234,56");
    expect(csvMontant(1000)).toBe("1000,00");
  });

  it("absorbe les résidus de flottants", () => {
    expect(csvMontant(799.9999999999999)).toBe("800,00");
  });

  it("n'écrit jamais « -0,00 »", () => {
    expect(csvMontant(-0)).toBe("0,00");
  });
});
