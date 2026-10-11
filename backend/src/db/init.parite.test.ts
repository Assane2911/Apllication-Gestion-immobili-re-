import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { testDb } from "../test/setupTestDb";
import { initDb } from "./init";

/**
 * Parité entre schema.ts et initDb() sur une base VIERGE.
 *
 * Les tests construisent leur base avec pushSchema (schema.ts), et la
 * production avec initDb() puis des évolutions successives : rien ne vérifiait
 * que les deux produisent la même structure. Une colonne ajoutée à schema.ts et
 * oubliée dans initDb() passait donc tous les tests, et ne se découvrait que
 * sur une installation neuve — là où l'application plante au premier accès à
 * la colonne manquante. C'est arrivé trois fois (users.has_password,
 * owners.civility, tenants.civility), et deux index déclarés n'avaient jamais
 * été créés (vendors_manager_id_idx, issue_reports_vendor_id_idx), y compris
 * en production.
 *
 * Règle vérifiée : tout ce que schema.ts déclare — colonne, ou index nommé
 * `…_idx` — doit être créé par initDb(). Dans l'autre sens, seules les colonnes
 * sont comparées : un index de plus créé par initDb() est sans danger.
 *
 * Les différences de forme sans conséquence (now() / CURRENT_TIMESTAMP, noms
 * `_key` / `_unique` des contraintes d'unicité, énumération / texte + CHECK)
 * ne sont volontairement pas comparées.
 */
const lire = async () => {
  const colonnes = (await testDb.execute(
    sql`SELECT table_name || '.' || column_name AS nom FROM information_schema.columns WHERE table_schema = 'public'`
  )) as unknown as { rows?: Array<{ nom: string }> } & Array<{ nom: string }>;
  const index = (await testDb.execute(
    sql`SELECT indexname AS nom FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%\\_idx'`
  )) as unknown as { rows?: Array<{ nom: string }> } & Array<{ nom: string }>;
  const noms = (r: { rows?: Array<{ nom: string }> } & Array<{ nom: string }>) => (r.rows ?? r).map((x) => x.nom).sort();
  return { colonnes: noms(colonnes), index: noms(index) };
};

describe("initDb() sur une base vierge", () => {
  it("crée tout ce que schema.ts déclare", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // État attendu : celui que pushSchema a construit à partir de schema.ts.
    const attendu = await lire();
    expect(attendu.colonnes.length).toBeGreaterThan(200);

    // Base vierge : plus aucune table, comme sur une installation neuve.
    await testDb.execute(sql`DROP SCHEMA public CASCADE`);
    await testDb.execute(sql`CREATE SCHEMA public`);
    await initDb();
    const obtenu = await lire();

    const colonnesManquantes = attendu.colonnes.filter((c) => !obtenu.colonnes.includes(c));
    const colonnesEnTrop = obtenu.colonnes.filter((c) => !attendu.colonnes.includes(c));
    const indexManquants = attendu.index.filter((i) => !obtenu.index.includes(i));

    expect({ colonnesManquantes, colonnesEnTrop, indexManquants }).toEqual({
      colonnesManquantes: [],
      colonnesEnTrop: [],
      indexManquants: [],
    });
  });
});
