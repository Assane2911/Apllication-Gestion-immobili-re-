#!/usr/bin/env node
/**
 * Kit de simulation : « et avec N gestionnaires ? ». Une seule commande monte une base Postgres LOCALE, la remplit
 * avec N agences, démarre le vrai backend compilé, le soumet à une charge croissante, mesure la tâche quotidienne
 * d'envoi d'e-mails sur un faux serveur SMTP, puis écrit un rapport (Markdown) : temps de réponse par palier,
 * verdict, goulots d'étranglement et revenu estimé en FCFA.
 *
 *   node scripts/charge/simuler.js --agences 500
 *   node scripts/charge/simuler.js --agences 200 --profil starter=30,pro=60,enterprise=10 --paliers 20,50,100
 *
 * Jamais contre la production : le script ne parle qu'à une base locale qu'il crée lui-même (ou à une base locale
 * indiquée par --url-base) et ne se connecte à aucun service extérieur. Voir README.md.
 */
const { spawn, spawnSync, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const RACINE_BACKEND = path.resolve(__dirname, "../..");
const postgres = require(path.join(RACINE_BACKEND, "node_modules/postgres"));

// ---------------------------------------------------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------------------------------------------------
const AIDE = `
Usage : node scripts/charge/simuler.js [options]

  --agences N          nombre de gestionnaires (agences) à simuler (défaut 500)
  --profil a=P,b=P,c=P répartition des formules en % : starter, pro, enterprise (défaut starter=20,pro=70,enterprise=10)
  --paliers P,P,...    paliers de charge, en % des agences connectées en même temps (défaut 10,20,40,100)
  --duree S            secondes de mesure par palier (défaut 40)
  --pause MS           pause moyenne entre deux requêtes d'un utilisateur (défaut 1000)
  --instances K        instances du backend en parallèle, comme les fonctions Vercel (défaut 6)
  --budget-cron S      budget de temps du test d'envoi d'e-mails (défaut 30)
  --delai-smtp MS      durée simulée d'un envoi d'e-mail (défaut 500)
  --parallele P        envois de front pendant le test (défaut 5)
  --sans-cron          sauter le test d'envoi d'e-mails
  --port-pg PORT       port du Postgres local (défaut 5433)
  --url-base URL       utiliser un Postgres local existant (vide !) au lieu d'en créer un
  --pg-bin DIR         dossier des binaires Postgres (sinon recherche automatique)
  --sortie FICHIER     rapport Markdown (défaut rapports/simulation-<N>-agences-<date>.md)
  --garder             ne pas arrêter ni supprimer le Postgres local à la fin
  --reconstruire       recompiler le backend avant de lancer
  --aide               cette aide
`;

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : defaut;
};
const drapeau = (nom) => process.argv.includes(`--${nom}`);
if (drapeau("aide") || drapeau("help")) {
  console.log(AIDE);
  process.exit(0);
}

const nombre = (nom, defaut, min = 1) => {
  const v = Number(arg(nom, defaut));
  if (!Number.isFinite(v) || v < min) {
    console.error(`--${nom} doit être un nombre supérieur ou égal à ${min}.`);
    process.exit(2);
  }
  return Math.floor(v);
};

const AGENCES = nombre("agences", 500);
const DUREE_S = nombre("duree", 40, 5);
const PAUSE_MS = nombre("pause", 1000, 50);
const INSTANCES = nombre("instances", 6);
const BUDGET_CRON_S = nombre("budget-cron", 30, 5);
const DELAI_SMTP_MS = nombre("delai-smtp", 500, 1);
const PARALLELE = nombre("parallele", 5);
const PORT_PG = nombre("port-pg", 5433, 1024);
const PALIERS_PCT = String(arg("paliers", "10,20,40,100")).split(",").map(Number);
if (PALIERS_PCT.some((p) => !(p > 0 && p <= 100))) {
  console.error("--paliers : des pourcentages entre 1 et 100, séparés par des virgules.");
  process.exit(2);
}

function lireProfil(texte) {
  const profil = { starter: 20, pro: 70, enterprise: 10 };
  for (const part of String(texte).split(",")) {
    const [cle, val] = part.split("=");
    if (!(cle in profil) || !(Number(val) >= 0)) {
      console.error("--profil : starter=20,pro=70,enterprise=10 (en %, la somme doit faire 100).");
      process.exit(2);
    }
    profil[cle] = Number(val);
  }
  if (Math.round(profil.starter + profil.pro + profil.enterprise) !== 100) {
    console.error(`--profil : la somme des pourcentages doit faire 100 (reçu ${profil.starter + profil.pro + profil.enterprise}).`);
    process.exit(2);
  }
  return profil;
}
const PROFIL = lireProfil(arg("profil", "starter=20,pro=70,enterprise=10"));
const N_STARTER = Math.round((AGENCES * PROFIL.starter) / 100);
const N_PRO = Math.min(AGENCES - N_STARTER, Math.round((AGENCES * PROFIL.pro) / 100));

const aujourdhui = new Date().toISOString().slice(0, 10);
const SORTIE = path.resolve(RACINE_BACKEND, "scripts/charge", arg("sortie", `rapports/simulation-${AGENCES}-agences-${aujourdhui}.md`));

// ---------------------------------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------------------------------
const processus = []; // groupes de processus lancés, arrêtés à la fin quoi qu'il arrive
let arretPostgres = null;
let nettoyageFait = false;

const journal = (m) => console.log(`[simulation] ${m}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const dec = (n, d = 1) => Number(n).toFixed(d).replace(".", ",");
const fmt = (n) => Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ");

function lancer(commande, args, options = {}) {
  const enfant = spawn(commande, args, { detached: true, stdio: "ignore", ...options });
  enfant.unref();
  processus.push(enfant.pid);
  return enfant;
}

async function nettoyer() {
  if (nettoyageFait) return;
  nettoyageFait = true;
  for (const pid of processus) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      /* déjà arrêté */
    }
  }
  if (arretPostgres && !drapeau("garder")) {
    try {
      arretPostgres();
    } catch (e) {
      console.error(`[simulation] Arrêt de Postgres impossible : ${e.message}`);
    }
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await nettoyer(); process.exit(130); });

async function attendreSante(port, delaiMs = 90_000) {
  const limite = Date.now() + delaiMs;
  while (Date.now() < limite) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch {
      /* pas encore prêt */
    }
    await dormir(500);
  }
  throw new Error(`Le backend du port ${port} ne répond pas après ${delaiMs / 1000} s (voir ${path.join(os.tmpdir(), "simulation-charge-*.log")}).`);
}

function estLocal(urlTexte) {
  try {
    const h = new URL(urlTexte).hostname;
    return ["localhost", "127.0.0.1", "::1", "[::1]", ""].includes(h);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Postgres local, réglé comme la base de production (60 connexions, petit cache)
// ---------------------------------------------------------------------------------------------------------------------
function trouverBinPostgres() {
  const candidats = [arg("pg-bin", null), process.env.PG_BIN];
  try {
    candidats.push(execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim());
  } catch {
    /* pg_config absent */
  }
  for (const base of ["/usr/lib/postgresql", "/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin"]) {
    if (!fs.existsSync(base)) continue;
    if (base.endsWith("/bin")) candidats.push(base);
    else for (const v of fs.readdirSync(base).sort().reverse()) candidats.push(path.join(base, v, "bin"));
  }
  return candidats.find((d) => d && fs.existsSync(path.join(d, "initdb")));
}

async function demarrerPostgres() {
  const urlExistante = arg("url-base", null);
  if (urlExistante) {
    if (!estLocal(urlExistante)) {
      console.error("--url-base doit désigner une base LOCALE (localhost) : ce kit n'est jamais lancé contre un serveur distant.");
      process.exit(2);
    }
    journal("Postgres local existant : on s'y connecte (il doit être vide).");
    return urlExistante;
  }

  const bin = trouverBinPostgres();
  if (!bin) {
    console.error("Postgres introuvable. Installez-le (apt install postgresql, brew install postgresql@16), ou indiquez --pg-bin / --url-base.");
    process.exit(2);
  }
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  const dossier = root ? "/var/tmp/simulation-charge-pg" : path.join(os.tmpdir(), "simulation-charge-pg");
  const donnees = path.join(dossier, "data");
  const exec = (cmd, args) => {
    const programme = path.join(bin, cmd);
    return root ? execFileSync("runuser", ["-u", "postgres", "--", programme, ...args], { encoding: "utf8" }) : execFileSync(programme, args, { encoding: "utf8" });
  };

  // Un cluster d'une simulation précédente (arrêté ou non) est remplacé : chaque simulation part d'une base vierge.
  if (fs.existsSync(path.join(donnees, "postmaster.pid"))) {
    try {
      exec("pg_ctl", ["-D", donnees, "stop", "-m", "immediate"]);
    } catch {
      /* déjà arrêté */
    }
  }
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(dossier, { recursive: true });
  if (root) execFileSync("chown", ["postgres:postgres", dossier]);

  journal(`Postgres local : ${bin} (port ${PORT_PG})`);
  exec("initdb", ["-D", donnees, "-A", "trust", "-E", "UTF8", "--username=postgres"]);
  fs.appendFileSync(
    path.join(donnees, "postgresql.conf"),
    [
      `port = ${PORT_PG}`,
      "listen_addresses = 'localhost'",
      `unix_socket_directories = '${dossier}'`,
      "max_connections = 60", // comme le projet Supabase de production
      "shared_buffers = 224MB", // idem (28 672 pages de 8 Ko)
      "work_mem = 4MB",
      "effective_cache_size = 512MB",
      "shared_preload_libraries = 'pg_stat_statements'",
    ].join("\n") + "\n"
  );
  exec("pg_ctl", ["-D", donnees, "-l", path.join(dossier, "pg.log"), "start", "-w"]);
  arretPostgres = () => {
    exec("pg_ctl", ["-D", donnees, "stop", "-m", "fast"]);
    fs.rmSync(dossier, { recursive: true, force: true });
  };

  const admin = postgres(`postgres://postgres@localhost:${PORT_PG}/postgres`, { max: 1 });
  await admin.unsafe("CREATE DATABASE simulation");
  await admin.end();
  return `postgres://postgres@localhost:${PORT_PG}/simulation`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Mesures
// ---------------------------------------------------------------------------------------------------------------------
function verdict(palier) {
  if (palier.taux_erreur_pct > 1) return "KO";
  if (palier.global.p95 > 1500) return "saturé";
  if (palier.global.p95 > 500) return "limite";
  return "OK";
}
const ICONE = { OK: "🟢 OK", limite: "🟠 limite", saturé: "🔴 saturé", KO: "🔴 KO" };

function lancerCharge(env, utilisateurs, ports, agencesListe) {
  const sortie = spawnSync(
    process.execPath,
    [path.join(__dirname, "charge.js"), "--ports", ports.join(","), "--users", String(utilisateurs), "--duree", String(DUREE_S), "--pause", String(PAUSE_MS), "--montee", "8", "--agences", agencesListe.join(",")],
    { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (sortie.status !== 0) throw new Error(`charge.js a échoué : ${sortie.stderr || sortie.stdout}`);
  return JSON.parse(sortie.stdout);
}

async function main() {
  const t0 = Date.now();
  journal(`${AGENCES} agences : ${N_STARTER} Starter, ${N_PRO} Pro, ${AGENCES - N_STARTER - N_PRO} Enterprise.`);

  // 1. Backend compilé (comme en production).
  if (drapeau("reconstruire") || !fs.existsSync(path.join(RACINE_BACKEND, "dist/index.js"))) {
    journal("Compilation du backend...");
    const r = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: RACINE_BACKEND, stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) throw new Error("La compilation du backend a échoué.");
  }

  // 2. Base locale + première instance (crée le schéma au démarrage, comme initDb en production).
  const urlBase = await demarrerPostgres();
  const secret = `simulation-${crypto.randomBytes(16).toString("hex")}-secret-local`;
  const envBackend = { ...process.env, DATABASE_URL: urlBase, JWT_SECRET: secret, NODE_ENV: "development", SENTRY_DSN: "" };
  delete envBackend.SMTP_USER;
  delete envBackend.SMTP_APP_PASSWORD;
  const journalInstance = (port) => fs.openSync(path.join(os.tmpdir(), `simulation-charge-${port}.log`), "w");
  const demarrerInstance = (port, extra = {}) =>
    lancer(process.execPath, ["dist/index.js"], { cwd: RACINE_BACKEND, env: { ...envBackend, PORT: String(port), ...extra }, stdio: ["ignore", journalInstance(port), journalInstance(port)] });

  const ports = Array.from({ length: INSTANCES }, (_, i) => 4101 + i);
  journal("Démarrage de la première instance (création du schéma)...");
  demarrerInstance(ports[0]);
  await attendreSante(ports[0]);

  // 3. Données.
  journal("Chargement des données...");
  const sql = postgres(urlBase, { max: 1, onnotice: () => {} });
  const script = fs
    .readFileSync(path.join(__dirname, "seed.sql"), "utf8")
    .replaceAll("{{AGENCES}}", String(AGENCES))
    .replaceAll("{{N_STARTER}}", String(N_STARTER))
    .replaceAll("{{N_PRO}}", String(N_PRO));
  await sql.unsafe(script);
  await sql.unsafe("ANALYZE");
  await sql.unsafe("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
  const [volumes] = await sql`
    SELECT (SELECT count(*) FROM users WHERE role='MANAGER')::int AS agences, (SELECT count(*) FROM properties)::int AS biens,
           (SELECT count(*) FROM tenants)::int AS locataires, (SELECT count(*) FROM contracts)::int AS baux,
           (SELECT count(*) FROM invoices)::int AS factures, (SELECT count(*) FROM invoice_payments)::int AS paiements,
           (SELECT pg_size_pretty(pg_database_size(current_database()))) AS taille`;
  const parPlan = await sql`SELECT subscription_plan AS plan, count(*)::int AS n FROM users WHERE role='MANAGER' GROUP BY 1`;
  const nombrePlan = Object.fromEntries(parPlan.map((l) => [l.plan, l.n]));
  journal(`Données prêtes : ${fmt(volumes.biens)} biens, ${fmt(volumes.baux)} baux, ${fmt(volumes.factures)} factures (${volumes.taille}).`);

  for (const port of ports.slice(1)) demarrerInstance(port);
  await Promise.all(ports.slice(1).map((p) => attendreSante(p)));

  // 4. Charge croissante.
  await sql.unsafe("SELECT pg_stat_statements_reset()");
  const envCharge = { ...process.env, JWT_SECRET: secret };
  const resultats = [];
  let dureeTotale = 0;
  for (const pct of PALIERS_PCT) {
    const utilisateurs = Math.max(1, Math.round((AGENCES * pct) / 100));
    // Les utilisateurs simulés sont répartis sur toute la liste des agences (petites, moyennes et grandes dans leur proportion).
    const agencesListe = Array.from({ length: utilisateurs }, (_, i) => 1 + Math.floor((i * AGENCES) / utilisateurs));
    journal(`Palier ${pct} % : ${utilisateurs} gestionnaires connectés en même temps pendant ${DUREE_S} s...`);
    const debut = Date.now();
    const r = lancerCharge(envCharge, utilisateurs, ports, agencesListe);
    dureeTotale += (Date.now() - debut) / 1000;
    resultats.push({ pct, ...r, verdict: verdict(r) });
    journal(`  -> ${r.debit_req_s} req/s, p95 ${r.global.p95} ms, erreurs ${r.taux_erreur_pct} % : ${resultats[resultats.length - 1].verdict}`);
  }
  const [{ somme_ms }] = await sql`SELECT coalesce(sum(total_exec_time), 0)::float AS somme_ms FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`;
  const [{ appels }] = await sql`SELECT coalesce(sum(calls), 0)::bigint::int AS appels FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`;
  const totalRequetes = resultats.reduce((s, r) => s + r.requetes, 0);
  const tempsBaseParRequete = totalRequetes ? somme_ms / totalRequetes : 0;
  const occupationBase = dureeTotale ? somme_ms / 1000 / dureeTotale : 0; // en « cœurs » de la base occupés en moyenne

  // 5. Tâche quotidienne d'envoi d'e-mails.
  let cron = null;
  if (!drapeau("sans-cron")) {
    journal(`Tâche quotidienne : ${BUDGET_CRON_S} s de budget, ${PARALLELE} envois de front, ${DELAI_SMTP_MS} ms par envoi simulé...`);
    const fichierCompte = path.join(os.tmpdir(), `simulation-charge-sink-${process.pid}`);
    fs.rmSync(fichierCompte, { force: true });
    lancer(process.execPath, [path.join(__dirname, "smtp-sink.js")], { env: { ...process.env, DELAI_MS: String(DELAI_SMTP_MS), SINK_COMPTE: fichierCompte, SINK_PORT: "2525" } });
    await dormir(800);
    await sql.unsafe("UPDATE invoices SET due_soon_reminder_sent_at = NULL WHERE status IN ('PENDING','LATE')");
    const [{ eligibles }] = await sql`SELECT count(*)::int AS eligibles FROM invoices WHERE status IN ('PENDING','LATE')`;
    const portCron = 4150;
    demarrerInstance(portCron, {
      CRON_SECRET: "cron-simulation-local", CRON_BUDGET_SECONDS: String(BUDGET_CRON_S), CRON_ENVOIS_PARALLELES: String(PARALLELE),
      SMTP_HOST: "127.0.0.1", SMTP_PORT: "2525", SMTP_SECURE: "false", SMTP_USER: "simulation@local", SMTP_APP_PASSWORD: "x",
    });
    await attendreSante(portCron);
    const debut = Date.now();
    const reponse = await fetch(`http://localhost:${portCron}/api/cron/daily`, { headers: { Authorization: "Bearer cron-simulation-local" }, signal: AbortSignal.timeout((BUDGET_CRON_S + 120) * 1000) });
    const corps = await reponse.json();
    const duree = (Date.now() - debut) / 1000;
    const envoyes = corps.upcomingRentDueRemindersSent ?? 0;
    const recus = fs.existsSync(fichierCompte) ? Number(fs.readFileSync(fichierCompte, "utf8")) : 0;
    cron = { eligibles, envoyes, recus, duree, interrompu: Boolean(corps.interrompu), echecs: corps.echecs ?? 0, debit: duree > 0 ? envoyes / duree : 0 };
    journal(`  -> ${envoyes} e-mails en ${duree.toFixed(0)} s (${cron.debit.toFixed(1)}/s), interrompu : ${cron.interrompu ? "oui" : "non"}`);
  }

  // 6. Revenus : les prix viennent du code (une seule source de vérité), appliqués au nombre réel d'agences par formule.
  const tarifs = JSON.parse(
    execFileSync(
      process.execPath,
      ["-e", "const s=require('./dist/controllers/subscription.controller');console.log(JSON.stringify(Object.fromEntries(['STARTER','PRO','ENTERPRISE'].map(p=>[p,s.tarifPourDevise(p,'XOF')]))))"],
      { cwd: RACINE_BACKEND, env: envBackend, encoding: "utf8" }
    ).trim().split("\n").pop()
  );
  await sql.end();

  ecrireRapport({ volumes, nombrePlan, resultats, cron, tarifs, tempsBaseParRequete, occupationBase, appels, dureeScript: (Date.now() - t0) / 1000 });
  journal(`Rapport : ${SORTIE}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------------------------------------------------
function ecrireRapport({ volumes, nombrePlan, resultats, cron, tarifs, tempsBaseParRequete, occupationBase, dureeScript }) {
  const L = [];
  const dernierOk = [...resultats].reverse().find((r) => r.verdict === "OK" || r.verdict === "limite");
  const pire = resultats[resultats.length - 1];
  const globalVerdict = resultats.every((r) => r.verdict === "OK") ? "OK" : resultats.every((r) => r.verdict !== "KO" && r.verdict !== "saturé") ? "limite" : pire.verdict;

  L.push(`# Simulation de charge — ${AGENCES} gestionnaires`, "");
  L.push(`Généré le ${new Date().toLocaleString("fr-FR")} · durée de la simulation : ${Math.round(dureeScript)} s`, "");
  L.push("## Verdict", "");
  if (globalVerdict === "OK") L.push(`**Tous les paliers sont fluides** : même avec ${resultats[resultats.length - 1].utilisateurs} gestionnaires connectés en même temps, 95 % des requêtes répondent en moins de ${pire.global.p95} ms, sans erreur.`);
  else if (dernierOk) L.push(`**Le service tient jusqu'à ${dernierOk.utilisateurs} gestionnaires connectés en même temps** (palier ${dernierOk.pct} %, ${ICONE[dernierOk.verdict]}). Au palier ${pire.pct} % (${pire.utilisateurs} utilisateurs), le service est ${ICONE[pire.verdict]} : 95 % des requêtes répondent en moins de ${pire.global.p95} ms, ${dec(pire.taux_erreur_pct)} % d'erreurs.`);
  else L.push(`**Le service est déjà ${ICONE[pire.verdict]} dès le premier palier.**`);
  L.push("", "> Seuils : 🟢 OK = 95 % des requêtes sous 500 ms ; 🟠 limite = sous 1,5 s ; 🔴 saturé = au-delà ; 🔴 KO = plus de 1 % d'erreurs.", "");

  L.push("## Le jeu de données simulé", "");
  L.push(`| Agences | Starter | Pro | Enterprise | Biens | Locataires | Baux | Factures | Paiements | Taille |`, `|---|---|---|---|---|---|---|---|---|---|`);
  L.push(`| ${fmt(volumes.agences)} | ${nombrePlan.STARTER ?? 0} | ${nombrePlan.PRO ?? 0} | ${nombrePlan.ENTERPRISE ?? 0} | ${fmt(volumes.biens)} | ${fmt(volumes.locataires)} | ${fmt(volumes.baux)} | ${fmt(volumes.factures)} | ${fmt(volumes.paiements)} | ${volumes.taille} |`, "");
  L.push("Une agence Starter a 5 biens, une Pro 20, une Enterprise 100 (une sur dix en a 400), avec douze mois de factures. Les formules suivent les limites de chacune.", "");

  L.push("## Revenu estimé", "");
  const mensuel = ["STARTER", "PRO", "ENTERPRISE"].reduce((s, p) => s + (nombrePlan[p] ?? 0) * tarifs[p].monthly, 0);
  const annuel = ["STARTER", "PRO", "ENTERPRISE"].reduce((s, p) => s + (nombrePlan[p] ?? 0) * tarifs[p].annual, 0);
  L.push(`| Formule | Agences | Prix au mois | Prix à l'année | Revenu mensuel |`, `|---|---|---|---|---|`);
  for (const p of ["STARTER", "PRO", "ENTERPRISE"]) L.push(`| ${p} | ${nombrePlan[p] ?? 0} | ${fmt(tarifs[p].monthly)} FCFA | ${fmt(tarifs[p].annual)} FCFA | ${fmt((nombrePlan[p] ?? 0) * tarifs[p].monthly)} FCFA |`);
  L.push("", `**${fmt(mensuel)} FCFA par mois**, soit **${fmt(mensuel * 12)} FCFA par an** si tous paient au mois, ou **${fmt(annuel)} FCFA par an** si tous paient à l'année (remise de 20 %).`);
  L.push("", "Montants bruts : avant frais de paiement, taxes, essais gratuits non convertis et départs. Les agences en France (en euros) ne sont pas comptées. Les prix sont lus dans le code (`subscription.controller.ts`).", "");

  L.push("## Charge de consultation", "");
  L.push("Chaque gestionnaire enchaîne une session type de 11 requêtes (tableau de bord, notifications, listes, comptes-rendus de gestion, relevé annuel, synthèse fiscale), à environ une requête par seconde : c'est plus intense que l'usage réel.", "");
  L.push(`| Palier | Gestionnaires en même temps | Requêtes/s | Erreurs | Médiane | 95 % sous | 99 % sous | Verdict |`, `|---|---|---|---|---|---|---|---|`);
  for (const r of resultats) L.push(`| ${r.pct} % | ${r.utilisateurs} | ${dec(r.debit_req_s)} | ${dec(r.taux_erreur_pct)} % | ${r.global.p50} ms | ${r.global.p95} ms | ${r.global.p99} ms | ${ICONE[r.verdict]} |`);
  L.push("");

  const etapesPire = pire.etapes.slice().sort((a, b) => b.p95 - a.p95);
  L.push(`### Les écrans les plus lents au palier ${pire.pct} %`, "", `| Requête | Nombre | Médiane | 95 % sous | Maximum | Erreurs |`, `|---|---|---|---|---|---|`);
  for (const e of etapesPire.slice(0, 5)) L.push(`| ${e.etape} | ${e.n} | ${e.p50} ms | ${e.p95} ms | ${e.max} ms | ${e.erreurs} |`);
  L.push("");

  L.push("### Où est le goulot ?", "");
  L.push(`- Temps de calcul de la base : **${dec(tempsBaseParRequete)} ms par requête** en moyenne, soit ${dec(occupationBase, 2)} cœur de la base occupé en moyenne pendant la charge.`);
  L.push(occupationBase < 0.5 ? "- La base travaille peu : le ralentissement éventuel vient du calcul des instances du backend (et de la machine de test, partagée entre tout), pas de la base." : "- La base est sollicitée de façon notable : surveiller sa puissance et ses index si le nombre de gestionnaires augmente.");
  L.push(`- Connexions : ${INSTANCES} instances du backend, une connexion chacune (comme en production, \`max: 1\`) ; la base est limitée à 60 connexions, comme chez Supabase.`, "");

  if (cron) {
    L.push("## Tâche quotidienne : envoi des e-mails", "");
    L.push(`Test sur un faux serveur d'envoi à ${DELAI_SMTP_MS} ms par e-mail, ${PARALLELE} envois de front, budget de ${BUDGET_CRON_S} s : **${cron.envoyes} e-mails en ${cron.duree.toFixed(0)} s** (${dec(cron.debit)} par seconde), ${cron.echecs} échec(s), ${cron.interrompu ? "interrompu faute de temps (le reste est repris le lendemain)" : `tout traité (${cron.eligibles} éligibles)`}.`, "");
    if (!cron.interrompu) L.push("> Le budget n'a pas été épuisé : le débit mesuré est un minimum, il aurait pu être plus élevé avec plus de messages à envoyer.", "");
    const parSeconde = cron.debit;
    L.push(`Projection au budget réel de la production (240 s par exécution quotidienne), pour ${fmt(volumes.baux)} baux (un avis d'échéance chacun par mois), à débit constant :`, "");
    L.push(`| Envois de front | E-mails par exécution | Jours pour envoyer tous les avis du mois |`, `|---|---|---|`);
    for (const p of [1, PARALLELE, 20]) {
      const debit = (parSeconde * p) / PARALLELE;
      const parJour = debit * 240;
      L.push(`| ${p}${p === PARALLELE ? " (ce test)" : " (estimation linéaire)"} | ${fmt(parJour)} | ${parJour > 0 ? Math.ceil(volumes.baux / parJour) : "—"} |`);
    }
    L.push("", "Hypothèse : chaque envoi prend le délai simulé ; un vrai serveur d'envoi peut être plus lent, ou limiter le nombre d'e-mails par jour (comptes Zoho ou Gmail) ou de connexions simultanées.", "");
  }

  L.push("## Limites de cette simulation", "");
  L.push("- Elle tourne sur une seule machine, qui partage son processeur entre le backend, la base et le générateur de charge : les temps absolus sont pessimistes par rapport à Vercel, où chaque fonction a son propre processeur.");
  L.push("- La base locale est un Postgres standard réglé comme la production (60 connexions, petit cache), mais sans le pooler de connexions de Supabase ni le réseau entre Vercel et Supabase.");
  L.push("- Le débit d'envoi d'e-mails dépend du vrai serveur d'envoi, simulé ici par un délai fixe.");
  L.push("- Aucun appel à un service extérieur (paiement, WhatsApp, Sentry) n'est fait.", "");

  fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
  fs.writeFileSync(SORTIE, L.join("\n") + "\n");
}

main()
  .catch((e) => {
    console.error(`[simulation] ÉCHEC : ${e.stack || e.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await nettoyer();
    process.exit(process.exitCode ?? 0);
  });
