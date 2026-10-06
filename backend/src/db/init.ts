import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * Exécute une migration additive (ALTER TABLE ... ADD COLUMN IF NOT EXISTS,
 * DROP/ADD CONSTRAINT...) en avalant l'échec plutôt qu'en interrompant tout
 * initDb() — une seule instruction en délicatesse (base pas encore créée sur
 * un environnement PGlite local vierge, essentiellement) ne doit pas empêcher
 * TOUTES les suivantes de s'exécuter. Journalisé (contrairement à l'ancien
 * `catch {}` muet) : un vrai échec — typo, permission refusée, coupure réseau
 * en plein milieu — se manifestait auparavant bien plus tard, sur une requête
 * applicative sans rapport, avec un message qui ne pointait vers rien.
 */
async function alterSiBesoin(migration: () => Promise<unknown>): Promise<void> {
  try {
    await migration();
  } catch (err) {
    console.error("[db] Échec d'une migration additive (non bloquant) :", err);
  }
}

export async function initDb() {
  try {
    // PGlite does not support CREATE TYPE ... AS ENUM, so we create tables
    // using TEXT columns with CHECK constraints to emulate enum validation.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('MANAGER', 'TENANT', 'ADMIN', 'OWNER')),
        token_version INTEGER NOT NULL DEFAULT 0,
        subscription_status TEXT NOT NULL DEFAULT 'TRIAL' CHECK (subscription_status IN ('TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED')),
        subscription_plan TEXT NOT NULL DEFAULT 'STARTER' CHECK (subscription_plan IN ('STARTER', 'PRO', 'ENTERPRISE')),
        trial_ends_at TIMESTAMP,
        subscription_ends_at TIMESTAMP,
        subscription_payment_method TEXT CHECK (subscription_payment_method IN ('STRIPE', 'PAYDUNYA', 'BANK_TRANSFER', 'DEMO')),
        referral_code TEXT UNIQUE,
        referred_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        referral_reward_granted_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // owners/listings/listing_leads/platform_settings et les colonnes
    // properties.owner_id, users.google_id,
    // users.subscription_payment_attempt_started_at et
    // invoices.payment_attempt_started_at (plus bas) étaient totalement
    // absents de ce fichier alors que schema.ts les déclare déjà (créés
    // directement en base de production par un autre chantier) : une base
    // PGlite locale neuve n'avait donc ni ces tables ni ces colonnes, et
    // toute requête Drizzle les ciblant (OwnersPage, ListingsPage,
    // ListingLeadsPage, connexion Google, virement bancaire plateforme...)
    // échouait avec "column/relation ... does not exist".
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS owners (
        id TEXT PRIMARY KEY,
        manager_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        company_name TEXT,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT,
        iban TEXT,
        bic TEXT,
        management_fee_rate DOUBLE PRECISION NOT NULL DEFAULT 8.0,
        notes TEXT,
        user_id TEXT REFERENCES users(id),
        anonymized_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS listings (
        id TEXT PRIMARY KEY,
        manager_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'RENT',
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        price_period TEXT NOT NULL DEFAULT 'MONTH',
        surface DOUBLE PRECISION,
        rooms INTEGER,
        location TEXT NOT NULL,
        image_url TEXT,
        contact_phone TEXT,
        contact_whatsapp TEXT,
        contact_email TEXT,
        status TEXT NOT NULL DEFAULT 'PUBLISHED',
        featured BOOLEAN NOT NULL DEFAULT FALSE,
        country TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS listing_leads (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        manager_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        prospect_name TEXT NOT NULL,
        prospect_email TEXT NOT NULL,
        prospect_phone TEXT NOT NULL,
        request_type TEXT NOT NULL DEFAULT 'VISIT',
        preferred_date TIMESTAMP,
        message TEXT,
        status TEXT NOT NULL DEFAULT 'NEW',
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS platform_settings (
        id TEXT PRIMARY KEY,
        iban TEXT,
        bic TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ordre important pour PGlite/Postgres : ces CREATE TABLE portent des
    // clés étrangères vers properties/tenants/contracts, qui doivent donc
    // déjà exister. Sur une base totalement vierge (PGlite fallback local,
    // sans DATABASE_URL), créer "expenses" avant "properties" par exemple
    // échouait avec "relation properties does not exist" — initDb() plantait
    // dès le premier démarrage, avant même app.listen(). C'est ce qui a été
    // corrigé ici en remontant properties/tenants/contracts/invoices avant
    // les tables qui les référencent.
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
        -- Pas UNIQUE ici : schema.ts déclare l'unicité par (manager_id, email)
        -- uniquement (index composite ci-dessous), pas globalement — deux
        -- agences distinctes doivent pouvoir chacune enregistrer un locataire
        -- partageant le même email.
        email TEXT NOT NULL,
        id_document TEXT,
        user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
        anonymized_at TIMESTAMP,
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
        deposit_deductions TEXT,
        deposit_refunded_at TIMESTAMP,
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
        payment_method TEXT CHECK (payment_method IN ('STRIPE', 'PAYDUNYA', 'BANK_TRANSFER', 'DEMO')),
        payment_ref TEXT,
        reminder_sent_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await alterSiBesoin(() => db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP`));

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS invoices_contract_period_unique
      ON invoices (contract_id, period_month, period_year)
    `);

    // Doit venir après contracts/properties/tenants (FK).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS inspections (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        manager_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'ENTRY',
        status TEXT NOT NULL DEFAULT 'DRAFT',
        inspection_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        rooms_data TEXT,
        meters_data TEXT,
        keys_data TEXT,
        general_comments TEXT,
        manager_signature_url TEXT,
        signed_by_manager_at TIMESTAMP,
        tenant_signature_url TEXT,
        signed_by_tenant_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        category TEXT NOT NULL DEFAULT 'MAINTENANCE',
        title TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        expense_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        receipt_url TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_role TEXT NOT NULL,
        content TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agency_settings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        agency_name TEXT NOT NULL DEFAULT 'Agence Immobilière',
        logo_url TEXT,
        siret_or_id TEXT,
        address TEXT,
        phone TEXT,
        email TEXT,
        legal_notice TEXT,
        stamp_or_signature_url TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS platform_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan TEXT NOT NULL CHECK (plan IN ('STARTER', 'PRO', 'ENTERPRISE')),
        amount DOUBLE PRECISION NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
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
      CREATE TABLE IF NOT EXISTS vendors (
        id TEXT PRIMARY KEY,
        manager_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        trade TEXT,
        phone TEXT NOT NULL,
        email TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
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
        vendor_id TEXT REFERENCES vendors(id) ON DELETE SET NULL,
        scheduled_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        actor_role TEXT,
        actor_label TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        entity_label TEXT NOT NULL,
        details TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure columns exist on existing databases. Ces ALTER doivent
    // s'exécuter APRÈS tous les CREATE TABLE ci-dessus : sur une base
    // totalement vierge (PGlite fallback local, sans DATABASE_URL), les
    // tables visées n'existaient pas encore quand ce bloc était placé plus
    // haut, donc chaque ALTER échouait silencieusement (try/catch) et les
    // colonnes ci-dessous — dont manager_id, indispensable à l'isolation par
    // gestionnaire — n'étaient jamais créées, faisant échouer les CREATE
    // INDEX juste après ("column manager_id does not exist") puis toute
    // requête applicative qui s'appuie sur ces colonnes.
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE platform_subscriptions ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'TRIAL'`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'STARTER'`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_payment_method TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS scanned_contract_url TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_by_manager_at TIMESTAMP`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS manager_signature_url TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_by_tenant_at TIMESTAMP`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS tenant_signature_url TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_soon_reminder_sent_at TIMESTAMP`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS additional_photos TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMP`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_payment_attempt_started_at TIMESTAMP`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_attempt_started_at TIMESTAMP`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES owners(id) ON DELETE SET NULL`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS iban TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS bic TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS team_owner_id TEXT REFERENCES users(id) ON DELETE CASCADE`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMP`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes_hash TEXT`));
    // Planification des interventions prestataires : sur une base créée avant
    // ce correctif, la table existe déjà sans cette colonne.
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP`));
    // Sur une base créée avant ce correctif, "tenants.email" portait encore
    // une contrainte UNIQUE globale (nom par défaut Postgres/PGlite pour une
    // colonne UNIQUE déclarée en ligne) — on la retire au profit de l'index
    // composite (manager_id, email) créé plus bas, seul contrat réellement
    // voulu par schema.ts.
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_email_key`));

    // Colonnes ajoutées au schéma après l'écriture des CREATE TABLE ci-dessus.
    // Elles étaient absentes de ce fichier, si bien qu'une base créée par
    // initDb() (installation locale neuve) n'avait ni l'isolation par
    // gestionnaire, ni la réinitialisation de mot de passe, ni la vérification
    // d'email — et toute requête Drizzle sur ces tables échouait, Drizzle
    // nommant explicitement chaque colonne déclarée dans schema.ts.
    //
    // manager_id est ajouté NULLABLE ici, alors que le schéma le déclare
    // obligatoire : une colonne NOT NULL ne peut pas être ajoutée à une table
    // contenant déjà des lignes sans valeur par défaut. Les insertions
    // applicatives la renseignent toujours, la contrainte n'est donc utile
    // qu'à la création initiale de la table.
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS manager_id TEXT REFERENCES users(id)`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS manager_id TEXT REFERENCES users(id)`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS manager_id TEXT REFERENCES users(id)`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS terms TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_token_hash TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_expires_at TIMESTAMP`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP`));

    // Les bases locales créées avant l'ajout des rôles ADMIN et OWNER portent
    // encore une contrainte CHECK qui ne les autorise pas : un admin créé via
    // « npm run create-admin », ou un propriétaire créé par createOwnerAccount
    // (owner.controller.ts), y serait refusé par la base elle-même. On la
    // remplace.
    await alterSiBesoin(async () => {
      await db.execute(sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
      await db.execute(sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('MANAGER', 'TENANT', 'ADMIN', 'OWNER'))`);
    });
    // Sur une base créée avant ce correctif, "messages.is_read" portait le
    // type TEXT (défaut 'false') hérité du CREATE TABLE ci-dessus, alors que
    // schema.ts la déclare boolean() depuis toujours : Postgres refuse la
    // comparaison "is_read = false" ("operator does not exist: text =
    // boolean"), ce qui faisait échouer GET /api/notifications dès qu'un
    // gestionnaire avait des messages non lus (constaté en production —
    // Sentry IMMOPLATFORM-PRO-BACKEND-2, >1200 occurrences). Idempotent :
    // relancer ces ALTER sur une colonne déjà boolean ne fait rien.
    await alterSiBesoin(async () => {
      await db.execute(sql`ALTER TABLE messages ALTER COLUMN is_read DROP DEFAULT`);
      await db.execute(sql`ALTER TABLE messages ALTER COLUMN is_read TYPE BOOLEAN USING (is_read::boolean)`);
      await db.execute(sql`ALTER TABLE messages ALTER COLUMN is_read SET DEFAULT false`);
    });
    // 15 jours, pas 10 : même durée que celle réellement accordée à
    // l'inscription (voir auth.controller.ts). Ce backfill ne visait que les
    // comptes gestionnaire pré-existants sans date d'essai ; leur donner une
    // durée différente de celle annoncée partout ailleurs dans l'application
    // aurait été incohérent.
    await alterSiBesoin(() => db.execute(sql`UPDATE users SET trial_ends_at = CURRENT_TIMESTAMP + INTERVAL '15 days', subscription_status = 'TRIAL' WHERE role = 'MANAGER' AND trial_ends_at IS NULL`));
    // Droit à l'effacement (RGPD art. 17) pour un propriétaire — voir
    // anonymiserOwner (owner.controller.ts), même principe que
    // tenants.anonymized_at ci-dessus, pour un propriétaire qu'un bien associé
    // empêche de supprimer (deleteOwner).
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE owners ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMP`));
    // Carnet de prestataires/artisans (vendors) : sur une base créée avant ce
    // correctif, la table existe déjà sans cette colonne — voir
    // assignVendorToIssue (issue.controller.ts).
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS vendor_id TEXT REFERENCES vendors(id) ON DELETE SET NULL`));
    // Restitution du dépôt de garantie : sur une base créée avant ce correctif,
    // la table existe déjà sans ces colonnes — voir recordDepositRefund
    // (contract.controller.ts).
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deposit_deductions TEXT`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deposit_refunded_at TIMESTAMP`));
    // Programme de parrainage : sur une base créée avant ce correctif, la
    // table existe déjà sans ces colonnes — voir referral.service.ts.
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL`));
    await alterSiBesoin(() => db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_reward_granted_at TIMESTAMP`));

    // Index de performance sur clés étrangères et filtres fréquents
    await db.execute(sql`CREATE INDEX IF NOT EXISTS properties_manager_id_idx ON properties (manager_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS tenants_manager_id_idx ON tenants (manager_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS contracts_property_id_idx ON contracts (property_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS contracts_tenant_id_idx ON contracts (tenant_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS contracts_status_idx ON contracts (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS invoices_contract_id_idx ON invoices (contract_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS invoices_due_date_idx ON invoices (due_date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS expenses_property_id_idx ON expenses (property_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS issue_reports_contract_id_idx ON issue_reports (contract_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS issue_reports_tenant_id_idx ON issue_reports (tenant_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS issue_reports_status_idx ON issue_reports (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS messages_sender_id_idx ON messages (sender_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS messages_contract_id_idx ON messages (contract_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS activity_logs_manager_id_idx ON activity_logs (manager_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON activity_logs (created_at)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS tenants_manager_email_unique ON tenants (manager_id, email)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS properties_owner_id_idx ON properties (owner_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS owners_manager_id_idx ON owners (manager_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS owners_user_id_idx ON owners (user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS listings_manager_id_idx ON listings (manager_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS listings_status_idx ON listings (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS listings_type_idx ON listings (type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS listings_country_idx ON listings (country)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS listing_leads_listing_id_idx ON listing_leads (listing_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS listing_leads_manager_id_idx ON listing_leads (manager_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS listing_leads_status_idx ON listing_leads (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS inspections_contract_id_idx ON inspections (contract_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS inspections_property_id_idx ON inspections (property_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS inspections_manager_id_idx ON inspections (manager_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS inspections_tenant_id_idx ON inspections (tenant_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS platform_subscriptions_user_id_idx ON platform_subscriptions (user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS platform_subscriptions_payment_ref_idx ON platform_subscriptions (payment_ref)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS users_referred_by_user_id_idx ON users (referred_by_user_id)`);

    console.log("✅ Tables et types de base de données initialisés avec succès.");

    // L'injection automatique de données de démonstration a été RETIRÉE d'ici.
    // Elle se déclenchait dès qu'une base était vide, sans autre condition :
    // un démarrage local pointé sur la base de production (DATABASE_URL mal
    // positionnée) y créait donc des comptes dont le mot de passe était écrit
    // dans le code — et le dépôt est public. Une base vide n'est pas une
    // invitation à créer des comptes.
    //
    // Le seed reste disponible, mais toujours de façon explicite :
    //     npm run seed
    // et il refuse désormais toute base non locale (voir refusDeSeed dans
    // src/seed.ts).
  } catch (err) {
    console.error("[db] Erreur lors de l'initialisation du schéma :", err);
    throw err;
  }
}
