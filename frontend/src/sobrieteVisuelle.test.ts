import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Charte « plan d'architecte » : des aplats nets, des traits, des hachures. Ce garde-fou empêche le retour des effets
// de décor générique (texte ou barres en dégradé, halos flous, verre dépoli, pulsations) sur les pages de l'application.
const SRC = __dirname;

function sources(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return sources(chemin);
    return /\.tsx$/.test(nom) && !/\.test\./.test(nom) ? [chemin] : [];
  });
}

const fautifs = (motif: RegExp, ignorer?: RegExp) =>
  sources(SRC)
    .filter((chemin) => !ignorer?.test(chemin) && motif.test(readFileSync(chemin, "utf8")))
    .map((chemin) => chemin.replace(SRC, "src"));

describe("sobriété visuelle", () => {
  it("aucun texte ni fond en dégradé de couleurs", () => {
    // Le seul dégradé permis est le voile noir sous le titre d'une photo (`from-slate-950/…`).
    expect(fautifs(/bg-clip-text|text-transparent|bg-linear-to-[a-z]+ (?!from-slate-950)|bg-gradient-to/)).toEqual([]);
  });

  it("aucun halo flou ni verre dépoli", () => {
    expect(fautifs(/(^|[\s"'`])(blur-[a-z0-9]+|backdrop-blur[a-z0-9-]*)/)).toEqual([]);
  });

  it("aucune pulsation décorative (seuls les squelettes de chargement pulsent)", () => {
    expect(fautifs(/animate-pulse/, /Skeleton\.tsx$/)).toEqual([]);
  });
});
