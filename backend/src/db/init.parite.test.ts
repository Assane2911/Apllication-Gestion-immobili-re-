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
 * Règle vérifiée, dans les deux sens : colonnes et index nommés `…_idx` sont les
 * mêmes dans schema.ts et après initDb(). Un index créé par initDb() mais absent
 * de schema.ts serait invisible de drizzle-kit (et d'un pushSchema neuf) ;
 * c'était le cas de users_referred_by_user_id_idx.
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
  // Colonnes obligatoires : « NOT NULL » est la garantie d'isolation par gestionnaire
  // (manager_id), elle ne doit pas dépendre de la façon dont la base a été créée.
  const obligatoires = (await testDb.execute(
    sql`SELECT table_name || '.' || column_name AS nom FROM information_schema.columns WHERE table_schema = 'public' AND is_nullable = 'NO'`
  )) as unknown as { rows?: Array<{ nom: string }> } & Array<{ nom: string }>;
  // Règle de suppression de chaque clé étrangère (CASCADE, SET NULL, NO ACTION) :
  // la suppression d'un compte gestionnaire en dépend.
  const suppressions = (await testDb.execute(
    sql`SELECT kcu.table_name || '.' || kcu.column_name || ' -> ' || ccu.table_name || ' : ' || rc.delete_rule AS nom
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name AND kcu.constraint_schema = rc.constraint_schema
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.unique_constraint_name OR ccu.constraint_name = rc.constraint_name
        WHERE rc.constraint_schema = 'public'`
  )) as unknown as { rows?: Array<{ nom: string }> } & Array<{ nom: string }>;
  const noms = (r: { rows?: Array<{ nom: string }> } & Array<{ nom: string }>) => (r.rows ?? r).map((x) => x.nom).sort();
  return { colonnes: noms(colonnes), index: noms(index), obligatoires: noms(obligatoires), suppressions: noms(suppressions) };
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
    const indexEnTrop = obtenu.index.filter((i) => !attendu.index.includes(i));

    // Une colonne obligatoire dans schema.ts doit l'être aussi après initDb()
    // (l'inverse — plus strict en base qu'en schéma — n'est pas comparé).
    const obligatoiresPerdues = attendu.obligatoires.filter((c) => !obtenu.obligatoires.includes(c));
    const suppressionsDifferentes = attendu.suppressions.filter((r) => !obtenu.suppressions.includes(r));

    expect({ colonnesManquantes, colonnesEnTrop, indexManquants, indexEnTrop, obligatoiresPerdues, suppressionsDifferentes }).toEqual({
      colonnesManquantes: [],
      colonnesEnTrop: [],
      indexManquants: [],
      indexEnTrop: [],
      obligatoiresPerdues: [],
      suppressionsDifferentes: [],
    });
  });
});
