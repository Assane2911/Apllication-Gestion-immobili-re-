import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testDb } from "../test/setupTestDb";
import { initDb } from "./init";

/**
 * Le gestionnaire peut enregistrer un encaissement en espèces, par chèque ou
 * par Mobile Money (voir markInvoicePaid). Les bases déjà en service ne
 * connaissent pas ces moyens : initDb() doit les ajouter, sous les DEUX formes
 * de base qui coexistent — vrai type ENUM (production) et TEXT + CHECK
 * (base créée par initDb).
 */
const NOUVEAUX = ["CASH", "CHEQUE", "MOBILE_MONEY"];

const lignes = <T>(r: unknown): T[] => (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await testDb.execute(sql`DROP SCHEMA public CASCADE`);
  await testDb.execute(sql`CREATE SCHEMA public`);
});

describe("initDb() — moyens de paiement saisis à la main", () => {
  it("ajoute les nouveaux moyens à un type ENUM existant (production), sans toucher aux anciens", async () => {
    await testDb.execute(sql`CREATE TYPE payment_method AS ENUM ('STRIPE', 'PAYDUNYA', 'BANK_TRANSFER', 'DEMO')`);

    await initDb();

    const labels = lignes<{ enumlabel: string }>(
      await testDb.execute(sql`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'payment_method'`)
    ).map((l) => l.enumlabel);
    expect(labels).toEqual(expect.arrayContaining(["STRIPE", "PAYDUNYA", "BANK_TRANSFER", "DEMO", ...NOUVEAUX]));
    expect(labels).toHaveLength(7);
  });

  it("est idempotent : un second démarrage ne change rien et n'échoue pas", async () => {
    await testDb.execute(sql`CREATE TYPE payment_method AS ENUM ('STRIPE', 'PAYDUNYA', 'BANK_TRANSFER', 'DEMO')`);
    await initDb();
    await initDb();

    const labels = lignes<{ enumlabel: string }>(
      await testDb.execute(sql`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'payment_method'`)
    );
    expect(labels).toHaveLength(7);
  });

  it("remplace la contrainte CHECK d'une base TEXT qui ne connaît que les anciens moyens", async () => {
    await testDb.execute(sql`
      CREATE TABLE invoices (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        period_month INTEGER NOT NULL,
        period_year INTEGER NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        due_date TIMESTAMP NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        paid_at TIMESTAMP,
        payment_method TEXT CHECK (payment_method IN ('STRIPE', 'PAYDUNYA', 'BANK_TRANSFER', 'DEMO')),
        payment_ref TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await initDb();

    for (const [mois, moyen] of NOUVEAUX.entries()) {
      await testDb.execute(
        sql.raw(
          `INSERT INTO invoices (id, contract_id, period_month, period_year, amount, due_date, payment_method) VALUES ('i-${moyen}', 'c', ${mois + 1}, 2026, 100, now(), '${moyen}')`
        )
      );
    }
    const lues = lignes<{ payment_method: string }>(await testDb.execute(sql`SELECT payment_method FROM invoices ORDER BY id`));
    expect(lues.map((l) => l.payment_method).sort()).toEqual([...NOUVEAUX].sort());
    // La contrainte reste utile : une valeur inconnue est toujours refusée.
    await expect(
      testDb.execute(sql`INSERT INTO invoices (id, contract_id, period_month, period_year, amount, due_date, payment_method) VALUES ('i-x', 'c', 12, 2026, 100, now(), 'BITCOIN')`)
    ).rejects.toThrow();
  });

  it("une installation neuve accepte directement les nouveaux moyens", async () => {
    await initDb();

    await testDb.execute(sql`INSERT INTO users (id, email, password_hash, role) VALUES ('u', 'u@test.local', 'x', 'MANAGER')`);
    const definition = lignes<{ def: string }>(
      await testDb.execute(sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'invoices_payment_method_check'`)
    )[0]?.def;
    for (const moyen of NOUVEAUX) expect(definition).toContain(`'${moyen}'`);
  });
});
