import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Charger les polices depuis fonts.googleapis.com / fonts.gstatic.com envoie l'adresse IP de CHAQUE visiteur à
 * Google dès l'ouverture de la page, avant toute action et sans consentement : un tribunal allemand (LG München I,
 * 20 janvier 2022) y a vu une violation du RGPD, et la CNIL range ces appels parmi les transferts à des tiers. Le
 * bandeau de consentement ne couvre que la mesure d'audience : les polices doivent donc être servies par nous.
 */
const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const main = readFileSync(resolve(__dirname, "../main.tsx"), "utf8");

describe("polices de caractères", () => {
  it("la page ne contacte aucun serveur de polices de Google", () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it("les polices Manrope et Public Sans sont embarquées avec l'application", () => {
    expect(main).toMatch(/@fontsource\/manrope/);
    expect(main).toMatch(/@fontsource\/public-sans/);
  });
});

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");

describe("police des titres", () => {
  // `'"Manrope"'` (guillemets doubles DANS des guillemets simples) désigne une famille dont le nom contient des
  // guillemets : elle n'existe pas, et tous les titres h1–h3 de la plateforme retombaient sur la police système.
  it("les titres h1–h3 demandent bien la famille Manrope, et non un nom entouré de guillemets parasites", () => {
    expect(css).not.toContain(`'"Manrope"'`);
    expect(css).toMatch(/h1,\s*h2,\s*h3\s*\{[^}]*(font-display|font-family:\s*"Manrope")/);
  });
});
