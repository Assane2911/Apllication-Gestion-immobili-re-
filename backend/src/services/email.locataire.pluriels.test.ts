import { describe, expect, it } from "vitest";
import { LANGUES } from "../utils/langue";
import { TEXTES_LOCATAIRE } from "./email.locataire.textes";

/**
 * Les objets d'e-mail disaient « dans 3 jour(s) » : la rustine « (s) » n'est pas une langue, et l'objet est la
 * première chose que lit le locataire. Chaque durée s'accorde : « dans 1 jour », « dans 3 jours » — dans les quatre langues.
 */
describe("e-mails aux locataires : les durées s'accordent", () => {
  it.each(LANGUES)("%s : aucun « (s) » dans les objets ni dans l'échéance dépassée", (langue) => {
    const t = TEXTES_LOCATAIRE[langue];
    const textes = [t.rappelAvantEcheance.sujet("mois", 1), t.rappelAvantEcheance.sujet("mois", 3), t.relance.echeance("1 janvier", 1), t.relance.echeance("1 janvier", 7)];
    for (const texte of textes) expect(texte).not.toMatch(/\w\((s|es)\)/);
  });

  it("1 s'écrit au singulier, 3 au pluriel", () => {
    expect(TEXTES_LOCATAIRE.fr.rappelAvantEcheance.sujet("octobre", 1)).toContain("dans 1 jour");
    expect(TEXTES_LOCATAIRE.fr.rappelAvantEcheance.sujet("octobre", 1)).not.toContain("jours");
    expect(TEXTES_LOCATAIRE.fr.rappelAvantEcheance.sujet("octobre", 3)).toContain("dans 3 jours");
    expect(TEXTES_LOCATAIRE.en.rappelAvantEcheance.sujet("October", 1)).toContain("in 1 day");
    expect(TEXTES_LOCATAIRE.en.rappelAvantEcheance.sujet("October", 3)).toContain("in 3 days");
    expect(TEXTES_LOCATAIRE.es.rappelAvantEcheance.sujet("octubre", 1)).toContain("en 1 día");
    expect(TEXTES_LOCATAIRE.es.rappelAvantEcheance.sujet("octubre", 3)).toContain("en 3 días");
    expect(TEXTES_LOCATAIRE.pt.rappelAvantEcheance.sujet("outubro", 1)).toContain("em 1 dia");
    expect(TEXTES_LOCATAIRE.pt.rappelAvantEcheance.sujet("outubro", 3)).toContain("em 3 dias");
  });
});
