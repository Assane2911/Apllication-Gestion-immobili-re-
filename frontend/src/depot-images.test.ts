import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le logo `app-icon.png` s'affiche à 28-36 px sur presque toutes les pages (connexion, menus, pages légales,
 * vitrine) et sert d'icône d'onglet. Il pesait 95 Ko pour 1024 x 1024 pixels : le navigateur le téléchargeait et le
 * décodait en entier pour l'afficher dans un carré de 36 px, sur une connexion mobile lente, dès la page de
 * connexion. Une image de la taille d'affichage (avec une marge pour les écrans très denses) suffit.
 */
const PUBLIC = join(__dirname, "../public");

/** Largeur et hauteur lues dans l'en-tête IHDR d'un PNG (octets 16 à 23). */
function dimensions(chemin: string): { largeur: number; hauteur: number } {
  const octets = readFileSync(chemin);
  return { largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) };
}

describe("images affichées en petit", () => {
  it("le logo de l'application est à la taille d'une icône : au plus 256 px et 30 Ko", () => {
    const chemin = join(PUBLIC, "app-icon.png");
    const { largeur, hauteur } = dimensions(chemin);
    expect(largeur).toBeLessThanOrEqual(256);
    expect(hauteur).toBeLessThanOrEqual(256);
    expect(largeur).toBeGreaterThanOrEqual(192); // net sur un écran 3x affichant 36 px, et pour les données structurées
    expect(statSync(chemin).size).toBeLessThanOrEqual(30 * 1024);
  });

  it("le logo reste carré", () => {
    const { largeur, hauteur } = dimensions(join(PUBLIC, "app-icon.png"));
    expect(largeur).toBe(hauteur);
  });
});
