import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createManager } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { initDb } from "./init";

/**
 * initDb() s'exécute à chaque démarrage à froid d'une fonction serverless.
 * « IF NOT EXISTS » n'évite pas le verrou exclusif d'un ALTER TABLE : rejouer
 * ces instructions sans condition bloquait toute requête sur la table derrière
 * elles (voir le commentaire de init.ts). Ces tests tiennent la règle
 * inverse : sur un schéma déjà à jour, AUCUNE instruction de schéma ne part.
 *
 * Ils ne peuvent pas reproduire le verrou lui-même (PGlite sérialise les
 * transactions) : ce comportement-là a été vérifié contre un vrai Postgres.
 */
const dialecte = new PgDialect();
const texte = (requete: unknown) => dialecte.sqlToQuery(requete as never).sql;

/** Enregistre le texte de chaque instruction émise par initDb(), transactions comprises. */
function enregistrerInstructions() {
  const emises: string[] = [];
  const db = testDb as unknown as {
    execute: (q: unknown) => Promise<unknown>;
    transaction: (fn: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<unknown>) => Promise<unknown>;
  };
  const execute = db.execute.bind(db);
  const transaction = db.transaction.bind(db);
  vi.spyOn(db, "execute").mockImplementation((q) => {
    emises.push(texte(q));
    return execute(q);
  });
  vi.spyOn(db, "transaction").mockImplementation((fn) =>
    transaction((tx) =>
      fn({
        ...tx,
        execute: (q: unknown) => {
          emises.push(texte(q));
          return tx.execute(q);
        },
      })
    )
  );
  return emises;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("initDb : idempotence sans verrou inutile", () => {
  it("n'émet AUCUNE instruction de schéma quand tout existe déjà", async () => {
    await initDb(); // amène le schéma à jour (contrainte de rôle comprise)
    const emises = enregistrerInstructions();

    await initDb();

    const ddl = emises.filter((q) => /\b(ALTER|CREATE|DROP)\b/i.test(q));
    expect(ddl).toEqual([]);
    // Et se limite à quelques lectures de l'état du schéma.
    expect(emises.length).toBeLessThan(10);
  });

  it("n'ouvre de transaction à verrou borné que pour des LECTURES quand tout existe déjà", async () => {
    await initDb();
    const emises = enregistrerInstructions();

    await initDb();

    const ecritures = emises.filter((q) => /\b(INSERT|UPDATE|DELETE)\b/i.test(q));
    expect(ecritures).toEqual([]);
  });

  it("recrée une colonne manquante, avec un verrou borné", async () => {
    await initDb();
    await testDb.execute(sql`ALTER TABLE users DROP COLUMN suspension_reason`);
    const emises = enregistrerInstructions();

    await initDb();

    const colonne = await testDb.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'suspension_reason'`
    );
    const lignes = Array.isArray(colonne) ? colonne : ((colonne as { rows: unknown[] }).rows ?? []);
    expect(lignes).toHaveLength(1);
    // La réparation s'est faite sous un délai de verrou, jamais sans.
    expect(emises.some((q) => /SET LOCAL lock_timeout/i.test(q))).toBe(true);
    expect(emises.filter((q) => /ADD COLUMN IF NOT EXISTS suspension_reason/i.test(q))).toHaveLength(1);
  });

  it("recrée un index manquant", async () => {
    await initDb();
    await testDb.execute(sql`DROP INDEX IF EXISTS admin_audit_logs_created_at_idx`);

    await initDb();

    const index = await testDb.execute(sql`SELECT indexname FROM pg_indexes WHERE indexname = 'admin_audit_logs_created_at_idx'`);
    const lignes = Array.isArray(index) ? index : ((index as { rows: unknown[] }).rows ?? []);
    expect(lignes).toHaveLength(1);
  });

  it("remplace une contrainte de rôle PÉRIMÉE (sans ADMIN ni OWNER)", async () => {
    await initDb();
    await testDb.execute(sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await testDb.execute(sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('MANAGER', 'TENANT'))`);

    await initDb();

    const def = await testDb.execute(sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'users_role_check'`);
    const lignes = (Array.isArray(def) ? def : ((def as { rows: unknown[] }).rows ?? [])) as Array<{ def: string }>;
    expect(lignes).toHaveLength(1);
    expect(lignes[0].def).toContain("'ADMIN'");
    expect(lignes[0].def).toContain("'OWNER'");
  });

  it("repose une contrainte de rôle absente", async () => {
    await initDb();
    await testDb.execute(sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);

    await initDb();

    const def = await testDb.execute(sql`SELECT conname FROM pg_constraint WHERE conname = 'users_role_check'`);
    const lignes = Array.isArray(def) ? def : ((def as { rows: unknown[] }).rows ?? []);
    expect(lignes).toHaveLength(1);
  });

  it("donne toujours un essai aux gestionnaires qui n'en ont pas (rattrapage conservé)", async () => {
    const manager = await createManager({ trialEndsAt: null });

    await initDb();

    const resultat = await testDb.execute(sql`SELECT trial_ends_at, subscription_status FROM users WHERE id = ${manager.id}`);
    const lignes = (Array.isArray(resultat) ? resultat : ((resultat as { rows: unknown[] }).rows ?? [])) as Array<{
      trial_ends_at: Date | null;
      subscription_status: string;
    }>;
    expect(lignes[0].trial_ends_at).not.toBeNull();
    expect(lignes[0].subscription_status).toBe("TRIAL");
  });
});
