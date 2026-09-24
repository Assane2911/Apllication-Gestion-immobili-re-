import { describe, expect, it } from "vitest";
import { estCiviliteConnue, nomAvecCivilite, nomComplet } from "./nom";

describe("Écriture du nom d'une personne", () => {
  it("préfixe le nom de la civilité dans un document officiel", () => {
    expect(nomAvecCivilite({ civility: "M", firstName: "ALIOU", lastName: "THIAM" })).toBe("Monsieur ALIOU THIAM");
    expect(nomAvecCivilite({ civility: "MME", firstName: "Awa", lastName: "Diallo" })).toBe("Madame Awa Diallo");
  });

  it("reste correct sans civilité, condition pour que le champ soit facultatif", () => {
    // Un propriétaire peut être une société ; une personne peut ne pas vouloir
    // en donner. Si le document devenait bancal dans ces cas-là, le champ
    // serait facultatif en théorie et obligatoire en pratique.
    expect(nomAvecCivilite({ firstName: "ALIOU", lastName: "THIAM" })).toBe("ALIOU THIAM");
    expect(nomAvecCivilite({ civility: null, firstName: "ALIOU", lastName: "THIAM" })).toBe("ALIOU THIAM");
    expect(nomAvecCivilite({ civility: "", firstName: "ALIOU", lastName: "THIAM" })).toBe("ALIOU THIAM");
  });

  it("ignore une civilité que le serveur ne sait pas écrire", () => {
    // Une valeur inattendue en base — import, ancienne version — ne doit pas
    // produire « undefined ALIOU THIAM » au milieu d'un bail.
    expect(nomAvecCivilite({ civility: "DR", firstName: "ALIOU", lastName: "THIAM" })).toBe("ALIOU THIAM");
  });

  it("ne laisse jamais traîner d'espace quand une partie du nom manque", () => {
    expect(nomComplet({ firstName: "ALIOU", lastName: null })).toBe("ALIOU");
    expect(nomComplet({ firstName: null, lastName: "THIAM" })).toBe("THIAM");
    expect(nomAvecCivilite({ civility: "M", firstName: null, lastName: null })).toBe("");
  });

  it("ne reconnaît que les deux civilités enregistrables", () => {
    expect(estCiviliteConnue("M")).toBe(true);
    expect(estCiviliteConnue("MME")).toBe(true);
    expect(estCiviliteConnue("Monsieur")).toBe(false);
    expect(estCiviliteConnue("m")).toBe(false);
  });
});
