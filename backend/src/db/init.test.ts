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
    // Et se limite à quelques lectures de l'état du schéma (schéma, RLS, rôles de l'API publique, essais, rattrapages).
    expect(emises.length).toBeLessThan(15);
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

  it("ne pose pas d'essai fictif aux collaborateurs invités, et n'écrit rien pour eux", async () => {
    await initDb();
    const proprietaire = await createManager();
    const collaborateur = await createManager({ teamOwnerId: proprietaire.id, teamRole: "AGENT", trialEndsAt: null });
    const emises = enregistrerInstructions();

    await initDb();

    const resultat = await testDb.execute(sql`SELECT trial_ends_at FROM users WHERE id = ${collaborateur.id}`);
    const lignes = (Array.isArray(resultat) ? resultat : ((resultat as { rows: unknown[] }).rows ?? [])) as Array<{
      trial_ends_at: Date | null;
    }>;
    expect(lignes[0].trial_ends_at).toBeNull();
    expect(emises.filter((q) => /\bUPDATE\b/i.test(q))).toEqual([]);
  });
});

/** Les tables du schéma courant, avec l'état de leur protection par lignes (RLS). */
async function tablesEtRls(): Promise<Array<{ relname: string; relrowsecurity: boolean }>> {
  const r = await testDb.execute(
    sql`SELECT c.relname, c.relrowsecurity FROM pg_class c WHERE c.relnamespace = current_schema()::regnamespace AND c.relkind = 'r' ORDER BY c.relname`
  );
  return Array.isArray(r) ? r : ((r as { rows: Array<{ relname: string; relrowsecurity: boolean }> }).rows ?? []);
}

/**
 * Supabase expose le schéma `public` par une API REST ouverte au rôle `anon` : sans protection par lignes (RLS),
 * une table y est lisible et modifiable par quiconque détient la clé publique du projet. L'application, elle, se
 * connecte directement (rôle propriétaire, qui contourne la RLS) et n'en est pas gênée. Le conseiller de sécurité
 * de Supabase signalait 13 tables créées sans cette protection.
 */
describe("initDb : protection par lignes (RLS) de toutes les tables", () => {
  it("active la RLS sur chaque table du schéma, sans en oublier", async () => {
    await initDb();

    const tables = await tablesEtRls();
    expect(tables.length).toBeGreaterThan(25);
    expect(tables.filter((t) => !t.relrowsecurity).map((t) => t.relname)).toEqual([]);
  });

  it("protège aussi une table ajoutée sans elle, au démarrage suivant", async () => {
    await initDb();
    await testDb.execute(sql`CREATE TABLE table_sans_protection_essai (id text PRIMARY KEY)`);
    try {
      await initDb();

      const essai = (await tablesEtRls()).find((t) => t.relname === "table_sans_protection_essai");
      expect(essai?.relrowsecurity).toBe(true);
    } finally {
      await testDb.execute(sql`DROP TABLE IF EXISTS table_sans_protection_essai`);
    }
  });

  it("ne bloque pas l'application : l'accès par la connexion directe lit toujours les lignes", async () => {
    await initDb();
    const manager = await createManager();

    const r = await testDb.execute(sql`SELECT id FROM users WHERE id = ${manager.id}`);
    const lignes = Array.isArray(r) ? r : ((r as { rows: unknown[] }).rows ?? []);
    expect(lignes).toHaveLength(1);
  });

  it("ne rejoue aucune instruction quand toutes les tables sont déjà protégées", async () => {
    await initDb();
    const emises = enregistrerInstructions();

    await initDb();

    expect(emises.filter((q) => /ROW LEVEL SECURITY/i.test(q))).toEqual([]);
  });
});

/** Les droits d'`anon` / `authenticated` sur les tables du schéma, et leurs droits par défaut sur les futures. */
async function droitsPublics(): Promise<{ tables: string[]; defauts: number }> {
  const t = await testDb.execute(
    sql`SELECT DISTINCT c.relname FROM pg_class c, aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee WHERE c.relnamespace = current_schema()::regnamespace AND c.relkind = 'r' AND r.rolname IN ('anon', 'authenticated') ORDER BY c.relname`
  );
  const d = await testDb.execute(
    sql`SELECT d.oid FROM pg_default_acl d, aclexplode(d.defaclacl) a JOIN pg_roles r ON r.oid = a.grantee WHERE d.defaclnamespace = current_schema()::regnamespace AND d.defaclobjtype = 'r' AND r.rolname IN ('anon', 'authenticated')`
  );
  const l = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows: unknown[] }).rows ?? []));
  return { tables: (l(t) as Array<{ relname: string }>).map((x) => x.relname), defauts: l(d).length };
}

/**
 * Seconde barrière derrière la RLS : sur Supabase, `anon` et `authenticated` reçoivent tous les droits sur chaque table
 * du schéma `public`, existante ou à venir. Ces rôles n'existent pas dans un Postgres ordinaire : on les crée ici pour
 * reproduire la situation de Supabase.
 */
describe("initDb : retrait des droits de l'API publique (anon, authenticated)", () => {
  async function simulerSupabase() {
    await testDb.execute(sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$`);
    await testDb.execute(sql`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`);
    await testDb.execute(sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`);
  }

  it("retire leurs droits sur toutes les tables existantes", async () => {
    await initDb();
    await simulerSupabase();
    expect((await droitsPublics()).tables.length).toBeGreaterThan(25);

    await initDb();

    expect((await droitsPublics()).tables).toEqual([]);
  });

  it("retire aussi leurs droits par défaut, pour que les futures tables n'en reçoivent pas", async () => {
    await initDb();
    await simulerSupabase();
    expect((await droitsPublics()).defauts).toBeGreaterThan(0);

    await initDb();

    expect((await droitsPublics()).defauts).toBe(0);
    await testDb.execute(sql`CREATE TABLE table_future_essai (id text PRIMARY KEY)`);
    try {
      expect((await droitsPublics()).tables).toEqual([]);
    } finally {
      await testDb.execute(sql`DROP TABLE IF EXISTS table_future_essai`);
    }
  });

  it("ne touche pas à l'application : l'accès par la connexion directe lit toujours les lignes", async () => {
    await initDb();
    await simulerSupabase();
    await initDb();
    const manager = await createManager();

    const r = await testDb.execute(sql`SELECT id FROM users WHERE id = ${manager.id}`);
    expect(Array.isArray(r) ? r : ((r as { rows: unknown[] }).rows ?? [])).toHaveLength(1);
  });

  it("n'émet aucune instruction de droits quand tout est déjà durci", async () => {
    await initDb();
    await simulerSupabase();
    await initDb();
    const emises = enregistrerInstructions();

    await initDb();

    expect(emises.filter((q) => /\b(GRANT|REVOKE|DEFAULT PRIVILEGES)\b/i.test(q))).toEqual([]);
  });
});

describe("initDb : index des clés étrangères signalées sans index", () => {
  it.each([
    ["users_team_owner_id_idx", "users", "team_owner_id"],
    ["activity_logs_actor_id_idx", "activity_logs", "actor_id"],
    ["admin_audit_logs_admin_id_idx", "admin_audit_logs", "admin_id"],
    ["suggestions_author_id_idx", "suggestions", "author_id"],
  ])("recrée %s s'il manque", async (nom, table, colonne) => {
    await initDb();
    await testDb.execute(sql.raw(`DROP INDEX IF EXISTS ${nom}`));

    await initDb();

    const r = await testDb.execute(sql`SELECT indexdef FROM pg_indexes WHERE indexname = ${nom}`);
    const lignesIdx = (Array.isArray(r) ? r : ((r as { rows: unknown[] }).rows ?? [])) as Array<{ indexdef: string }>;
    expect(lignesIdx).toHaveLength(1);
    expect(lignesIdx[0].indexdef).toContain(`${table} `);
    expect(lignesIdx[0].indexdef).toContain(`(${colonne})`);
  });
});
