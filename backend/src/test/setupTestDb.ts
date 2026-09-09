import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { beforeEach, vi } from "vitest";
import * as schema from "../db/schema";

// IMPORTANT : les tests ne doivent JAMAIS toucher la vraie base de production
// (Supabase). On remplace entièrement le module "../db/client" par une base
// PGlite (Postgres embarqué) purement en mémoire, créée fraîche pour chaque
// fichier de test (voir `isolate` dans vitest.config.ts). Le schéma réel est
// poussé dessus via drizzle-kit/api, donc il reste toujours synchronisé avec
// src/db/schema.ts sans dupliquer de SQL de migration à la main.
//
// Filet de sécurité supplémentaire : même si le vi.mock ci-dessous ne devait
// pas intercepter un import quelque part, on neutralise DATABASE_URL pour que
// le vrai module db/client.ts ne puisse en aucun cas se connecter à la vraie
// base Supabase — il retomberait alors sur son propre fallback PGlite local
// (voir db/client.ts), jamais sur le réseau.
process.env.DATABASE_URL = "";

const pglite = new PGlite();
export const testDb = drizzle(pglite, { schema }) as any;

const ready = pushSchema(schema as any, testDb).then(({ apply }) => apply());

vi.mock("../db/client", async () => {
  await ready;
  return { db: testDb };
});

// Le SDK @sentry/node instrumente automatiquement Node au chargement (hooks
// require/import pour http, express, pg, etc. via require-in-the-middle).
// Ce mécanisme est incompatible avec le "module runner" de Vitest (vite-node) :
// le simple `import("@sentry/node")` reste bloqué indéfiniment dans les tests,
// avant même d'atteindre le moindre code applicatif (confirmé en isolant
// l'import étape par étape). On remplace donc entièrement le module par un
// stub inoffensif : aucun test ne dépend du suivi d'erreurs Sentry, seule son
// présence (les 3 fonctions réellement utilisées dans le code) doit être
// satisfaite pour que app.ts et instrument.ts se chargent normalement.
vi.mock("@sentry/node", () => ({
  init: () => {},
  setupExpressErrorHandler: () => {},
  flush: async () => true,
}));

// @supabase/supabase-js instancie un client "realtime" (WebSocket + timers de
// heartbeat/reconnexion internes) dès `createClient(...)`, ce qui laisse le
// process Node ouvert indéfiniment après les tests (le event loop ne se vide
// jamais) — confirmé en isolant l'import : les tests passent, mais `vitest
// run` ne se termine jamais. Aucun test actuel n'a besoin d'un vrai upload
// Supabase Storage, donc on stub entièrement ce module plutôt que de laisser
// construire un vrai client.
vi.mock("../config/supabase", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: (objectPath: string) => ({ data: { publicUrl: `http://test.local/${objectPath}` } }),
        createSignedUrl: async (objectPath: string) => ({
          data: { signedUrl: `http://test.local/signed/${objectPath}` },
          error: null,
        }),
      }),
    },
  },
  STORAGE_BUCKETS: { public: "public-uploads", private: "private-uploads" },
}));

// JWT_SECRET est requis au chargement de config/env.ts (voir `required()`) ;
// on force une valeur de test pour ne jamais dépendre d'un .env présent ou non.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-do-not-use-in-production";

// Neutralise tout service externe réel qui pourrait autrement être appelé
// avec de vraies clés si le fichier .env local en contient (SMTP, Sentry) :
// en test, on ne doit jamais envoyer de vrais emails ni de vrais événements.
process.env.SMTP_USER = "";
process.env.SMTP_APP_PASSWORD = "";
process.env.SENTRY_DSN = "";

// Idem pour les moyens de paiement : même si le vrai .env venait à contenir
// de vraies clés Stripe/PayDunya un jour, on force le mode démo et on vide les
// clés en test — aucun test ne doit jamais appeler une vraie API de paiement.
process.env.PAYMENTS_DEMO_MODE = "true";
process.env.STRIPE_SECRET_KEY = "";
// PAYDUNYA_MASTER_KEY reste à une valeur FIXE connue des tests (plutôt que
// vidée) : le webhook IPN public (paydunya.controller.ts) vérifie un hash
// SHA-512 de cette clé, et paydunya.controller.test.ts a besoin de pouvoir
// reproduire ce hash pour tester la vérification de signature. Ça ne
// change rien à la sécurité réelle : initiatePaydunyaPayment (paiement
// sortant) reste en simulation tant que PAYDUNYA_PRIVATE_KEY/TOKEN sont
// vides et que PAYMENTS_DEMO_MODE=true (voir services/payment.service.ts).
process.env.PAYDUNYA_MASTER_KEY = "test-paydunya-master-key-do-not-use-in-production";
process.env.PAYDUNYA_PRIVATE_KEY = "";
process.env.PAYDUNYA_TOKEN = "";

// cron.controller.ts refuse toute requête sans CRON_SECRET configuré
// (fail-closed en production). On fixe une valeur de test connue pour que
// cron.controller.test.ts puisse simuler l'appel authentifié de Vercel Cron
// (`Authorization: Bearer <CRON_SECRET>`) sans dépendre d'un vrai .env.
process.env.CRON_SECRET = "test-cron-secret-do-not-use-in-production";

const TABLES = [
  "users",
  "platform_subscriptions",
  "properties",
  "tenants",
  "contracts",
  "invoices",
  "issue_reports",
  "expenses",
  "messages",
  "activity_logs",
  "agency_settings",
];

// Table vide avant chaque test pour qu'aucun test ne dépende de l'ordre
// d'exécution ni des données laissées par le précédent.
beforeEach(async () => {
  await ready;
  await testDb.execute(sql.raw(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
});
