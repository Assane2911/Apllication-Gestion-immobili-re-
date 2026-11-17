import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  construireTable,
  genererScript,
  injecterDansLeHtml,
  routesDepuisApp,
  type SortieBuild,
} from "../prechargementDesPages";

/**
 * Préchargement de la page et de ses textes, annoncé dès le HTML (prechargementDesPages.ts, branché sur le build dans vite.config.ts).
 * Sans lui, la page d'une adresse n'était découverte qu'une fois le code principal exécuté : 1,8 s au lieu de 0,3 s sur une connexion lente.
 */
const APP = readFileSync(join(__dirname, "App.tsx"), "utf8");

describe("routes lues dans App.tsx", () => {
  const routes = routesDepuisApp(APP);
  const de = (chemin: string) => routes.find((r) => r.chemin === chemin);

  it("trouve l'accueil (page d'accueil du visiteur non connecté), la vitrine, la connexion et l'inscription", () => {
    expect(de("/")).toEqual({ chemin: "/", page: "pages/LandingPage", zones: ["landing", "partage"] });
    expect(de("/vitrine")).toMatchObject({ page: "pages/VitrinePage", zones: ["partage"] });
    expect(de("/login")).toMatchObject({ page: "pages/LoginPage", zones: [] });
    expect(de("/inscription")).toMatchObject({ page: "pages/RegisterPage", zones: [] });
  });

  it("trouve les pages de chaque espace avec leurs zones de textes", () => {
    expect(de("/dashboard")).toMatchObject({ page: "pages/manager/DashboardPage", zones: ["manager", "partage"] });
    expect(de("/portail")).toMatchObject({ page: "pages/tenant/TenantDashboardPage", zones: ["tenant", "partage"] });
    expect(de("/proprietaire")).toMatchObject({ page: "pages/owner/OwnerDashboardPage", zones: ["partage"] });
    expect(de("/admin")).toMatchObject({ page: "pages/admin/AdminDashboardPage", zones: ["admin", "partage"] });
  });

  it("garde les adresses à paramètre, une seule fois chacune", () => {
    expect(de("/vitrine/annonces/:id")).toMatchObject({ page: "pages/VitrineListingPage" });
    expect(de("/admin/gestionnaires/:id")).toMatchObject({ page: "pages/admin/AdminManagerDetailPage" });
    expect(new Set(routes.map((r) => r.chemin)).size).toBe(routes.length);
    expect(routes.length).toBeGreaterThan(40);
  });
});

/** Un petit build factice : le code principal et sa bibliothèque, une page et ses dépendances, des fichiers de textes. */
function sortie(): SortieBuild {
  return {
    "assets/index-aaa.js": { type: "chunk", isEntry: true, imports: ["assets/vendor-bbb.js"] },
    "assets/vendor-bbb.js": { type: "chunk", imports: [] },
    "assets/LandingPage-ccc.js": { type: "chunk", facadeModuleId: "/app/src/pages/LandingPage.tsx", imports: ["assets/vendor-bbb.js", "assets/Seo-ddd.js"] },
    "assets/Seo-ddd.js": { type: "chunk", imports: ["assets/vendor-bbb.js"] },
    "assets/VitrinePage-eee.js": { type: "chunk", facadeModuleId: "/app/src/pages/VitrinePage.tsx", imports: ["assets/Seo-ddd.js"] },
    "assets/VitrineListingPage-fff.js": { type: "chunk", facadeModuleId: "/app/src/pages/VitrineListingPage.tsx", imports: [] },
    "assets/LoginPage-ggg.js": { type: "chunk", facadeModuleId: "/app/src/pages/LoginPage.tsx", imports: [] },
    "assets/DashboardPage-hhh.js": { type: "chunk", facadeModuleId: "/app/src/pages/manager/DashboardPage.tsx", imports: [] },
    "assets/landing-fr.js": { type: "chunk", facadeModuleId: "/app/src/i18n/locales/zones/fr/landing.ts", imports: [] },
    "assets/partage-fr.js": { type: "chunk", facadeModuleId: "/app/src/i18n/locales/zones/fr/partage.ts", imports: [] },
    "assets/manager-fr.js": { type: "chunk", facadeModuleId: "/app/src/i18n/locales/zones/fr/manager.ts", imports: [] },
    "assets/base-en.js": { type: "chunk", facadeModuleId: "/app/src/i18n/locales/zones/en/base.ts", imports: [] },
    "assets/landing-en.js": { type: "chunk", facadeModuleId: "/app/src/i18n/locales/zones/en/landing.ts", imports: [] },
    "assets/partage-en.js": { type: "chunk", facadeModuleId: "/app/src/i18n/locales/zones/en/partage.ts", imports: [] },
    "assets/manager-en.js": { type: "chunk", facadeModuleId: "/app/src/i18n/locales/zones/en/manager.ts", imports: [] },
    "assets/base-es.js": { type: "chunk", facadeModuleId: "/app/src/i18n/locales/zones/es/base.ts", imports: [] },
    "assets/landing-es.js": { type: "chunk", facadeModuleId: "/app/src/i18n/locales/zones/es/landing.ts", imports: [] },
    "assets/partage-es.js": { type: "chunk", facadeModuleId: "/app/src/i18n/locales/zones/es/partage.ts", imports: [] },
    "assets/index.html": { type: "asset" },
  };
}
const ROUTES = [
  { chemin: "/", page: "pages/LandingPage", zones: ["landing", "partage"] },
  { chemin: "/vitrine", page: "pages/VitrinePage", zones: ["partage"] },
  { chemin: "/vitrine/annonces/:id", page: "pages/VitrineListingPage", zones: ["partage"] },
  { chemin: "/login", page: "pages/LoginPage", zones: [] },
  { chemin: "/dashboard", page: "pages/manager/DashboardPage", zones: ["manager", "partage"] },
];
const ZONES = ["landing", "manager", "partage"];

describe("table de préchargement construite depuis le build", () => {
  const table = construireTable(sortie(), ROUTES, ZONES);
  const noms = (liste: number[]) => liste.map((i) => table.fichiers[i]);

  it("liste la page et ses dépendances, sans ce que le code principal charge déjà", () => {
    const accueil = table.routes.find((r) => r.expression === "^/$")!;
    expect(noms(accueil.page)).toEqual(["assets/LandingPage-ccc.js", "assets/Seo-ddd.js"]);
    expect(noms(accueil.page)).not.toContain("assets/vendor-bbb.js");
    expect(noms(accueil.page)).not.toContain("assets/index-aaa.js");
  });

  it("écrit l'adresse d'une route à paramètre en expression régulière exacte", () => {
    const annonce = table.routes.find((r) => r.expression === "^/vitrine/annonces/[^/]+$")!;
    expect(annonce).toBeDefined();
    expect(new RegExp(annonce.expression).test("/vitrine/annonces/abc123")).toBe(true);
    expect(new RegExp(annonce.expression).test("/vitrine/annonces/abc/def")).toBe(false);
    expect(new RegExp(annonce.expression).test("/vitrine/annonces")).toBe(false);
  });

  it("donne les textes par langue : la base seulement pour les langues autres que le français (celle du français est dans le code principal)", () => {
    expect(table.langues.fr.base).toBeUndefined();
    expect(noms(table.langues.fr.landing)).toEqual(["assets/landing-fr.js"]);
    expect(noms(table.langues.en.base)).toEqual(["assets/base-en.js"]);
    expect(noms(table.langues.es.partage)).toEqual(["assets/partage-es.js"]);
  });

  it("ignore une route dont la page est introuvable dans le build, et cite chaque fichier une seule fois", () => {
    const t = construireTable(sortie(), [...ROUTES, { chemin: "/fantome", page: "pages/Fantome", zones: [] }], ZONES);
    expect(t.routes.some((r) => r.expression === "^/fantome$")).toBe(false);
    expect(new Set(t.fichiers).size).toBe(t.fichiers.length);
  });
});

/** Exécute le script d'aide dans un faux navigateur et rend les fichiers qu'il a annoncés. */
function executer(chemin: string, { memoire = {}, memoireIllisible = false }: { memoire?: Record<string, string>; memoireIllisible?: boolean } = {}): string[] {
  const script = genererScript(construireTable(sortie(), ROUTES, ZONES));
  const liens: string[] = [];
  const document = {
    createElement: () => ({ rel: "", href: "" }),
    head: { appendChild: (l: { rel: string; href: string }) => liens.push(`${l.rel}:${l.href}`) },
  };
  const stockage = {
    getItem: (cle: string) => {
      if (memoireIllisible) throw new Error("stockage bloqué");
      return memoire[cle] ?? null;
    },
  };
  new Function("location", "localStorage", "document", script)({ pathname: chemin }, stockage, document);
  return liens;
}

describe("script d'aide exécuté dans le navigateur", () => {
  it("annonce la page d'accueil et ses textes français", () => {
    expect(executer("/")).toEqual([
      "modulepreload:/assets/LandingPage-ccc.js",
      "modulepreload:/assets/Seo-ddd.js",
      "modulepreload:/assets/landing-fr.js",
      "modulepreload:/assets/partage-fr.js",
    ]);
  });

  it("annonce, pour /en, la page, la base anglaise (que l'application charge avant de s'afficher) et les textes anglais de la page", () => {
    const liens = executer("/en");
    expect(liens).toContain("modulepreload:/assets/LandingPage-ccc.js");
    expect(liens).toContain("modulepreload:/assets/base-en.js");
    expect(liens).toContain("modulepreload:/assets/landing-en.js");
    expect(liens).toContain("modulepreload:/assets/partage-en.js");
    expect(liens.some((l) => l.endsWith("-fr.js"))).toBe(false);
  });

  it("reconnaît la vitrine dans chaque langue, avec ou sans barre finale", () => {
    for (const chemin of ["/vitrine", "/vitrine/", "/en/vitrine", "/es/vitrine/"]) {
      expect(executer(chemin), chemin).toContain("modulepreload:/assets/VitrinePage-eee.js");
    }
    expect(executer("/es/vitrine")).toContain("modulepreload:/assets/base-es.js");
  });

  it("reconnaît une annonce de la vitrine (adresse à paramètre)", () => {
    expect(executer("/vitrine/annonces/abc123")).toContain("modulepreload:/assets/VitrineListingPage-fff.js");
  });

  it("annonce la page d'un espace connecté, avec ses zones", () => {
    const liens = executer("/dashboard");
    expect(liens).toContain("modulepreload:/assets/DashboardPage-hhh.js");
    expect(liens).toContain("modulepreload:/assets/manager-fr.js");
    expect(liens).toContain("modulepreload:/assets/partage-fr.js");
  });

  it("suit la langue mémorisée du visiteur sur une adresse sans préfixe", () => {
    const liens = executer("/login", { memoire: { app_language: "es" } });
    expect(liens).toEqual(["modulepreload:/assets/LoginPage-ggg.js", "modulepreload:/assets/base-es.js"]);
    expect(executer("/login", { memoire: { app_language: "klingon" } })).toEqual(["modulepreload:/assets/LoginPage-ggg.js"]);
  });

  it("n'annonce rien sur l'accueil pour un visiteur connecté : il est redirigé vers son espace", () => {
    expect(executer("/", { memoire: { hasSession: "1" } })).toEqual([]);
    expect(executer("/en", { memoire: { hasSession: "1" } })).toEqual([]);
    // Les autres pages ne sont pas concernées par l'indice de session.
    expect(executer("/dashboard", { memoire: { hasSession: "1" } }).length).toBeGreaterThan(0);
  });

  it("n'annonce rien pour une adresse inconnue, y compris une adresse préfixée qui n'existe pas", () => {
    expect(executer("/n-importe-quoi")).toEqual([]);
    expect(executer("/en/login")).toEqual([]);
    expect(executer("/vitrine/annonces")).toEqual([]);
  });

  it("fonctionne quand le navigateur interdit de lire le stockage, et ne lève jamais d'erreur", () => {
    expect(executer("/", { memoireIllisible: true })).toContain("modulepreload:/assets/LandingPage-ccc.js");
    expect(() => executer("/en", { memoireIllisible: true })).not.toThrow();
  });
});

describe("injection dans le HTML", () => {
  it("ajoute un script `async` à la fin du head, jamais incorporé (la politique de sécurité de contenu l'interdit)", () => {
    const html = injecterDansLeHtml("<html><head><title>x</title></head><body></body></html>", "/assets/precharge-abc.js");
    expect(html).toContain('<script async src="/assets/precharge-abc.js"></script>\n  </head>');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });
});
