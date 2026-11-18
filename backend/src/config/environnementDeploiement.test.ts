import { describe, expect, it } from "vitest";
import { environnementSentry, estProductionReelle, schemaAMettreAJour } from "./environnementDeploiement";

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

describe("schemaAMettreAJour", () => {
  it("la production met le schéma à jour (c'est ainsi que la base de production évolue)", () => {
    expect(schemaAMettreAJour("production", undefined)).toBe(true);
  });

  it("un aperçu Vercel NE touche PAS au schéma : il partage la base de production", () => {
    expect(schemaAMettreAJour("preview", undefined)).toBe(false);
    expect(schemaAMettreAJour("preview", "")).toBe(false);
    expect(schemaAMettreAJour("preview", "false")).toBe(false);
  });

  it("un aperçu qui a SA PROPRE base peut le demander explicitement (PREVIEW_DB_MIGRATIONS=true)", () => {
    expect(schemaAMettreAJour("preview", "true")).toBe(true);
  });

  it("hors aperçu (développement local, démarrage réel de la CI, tests), le schéma est mis à jour comme avant", () => {
    expect(schemaAMettreAJour(undefined, undefined)).toBe(true);
    expect(schemaAMettreAJour("development", undefined)).toBe(true);
  });
});
