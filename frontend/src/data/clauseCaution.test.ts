import { describe, expect, it } from "vitest";
import { CLAUSE_CAUTION, clauseCautionIncomplete, insererClause } from "./clauseCaution";

describe("clause de caution (modèle)", () => {
  it("s'insère seule dans un champ vide", () => {
    expect(insererClause("", CLAUSE_CAUTION)).toBe(CLAUSE_CAUTION);
  });

  it("s'ajoute après les clauses déjà saisies, séparée par une ligne vide", () => {
    expect(insererClause("Animaux interdits.", CLAUSE_CAUTION)).toBe(`Animaux interdits.\n\n${CLAUSE_CAUTION}`);
    expect(insererClause("Animaux interdits.\n\n", CLAUSE_CAUTION)).toBe(`Animaux interdits.\n\n${CLAUSE_CAUTION}`);
  });

  it("ne s'insère pas deux fois", () => {
    const une = insererClause("Animaux interdits.", CLAUSE_CAUTION);
    expect(insererClause(une, CLAUSE_CAUTION)).toBe(une);
  });

  it("reste signalée comme incomplète tant qu'il y a des passages entre crochets", () => {
    expect(clauseCautionIncomplete(CLAUSE_CAUTION)).toBe(true);
    expect(clauseCautionIncomplete(`Animaux interdits.\n\n${CLAUSE_CAUTION}`)).toBe(true);
  });

  it("n'est plus incomplète une fois les crochets remplacés", () => {
    const remplie = CLAUSE_CAUTION.replace(/\[[^\]]*\]/g, "X");
    expect(clauseCautionIncomplete(remplie)).toBe(false);
  });

  it("ne bloque pas les autres clauses : des crochets sans la clause de caution sont laissés au gestionnaire", () => {
    expect(clauseCautionIncomplete("Loyer [révisable] chaque année.")).toBe(false);
    expect(clauseCautionIncomplete("")).toBe(false);
  });
});
