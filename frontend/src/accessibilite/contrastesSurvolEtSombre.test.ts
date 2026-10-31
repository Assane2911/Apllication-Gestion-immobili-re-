import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrastes que l'audit axe-core a trouvés en rejouant les pages avec le pointeur posé sur un bouton et en thème
 * sombre (un audit « à froid » ne les voit pas) :
 *
 *  - les boutons pleins `bg-brand-600 text-white` passaient au survol à `bg-brand-500` : le blanc dessus tombait à
 *    3,68:1, sous les 4,5:1 du niveau AA. Le survol d'un bouton blanc sur fond bleu s'assombrit, il ne s'éclaircit
 *    pas au-delà de ce que le texte blanc supporte ;
 *  - le bouton « Annuler » des fenêtres (`text-slate-500`) restait gris moyen sur le fond sombre de la fenêtre :
 *    3,75:1. Il a besoin d'une variante sombre plus claire.
 *
 * Le test lit les vraies couleurs dans index.css : il garde sa valeur si la palette change.
 */
const SRC = join(__dirname, "..");
const css = readFileSync(join(SRC, "index.css"), "utf8");

function fichiersTsx(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersTsx(chemin);
    return /\.tsx$/.test(nom) && !/\.test\.tsx$/.test(nom) ? [chemin] : [];
  });
}

/** Chaînes entre guillemets ou accents graves du code, avec leur fichier : c'est là que vivent les classes Tailwind. */
function chaines(): Array<{ fichier: string; texte: string }> {
  const sortie: Array<{ fichier: string; texte: string }> = [];
  for (const chemin of fichiersTsx(SRC)) {
    const source = readFileSync(chemin, "utf8");
    for (const m of source.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
      sortie.push({ fichier: chemin.replace(SRC, "src"), texte: m[2] });
    }
  }
  return sortie;
}

function jeton(nom: string): string {
  const m = css.match(new RegExp(`--color-${nom}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`Jeton --color-${nom} introuvable dans index.css`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (clair + 0.05) / (sombre + 0.05);
}

describe("boutons pleins — le texte blanc reste lisible au survol", () => {
  const classes = chaines().filter((c) => /(^|\s)text-white(\s|$)/.test(c.texte) && /(^|\s)hover:bg-brand-\d+(\s|$)/.test(c.texte));

  it("il existe des boutons concernés (le test ne tourne pas à vide)", () => {
    expect(classes.length).toBeGreaterThan(10);
  });

  it("le fond de survol de chaque bouton à texte blanc atteint 4,5:1", () => {
    const trop_clairs = classes
      .map((c) => ({ ...c, survol: c.texte.match(/(?:^|\s)hover:bg-brand-(\d+)(?:\s|$)/)![1] }))
      .filter((c) => contraste("#ffffff", jeton(`brand-${c.survol}`)) < 4.5)
      .map((c) => `${c.fichier} : hover:bg-brand-${c.survol}`);
    expect(trop_clairs).toEqual([]);
  });

  it("le fond de repos aussi", () => {
    const trop_clairs = classes
      .flatMap((c) => [...c.texte.matchAll(/(?:^|\s)bg-brand-(\d+)(?:\s|$)/g)].map((m) => ({ fichier: c.fichier, repos: m[1] })))
      .filter((c) => contraste("#ffffff", jeton(`brand-${c.repos}`)) < 4.5)
      .map((c) => `${c.fichier} : bg-brand-${c.repos}`);
    expect(trop_clairs).toEqual([]);
  });
});
