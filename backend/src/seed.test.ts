import { afterEach, describe, expect, it } from "vitest";
import { refusDeSeed } from "./seed";

/**
 * Régression : ce fichier créait des comptes de démonstration avec un mot de
 * passe écrit en clair dans le code, sur n'importe quelle base. Deux de ces
 * comptes se sont retrouvés dans la base de PRODUCTION — dont un gestionnaire
 * avec un abonnement actif — alors que le dépôt est public.
 *
 * Ces tests verrouillent les deux conditions qui l'auraient empêché.
 */
describe("refusDeSeed", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  function preparer(env: Record<string, string | undefined>) {
    delete process.env.VERCEL;
    delete process.env.SEED_ALLOW_REMOTE;
    process.env.NODE_ENV = "development";
    for (const [cle, valeur] of Object.entries(env)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
  }

  it("autorise une base locale en développement", () => {
    preparer({ DATABASE_URL: "postgresql://postgres:motdepasse@localhost:5432/gestion_immo" });
    expect(refusDeSeed()).toBeNull();
  });

  it("autorise aussi 127.0.0.1", () => {
    preparer({ DATABASE_URL: "postgresql://postgres:x@127.0.0.1:5432/gestion_immo" });
    expect(refusDeSeed()).toBeNull();
  });

  it("REFUSE une base distante, même en développement", () => {
    // Le cas réel : machine en développement, mais DATABASE_URL pointée sur
    // Supabase. Le garde-fou sur NODE_ENV seul n'aurait rien empêché.
    preparer({ DATABASE_URL: "postgresql://postgres:x@db.iljmbgwpcdplfddiiunp.supabase.co:5432/postgres" });

    const refus = refusDeSeed();
    expect(refus).not.toBeNull();
    expect(refus?.raison).toContain("n'est pas locale");
    // La raison nomme l'hôte, pour que l'erreur soit exploitable.
    expect(refus?.raison).toContain("supabase.co");
  });

  it("REFUSE en production, même si la base est locale", () => {
    preparer({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://postgres:x@localhost:5432/gestion_immo",
    });
    expect(refusDeSeed()?.raison).toContain("production");
  });

  it("REFUSE sur Vercel, quel que soit NODE_ENV", () => {
    preparer({ VERCEL: "1", DATABASE_URL: "postgresql://postgres:x@localhost:5432/gestion_immo" });
    expect(refusDeSeed()?.raison).toContain("production");
  });

  it("n'autorise une base distante que sur consentement explicite", () => {
    preparer({
      DATABASE_URL: "postgresql://postgres:x@db.exemple.supabase.co:5432/postgres",
      SEED_ALLOW_REMOTE: "true",
    });
    expect(refusDeSeed()).toBeNull();
  });

  it("refuse si DATABASE_URL est absente", () => {
    preparer({ DATABASE_URL: undefined });
    expect(refusDeSeed()?.raison).toContain("DATABASE_URL");
  });

  it("refuse une URL illisible plutôt que de la supposer locale", () => {
    preparer({ DATABASE_URL: "ceci-nest-pas-une-url" });
    expect(refusDeSeed()).not.toBeNull();
  });
});
