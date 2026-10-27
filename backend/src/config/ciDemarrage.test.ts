import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Du 5 au 7 octobre 2026, le site est resté en panne deux jours, CI verte : les tests tournent sous Node 22, avec toutes les
 * dépendances de développement, et ne chargent pas l'application comme le fait le serveur. La CI démarre donc aussi le
 * backend compilé sous Node 24, avec les seules dépendances de production, et exige /api/health = 200.
 *
 * Ce garde-fou vérifie que ce job existe et garde ses trois propriétés ; il est ignoré si le dépôt n'est pas complet.
 */
const RACINE = join(__dirname, "../../..");
const dispo = existsSync(join(RACINE, ".github/workflows/ci.yml")) && existsSync(join(RACINE, "backend/scripts/verifier-demarrage.js"));

const ci = () => readFileSync(join(RACINE, ".github/workflows/ci.yml"), "utf8");
const jobDemarrage = () => {
  const texte = ci();
  const debut = texte.indexOf("  demarrage:");
  const fin = texte.indexOf("\n  frontend:", debut);
  return texte.slice(debut, fin === -1 ? undefined : fin);
};

describe.skipIf(!dispo)("démarrage réel du backend en CI", () => {
  it("la CI a un job de démarrage réel", () => {
    expect(ci()).toContain("  demarrage:");
    expect(jobDemarrage()).toContain("scripts/verifier-demarrage.js");
  });

  it("il tourne sous Node 24, la version de Vercel", () => {
    expect(jobDemarrage()).toMatch(/node-version:\s*24\b/);
  });

  it("il retire les dépendances de développement avant de démarrer, comme en production", () => {
    const job = jobDemarrage();
    expect(job).toContain("npm prune --omit=dev");
    expect(job.indexOf("npm run build")).toBeGreaterThan(-1);
    expect(job.indexOf("npm prune --omit=dev")).toBeGreaterThan(job.indexOf("npm run build"));
    expect(job.indexOf("verifier-demarrage.js")).toBeGreaterThan(job.indexOf("npm prune --omit=dev"));
  });

  it("le script exige un 200 sur /api/health et active l'instrumentation Sentry", () => {
    const script = readFileSync(join(RACINE, "backend/scripts/verifier-demarrage.js"), "utf8");
    expect(script).toContain("/api/health");
    expect(script).toMatch(/SENTRY_DSN/);
    expect(script).toMatch(/process\.exit\(1\)/);
  });

  it("DEPLOYMENT.md explique la panne, ce que la CI vérifie et ce qu'elle ne vérifie pas", () => {
    const guide = readFileSync(join(RACINE, "DEPLOYMENT.md"), "utf8");
    expect(guide).toMatch(/FUNCTION_INVOCATION_FAILED/);
    expect(guide).toMatch(/ERR_REQUIRE_ESM/);
    expect(guide).toMatch(/démarrage réel/);
    expect(guide).toMatch(/Il ne reproduit pas tout/);
  });

  it("le job existant des tests reste sous Node 22 (la version annoncée dans le README)", () => {
    expect(ci().match(/node-version:\s*(\d+)/)?.[1]).toBe("22");
  });
});
