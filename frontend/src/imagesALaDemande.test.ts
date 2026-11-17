import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Une image de liste ou de carte qui n'est pas visible à l'ouverture de la page n'a pas à être téléchargée tout de suite : sans
 * `loading="lazy"`, une liste de 30 biens récupère ses 30 photos d'un coup, au détriment de ce qui est affiché. Ce garde-fou
 * oblige à choisir (lazy, ou priorité haute pour l'image principale) chaque fois qu'une balise <img> est ajoutée.
 */
const SRC = join(__dirname);

function fichiersTsx(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersTsx(chemin);
    return chemin.endsWith(".tsx") && !chemin.endsWith(".test.tsx") ? [chemin] : [];
  });
}

/** Les images qui n'ont pas à être différées : code QR et aperçus locaux (affichés tout de suite), visionneuse (ouverte à la demande), etc. */
const EXCLUSIONS = [
  "components/TwoFactorSetupModal.tsx",
  "components/PhotoLightbox.tsx",
  "components/ScannedContractModal.tsx",
  "components/SectionImageAgence.tsx",
];
/** Aperçus locaux (blob:) : déjà en mémoire, rien à télécharger. */
const APERCU_LOCAL = /src=\{(apercu \?\?|extraPreview|preview)/;

function balisesImg(source: string): string[] {
  return [...source.matchAll(/<img\b[\s\S]*?\/>/g)].map((m) => m[0]);
}

describe("images de listes et de cartes", () => {
  const fichiers = fichiersTsx(SRC).filter((f) => !EXCLUSIONS.some((e) => f.replaceAll("\\", "/").endsWith(e)));

  it("chaque <img> est chargée à la demande (lazy) ou explicitement en priorité", () => {
    const fautives: string[] = [];
    for (const f of fichiers) {
      for (const balise of balisesImg(readFileSync(f, "utf8"))) {
        if (APERCU_LOCAL.test(balise)) continue;
        if (!/loading="lazy"/.test(balise) && !/fetchPriority="high"/.test(balise)) fautives.push(`${f.slice(SRC.length + 1)} : ${balise.slice(0, 80).replace(/\s+/g, " ")}`);
      }
    }
    expect(fautives).toEqual([]);
  });

  it("l'image principale de la fiche d'annonce est demandée en priorité, jamais différée", () => {
    const source = readFileSync(join(SRC, "pages/VitrineListingPage.tsx"), "utf8");
    const principale = balisesImg(source).find((b) => b.includes("listing.imageUrl"));
    expect(principale).toBeDefined();
    expect(principale).toContain('fetchPriority="high"');
    expect(principale).not.toContain('loading="lazy"');
  });
});
