import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Deux réglages de sécurité qui vivent hors du code applicatif, donc que personne ne relit :
 *
 * 1. Le site (une application monopage servie par Vercel) n'envoyait AUCUN en-tête de sécurité — seule l'API,
 *    protégée par helmet, en avait. Sans eux, la page de connexion peut être affichée dans un cadre invisible
 *    d'un autre site (détournement de clic), le navigateur devine le type des fichiers, et l'adresse complète des
 *    pages (lien de réinitialisation compris) part dans l'en-tête Referer vers les sites tiers.
 * 2. Le workflow de CI n'avait pas de bloc `permissions` : le jeton du workflow recevait les droits par défaut du
 *    dépôt, parfois en écriture, alors que lire le code suffit à lancer le build et les tests.
 */
const RACINE = join(__dirname, "../..");
const dispo = existsSync(join(RACINE, "frontend/vercel.json")) && existsSync(join(RACINE, ".github/workflows/ci.yml"));

type Entete = { key: string; value: string };
type Regle = { source: string; headers: Entete[] };

function enTetesDuSite(): Map<string, string> {
  const config = JSON.parse(readFileSync(join(RACINE, "frontend/vercel.json"), "utf8")) as { headers?: Regle[] };
  const regle = (config.headers ?? []).find((r) => r.source === "/(.*)");
  return new Map((regle?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
}

describe.skipIf(!dispo)("en-têtes de sécurité du site", () => {
  it("interdit le chargement des fichiers sous un autre type que celui annoncé", () => {
    expect(enTetesDuSite().get("x-content-type-options")).toBe("nosniff");
  });

  it("interdit l'affichage du site dans un cadre d'un autre site (détournement de clic)", () => {
    const entetes = enTetesDuSite();
    expect(entetes.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(entetes.get("content-security-policy")).toBe("frame-ancestors 'self'");
  });

  it("n'envoie aux sites tiers que l'origine, jamais l'adresse complète de la page", () => {
    expect(enTetesDuSite().get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("n'accorde que les fonctions du navigateur dont l'application se sert", () => {
    const permissions = enTetesDuSite().get("permissions-policy") ?? "";
    expect(permissions).toContain("camera=(self)");
    expect(permissions).toContain("microphone=()");
    expect(permissions).toContain("geolocation=()");
    expect(permissions).toContain("payment=()");
  });

  it("garde la redirection de toutes les pages vers l'application monopage", () => {
    const config = JSON.parse(readFileSync(join(RACINE, "frontend/vercel.json"), "utf8")) as { rewrites?: Array<{ source: string; destination: string }> };
    expect(config.rewrites).toEqual([{ source: "/(.*)", destination: "/index.html" }]);
  });
});

describe.skipIf(!dispo)("workflow de CI", () => {
  const ci = dispo ? readFileSync(join(RACINE, ".github/workflows/ci.yml"), "utf8") : "";

  it("déclare des droits en lecture seule pour le jeton du workflow", () => {
    expect(ci).toMatch(/^permissions:\n  contents: read\s*$/m);
  });

  it("n'utilise ni pull_request_target ni secret", () => {
    expect(ci).not.toMatch(/pull_request_target/);
    expect(ci).not.toMatch(/\$\{\{\s*secrets\./);
  });
});
