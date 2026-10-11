import { sql, SQL } from "drizzle-orm";
import { db } from "./client";

/**
 * Exécute une migration additive en avalant l'échec plutôt qu'en interrompant
 * tout initDb() — une seule instruction en délicatesse (base pas encore créée
 * sur un environnement PGlite local vierge, essentiellement) ne doit pas
 * empêcher TOUTES les suivantes de s'exécuter. Journalisé (contrairement à
 * l'ancien `catch {}` muet) : un vrai échec — typo, permission refusée,
 * coupure réseau en plein milieu — se manifestait auparavant bien plus tard,
 * sur une requête applicative sans rapport, avec un message qui ne pointait
 * vers rien.
 */
async function alterSiBesoin(migration: () => Promise<unknown>): Promise<void> {
  try {
    await migration();
  } catch (err) {
    // Une table tenue par quelqu'un d'autre est signalée UNE fois (voir
    // avecVerrouBorne) ; les migrations qui sautent ensuite n'ont pas à
    // répéter la même alerte.
    if (err instanceof VerrouAbandonne) return;
    console.error("[db] Échec d'une migration additive (non bloquant) :", err);
  }
}

/*
 * POURQUOI initDb() NE REJOUE PLUS TOUT À CHAQUE DÉMARRAGE.
 *
 * Ce fichier s'exécute à chaque démarrage à froid d'une fonction serverless
 * (voir app.ts), c'est-à-dire souvent, et parfois dans plusieurs régions en
 * même temps. Il rejouait alors, sans condition, une centaine d'instructions
 * « IF NOT EXISTS » — et « IF NOT EXISTS » n'évite PAS le verrou :
 *
 *  - `ALTER TABLE users ADD COLUMN IF NOT EXISTS ...` réclame un verrou
 *    EXCLUSIF sur la table AVANT de constater que la colonne existe déjà. Il
 *    attend la fin de toute transaction en cours — et, pendant qu'il attend,
 *    toute requête suivante sur `users` (donc toute connexion, toute
 *    vérification de jeton) fait la queue derrière lui ;
 *  - la contrainte `users_role_check` était SUPPRIMÉE puis RECRÉÉE à chaque
 *    démarrage (ce qui relit toute la table sous verrou exclusif), et la
 *    colonne `messages.is_read` retypée, à chaque démarrage aussi.
 *
 * Constaté en production : des requêtes d'administration restées bloquées
 * jusqu'au délai de 300 s de la fonction, et une instruction `ALTER TABLE
 * users` annulée par le délai d'attente de 2 minutes de la base.
 *
 * Le correctif tient en trois règles :
 *  1. on LIT d'abord l'état réel du schéma (trois requêtes de lecture, sans
 *     verrou) et on n'exécute QUE ce qui manque réellement ;
 *  2. ce qui doit s'exécuter le fait dans une transaction avec un
 *     `lock_timeout` court : si la table est tenue par quelqu'un d'autre, on
 *     abandonne en quelques secondes au lieu de faire la queue — et de
 *     bloquer tout le monde derrière nous ;
 *  3. une migration non indispensable qui échoue est journalisée sans
 *     interrompre le démarrage (comme avant), et sera retentée au prochain.
 */

/** Attente maximale d'un verrou pour une instruction de schéma. */
const DELAI_VERROU = "5s";

interface EtatSchema {
  tables: Set<string>;
  /** "table.colonne" -> type de données. */
  colonnes: Map<string, string>;
  index: Set<string>;
  /** Noms seulement : lire la DÉFINITION d'une contrainte ouvre la table, et attend donc son verrou. */
  contraintes: Set<string>;
}

let etat: EtatSchema = { tables: new Set(), colonnes: new Map(), index: new Set(), contraintes: new Set() };

/** Les deux pilotes renvoient soit un tableau de lignes, soit un objet { rows }. */
function lignes<T>(resultat: unknown): T[] {
  return (Array.isArray(resultat) ? resultat : ((resultat as { rows?: unknown[] }).rows ?? [])) as T[];
}

/** Lecture seule, sans verrou : l'état réel du schéma courant. */
async function lireEtatSchema(): Promise<EtatSchema> {
  const colonnes = lignes<{ table_name: string; column_name: string; data_type: string }>(
    await db.execute(
      sql`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema()`
    )
  );
  const index = lignes<{ indexname: string }>(
    await db.execute(sql`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`)
  );
  const contraintes = lignes<{ conname: string }>(
    await db.execute(
      sql`SELECT conname FROM pg_constraint WHERE conname IN ('users_role_check', 'tenants_email_key') AND connamespace = current_schema()::regnamespace`
    )
  );

  return {
    tables: new Set(colonnes.map((c) => c.table_name)),
    colonnes: new Map(colonnes.map((c) => [`${c.table_name}.${c.column_name}`, c.data_type])),
    index: new Set(index.map((i) => i.indexname)),
    contraintes: new Set(contraintes.map((c) => c.conname)),
  };
}

/**
 * Exécute `travail` dans UNE transaction dont l'attente de verrou est bornée
 * (`SET LOCAL` : le réglage ne survit pas à la transaction, donc ne touche pas
 * la connexion que l'application réutilise ensuite). Valable aussi pour une
 * simple LECTURE : un SELECT sur une table tenue en verrou exclusif attend
 * tout autant qu'un ALTER.
 */
async function avecVerrouBorne<T>(travail: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  if (verrouTenu) throw new VerrouAbandonne();
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${DELAI_VERROU}'`));
      return travail(tx);
    });
  } catch (err) {
    if (!estUnDelaiDeVerrou(err)) throw err;
    // Une table est tenue par quelqu'un d'autre. Insister sur chacune des
    // migrations restantes coûterait à chaque fois le même délai : on renonce
    // à TOUTES celles qui restent, une seule alerte, et le démarrage se
    // poursuit. Elles seront retentées au prochain démarrage à froid.
    verrouTenu = true;
    console.error(
      `[db] Une table est verrouillée depuis plus de ${DELAI_VERROU} : les migrations de schéma restantes sont ignorées pour ce démarrage.`
    );
    throw new VerrouAbandonne();
  }
}

/** Levée quand on renonce à une migration parce qu'une table est tenue (voir avecVerrouBorne). */
class VerrouAbandonne extends Error {
  constructor() {
    super("Migration ignorée : une table est verrouillée.");
  }
}

/** Positionné par avecVerrouBorne ; remis à faux au début de chaque initDb(). */
let verrouTenu = false;

/** « lock timeout » : code SQLSTATE 55P03, éventuellement enveloppé par Drizzle (`cause`). */
function estUnDelaiDeVerrou(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  return (
    e?.code === "55P03" ||
    e?.cause?.code === "55P03" ||
    /lock timeout/i.test(`${e?.message ?? ""} ${e?.cause?.message ?? ""}`)
  );
}

/** Exécute des instructions de schéma dans UNE transaction, avec une attente de verrou bornée. */
async function executerDdl(...requetes: SQL[]): Promise<void> {
  await avecVerrouBorne(async (tx) => {
    for (const requete of requetes) await tx.execute(requete);
  });
}

/** Crée la table si elle n'existe pas. Un échec interrompt le démarrage : sans elle l'application ne peut pas fonctionner. */
async function creerTable(nom: string, requete: SQL): Promise<void> {
  if (etat.tables.has(nom)) return;
  await executerDdl(requete);
}

/** Crée l'index s'il n'existe pas. Non bloquant : un index manquant dégrade les performances, il ne casse rien. */
async function creerIndex(nom: string, requete: SQL): Promise<void> {
  if (etat.index.has(nom)) return;
  await alterSiBesoin(() => executerDdl(requete));
}

/** Ajoute la colonne si elle n'existe pas. */
async function ajouterColonne(table: string, colonne: string, requete: SQL): Promise<void> {
  if (etat.colonnes.has(`${table}.${colonne}`)) return;
  await alterSiBesoin(() => executerDdl(requete));
}

/**
 * La contrainte `users_role_check` connaît-elle déjà les quatre rôles ? Faux si
 * elle manque. Lire sa définition ouvre la table `users` : la lecture est donc
 * bornée, et si la table est tenue on ne touche à RIEN (dans le doute, une
 * contrainte déjà posée vaut mieux qu'un remplacement tenté sous verrou).
 */
async function contrainteRoleAJour(): Promise<boolean> {
  if (!etat.contraintes.has("users_role_check")) return false;
  try {
    const resultat = await avecVerrouBorne((tx) =>
      tx.execute(
        sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'users_role_check' AND connamespace = current_schema()::regnamespace`
      )
    );
    const definition = lignes<{ def: string }>(resultat)[0]?.def ?? "";
    return ["MANAGER", "TENANT", "ADMIN", "OWNER"].every((role) => definition.includes(`'${role}'`));
  } catch {
    return true;
  }
}

export async function initDb() {
  try {
    verrouTenu = false;
    // Lu AVANT toute instruction de schéma : voir le commentaire plus haut.
    etat = await lireEtatSchema();

    // PGlite does not support CREATE TYPE ... AS ENUM, so we create tables
    // using TEXT columns with CHECK constraints to emulate enum validation.
    await creerTable("users", sql`
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
        suspended_at TIMESTAMP,
        suspension_reason TEXT,
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
    await creerTable("owners", sql`
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

    await creerTable("listings", sql`
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
        hidden_by_admin_at TIMESTAMP,
        moderation_reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await creerTable("listing_leads", sql`
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

    await creerTable("platform_settings", sql`
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
    await creerTable("properties", sql`
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

    await creerTable("tenants", sql`
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

    await creerTable("contracts", sql`
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

    await creerTable("invoices", sql`
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

    await ajouterColonne("invoices", "reminder_sent_at", sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP`);

    await creerIndex("invoices_contract_period_unique", sql`
      CREATE UNIQUE INDEX IF NOT EXISTS invoices_contract_period_unique
      ON invoices (contract_id, period_month, period_year)
    `);

    // Doit venir après contracts/properties/tenants (FK).
    await creerTable("inspections", sql`
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

    await creerTable("expenses", sql`
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
        recurrence TEXT,
        recurrence_end_date TIMESTAMP,
        template_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
        period_index INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await creerTable("insurance_policies", sql`
      CREATE TABLE IF NOT EXISTS insurance_policies (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        insurer_name TEXT NOT NULL,
        policy_number TEXT NOT NULL,
        premium_amount DOUBLE PRECISION,
        currency TEXT NOT NULL DEFAULT 'EUR',
        start_date TIMESTAMP,
        expiry_date TIMESTAMP NOT NULL,
        notes TEXT,
        reminder_sent_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await creerTable("admin_audit_logs", sql`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id TEXT PRIMARY KEY,
        admin_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        admin_email TEXT NOT NULL,
        action TEXT NOT NULL,
        target_user_id TEXT,
        target_label TEXT,
        details TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // La table `suggestions` n'avait jamais été créée ici (elle existe en
    // production par un autre chemin) : une installation neuve n'en avait donc
    // pas. Sur une base existante, ce CREATE ne fait rien — les colonnes de
    // suivi sont ajoutées par les ALTER plus bas.
    await creerTable("suggestions", sql`
      CREATE TABLE IF NOT EXISTS suggestions (
        id TEXT PRIMARY KEY,
        author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        author_label TEXT NOT NULL,
        author_role TEXT CHECK (author_role IN ('MANAGER', 'TENANT', 'ADMIN', 'OWNER')),
        page TEXT,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'NEW',
        admin_note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await creerTable("messages", sql`
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

    await creerTable("agency_settings", sql`
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

    await creerTable("platform_subscriptions", sql`
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

    await creerTable("vendors", sql`
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

    await creerTable("issue_reports", sql`
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

    await creerTable("activity_logs", sql`
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
    await ajouterColonne("platform_subscriptions", "currency", sql`ALTER TABLE platform_subscriptions ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`);
    await ajouterColonne("users", "subscription_status", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'TRIAL'`);
    await ajouterColonne("users", "subscription_plan", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'STARTER'`);
    await ajouterColonne("users", "trial_ends_at", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP`);
    await ajouterColonne("users", "subscription_ends_at", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP`);
    await ajouterColonne("users", "subscription_payment_method", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_payment_method TEXT`);
    await ajouterColonne("users", "currency", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`);
    await ajouterColonne("users", "suspended_at", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP`);
    await ajouterColonne("users", "suspension_reason", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT`);
    await ajouterColonne("listings", "hidden_by_admin_at", sql`ALTER TABLE listings ADD COLUMN IF NOT EXISTS hidden_by_admin_at TIMESTAMP`);
    await ajouterColonne("listings", "moderation_reason", sql`ALTER TABLE listings ADD COLUMN IF NOT EXISTS moderation_reason TEXT`);
    await ajouterColonne("suggestions", "status", sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'NEW'`);
    await ajouterColonne("suggestions", "admin_note", sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS admin_note TEXT`);
    await ajouterColonne("properties", "currency", sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`);
    await ajouterColonne("contracts", "currency", sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`);
    await ajouterColonne("contracts", "scanned_contract_url", sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS scanned_contract_url TEXT`);
    await ajouterColonne("contracts", "signed_by_manager_at", sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_by_manager_at TIMESTAMP`);
    await ajouterColonne("contracts", "manager_signature_url", sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS manager_signature_url TEXT`);
    await ajouterColonne("contracts", "signed_by_tenant_at", sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_by_tenant_at TIMESTAMP`);
    await ajouterColonne("contracts", "tenant_signature_url", sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS tenant_signature_url TEXT`);
    await ajouterColonne("invoices", "currency", sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`);
    await ajouterColonne("invoices", "reminder_sent_at", sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP`);
    await ajouterColonne("invoices", "due_soon_reminder_sent_at", sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_soon_reminder_sent_at TIMESTAMP`);
    await ajouterColonne("issue_reports", "additional_photos", sql`ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS additional_photos TEXT`);
    await ajouterColonne("users", "google_id", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`);
    await ajouterColonne("users", "token_version", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`);
    await ajouterColonne("tenants", "anonymized_at", sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMP`);
    await ajouterColonne("users", "subscription_payment_attempt_started_at", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_payment_attempt_started_at TIMESTAMP`);
    await ajouterColonne("invoices", "payment_attempt_started_at", sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_attempt_started_at TIMESTAMP`);
    await ajouterColonne("properties", "owner_id", sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES owners(id) ON DELETE SET NULL`);
    await ajouterColonne("agency_settings", "iban", sql`ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS iban TEXT`);
    await ajouterColonne("agency_settings", "bic", sql`ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS bic TEXT`);
    await ajouterColonne("users", "team_owner_id", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS team_owner_id TEXT REFERENCES users(id) ON DELETE CASCADE`);
    await ajouterColonne("users", "stripe_customer_id", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
    await ajouterColonne("users", "stripe_subscription_id", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE`);
    await ajouterColonne("users", "totp_secret", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT`);
    await ajouterColonne("users", "totp_enabled_at", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMP`);
    await ajouterColonne("users", "totp_backup_codes_hash", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes_hash TEXT`);
    // Planification des interventions prestataires : sur une base créée avant
    // ce correctif, la table existe déjà sans cette colonne.
    await ajouterColonne("issue_reports", "scheduled_at", sql`ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP`);
    // Sur une base créée avant ce correctif, "tenants.email" portait encore
    // une contrainte UNIQUE globale (nom par défaut Postgres/PGlite pour une
    // colonne UNIQUE déclarée en ligne) — on la retire au profit de l'index
    // composite (manager_id, email) créé plus bas, seul contrat réellement
    // voulu par schema.ts.
    if (etat.contraintes.has("tenants_email_key")) {
      await alterSiBesoin(() => executerDdl(sql`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_email_key`));
    }

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
    await ajouterColonne("properties", "manager_id", sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS manager_id TEXT REFERENCES users(id)`);
    await ajouterColonne("tenants", "manager_id", sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS manager_id TEXT REFERENCES users(id)`);
    await ajouterColonne("activity_logs", "manager_id", sql`ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS manager_id TEXT REFERENCES users(id)`);
    await ajouterColonne("contracts", "terms", sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS terms TEXT`);
    await ajouterColonne("users", "reset_password_token_hash", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_token_hash TEXT`);
    await ajouterColonne("users", "reset_password_expires_at", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_expires_at TIMESTAMP`);
    await ajouterColonne("users", "email_verified_at", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP`);
    await ajouterColonne("users", "email_verification_token_hash", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT`);
    await ajouterColonne("users", "email_verification_expires_at", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP`);

    // Les bases locales créées avant l'ajout des rôles ADMIN et OWNER portent
    // encore une contrainte CHECK qui ne les autorise pas : un admin créé via
    // « npm run create-admin », ou un propriétaire créé par createOwnerAccount
    // (owner.controller.ts), y serait refusé par la base elle-même. On la
    // remplace.
    //
    // Remplacée UNIQUEMENT si elle manque ou si elle ne connaît pas encore les
    // quatre rôles : la supprimer puis la recréer à chaque démarrage relisait
    // toute la table `users` sous verrou exclusif, et laissait un instant la
    // table sans contrainte.
    if (!(await contrainteRoleAJour())) {
      await alterSiBesoin(() =>
        executerDdl(
          sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`,
          sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('MANAGER', 'TENANT', 'ADMIN', 'OWNER'))`
        )
      );
    }
    // Sur une base créée avant ce correctif, "messages.is_read" portait le
    // type TEXT (défaut 'false') hérité du CREATE TABLE ci-dessus, alors que
    // schema.ts la déclare boolean() depuis toujours : Postgres refuse la
    // comparaison "is_read = false" ("operator does not exist: text =
    // boolean"), ce qui faisait échouer GET /api/notifications dès qu'un
    // gestionnaire avait des messages non lus (constaté en production —
    // Sentry IMMOPLATFORM-PRO-BACKEND-2, >1200 occurrences). Idempotent :
    // relancer ces ALTER sur une colonne déjà boolean ne fait rien.
    //
    // Exécuté UNIQUEMENT si la colonne n'est pas déjà booléenne (relancer ces
    // ALTER ne changeait rien, mais prenait chaque fois un verrou exclusif sur
    // `messages`).
    if (etat.colonnes.has("messages.is_read") && etat.colonnes.get("messages.is_read") !== "boolean") {
      await alterSiBesoin(() =>
        executerDdl(
          sql`ALTER TABLE messages ALTER COLUMN is_read DROP DEFAULT`,
          sql`ALTER TABLE messages ALTER COLUMN is_read TYPE BOOLEAN USING (is_read::boolean)`,
          sql`ALTER TABLE messages ALTER COLUMN is_read SET DEFAULT false`
        )
      );
    }
    // 15 jours, pas 10 : même durée que celle réellement accordée à
    // l'inscription (voir auth.controller.ts). Ce backfill ne visait que les
    // comptes gestionnaire pré-existants sans date d'essai ; leur donner une
    // durée différente de celle annoncée partout ailleurs dans l'application
    // aurait été incohérent.
    // Lu d'abord : l'UPDATE ne se lance que s'il y a réellement une ligne à
    // corriger (il n'y en a plus aucune en régime normal).
    await alterSiBesoin(() =>
      avecVerrouBorne(async (tx) => {
        const aCorriger = lignes<{ un: number }>(
          await tx.execute(sql`SELECT 1 AS un FROM users WHERE role = 'MANAGER' AND trial_ends_at IS NULL LIMIT 1`)
        );
        if (aCorriger.length === 0) return;
        await tx.execute(
          sql`UPDATE users SET trial_ends_at = CURRENT_TIMESTAMP + INTERVAL '15 days', subscription_status = 'TRIAL' WHERE role = 'MANAGER' AND trial_ends_at IS NULL`
        );
      })
    );
    // Droit à l'effacement (RGPD art. 17) pour un propriétaire — voir
    // anonymiserOwner (owner.controller.ts), même principe que
    // tenants.anonymized_at ci-dessus, pour un propriétaire qu'un bien associé
    // empêche de supprimer (deleteOwner).
    await ajouterColonne("owners", "anonymized_at", sql`ALTER TABLE owners ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMP`);
    // Carnet de prestataires/artisans (vendors) : sur une base créée avant ce
    // correctif, la table existe déjà sans cette colonne — voir
    // assignVendorToIssue (issue.controller.ts).
    await ajouterColonne("issue_reports", "vendor_id", sql`ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS vendor_id TEXT REFERENCES vendors(id) ON DELETE SET NULL`);
    // Restitution du dépôt de garantie : sur une base créée avant ce correctif,
    // la table existe déjà sans ces colonnes — voir recordDepositRefund
    // (contract.controller.ts).
    await ajouterColonne("contracts", "deposit_deductions", sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deposit_deductions TEXT`);
    await ajouterColonne("contracts", "deposit_refunded_at", sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deposit_refunded_at TIMESTAMP`);
    // Programme de parrainage : sur une base créée avant ce correctif, la
    // table existe déjà sans ces colonnes — voir referral.service.ts.
    await ajouterColonne("users", "referral_code", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE`);
    await ajouterColonne("users", "referred_by_user_id", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL`);
    await ajouterColonne("users", "referral_reward_granted_at", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_reward_granted_at TIMESTAMP`);
    // Dépenses récurrentes : sur une base créée avant ce correctif, la table
    // existe déjà sans ces colonnes — voir recurringExpense.service.ts.
    await ajouterColonne("expenses", "recurrence", sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurrence TEXT`);
    await ajouterColonne("expenses", "recurrence_end_date", sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurrence_end_date TIMESTAMP`);
    await ajouterColonne("expenses", "template_id", sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS template_id TEXT REFERENCES expenses(id) ON DELETE SET NULL`);
    await ajouterColonne("expenses", "period_index", sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS period_index INTEGER`);
    await creerIndex(
      "expenses_template_period_unique",
      sql`CREATE UNIQUE INDEX IF NOT EXISTS expenses_template_period_unique ON expenses (template_id, period_index)`
    );

    // Index de performance sur clés étrangères et filtres fréquents
    await creerIndex("properties_manager_id_idx", sql`CREATE INDEX IF NOT EXISTS properties_manager_id_idx ON properties (manager_id)`);
    await creerIndex("tenants_manager_id_idx", sql`CREATE INDEX IF NOT EXISTS tenants_manager_id_idx ON tenants (manager_id)`);
    await creerIndex("contracts_property_id_idx", sql`CREATE INDEX IF NOT EXISTS contracts_property_id_idx ON contracts (property_id)`);
    await creerIndex("contracts_tenant_id_idx", sql`CREATE INDEX IF NOT EXISTS contracts_tenant_id_idx ON contracts (tenant_id)`);
    await creerIndex("contracts_status_idx", sql`CREATE INDEX IF NOT EXISTS contracts_status_idx ON contracts (status)`);
    await creerIndex("invoices_contract_id_idx", sql`CREATE INDEX IF NOT EXISTS invoices_contract_id_idx ON invoices (contract_id)`);
    await creerIndex("invoices_status_idx", sql`CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices (status)`);
    await creerIndex("invoices_due_date_idx", sql`CREATE INDEX IF NOT EXISTS invoices_due_date_idx ON invoices (due_date)`);
    await creerIndex("expenses_property_id_idx", sql`CREATE INDEX IF NOT EXISTS expenses_property_id_idx ON expenses (property_id)`);
    await creerIndex("insurance_policies_property_id_idx", sql`CREATE INDEX IF NOT EXISTS insurance_policies_property_id_idx ON insurance_policies (property_id)`);
    await creerIndex("issue_reports_contract_id_idx", sql`CREATE INDEX IF NOT EXISTS issue_reports_contract_id_idx ON issue_reports (contract_id)`);
    await creerIndex("issue_reports_tenant_id_idx", sql`CREATE INDEX IF NOT EXISTS issue_reports_tenant_id_idx ON issue_reports (tenant_id)`);
    await creerIndex("issue_reports_status_idx", sql`CREATE INDEX IF NOT EXISTS issue_reports_status_idx ON issue_reports (status)`);
    await creerIndex("messages_sender_id_idx", sql`CREATE INDEX IF NOT EXISTS messages_sender_id_idx ON messages (sender_id)`);
    await creerIndex("messages_contract_id_idx", sql`CREATE INDEX IF NOT EXISTS messages_contract_id_idx ON messages (contract_id)`);
    await creerIndex("activity_logs_manager_id_idx", sql`CREATE INDEX IF NOT EXISTS activity_logs_manager_id_idx ON activity_logs (manager_id)`);
    await creerIndex("activity_logs_created_at_idx", sql`CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON activity_logs (created_at)`);
    await creerIndex("suggestions_created_at_idx", sql`CREATE INDEX IF NOT EXISTS suggestions_created_at_idx ON suggestions (created_at)`);
    await creerIndex("suggestions_status_idx", sql`CREATE INDEX IF NOT EXISTS suggestions_status_idx ON suggestions (status)`);
    await creerIndex("admin_audit_logs_created_at_idx", sql`CREATE INDEX IF NOT EXISTS admin_audit_logs_created_at_idx ON admin_audit_logs (created_at)`);
    await creerIndex("admin_audit_logs_target_user_id_idx", sql`CREATE INDEX IF NOT EXISTS admin_audit_logs_target_user_id_idx ON admin_audit_logs (target_user_id)`);
    await creerIndex("tenants_manager_email_unique", sql`CREATE UNIQUE INDEX IF NOT EXISTS tenants_manager_email_unique ON tenants (manager_id, email)`);
    await creerIndex("properties_owner_id_idx", sql`CREATE INDEX IF NOT EXISTS properties_owner_id_idx ON properties (owner_id)`);
    await creerIndex("owners_manager_id_idx", sql`CREATE INDEX IF NOT EXISTS owners_manager_id_idx ON owners (manager_id)`);
    await creerIndex("owners_user_id_idx", sql`CREATE INDEX IF NOT EXISTS owners_user_id_idx ON owners (user_id)`);
    await creerIndex("listings_manager_id_idx", sql`CREATE INDEX IF NOT EXISTS listings_manager_id_idx ON listings (manager_id)`);
    await creerIndex("listings_status_idx", sql`CREATE INDEX IF NOT EXISTS listings_status_idx ON listings (status)`);
    await creerIndex("listings_type_idx", sql`CREATE INDEX IF NOT EXISTS listings_type_idx ON listings (type)`);
    await creerIndex("listings_country_idx", sql`CREATE INDEX IF NOT EXISTS listings_country_idx ON listings (country)`);
    await creerIndex("listing_leads_listing_id_idx", sql`CREATE INDEX IF NOT EXISTS listing_leads_listing_id_idx ON listing_leads (listing_id)`);
    await creerIndex("listing_leads_manager_id_idx", sql`CREATE INDEX IF NOT EXISTS listing_leads_manager_id_idx ON listing_leads (manager_id)`);
    await creerIndex("listing_leads_status_idx", sql`CREATE INDEX IF NOT EXISTS listing_leads_status_idx ON listing_leads (status)`);
    await creerIndex("inspections_contract_id_idx", sql`CREATE INDEX IF NOT EXISTS inspections_contract_id_idx ON inspections (contract_id)`);
    await creerIndex("inspections_property_id_idx", sql`CREATE INDEX IF NOT EXISTS inspections_property_id_idx ON inspections (property_id)`);
    await creerIndex("inspections_manager_id_idx", sql`CREATE INDEX IF NOT EXISTS inspections_manager_id_idx ON inspections (manager_id)`);
    await creerIndex("inspections_tenant_id_idx", sql`CREATE INDEX IF NOT EXISTS inspections_tenant_id_idx ON inspections (tenant_id)`);
    await creerIndex("platform_subscriptions_user_id_idx", sql`CREATE INDEX IF NOT EXISTS platform_subscriptions_user_id_idx ON platform_subscriptions (user_id)`);
    await creerIndex("platform_subscriptions_payment_ref_idx", sql`CREATE INDEX IF NOT EXISTS platform_subscriptions_payment_ref_idx ON platform_subscriptions (payment_ref)`);
    await creerIndex("users_referred_by_user_id_idx", sql`CREATE INDEX IF NOT EXISTS users_referred_by_user_id_idx ON users (referred_by_user_id)`);

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
