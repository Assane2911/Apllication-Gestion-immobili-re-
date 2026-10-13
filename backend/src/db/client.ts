import path from "path";
import fs from "fs";
import "dotenv/config";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";
import { creerClientSerialise } from "./clientSerialise";

// Les deux pilotes utilisés ci-dessous (postgres-js en production, PGlite en
// local) exposent un type de résultat bas niveau différent (leur "HKT" interne),
// mais partagent exactement la même API de requêtage une fois le schéma branché
// (select/insert/update/delete/transaction). On type donc `db` sur ce schéma
// commun plutôt que sur le pilote concret : ça donne l'autocomplétion et la
// vérification de type sur les tables/colonnes/valeurs dans tout le code,
// sans avoir à re-déclarer un type par contrôleur comme c'était le cas avant.
export type Database = PgDatabase<any, typeof schema>;

// Type du `tx` reçu dans un callback `db.transaction(async (tx) => {...})`.
export type Transaction = PgTransaction<any, typeof schema, ExtractTablesWithRelations<typeof schema>>;

// Pour les fonctions qui peuvent recevoir soit `db` directement, soit un `tx`
// venant d'une transaction en cours (ex. generateInvoicesForContract).
export type DbClient = Database | Transaction;

const connectionString = process.env.DATABASE_URL;

let dbInstance: Database;

if (connectionString && !connectionString.includes("VOTRE_MOT_DE_PASSE")) {
  // max: 1 — chaque fonction serverless Vercel ne traite qu'une requête à la
  // fois, mais peut en exécuter plusieurs EN PARALLÈLE sous charge (une
  // instance par invocation concurrente). Le max_connections de ce projet
  // Supabase est de 60 (vérifié) ; avec le max par défaut de postgres.js (10)
  // par instance, une poignée d'invocations concurrentes suffisait à épuiser
  // ce quota et à faire échouer les nouvelles connexions en timeout —
  // constaté en production (Sentry : plusieurs "Failed to connect to
  // database: timeout" sur /api/notifications, /api/contracts,
  // /api/dashboard/stats, /api/auth/google). idle_timeout libère les
  // connexions inactives au lieu de les garder ouvertes indéfiniment
  // (défaut de postgres.js) entre deux invocations d'une même instance
  // tiède.
  // Requêtes exécutées une par une, connexion recréée si elle se fige : voir clientSerialise.ts
  // (postgres-js pipeline les requêtes, et le pooler Supabase en perd au-delà de la première).
  const creerClient = () => {
    const brut = postgres(connectionString, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
    // Drizzle règle les analyseurs de types (dates, JSON) sur le client qu'on lui donne : à refaire sur
    // CHAQUE client recréé, sinon les dates reviendraient converties par postgres-js.
    drizzlePg(brut, { schema });
    return brut;
  };
  // Délais réglables sans redéployer le code : une requête isolée qui ne revient pas en 15 s (le navigateur
  // abandonne à 20 s) ou une transaction qui dépasse 2 min est tenue pour bloquée et la connexion recréée.
  const client = creerClientSerialise(creerClient, {
    delaiRequeteMs: Number(process.env.DB_DELAI_REQUETE_MS) || 15_000,
    delaiTransactionMs: Number(process.env.DB_DELAI_TRANSACTION_MS) || 120_000,
    surRecyclage: (raison) => console.error(`[db] Connexion recréée : ${raison}.`),
  });
  dbInstance = drizzlePg(client, { schema });
} else {
  const dataDir = path.resolve(__dirname, "../../data/local-db");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const pglite = new PGlite(dataDir);
  dbInstance = drizzlePglite(pglite, { schema });
  console.log(`[db] Base de données PostgreSQL locale (PGlite) initialisée dans ${dataDir}`);
}

export const db: Database = dbInstance;
