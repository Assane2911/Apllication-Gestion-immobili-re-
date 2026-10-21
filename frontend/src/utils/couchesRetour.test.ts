import { describe, expect, it, vi } from "vitest";
import { enregistrerCoucheRetour, traiterRetourSurCouche } from "./couchesRetour";

/**
 * Sur Android, le bouton retour doit d'abord refermer ce qui recouvre la page (menu, fenêtre modale), pas quitter la
 * page en laissant la fenêtre ouverte. Les couches ouvertes forment une pile : l'appui s'adresse à la dernière.
 */
describe("couches du bouton retour", () => {
  it("sans couche ouverte, l'appui n'est pas traité : la navigation reprend la main", () => {
    expect(traiterRetourSurCouche()).toBe(false);
  });

  it("l'appui est traité par la couche la plus récente, une seule à la fois", () => {
    const menu = vi.fn();
    const fenetre = vi.fn();
    const retirerMenu = enregistrerCoucheRetour(menu);
    const retirerFenetre = enregistrerCoucheRetour(fenetre);

    expect(traiterRetourSurCouche()).toBe(true);
    expect(fenetre).toHaveBeenCalledTimes(1);
    expect(menu).not.toHaveBeenCalled();

    retirerFenetre();
    expect(traiterRetourSurCouche()).toBe(true);
    expect(menu).toHaveBeenCalledTimes(1);

    retirerMenu();
    expect(traiterRetourSurCouche()).toBe(false);
  });

  it("une couche retirée deux fois, ou dans le désordre, n'en retire pas une autre", () => {
    const a = vi.fn();
    const b = vi.fn();
    const retirerA = enregistrerCoucheRetour(a);
    const retirerB = enregistrerCoucheRetour(b);

    retirerA();
    retirerA();
    expect(traiterRetourSurCouche()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();

    retirerB();
    expect(traiterRetourSurCouche()).toBe(false);
  });
});
