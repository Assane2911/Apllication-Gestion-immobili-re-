import { afterEach, describe, expect, it, vi } from "vitest";
import { fichierTropVolumineux, preparerFichier } from "./fichiers";

const MO = 1024 * 1024;
const fichier = (nom: string, type: string, octets: number) => new File([new Uint8Array(octets)], nom, { type });

describe("fichierTropVolumineux", () => {
  it("compare la taille à la limite d'envoi (4 Mo par défaut)", () => {
    expect(fichierTropVolumineux(fichier("a.pdf", "application/pdf", 4 * MO))).toBe(false);
    expect(fichierTropVolumineux(fichier("a.pdf", "application/pdf", 4 * MO + 1))).toBe(true);
  });

  it("accepte une autre limite (logo : 2 Mo)", () => {
    expect(fichierTropVolumineux(fichier("logo.png", "image/png", 3 * MO), 2)).toBe(true);
  });
});

/**
 * Le serveur est une fonction Vercel : au-delà de ~4,5 Mo de requête, Vercel répond lui-même « 413 » et
 * l'utilisateur ne voit qu'une erreur générique. Une photo de téléphone en pleine résolution (5 à 12 Mo) est
 * donc réduite avant l'envoi ; un PDF trop lourd est refusé tout de suite, avec un message clair.
 */
describe("preparerFichier", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** jsdom n'a ni décodage d'image ni canvas : on simule les deux et on enregistre ce qui est dessiné. */
  function simulerNavigateur(taillesBlob: number[], largeur = 4000, hauteur = 3000) {
    const dessin = { largeur: 0, hauteur: 0, fond: false, qualites: [] as number[] };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: largeur, height: hauteur, close: vi.fn() }));
    const contexte = {
      fillStyle: "",
      fillRect: () => {
        dessin.fond = true;
      },
      drawImage: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(contexte as unknown as CanvasRenderingContext2D);
    let appel = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, rappel, _type, qualite) {
      dessin.largeur = this.width;
      dessin.hauteur = this.height;
      dessin.qualites.push(qualite as number);
      const octets = taillesBlob[Math.min(appel++, taillesBlob.length - 1)];
      rappel(new Blob([new Uint8Array(octets)], { type: "image/jpeg" }));
    });
    return dessin;
  }

  it("rend tel quel un fichier sous la limite", async () => {
    const f = fichier("photo.jpg", "image/jpeg", 2 * MO);
    expect(await preparerFichier(f)).toBe(f);
  });

  it("refuse un PDF trop lourd (rien à réduire)", async () => {
    expect(await preparerFichier(fichier("bail.pdf", "application/pdf", 6 * MO))).toBeNull();
  });

  it("réduit une photo trop lourde en JPEG, côté long ramené à 2 560 px", async () => {
    const dessin = simulerNavigateur([1 * MO]);

    const reduit = await preparerFichier(fichier("IMG_0042.HEIC.png", "image/png", 9 * MO));

    expect(reduit).not.toBeNull();
    expect(reduit!.type).toBe("image/jpeg");
    expect(reduit!.name).toBe("IMG_0042.HEIC.jpg");
    expect(reduit!.size).toBeLessThan(4 * MO);
    expect([dessin.largeur, dessin.hauteur]).toEqual([2560, 1920]);
    // Un PNG transparent deviendrait noir en JPEG : le fond est peint en blanc d'abord.
    expect(dessin.fond).toBe(true);
  });

  it("retente plus petit et plus compressé quand le premier essai est encore trop lourd", async () => {
    const dessin = simulerNavigateur([5 * MO, 2 * MO]);

    const reduit = await preparerFichier(fichier("panorama.jpg", "image/jpeg", 12 * MO));

    expect(reduit?.size).toBe(2 * MO);
    expect(dessin.qualites).toEqual([0.85, 0.7]);
    expect(dessin.largeur).toBe(1600);
  });

  it("ne grossit jamais une petite image : pas d'agrandissement", async () => {
    const dessin = simulerNavigateur([1 * MO], 1200, 800);

    await preparerFichier(fichier("scan.png", "image/png", 6 * MO));

    expect([dessin.largeur, dessin.hauteur]).toEqual([1200, 800]);
  });

  it("refuse le fichier quand l'image ne peut pas être lue ou reste trop lourde", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("format illisible")));
    expect(await preparerFichier(fichier("photo.jpg", "image/jpeg", 9 * MO))).toBeNull();

    simulerNavigateur([6 * MO, 6 * MO]);
    expect(await preparerFichier(fichier("photo.jpg", "image/jpeg", 9 * MO))).toBeNull();
  });
});
