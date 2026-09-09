import "dotenv/config";
import type { Config } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL manquant dans .env (chaîne de connexion Postgres Supabase).");
}

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Supabase ajoute de nombreux autres schémas (auth, storage, realtime,
  // extensions, vault...) que drizzle-kit tente sinon d'introspecter aussi :
  // certaines de leurs contraintes CHECK internes font planter drizzle-kit
  // ("Cannot read properties of undefined (reading 'replace')", bug connu de
  // drizzle-kit avec Supabase). On limite donc l'introspection au schéma
  // "public", le seul qui contient réellement les tables de cette appli.
  schemaFilter: ["public"],
} satisfies Config;
