import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// L'application n'a qu'un thème : le clair. Ce garde-fou empêche le retour, par inadvertance, du thème sombre (variantes
// `dark:`, classe `.dark`, bouton de bascule) et des fonds pleins qui cacheraient la trame de papier calque.
const SRC = __dirname;

function sources(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return sources(chemin);
    return /\.(tsx?|css)$/.test(nom) && !/\.test\./.test(nom) ? [chemin] : [];
  });
}

const lire = (chemin: string) => readFileSync(chemin, "utf8");
const relatif = (chemin: string) => chemin.replace(SRC, "src");

describe("thème clair uniquement", () => {
  it("aucune classe `dark:` ne reste dans le code", () => {
    const fautifs = sources(SRC).filter((chemin) => /(^|[\s"'`])dark:/.test(lire(chemin))).map(relatif);
    expect(fautifs).toEqual([]);
  });

  it("la feuille de styles ne connaît plus ni la classe `.dark` ni la variante `dark`", () => {
    const css = lire(resolve(SRC, "index.css"));
    expect(css).not.toMatch(/\.dark\b/);
    expect(css).not.toMatch(/@custom-variant\s+dark/);
  });

  it("aucun fichier ne pose ni ne lit un réglage de thème", () => {
    const fautifs = sources(SRC)
      .filter((chemin) => /ThemeProvider|useTheme|toggleTheme|classList\.toggle\("dark"/.test(lire(chemin)))
      .map(relatif);
    expect(fautifs).toEqual([]);
  });

  it("l'ancien réglage mémorisé par les versions précédentes est effacé au démarrage", () => {
    expect(lire(resolve(SRC, "main.tsx"))).toMatch(/localStorage\.removeItem\(['"]theme['"]\)/);
  });
});

describe("fond de la charte — posé une fois, par la page", () => {
  it("aucune mise en page ne repose un fond plein par-dessus la trame de papier", () => {
    const fichiers = [
      "components/ManagerLayout.tsx",
      "components/TenantLayout.tsx",
      "components/OwnerLayout.tsx",
      "components/AdminLayout.tsx",
      "pages/VitrinePage.tsx",
      "pages/VitrineListingPage.tsx",
      "pages/LandingPage.tsx",
      "pages/LoginPage.tsx",
    ];
    for (const fichier of fichiers) {
      expect(lire(resolve(SRC, fichier)), fichier).not.toMatch(/min-h-screen[^"]*\bbg-(canvas|slate-950)\b/);
    }
  });
});
