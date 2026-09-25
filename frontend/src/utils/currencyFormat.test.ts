import { describe, expect, it } from "vitest";
import { formatByCurrency } from "./currencyFormat";

/**
 * Un écran qui affiche « 35 000 FCFA », « 0 FG » et « 35 000 FCFA » côte à
 * côte a l'air cassé — et pour cause : les deux totaux non vides parlent la
 * devise des factures, tandis que le total vide, n'ayant aucune devise à
 * montrer, retombait sur la devise d'AFFICHAGE du gestionnaire. Les trois
 * chiffres décrivent pourtant la même période et les mêmes biens.
 *
 * Un total vide doit donc s'exprimer dans les devises de ses voisins.
 */
const formatMoneyFactice = (montant: number | null | undefined, devise?: string | null) =>
  `${montant ?? 0} ${devise ?? "DISPLAY"}`;

describe("Totaux groupés par devise", () => {
  it("affiche chaque devise du total", () => {
    expect(formatByCurrency({ XOF: 35000, EUR: 120 }, formatMoneyFactice)).toBe("35000 XOF + 120 EUR");
  });

  it("exprime un total vide dans les devises de référence, pas dans celle du gestionnaire", () => {
    expect(formatByCurrency({}, formatMoneyFactice, ["XOF"])).toBe("0 XOF");
  });

  it("couvre toutes les devises de référence quand il y en a plusieurs", () => {
    expect(formatByCurrency({}, formatMoneyFactice, ["XOF", "EUR"])).toBe("0 XOF + 0 EUR");
  });

  it("retombe sur la devise d'affichage quand il n'y a aucune référence", () => {
    // Un écran entièrement vide n'a rien à quoi s'accorder : la préférence du
    // gestionnaire est alors le meilleur choix disponible.
    expect(formatByCurrency({}, formatMoneyFactice)).toBe("0 DISPLAY");
    expect(formatByCurrency(undefined, formatMoneyFactice, [])).toBe("0 DISPLAY");
  });

  it("ignore les références quand le total a ses propres devises", () => {
    expect(formatByCurrency({ EUR: 50 }, formatMoneyFactice, ["XOF"])).toBe("50 EUR");
  });
});
