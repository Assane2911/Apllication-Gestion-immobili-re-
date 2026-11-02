import { describe, expect, it, vi } from "vitest";
import { EVENEMENT_FIL_LU, libellePastille, signalerFilLu } from "./nonLus";

describe("libellePastille", () => {
  it("affiche le nombre, plafonné à 99+", () => {
    expect(libellePastille(1)).toBe("1");
    expect(libellePastille(99)).toBe("99");
    expect(libellePastille(100)).toBe("99+");
    expect(libellePastille(2500)).toBe("99+");
  });
});

describe("signalerFilLu", () => {
  it("prévient ceux qui écoutent qu'un fil vient d'être lu", () => {
    const ecouteur = vi.fn();
    window.addEventListener(EVENEMENT_FIL_LU, ecouteur);
    signalerFilLu();
    window.removeEventListener(EVENEMENT_FIL_LU, ecouteur);
    expect(ecouteur).toHaveBeenCalledTimes(1);
  });
});
