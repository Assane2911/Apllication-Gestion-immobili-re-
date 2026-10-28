#!/usr/bin/env node
/**
 * Simulation de charge : N gestionnaires connectés en même temps, chacun enchaînant les requêtes d'une session type
 * (tableau de bord, listes, comptes-rendus de gestion, synthèse fiscale), sur une base locale remplie par seed.sql.
 * À lancer UNIQUEMENT contre un backend local : jamais contre la production.
 *
 *   JWT_SECRET=... node charge.js --ports 4101,4102 --users 100 --duree 60 --pause 1000
 *
 * Les jetons sont forgés avec le JWT_SECRET du backend de test (aucune connexion par mot de passe : la limitation de
 * fréquence des connexions n'entre pas en jeu). Chaque utilisateur virtuel est une agence différente (m1 à mN).
 */
const jwt = require("jsonwebtoken");

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 ? process.argv[i + 1] : defaut;
};
const PORTS = String(arg("ports", "4101")).split(",").map(Number);
const UTILISATEURS = Number(arg("users", "50"));
const DUREE_S = Number(arg("duree", "60"));
const PAUSE_MS = Number(arg("pause", "1000"));
const MONTEE_S = Number(arg("montee", "5"));
const SCENARIO = String(arg("scenario", "session"));
const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error("JWT_SECRET manquant");
  process.exit(1);
}
if (PORTS.some((p) => p < 4000)) process.exit(1);

// Une session type, dans l'ordre où l'interface les appelle. {n} = numéro d'agence.
const SESSION = [
  ["dashboard/stats", "/api/dashboard/stats"],
  ["notifications", "/api/notifications"],
  ["agency", "/api/agency"],
  ["properties", "/api/properties?page=1&pageSize=20"],
  ["contracts", "/api/contracts?page=1&pageSize=20"],
  ["invoices", "/api/invoices?page=1&pageSize=20"],
  ["tenants", "/api/tenants?page=1&pageSize=20"],
  ["owners", "/api/owners?page=1&pageSize=20"],
  ["crg (mois)", "/api/crg/o{n}_1?month=10&year=2026"],
  ["crg (relevé annuel)", "/api/crg/o{n}_1/annual?year=2026"],
  ["fiscal/synthese", "/api/fiscal/synthese?year=2026"],
];
const ETAPES = SCENARIO === "lourd" ? SESSION.filter(([nom]) => nom.startsWith("crg") || nom === "fiscal/synthese" || nom === "dashboard/stats") : SESSION;

const mesures = new Map(); // nom -> { durees: [], erreurs: Map(statut -> n) }
const enregistrer = (nom, ms, statut) => {
  let m = mesures.get(nom);
  if (!m) mesures.set(nom, (m = { durees: [], erreurs: new Map() }));
  m.durees.push(ms);
  if (statut >= 400 || statut === 0) m.erreurs.set(statut, (m.erreurs.get(statut) ?? 0) + 1);
};
const percentile = (tri, p) => (tri.length ? tri[Math.min(tri.length - 1, Math.floor((p / 100) * tri.length))] : 0);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let finMesure = 0;
let envoyees = 0;
async function utilisateur(n) {
  const jeton = jwt.sign({ userId: `m${n}`, role: "MANAGER", tenantId: null, ownerId: null, collaboratorId: null }, SECRET, { expiresIn: "2h" });
  const port = PORTS[n % PORTS.length];
  await dormir((MONTEE_S * 1000 * n) / UTILISATEURS); // montée en charge progressive
  while (Date.now() < finMesure) {
    for (const [nom, chemin] of ETAPES) {
      if (Date.now() >= finMesure) return;
      const debut = performance.now();
      let statut = 0;
      try {
        const res = await fetch(`http://localhost:${port}${chemin.replaceAll("{n}", String(n))}`, {
          headers: { Authorization: `Bearer ${jeton}` },
          signal: AbortSignal.timeout(30_000),
        });
        statut = res.status;
        await res.arrayBuffer();
      } catch {
        statut = 0;
      }
      enregistrer(nom, performance.now() - debut, statut);
      envoyees++;
      await dormir(PAUSE_MS * (0.5 + Math.random()));
    }
  }
}

(async () => {
  const t0 = Date.now();
  finMesure = t0 + (DUREE_S + MONTEE_S) * 1000;
  await Promise.all(Array.from({ length: UTILISATEURS }, (_, i) => utilisateur(i + 1)));
  const secondes = (Date.now() - t0) / 1000;

  const lignes = [];
  let total = 0;
  let erreurs = 0;
  for (const [nom, m] of mesures) {
    const tri = [...m.durees].sort((a, b) => a - b);
    const e = [...m.erreurs.values()].reduce((a, b) => a + b, 0);
    total += tri.length;
    erreurs += e;
    lignes.push({
      etape: nom,
      n: tri.length,
      p50: Math.round(percentile(tri, 50)),
      p95: Math.round(percentile(tri, 95)),
      p99: Math.round(percentile(tri, 99)),
      max: Math.round(tri[tri.length - 1] ?? 0),
      erreurs: e,
      statuts: [...m.erreurs.entries()].map(([s, c]) => `${s}x${c}`).join(" "),
    });
  }
  const tous = [...mesures.values()].flatMap((m) => m.durees).sort((a, b) => a - b);
  console.log(JSON.stringify({
    utilisateurs: UTILISATEURS, instances: PORTS.length, secondes: Math.round(secondes), requetes: total, debit_req_s: Number((total / secondes).toFixed(1)),
    erreurs, taux_erreur_pct: Number(((100 * erreurs) / Math.max(1, total)).toFixed(2)),
    global: { p50: Math.round(percentile(tous, 50)), p95: Math.round(percentile(tous, 95)), p99: Math.round(percentile(tous, 99)) },
    etapes: lignes,
  }, null, 1));
})();
