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
  const client = postgres(connectionString, { prepare: false });
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
