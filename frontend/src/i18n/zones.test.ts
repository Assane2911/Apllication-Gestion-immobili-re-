import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import adminFr from "./locales/zones/fr/admin";
import baseFr from "./locales/zones/fr/base";
import landingFr from "./locales/zones/fr/landing";
import managerFr from "./locales/zones/fr/manager";
import partageFr from "./locales/zones/fr/partage";
import tenantFr from "./locales/zones/fr/tenant";

/**
 * Textes découpés par zone (voir i18n/index.ts) : une page n'a que les zones qu'elle déclare dans App.tsx. Une clé lue dans une zone
 * non chargée s'afficherait BRUTE (« manager.tips.contractRenew ») à l'écran, sans erreur ni alerte. Ce test lit le code source et
 * vérifie, pour chaque fichier, que toute clé d'une zone est chargée par TOUTES les pages qui peuvent l'afficher.
 */
const SRC = resolve(__dirname, "..");
type Arbre = Record<string, unknown>;
const ZONES_FR: Record<string, Arbre> = { base: baseFr, landing: landingFr, manager: managerFr, admin: adminFr, tenant: tenantFr, partage: partageFr };

/** « manager.tips » → « manager » (la zone qui porte cette clé de second niveau). */
function zoneDeLaCle(haut: string, second: string): string | undefined {
  for (const [zone, contenu] of Object.entries(ZONES_FR)) {
    const sousArbre = contenu[haut] as Arbre | undefined;
    if (sousArbre && typeof sousArbre === "object" && second in sousArbre) return zone;
  }
  return undefined;
}

function fichiersSource(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return nom === "locales" || nom === "node_modules" ? [] : fichiersSource(chemin);
    return /\.(ts|tsx)$/.test(nom) && !/\.test\.(ts|tsx)$/.test(nom) ? [chemin] : [];
  });
}

const fichiers = fichiersSource(SRC);
const contenu = new Map(fichiers.map((f) => [f, readFileSync(f, "utf8")]));

function resoudre(depuis: string, specifieur: string): string | undefined {
  const base = normalize(join(dirname(depuis), specifieur));
  return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base].find((c) => contenu.has(c));
}

/** Imports relatifs d'un fichier : `statiques` (import … from) et `tous` (avec import("…") dynamiques). */
function importsDe(fichier: string): { statiques: string[]; tous: string[] } {
  const texte = contenu.get(fichier) ?? "";
  const statiques = [...texte.matchAll(/^\s*(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?["'](\.[^"']*)["']/gm)].map((m) => m[1]);
  const dynamiques = [...texte.matchAll(/import\(\s*["'](\.[^"']*)["']\s*\)/g)].map((m) => m[1]);
  const res = (liste: string[]) => liste.map((s) => resoudre(fichier, s)).filter((x): x is string => !!x);
  return { statiques: res(statiques), tous: res([...statiques, ...dynamiques]) };
}

function atteints(racines: string[], statiqueSeulement: boolean): Set<string> {
  const vus = new Set<string>();
  const pile = [...racines];
  while (pile.length) {
    const f = pile.pop() as string;
    if (vus.has(f)) continue;
    vus.add(f);
    const { statiques, tous } = importsDe(f);
    pile.push(...(statiqueSeulement ? statiques : tous));
  }
  return vus;
}

// Pages chargées à la demande, et zones que App.tsx leur déclare.
const app = readFileSync(join(SRC, "App.tsx"), "utf8");
const pages = [...app.matchAll(/const (\w+) = lazy(?:AvecZones|WithReload)\(\(\) => import\("(\.[^"]+)"\)(?:, \[([^\]]*)\])?\)/g)].map((m) => ({
  nom: m[1],
  fichier: resoudre(join(SRC, "App.tsx"), m[2]) as string,
  zones: (m[3] ?? "").split(",").map((z) => z.trim().replace(/"/g, "")).filter(Boolean),
}));

const entree = atteints([join(SRC, "main.tsx"), join(SRC, "App.tsx")], true);
// Fichiers atteints par chaque page : tout ce qu'elle importe, directement ou non, y compris par import() dynamique.
const parPage = pages.map((p) => ({ ...p, atteints: atteints([p.fichier], false) }));

/** Identifiants d'actions du journal d'audit (« manager.suspend »…) : des noms d'actions, pas des clés de texte. */
const PAS_DES_CLES = new Set(["manager.suspend", "manager.reactivate", "manager.delete", "manager.trial_reminder"]);

const REFERENCE = /["'`](manager|admin|tenant|owner|landing)\.([A-Za-z_]\w*)/g;

describe("zones de textes", () => {
  it("App.tsx déclare des zones connues, pour toutes les pages d'un espace", () => {
    expect(pages.length).toBeGreaterThan(40);
    const connues = new Set(["landing", "manager", "admin", "tenant", "partage"]);
    for (const p of pages) for (const z of p.zones) expect(connues.has(z), `${p.nom} : zone « ${z} » inconnue`).toBe(true);
  });

  it("chaque clé de deuxième niveau de manager, admin et tenant se trouve dans exactement une zone", () => {
    for (const haut of ["manager", "admin", "tenant"]) {
      const comptes = new Map<string, string[]>();
      for (const [zone, c] of Object.entries(ZONES_FR)) {
        for (const cle of Object.keys((c[haut] as Arbre) ?? {})) comptes.set(cle, [...(comptes.get(cle) ?? []), zone]);
      }
      const doubles = [...comptes].filter(([, zs]) => zs.length > 1).map(([k, zs]) => `${haut}.${k} : ${zs.join(", ")}`);
      expect(doubles).toEqual([]);
    }
  });

  it("le fichier principal (imports statiques depuis main et App) ne lit que la base : il s'affiche avant tout chargement de zone", () => {
    const fautes: string[] = [];
    for (const f of entree) {
      for (const m of (contenu.get(f) ?? "").matchAll(REFERENCE)) {
        const zone = zoneDeLaCle(m[1], m[2]);
        if (zone !== "base") fautes.push(`${relative(SRC, f)} lit ${m[1]}.${m[2]} (zone ${zone ?? "inconnue"}), absente du fichier principal`);
      }
    }
    expect([...new Set(fautes)]).toEqual([]);
  });

  it("toute clé d'une zone lue par un fichier est chargée par chaque page qui peut l'afficher", () => {
    const fautes: string[] = [];
    for (const f of fichiers) {
      if (entree.has(f)) continue;
      const refs = [...new Set([...(contenu.get(f) ?? "").matchAll(REFERENCE)].map((m) => `${m[1]}.${m[2]}`))];
      if (refs.length === 0) continue;
      const pagesDuFichier = parPage.filter((p) => p.atteints.has(f));
      for (const ref of refs) {
        if (PAS_DES_CLES.has(ref)) continue;
        const [haut, second] = ref.split(".");
        const zone = zoneDeLaCle(haut, second);
        if (!zone) {
          fautes.push(`${relative(SRC, f)} lit ${ref}, qui n'existe dans aucune zone`);
          continue;
        }
        if (zone === "base") continue;
        for (const p of pagesDuFichier) {
          if (!p.zones.includes(zone)) fautes.push(`${relative(SRC, f)} lit ${ref} (zone ${zone}), mais la page ${p.nom} ne charge que [${p.zones.join(", ")}]`);
        }
      }
    }
    expect([...new Set(fautes)]).toEqual([]);
  });
});

describe("chargement des zones", () => {
  async function neuf(langue: string | null) {
    vi.resetModules();
    if (langue) localStorage.setItem("app_language", langue);
    else localStorage.removeItem("app_language");
    const module = await import("./index");
    await module.i18nPret;
    return module;
  }

  it("au démarrage, seule la base française est là : les zones arrivent avec leurs pages", async () => {
    const { default: i18n, chargerZones } = await neuf(null);
    expect(i18n.exists("common.language.selectAria")).toBe(true);
    expect(i18n.exists("manager.tips.contractRenew")).toBe(false);

    await chargerZones(["manager"]);

    expect(i18n.exists("manager.tips.contractRenew")).toBe(true);
    expect(i18n.exists("admin.dashboard.title")).toBe(false);
  });

  it("une langue choisie après coup reçoit les zones déjà demandées par la page affichée", async () => {
    const { default: i18n, chargerZones, changerLangue } = await neuf(null);
    await chargerZones(["manager", "partage"]);

    await changerLangue("en");

    expect(i18n.language).toBe("en");
    expect(i18n.exists("manager.tips.contractRenew", { lng: "en", fallbackLng: [] })).toBe(true);
    expect(i18n.exists("manager.dashboard.title", { lng: "en", fallbackLng: [] })).toBe(true);
    localStorage.removeItem("app_language");
  });

  it("une langue mémorisée charge sa base AVANT l'affichage, puis ses zones avec la page", async () => {
    const { default: i18n, chargerZones } = await neuf("es");
    expect(i18n.language).toBe("es");
    expect(i18n.exists("common.language.selectAria", { lng: "es", fallbackLng: [] })).toBe(true);

    await chargerZones(["tenant"]);

    expect(i18n.exists("tenant.dashboard.title", { lng: "es", fallbackLng: [] })).toBe(true);
    localStorage.removeItem("app_language");
  });

  it("demander deux fois la même zone ne la recharge pas et ne plante pas", async () => {
    const { default: i18n, chargerZones } = await neuf(null);
    await chargerZones(["landing"]);
    await chargerZones(["landing", "landing"]);
    expect(i18n.exists("landing.hero.ctaPricing")).toBe(true);
  });
});
