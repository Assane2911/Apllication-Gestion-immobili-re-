import { sql } from "drizzle-orm";
import { db } from "./client";
import { users } from "./schema";
import { seedDatabase } from "../seed";

export async function initDb() {
  try {
    // PGlite does not support CREATE TYPE ... AS ENUM, so we create tables
    // using TEXT columns with CHECK constraints to emulate enum validation.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('MANAGER', 'TENANT')),
        subscription_status TEXT NOT NULL DEFAULT 'TRIAL' CHECK (subscription_status IN ('TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED')),
        subscription_plan TEXT NOT NULL DEFAULT 'PRO' CHECK (subscription_plan IN ('STARTER', 'PRO', 'ENTERPRISE')),
        trial_ends_at TIMESTAMP,
        subscription_ends_at TIMESTAMP,
        subscription_payment_method TEXT CHECK (subscription_payment_method IN ('STRIPE', 'MOBILE_MONEY', 'BANK_TRANSFER', 'DEMO')),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure columns exist on existing databases
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'TRIAL'`); } catch {}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'PRO'`); } catch {}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP`); } catch {}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP`); } catch {}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_payment_method TEXT`); } catch {}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`); } catch {}
    try { await db.execute(sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`); } catch {}
    try { await db.execute(sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`); } catch {}
    try { await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`); } catch {}
    try { await db.execute(sql`UPDATE users SET trial_ends_at = CURRENT_TIMESTAMP + INTERVAL '15 days', subscription_status = 'TRIAL' WHERE role = 'MANAGER' AND trial_ends_at IS NULL`); } catch {}

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS platform_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan TEXT NOT NULL CHECK (plan IN ('STARTER', 'PRO', 'ENTERPRISE')),
        amount DOUBLE PRECISION NOT NULL,
        billing_cycle TEXT NOT NULL DEFAULT 'MONTHLY',
        status TEXT NOT NULL DEFAULT 'PAID',
        payment_method TEXT NOT NULL,
        payment_ref TEXT,
        start_date TIMESTAMP NOT NULL,
        end_date TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS properties (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        address TEXT NOT NULL,
        surface DOUBLE PRECISION NOT NULL,
        rent DOUBLE PRECISION NOT NULL,
        status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE')),
        description TEXT,
        image_url TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        id_document TEXT,
        user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id),
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        rent DOUBLE PRECISION NOT NULL,
        deposit DOUBLE PRECISION NOT NULL,
        start_date TIMESTAMP NOT NULL,
        end_date TIMESTAMP NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED', 'TERMINATED')),
        reminder_sent_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id),
        period_month INTEGER NOT NULL,
        period_year INTEGER NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        due_date TIMESTAMP NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'LATE', 'CANCELLED')),
        paid_at TIMESTAMP,
        payment_method TEXT CHECK (payment_method IN ('STRIPE', 'MOBILE_MONEY', 'BANK_TRANSFER', 'DEMO')),
        payment_ref TEXT,
        reminder_sent_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try { await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP`); } catch {}

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS invoices_contract_period_unique
      ON invoices (contract_id, period_month, period_year)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS issue_reports (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id),
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        photo_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')),
        manager_note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("✅ Tables et types de base de données initialisés avec succès.");

    // Auto-seed if database is empty
    const existingUsers = await db.select().from(users);
    if (existingUsers.length === 0) {
      console.log("🌱 Aucune donnée détectée — injection automatique du seed de démo...");
      await seedDatabase();
    }
  } catch (err) {
    console.error("[db] Erreur lors de l'initialisation du schéma :", err);
    throw err;
  }
}
