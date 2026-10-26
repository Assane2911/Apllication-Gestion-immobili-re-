import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Sauvegarde logique de la base (scripts/sauvegarde/*.sh, lancés chaque nuit par le workflow `sauvegarde.yml`).
 *
 * Une sauvegarde qu'on n'a jamais restaurée n'est qu'une hypothèse : ces tests font le trajet complet sur un vrai
 * serveur PostgreSQL jetable — copie chiffrée, restauration dans une base vide, comparaison des données — et
 * vérifient les garde-fous (rien d'écrasé, rien de sensible dans la sortie, aucune sauvegarde « vide »).
 *
 * Ils ont besoin des binaires PostgreSQL (`initdb`, `pg_dump`...) et de `gpg` : absents, la suite est ignorée
 * (le workflow, lui, les installe et refait ce trajet à chaque exécution).
 */
const RACINE = join(__dirname, "../..");
const SAUVEGARDER = join(RACINE, "scripts/sauvegarde/sauvegarder.sh");
const VERIFIER = join(RACINE, "scripts/sauvegarde/verifier-sauvegarde.sh");

function dossierBinairesPostgres(): string | null {
  for (const racine of ["/usr/lib/postgresql", "/usr/local/pgsql", "/opt/homebrew/opt/postgresql@16"]) {
    if (!existsSync(racine)) continue;
    const candidats = existsSync(join(racine, "bin", "initdb"))
      ? [join(racine, "bin")]
      : readdirSync(racine).sort().reverse().map((v) => join(racine, v, "bin"));
    const trouve = candidats.find((d) => existsSync(join(d, "initdb")) && existsSync(join(d, "pg_dump")));
    if (trouve) return trouve;
  }
  return null;
}
const BIN = dossierBinairesPostgres();
const aGpg = spawnSync("gpg", ["--version"]).status === 0;
const disponible = BIN !== null && aGpg;

const PHRASE = "phrase-de-passe-de-test";
const PORT = 55000 + Math.floor(Math.random() * 4000);
const estRoot = typeof process.getuid === "function" && process.getuid() === 0;

let racine: string;
const url = (base: string, utilisateur = "postgres") => `postgresql://${utilisateur}@127.0.0.1:${PORT}/${base}`;
const envScripts = (extra: Record<string, string>) => ({
  PATH: `${BIN}:${process.env.PATH}`,
  HOME: process.env.HOME ?? "/tmp",
  ...extra,
});
const sql = (base: string, requete: string) =>
  execFileSync(join(BIN!, "psql"), [url(base), "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", requete], { encoding: "utf8" }).trim();
const executer = (script: string, args: string[], env: Record<string, string>) =>
  spawnSync("bash", [script, ...args], { env: envScripts(env), encoding: "utf8", timeout: 120_000 });

describe.skipIf(!disponible)("sauvegarde chiffrée de la base", () => {
  beforeAll(() => {
    racine = mkdtempSync(join(tmpdir(), "sauvegarde-test-"));
    const donnees = join(racine, "pgdata");
    // initdb refuse de tourner en root : on passe par l'utilisateur système `postgres` quand c'est nécessaire.
    const commeProprietaire = (cmd: string, args: string[]) =>
      estRoot ? execFileSync("runuser", ["-u", "postgres", "--", cmd, ...args], { stdio: "pipe" }) : execFileSync(cmd, args, { stdio: "pipe" });
    if (estRoot) {
      // Le dossier entier (données, journal, socket) doit appartenir à l'utilisateur qui lance le serveur.
      const uid = Number(execFileSync("id", ["-u", "postgres"], { encoding: "utf8" }));
      const gid = Number(execFileSync("id", ["-g", "postgres"], { encoding: "utf8" }));
      chmodSync(racine, 0o755);
      chownSync(racine, uid, gid);
      mkdirSync(donnees);
      chownSync(donnees, uid, gid);
    }
    commeProprietaire(join(BIN!, "initdb"), ["-D", donnees, "-U", "postgres", "-A", "trust", "--no-sync"]);
    commeProprietaire(join(BIN!, "pg_ctl"), ["-D", donnees, "-o", `-p ${PORT} -k ${racine} -c listen_addresses=127.0.0.1 -c fsync=off`, "-w", "-l", join(racine, "pg.log"), "start"]);
    for (const base of ["source", "vide", "restauree", "refus", "sans_table"]) sql("postgres", `create database ${base}`);

    sql(
      "source",
      `create table public.locataires (id serial primary key, nom text not null, notes jsonb, cree_le timestamptz not null default '2026-10-26 08:00:00+00');
       insert into public.locataires (nom, notes) values ('Awa Diallo — éàç', '{"langue":"pt","tel":"+221771234567"}'), ('Moussa Fall', null);
       create table public.factures (id serial primary key, locataire_id int references public.locataires(id), montant numeric(12,2) not null);
       insert into public.factures (locataire_id, montant) values (1, 250000.50), (1, 99.99), (2, 0);
       create schema autre;
       create table autre.secret (v text);
       insert into autre.secret values ('hors-perimetre');`
    );
    sql("refus", "create table public.deja_la (x int); insert into public.deja_la values (1)");
    sql("sans_table", "select 1");
  }, 60_000); // initdb et le démarrage du serveur : plus lents sur une machine d'intégration chargée

  afterAll(() => {
    if (!racine) return;
    try {
      const commeProprietaire = (cmd: string, args: string[]) => (estRoot ? execFileSync("runuser", ["-u", "postgres", "--", cmd, ...args], { stdio: "pipe" }) : execFileSync(cmd, args, { stdio: "pipe" }));
      commeProprietaire(join(BIN!, "pg_ctl"), ["-D", join(racine, "pgdata"), "-m", "immediate", "stop"]);
    } catch {
      /* le serveur est peut-être déjà arrêté */
    }
    rmSync(racine, { recursive: true, force: true });
  });

  function sauvegarder(sortie: string, extra: Record<string, string> = {}) {
    mkdirSync(sortie, { recursive: true });
    return executer(SAUVEGARDER, [sortie], { DATABASE_URL: url("source"), BACKUP_PASSPHRASE: PHRASE, ...extra });
  }

  it("produit une copie chiffrée et son empreinte, sans rien de lisible dedans", () => {
    const sortie = join(racine, "s1");
    const r = sauvegarder(sortie);
    expect(r.status, r.stderr).toBe(0);

    const fichiers = readdirSync(sortie).sort();
    expect(fichiers).toHaveLength(2);
    expect(fichiers[0]).toMatch(/^immoplatform-\d{8}-\d{6}\.dump\.gpg$/);
    expect(fichiers[1]).toBe(`${fichiers[0]}.sha256`);

    const brut = readFileSync(join(sortie, fichiers[0])).toString("latin1");
    expect(brut).not.toContain("PGDMP"); // l'en-tête d'un dump PostgreSQL : chiffré, il ne doit pas apparaître
    expect(brut).not.toContain("Awa Diallo");
    expect(brut).not.toContain("locataires");
    // Le script ne dit que le nom du fichier produit, sur la dernière ligne.
    expect(r.stdout.trim().split("\n").pop()).toBe(fichiers[0]);
  });

  it("ne sauvegarde que le schéma public de l'application", () => {
    const sortie = join(racine, "s2");
    const r = sauvegarder(sortie);
    expect(r.status, r.stderr).toBe(0);
    const fichier = readdirSync(sortie).find((f) => f.endsWith(".gpg"))!;
    const v = executer(VERIFIER, [join(sortie, fichier)], { RESTORE_DATABASE_URL: url("restauree"), DATABASE_URL: url("source"), BACKUP_PASSPHRASE: PHRASE });
    expect(v.status, v.stderr + v.stdout).toBe(0);
    expect(sql("restauree", "select count(*) from information_schema.schemata where schema_name = 'autre'")).toBe("0");
  });

  it("se restaure dans une base vide, avec les mêmes données (accents, JSON, dates, montants, clés étrangères)", () => {
    const sortie = join(racine, "s3");
    expect(sauvegarder(sortie).status).toBe(0);
    const fichier = readdirSync(sortie).find((f) => f.endsWith(".gpg"))!;
    // La base « vide » de ce test : on repart d'une base neuve, la précédente ayant déjà servi.
    sql("postgres", "drop database restauree");
    sql("postgres", "create database restauree");

    const v = executer(VERIFIER, [join(sortie, fichier)], { RESTORE_DATABASE_URL: url("restauree"), DATABASE_URL: url("source"), BACKUP_PASSPHRASE: PHRASE });
    expect(v.status, v.stderr + v.stdout).toBe(0);
    // Le compte rendu donne le nombre de lignes par table.
    expect(v.stdout).toMatch(/locataires\s*[:|=]?\s*2/);
    expect(v.stdout).toMatch(/factures\s*[:|=]?\s*3/);

    for (const requete of [
      "select nom || '/' || coalesce(notes::text, 'null') || '/' || cree_le::text from public.locataires order by id",
      "select locataire_id || '/' || montant from public.factures order by id",
    ]) {
      expect(sql("restauree", requete)).toBe(sql("source", requete));
    }
    expect(sql("restauree", "select count(*) from pg_constraint where contype = 'f' and conrelid = 'public.factures'::regclass")).toBe("1");
  });

  it("refuse de restaurer une copie dont l'empreinte ne correspond pas (fichier abîmé)", () => {
    const sortie = join(racine, "s4");
    expect(sauvegarder(sortie).status).toBe(0);
    const fichier = readdirSync(sortie).find((f) => f.endsWith(".gpg"))!;
    execFileSync("bash", ["-c", `printf 'x' >> "${join(sortie, fichier)}"`]);
    sql("postgres", "drop database if exists restauree");
    sql("postgres", "create database restauree");
    const v = executer(VERIFIER, [join(sortie, fichier)], { RESTORE_DATABASE_URL: url("restauree"), DATABASE_URL: url("source"), BACKUP_PASSPHRASE: PHRASE });
    expect(v.status).not.toBe(0);
    expect(v.stderr).toMatch(/empreinte/i);
  });

  it("refuse une mauvaise phrase de passe, sans rien restaurer", () => {
    const sortie = join(racine, "s5");
    expect(sauvegarder(sortie).status).toBe(0);
    const fichier = readdirSync(sortie).find((f) => f.endsWith(".gpg"))!;
    sql("postgres", "drop database if exists restauree");
    sql("postgres", "create database restauree");
    const v = executer(VERIFIER, [join(sortie, fichier)], { RESTORE_DATABASE_URL: url("restauree"), DATABASE_URL: url("source"), BACKUP_PASSPHRASE: "mauvaise" });
    expect(v.status).not.toBe(0);
    expect(sql("restauree", "select count(*) from information_schema.tables where table_schema = 'public'")).toBe("0");
  });

  it("refuse de restaurer dans une base qui contient déjà des données, ou dans la base sauvegardée elle-même", () => {
    const sortie = join(racine, "s6");
    expect(sauvegarder(sortie).status).toBe(0);
    const fichier = readdirSync(sortie).find((f) => f.endsWith(".gpg"))!;

    const nonVide = executer(VERIFIER, [join(sortie, fichier)], { RESTORE_DATABASE_URL: url("refus"), DATABASE_URL: url("source"), BACKUP_PASSPHRASE: PHRASE });
    expect(nonVide.status).not.toBe(0);
    expect(nonVide.stderr).toMatch(/vide/i);
    expect(sql("refus", "select x from public.deja_la")).toBe("1"); // intacte

    const memeBase = executer(VERIFIER, [join(sortie, fichier)], { RESTORE_DATABASE_URL: url("source"), DATABASE_URL: url("source"), BACKUP_PASSPHRASE: PHRASE });
    expect(memeBase.status).not.toBe(0);
    expect(memeBase.stderr).toMatch(/source|sauvegard/i);
    expect(sql("source", "select count(*) from public.locataires")).toBe("2");
  });

  it("refuse de produire une sauvegarde « vide » (mauvaise adresse, base sans table)", () => {
    const sortie = join(racine, "s7");
    const r = sauvegarder(sortie, { DATABASE_URL: url("sans_table") });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/aucune table/i);
    expect(readdirSync(sortie)).toEqual([]); // aucun fichier laissé derrière
  });

  it("exige l'adresse de la base et la phrase de passe, et n'écrit jamais le mot de passe de la base", () => {
    const sortie = join(racine, "s8");
    mkdirSync(sortie);
    const sansPhrase = executer(SAUVEGARDER, [sortie], { DATABASE_URL: url("source") });
    expect(sansPhrase.status).not.toBe(0);
    expect(sansPhrase.stderr).toMatch(/BACKUP_PASSPHRASE/);
    const sansUrl = executer(SAUVEGARDER, [sortie], { BACKUP_PASSPHRASE: PHRASE });
    expect(sansUrl.status).not.toBe(0);
    expect(sansUrl.stderr).toMatch(/DATABASE_URL/);

    // Une base injoignable : l'échec ne doit rien laisser fuiter de l'adresse (mot de passe compris) dans la sortie.
    const injoignable = executer(SAUVEGARDER, [sortie], { DATABASE_URL: `postgresql://utilisateur:mot-de-passe-secret@127.0.0.1:1/base`, BACKUP_PASSPHRASE: PHRASE });
    expect(injoignable.status).not.toBe(0);
    expect(injoignable.stdout + injoignable.stderr).not.toContain("mot-de-passe-secret");
    expect(readdirSync(sortie)).toEqual([]);
  });

  it("ne passe jamais la phrase de passe en argument de commande (visible dans la liste des processus)", () => {
    for (const script of [SAUVEGARDER, VERIFIER]) {
      const source = readFileSync(script, "utf8");
      expect(source).not.toMatch(/--passphrase\s/);
      expect(source).not.toMatch(/--passphrase=/);
      expect(source).toMatch(/--passphrase-fd/);
      expect(source).not.toMatch(/^\s*set\s+-[a-z]*x/m); // pas de trace des commandes : elle montrerait les adresses
    }
  });
});
