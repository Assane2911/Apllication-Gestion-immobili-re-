import { describe, expect, it } from "vitest";
import {
  MENTIONS_VIDES,
  formulaireDepuisMentions,
  mentionsAbsentes,
  mentionsDepuisFormulaire,
  proposeMentionsLogement,
} from "./mentionsLogement";

/**
 * Mentions du logement du contrat type français (décret n° 2015-587), facultatives : le formulaire les propose pour un
 * logement en France, rappelle sans bloquer celles de base qui manquent, et n'envoie que celles qui sont renseignées.
 */
describe("proposeMentionsLogement", () => {
  it("France, habitation vide ou meublée : oui", () => {
    expect(proposeMentionsLogement("FR", "HABITATION")).toBe(true);
    expect(proposeMentionsLogement("FR", "MEUBLE")).toBe(true);
  });

  it("bail commercial ou professionnel en France, et tout autre pays ou compte sans pays : non", () => {
    expect(proposeMentionsLogement("FR", "COMMERCIAL")).toBe(false);
    expect(proposeMentionsLogement("FR", "PROFESSIONNEL")).toBe(false);
    for (const pays of ["SN", "CI", "ML", "BF", "BJ", "TG", "NE", "GW", null, undefined]) {
      expect(proposeMentionsLogement(pays, "HABITATION"), String(pays)).toBe(false);
    }
  });
});

describe("mentionsDepuisFormulaire", () => {
  it("aucune mention renseignée : null, rien n'est envoyé", () => {
    expect(mentionsDepuisFormulaire(MENTIONS_VIDES)).toBeNull();
    expect(mentionsDepuisFormulaire({ ...MENTIONS_VIDES, chauffage: "   " })).toBeNull();
  });

  it("n'envoie que les mentions renseignées, textes rognés et montants en nombres", () => {
    expect(
      mentionsDepuisFormulaire({ ...MENTIONS_VIDES, dpe: "D", identifiantFiscal: " 123 ", loyerReference: "24,5", dernierLoyer: "760" })
    ).toEqual({ dpe: "D", identifiantFiscal: "123", loyerReference: 24.5, dernierLoyer: 760 });
  });

  it("ignore un montant illisible plutôt que d'envoyer NaN", () => {
    expect(mentionsDepuisFormulaire({ ...MENTIONS_VIDES, dpe: "A", loyerReference: "abc" })).toEqual({ dpe: "A" });
  });
});

describe("mentionsAbsentes", () => {
  it("liste les mentions de base manquantes dans l'ordre du contrat type, jamais les montants", () => {
    expect(mentionsAbsentes(MENTIONS_VIDES)).toEqual(["dpe", "identifiantFiscal", "periodeConstruction", "chauffage"]);
    expect(mentionsAbsentes({ ...MENTIONS_VIDES, dpe: "C", chauffage: "Gaz" })).toEqual(["identifiantFiscal", "periodeConstruction"]);
    expect(mentionsAbsentes({ ...MENTIONS_VIDES, dpe: "C", identifiantFiscal: "1", periodeConstruction: "2", chauffage: "3" })).toEqual([]);
  });
});

describe("formulaireDepuisMentions", () => {
  it("un contrat sans mention donne un formulaire vide", () => {
    expect(formulaireDepuisMentions(null)).toEqual(MENTIONS_VIDES);
    expect(formulaireDepuisMentions(undefined)).toEqual(MENTIONS_VIDES);
  });

  it("reprend les mentions enregistrées, montants en texte", () => {
    expect(formulaireDepuisMentions({ dpe: "F", loyerReference: 24.5 })).toEqual({ ...MENTIONS_VIDES, dpe: "F", loyerReference: "24.5" });
  });
});
