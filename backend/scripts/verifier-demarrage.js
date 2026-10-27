#!/usr/bin/env node
/*
 * Démarrage réel du backend compilé, comme sur Vercel : charge dist/app.js (donc toutes ses dépendances, avec
 * l'instrumentation Sentry active), le met en écoute sur un port libre et appelle /api/health.
 *
 *   npm run build && node scripts/verifier-demarrage.js
 *
 * Pourquoi : du 5 au 7 octobre 2026, le site est resté en panne deux jours. Une dépendance de la double authentification
 * (otplib) en tirait deux autres passées à l'ESM pur ; sous Node 24 avec l'instrumentation de Sentry, leur chargement
 * échouait (ERR_REQUIRE_ESM) dès le démarrage, sur TOUTES les routes. Les tests (Node 22, sans Sentry, chargeur de
 * vitest) ne pouvaient pas le voir. Ce script le voit : il échoue si le module ne se charge pas ou si /api/health ne répond pas 200.
 *
 * Aucun accès réseau externe : l'adresse Sentry est fictive (rien n'est envoyé tant qu'aucune erreur n'est signalée) et la base
 * est la base locale embarquée (PGlite).
 */
process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.DATABASE_URL = "";
process.env.JWT_SECRET = process.env.JWT_SECRET || "verification-demarrage-ne-pas-utiliser-en-production-0123456789";
// Une adresse Sentry fictive suffit à activer l'instrumentation (require-in-the-middle), qui est ce qui a révélé la panne.
process.env.SENTRY_DSN = process.env.SENTRY_DSN || "https://publique@o0.ingest.sentry.io/0";

const delaiMs = 60_000;
const minuteur = setTimeout(() => {
  console.error(`Échec : pas de réponse de /api/health en ${delaiMs / 1000} s.`);
  process.exit(1);
}, delaiMs);

async function main() {
  let app;
  try {
    app = require("../dist/app.js").default;
  } catch (erreur) {
    console.error("Échec : le backend ne se charge pas (c'est ce qui rend tout le site indisponible).");
    console.error(erreur && erreur.code ? `${erreur.code}: ${erreur.message}` : erreur);
    process.exit(1);
  }
  if (typeof app !== "function") {
    console.error("Échec : dist/app.js n'exporte pas l'application par défaut (Vercel en a besoin).");
    process.exit(1);
  }

  const serveur = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => serveur.once("listening", resolve));
  const { port } = serveur.address();
  try {
    const reponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    const corps = await reponse.json().catch(() => null);
    if (reponse.status !== 200 || !corps || corps.status !== "ok") {
      console.error(`Échec : /api/health a répondu ${reponse.status}.`);
      process.exit(1);
    }
    console.log(`Démarrage réel vérifié : /api/health répond 200 (Node ${process.versions.node}).`);
  } finally {
    serveur.close();
  }
}

main().then(
  () => {
    clearTimeout(minuteur);
    process.exit(0);
  },
  (erreur) => {
    console.error("Échec :", erreur);
    process.exit(1);
  },
);
