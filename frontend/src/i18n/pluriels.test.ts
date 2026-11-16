import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import pt from "./locales/pt";
import i18n, { changerLangue } from "./index";

/**
 * Les textes disaient « 1 jour(s) restant(s) » : le « (s) » est une rustine d'écriture, pas du français — et un
 * lecteur d'écran lit « parenthèse s ». Chaque nombre s'accorde maintenant par les pluriels d'i18next
 * (« clé_one » / « clé_other », règles de chaque langue) : « 1 jour restant », « 3 jours restants ».
 *
 * Ce garde-fou tient trois choses : plus aucun « (s) » dans aucun texte, chaque pluriel a ses deux formes et le nombre
 * dans chacune, et chaque appel qui lit un pluriel lui passe bien `count` — sans lui, i18next afficherait la clé brute.
 */
type Arbre = { [cle: string]: string | Arbre };
const LANGUES: Array<[string, Arbre]> = [
  ["fr", fr as unknown as Arbre],
  ["en", en as unknown as Arbre],
  ["es", es as unknown as Arbre],
  ["pt", pt as unknown as Arbre],
];

function feuilles(arbre: Arbre, prefixe = ""): Record<string, string> {
  return Object.entries(arbre).reduce<Record<string, string>>((acc, [cle, valeur]) => {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    return typeof valeur === "string" ? { ...acc, [chemin]: valeur } : { ...acc, ...feuilles(valeur, chemin) };
  }, {});
}

const RUSTINE = /[\p{L}]\((?:s|es|x|em|ns|is|ões|ies|y\/ies)\)/u;
const SUFFIXE = /_(one|other)$/;

describe("pluriels des textes", () => {
  it.each(LANGUES)("%s : aucun « (s) » ni « (es) » laissé dans les textes", (_nom, arbre) => {
    const fautes = Object.entries(feuilles(arbre)).filter(([, texte]) => RUSTINE.test(texte));
    expect(fautes.map(([cle, texte]) => `${cle} = ${texte}`)).toEqual([]);
  });

  it.each(LANGUES)("%s : chaque pluriel a ses deux formes, avec le nombre dans chacune", (_nom, arbre) => {
    const toutes = feuilles(arbre);
    const fautes: string[] = [];
    for (const cle of Object.keys(toutes).filter((k) => SUFFIXE.test(k))) {
      const base = cle.replace(SUFFIXE, "");
      for (const forme of ["one", "other"]) {
        const texte = toutes[`${base}_${forme}`];
        if (texte === undefined) fautes.push(`${base} : la forme « ${forme} » manque`);
        else if (!texte.includes("{{count}}")) fautes.push(`${base}_${forme} : pas de {{count}}`);
      }
    }
    expect(fautes).toEqual([]);
  });

  it("les quatre langues ont les mêmes pluriels", () => {
    const [, referenceFr] = LANGUES[0];
    const base = (arbre: Arbre) => Object.keys(feuilles(arbre)).filter((k) => /_one$/.test(k)).sort();
    for (const [nom, arbre] of LANGUES.slice(1)) expect(base(arbre), nom).toEqual(base(referenceFr));
  });
});

describe("accord des nombres à l'affichage", () => {
  beforeAll(async () => {
    await changerLangue("fr");
  });

  const fr_textes = feuilles(fr as unknown as Arbre);
  const pluriels = Object.keys(fr_textes)
    .filter((k) => /_one$/.test(k))
    .map((k) => k.replace(/_one$/, ""));

  it("compte au moins une centaine de pluriels", () => {
    expect(pluriels.length).toBeGreaterThan(100);
  });

  it("0, 1, 2 et 5 donnent un texte, sans clé brute ni variable laissée, dans chaque langue", async () => {
    const fautes: string[] = [];
    for (const [langue] of LANGUES) {
      await changerLangue(langue);
      for (const cle of pluriels) {
        for (const n of [0, 1, 2, 5]) {
          const variables = Object.fromEntries([...fr_textes[`${cle}_other`].matchAll(/\{\{(\w+)\}\}/g)].map((v) => [v[1], "7"]));
          const texte = i18n.t(cle, { ...variables, count: n }) as string;
          if (texte === cle || /\{\{/.test(texte) || !texte.includes(String(n))) fautes.push(`${langue} ${cle} (${n}) → ${texte}`);
        }
      }
    }
    await changerLangue("fr");
    expect(fautes).toEqual([]);
  });

  it("« 1 » reste au singulier et « 3 » passe au pluriel", async () => {
    await changerLangue("fr");
    expect(i18n.t("tenant.invoices.lateDays", { count: 1 })).toBe("En retard de 1 jour");
    expect(i18n.t("tenant.invoices.lateDays", { count: 3 })).toBe("En retard de 3 jours");
    await changerLangue("pt");
    expect(i18n.t("nav.unread", { count: 1 })).toBe("1 mensagem por ler");
    expect(i18n.t("nav.unread", { count: 4 })).toBe("4 mensagens por ler");
    await changerLangue("es");
    expect(i18n.t("tenant.invoices.lateDays", { count: 1 })).toContain("1 día");
    expect(i18n.t("tenant.invoices.lateDays", { count: 2 })).toContain("2 días");
    await changerLangue("fr");
  });
});

function fichiersSource(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return nom === "locales" || nom === "node_modules" ? [] : fichiersSource(chemin);
    return /\.(ts|tsx)$/.test(nom) && !/\.test\.(ts|tsx)$/.test(nom) ? [chemin] : [];
  });
}

/** Le texte de l'appel `t(…)` qui contient la position donnée, parenthèses comprises. */
function appelAutour(source: string, position: number): string {
  const debut = source.lastIndexOf("(", position);
  let profondeur = 0;
  for (let i = debut; i < source.length; i++) {
    if (source[i] === "(") profondeur++;
    else if (source[i] === ")" && --profondeur === 0) return source.slice(debut, i + 1);
  }
  return source.slice(debut, debut + 200);
}

/** Clés lues par un composant qui ajoute lui-même `count` : MenuLateral reçoit le libellé d'une pastille et lui passe le nombre. */
const LUES_AVEC_COUNT_AILLEURS = new Set(["nav.overdue"]);

describe("appels aux pluriels", () => {
  it("chaque appel d'une clé au pluriel passe `count`", () => {
    const pluriels = Object.keys(feuilles(fr as unknown as Arbre))
      .filter((k) => /_one$/.test(k))
      .map((k) => k.replace(/_one$/, ""));
    const fautes: string[] = [];
    for (const fichier of fichiersSource(resolve(__dirname, ".."))) {
      const source = readFileSync(fichier, "utf8");
      for (const cle of pluriels.filter((c) => !LUES_AVEC_COUNT_AILLEURS.has(c))) {
        for (const m of source.matchAll(new RegExp(cle.replace(/\./g, "\\.") + "[\"'`]", "g"))) {
          if (!/\bcount\b/.test(appelAutour(source, m.index ?? 0))) fautes.push(`${fichier.replace(resolve(__dirname, "..") + "/", "")} → ${cle}`);
        }
      }
    }
    expect(fautes).toEqual([]);
  });
});
