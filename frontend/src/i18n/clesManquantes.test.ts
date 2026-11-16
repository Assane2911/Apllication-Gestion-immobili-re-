import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import i18n, { changerLangue } from "./index";

/**
 * Un `t("landing.nav.compare", "Comparatif")` dont la clé n'existe dans aucune langue affiche son texte par défaut
 * — en français — à tout le monde : le lien du menu restait « Comparatif » en anglais comme en espagnol, sans qu'aucun
 * test ne le voie. Chaque clé littérale passée à `t(...)` doit exister en français (la langue de référence).
 */
function fichiersSource(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return nom === "locales" || nom === "node_modules" ? [] : fichiersSource(chemin);
    return /\.(ts|tsx)$/.test(nom) && !/\.test\.(ts|tsx)$/.test(nom) ? [chemin] : [];
  });
}

describe("clés de traduction", () => {
  it("toutes les clés littérales appelées par t() existent en français", async () => {
    await changerLangue("fr");
    const manquantes: string[] = [];
    for (const fichier of fichiersSource(resolve(__dirname, ".."))) {
      const texte = readFileSync(fichier, "utf8");
      for (const m of texte.matchAll(/[^\w.]t\(\s*["']([a-zA-Z][\w]*(?:\.[\w]+)+)["']/g)) {
        // Une clé au pluriel n'existe que sous « clé_one » / « clé_other » : on la reconnaît à sa forme « autre ».
        const existe = i18n.exists(m[1], { lng: "fr" }) || i18n.exists(`${m[1]}_other`, { lng: "fr" });
        if (!existe) manquantes.push(`${fichier.replace(resolve(__dirname, "..") + "/", "")} → ${m[1]}`);
      }
    }
    expect(manquantes).toEqual([]);
  });
});
