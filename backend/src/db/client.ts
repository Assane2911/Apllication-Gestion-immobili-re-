import path from "path";
import fs from "fs";
import "dotenv/config";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

let dbInstance: any;

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

export const db = dbInstance;
