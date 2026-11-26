import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { testDb } from "../test/setupTestDb";

/**
 * Le script migrations/2026-11-26-supprimer-iban-bic.sql n'est joué qu'à la main, après le déploiement du code qui ne
 * nomme plus ces colonnes. Ce test le rejoue sur une base qui les porte encore (comme la production) : il doit les
 * retirer des trois tables, sans toucher au reste, et pouvoir être rejoué sans erreur.
 */
const TABLES = ["owners", "agency_settings", "platform_settings"] as const;
const script = readFileSync(resolve(__dirname, "../../migrations/2026-11-26-supprimer-iban-bic.sql"), "utf8");
const instructions = script
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const colonnes = async () => {
  const r = (await testDb.execute(
    sql`SELECT table_name || '.' || column_name AS nom FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name IN ('iban', 'bic') ORDER BY 1`
  )) as unknown as { rows?: Array<{ nom: string }> } & Array<{ nom: string }>;
  return (r.rows ?? r).map((x) => x.nom);
};
const jouer = async () => {
  for (const instruction of instructions) await testDb.execute(sql.raw(instruction));
};

describe("migration : suppression des colonnes iban et bic", () => {
  it("un schéma issu de schema.ts ne les porte plus", async () => {
    expect(await colonnes()).toEqual([]);
  });

  it("retire les six colonnes d'une base qui les porte encore, sans toucher aux autres données, et se rejoue sans erreur", async () => {
    for (const t of TABLES) {
      await testDb.execute(sql.raw(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS iban TEXT`));
      await testDb.execute(sql.raw(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS bic TEXT`));
    }
    await testDb.execute(sql`INSERT INTO platform_settings (id, iban, bic) VALUES ('platform', 'FR7630006000011234567890189', 'BNPAFRPP') ON CONFLICT (id) DO UPDATE SET iban = EXCLUDED.iban`);
    expect(await colonnes()).toHaveLength(6);

    await jouer();

    expect(await colonnes()).toEqual([]);
    const lignes = (await testDb.execute(sql`SELECT id FROM platform_settings`)) as unknown as { rows?: Array<{ id: string }> } & Array<{ id: string }>;
    expect((lignes.rows ?? lignes).map((l) => l.id)).toEqual(["platform"]);

    await expect(jouer()).resolves.toBeUndefined();
    expect(await colonnes()).toEqual([]);
  });
});
