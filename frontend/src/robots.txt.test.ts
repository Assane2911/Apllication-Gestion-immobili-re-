import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("public/robots.txt", () => {
  const txt = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../public/robots.txt"), "utf-8");

  it("autorise le crawl par défaut", () => {
    expect(txt).toMatch(/User-agent: \*/);
    expect(txt).toMatch(/Allow: \//);
  });

  it("n'exclut pas la vitrine publique ni ses annonces", () => {
    expect(txt).not.toMatch(/Disallow: \/vitrine\s*$/m);
  });

  it("pointe vers le sitemap généré au build", () => {
    expect(txt).toMatch(/Sitemap: https:\/\/[^\s]+\/sitemap\.xml/);
  });

  /**
   * La liste des exclusions avait pris du retard : huit espaces ajoutés depuis (agenda, documents, import, assurances,
   * parrainage, guide, pays, prestataires) n'y figuraient pas. Chaque route de App.tsx qui n'est pas une page publique
   * doit commencer par une adresse exclue.
   */
  it("exclut TOUTES les routes de l'application hors pages publiques", () => {
    const app = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf-8");
    const routes = [...new Set([...app.matchAll(/<Route\s+path="(\/[^"*]*)"/g)].map((m) => m[1]))];
    const publiques = new Set(["/", "/landing", "/login", "/inscription", "/mot-de-passe-oublie", "/reinitialiser-mot-de-passe", "/verifier-email", "/mentions-legales", "/cgu", "/confidentialite", "/vitrine", "/vitrine/annonces/:id"]);
    const exclusions = [...txt.matchAll(/^Disallow: (\S+)/gm)].map((m) => m[1]);
    const oubliees = routes.filter((r) => !publiques.has(r) && !exclusions.some((d) => r.startsWith(d)));
    expect(oubliees).toEqual([]);
  });

  it("exclut les espaces applicatifs derrière authentification", () => {
    for (const prefix of ["/dashboard", "/admin", "/portail", "/proprietaire"]) {
      expect(txt).toContain(`Disallow: ${prefix}`);
    }
  });
});
