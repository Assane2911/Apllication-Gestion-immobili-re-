import { describe, expect, it } from "vitest";
import { ECART, MARGE_FENETRE, placerBulle } from "./placementBulle";

/**
 * Une bulle rognée par le bord de l'écran se lit à moitié : « Marque cette factu… ».
 * Ces cas fixent ce qu'on exige d'elle, quel que soit l'endroit où se trouve le bouton.
 */
const FENETRE = { width: 1000, height: 700 };
const BULLE = { width: 200, height: 40 };
const bouton = (left: number, top: number, w = 80, h = 30) => ({ left, top, right: left + w, bottom: top + h });

describe("placerBulle", () => {
  it("pose la bulle au-dessus et centrée quand il y a la place", () => {
    const p = placerBulle(bouton(460, 300), BULLE, "haut", FENETRE);

    expect(p.cote).toBe("haut");
    expect(p.left).toBe(500 - 100);
    expect(p.top).toBe(300 - ECART - BULLE.height);
  });

  it("passe sous le bouton quand le haut de l'écran manque de place", () => {
    const p = placerBulle(bouton(460, 20), BULLE, "haut", FENETRE);

    expect(p.cote).toBe("bas");
    expect(p.top).toBe(50 + ECART);
  });

  it("reste en haut si le bas n'offre pas plus de place", () => {
    const petiteFenetre = { width: 1000, height: 120 };
    const p = placerBulle(bouton(460, 50, 80, 30), BULLE, "haut", petiteFenetre);

    // Haut : 42 px, bas : 32 px. Aucun côté ne convient, on garde celui qui en offre le plus.
    expect(p.cote).toBe("haut");
  });

  it("ramène la bulle dans la fenêtre à gauche, la pointe visant toujours le bouton", () => {
    const p = placerBulle(bouton(0, 300, 40), BULLE, "haut", FENETRE);

    expect(p.left).toBe(MARGE_FENETRE);
    expect(p.left + p.pointe).toBe(20); // centre du bouton
  });

  it("ramène la bulle dans la fenêtre à droite", () => {
    const p = placerBulle(bouton(960, 300, 40), BULLE, "haut", FENETRE);

    expect(p.left + BULLE.width).toBe(FENETRE.width - MARGE_FENETRE);
    expect(p.left + p.pointe).toBe(980);
  });

  it("garde la pointe à l'écart des coins de la bulle", () => {
    const p = placerBulle(bouton(-30, 300, 40), BULLE, "haut", FENETRE);

    expect(p.pointe).toBeGreaterThanOrEqual(12);
  });

  it("pose la bulle à droite d'un menu latéral et la centre verticalement", () => {
    const p = placerBulle(bouton(0, 200, 240, 40), BULLE, "droite", FENETRE);

    expect(p.cote).toBe("droite");
    expect(p.left).toBe(240 + ECART);
    expect(p.top).toBe(220 - 20);
  });

  it("passe à gauche d'un élément collé au bord droit", () => {
    const p = placerBulle(bouton(930, 200, 60, 40), BULLE, "droite", FENETRE);

    expect(p.cote).toBe("gauche");
    expect(p.left).toBe(930 - ECART - BULLE.width);
  });

  it("ne sort pas de l'écran en bas pour un élément en bas à droite", () => {
    const p = placerBulle(bouton(930, 690, 60, 20), BULLE, "droite", FENETRE);

    expect(p.top + BULLE.height).toBeLessThanOrEqual(FENETRE.height - MARGE_FENETRE);
  });

  it("garde le bord de départ visible quand la bulle dépasse la fenêtre", () => {
    const p = placerBulle(bouton(100, 300), { width: 2000, height: 40 }, "haut", FENETRE);

    expect(p.left).toBe(MARGE_FENETRE);
  });
});
