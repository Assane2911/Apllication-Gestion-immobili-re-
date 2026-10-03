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

  it("exclut les espaces applicatifs derrière authentification", () => {
    for (const prefix of ["/dashboard", "/admin", "/portail", "/proprietaire"]) {
      expect(txt).toContain(`Disallow: ${prefix}`);
    }
  });
});
