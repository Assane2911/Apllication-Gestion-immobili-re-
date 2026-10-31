import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function fichiersSource(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersSource(chemin);
    return /\.tsx$/.test(nom) && !/\.test\.tsx$/.test(nom) ? [chemin] : [];
  });
}

/** Superpositions plein écran qui ne sont pas des fenêtres modales (les tiroirs de menu mobile : menu latéral des espaces et accueil). */
const NON_MODALES = ["MenuLateral.tsx", "LandingPage.tsx"];

describe("fenêtres modales", () => {
  it("toute superposition plein écran passe par useDialogue ou <Dialogue> (Échap, focus, rôle dialog)", () => {
    const racine = join(__dirname, "..");
    const sansComportement = fichiersSource(racine)
      .filter((chemin) => readFileSync(chemin, "utf8").includes("fixed inset-0"))
      .filter((chemin) => !NON_MODALES.some((nom) => chemin.endsWith(nom)))
      .filter((chemin) => {
        const source = readFileSync(chemin, "utf8");
        return !source.includes("useDialogue(") && !source.includes("<Dialogue");
      })
      .map((chemin) => chemin.replace(racine, "src"));

    expect(sansComportement).toEqual([]);
  });
});
