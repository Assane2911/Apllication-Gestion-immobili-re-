import { describe, expect, it } from "vitest";
import { environnementSentry, estProductionReelle } from "./environnementDeploiement";

describe("estProductionReelle", () => {
  it("la production Vercel est la production", () => {
    expect(estProductionReelle("production", "1", "production")).toBe(true);
  });

  it("un aperçu Vercel n'est PAS la production, bien que VERCEL=1 et NODE_ENV=production y valent aussi", () => {
    expect(estProductionReelle("preview", "1", "production")).toBe(false);
  });

  it("le développement Vercel n'est pas la production", () => {
    expect(estProductionReelle("development", "1", "development")).toBe(false);
  });

  it("hors Vercel, NODE_ENV=production reste la production (démarrage réel de la CI)", () => {
    expect(estProductionReelle(undefined, undefined, "production")).toBe(true);
    expect(estProductionReelle(undefined, undefined, "development")).toBe(false);
    expect(estProductionReelle(undefined, undefined, "test")).toBe(false);
  });

  it("sur Vercel sans VERCEL_ENV, garde la prudence d'avant : traité comme la production", () => {
    expect(estProductionReelle(undefined, "1", "production")).toBe(true);
  });
});

describe("environnementSentry", () => {
  it("étiquette un aperçu « preview » : ses erreurs ne se mêlent plus à celles de la production", () => {
    expect(environnementSentry("preview", "production")).toBe("preview");
  });

  it("garde l'étiquette d'avant ailleurs", () => {
    expect(environnementSentry("production", "production")).toBe("production");
    expect(environnementSentry(undefined, "production")).toBe("production");
    expect(environnementSentry(undefined, "development")).toBe("development");
  });
});
