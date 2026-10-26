import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * 26 octobre 2026, mise en place de la sauvegarde : le secret `SUPABASE_DB_URL` a été collé avec des crochets (le
 * `[YOUR-PASSWORD]` de Supabase) et un mot de passe contenant un « @ ». `pg_dump` a répondu « could not translate host
 * name "1990]@aws-1-eu-west-3.pooler.supabase.com" » : la fin du mot de passe est apparue dans le journal du run, public
 * (le dépôt l'est). Le masquage du script s'arrêtait au premier « @ ».
 *
 * Le script vérifie donc la FORME de l'adresse avant d'appeler `pg_dump`, avec un message qui dit quoi corriger sans jamais
 * en citer un morceau, et masque tout le mot de passe dans les messages des outils.
 *
 * Ces tests n'ont pas besoin de PostgreSQL : `pg_dump` y est remplacé par un faux qui note qu'il a été appelé et affiche son
 * argument d'adresse, comme le ferait un message d'erreur.
 */
const SCRIPT = join(__dirname, "../../scripts/sauvegarde/sauvegarder.sh");

let racine: string;
let faux: string;
let sortie: string;
let marque: string;

beforeAll(() => {
  racine = mkdtempSync(join(tmpdir(), "adresse-sauvegarde-"));
  faux = join(racine, "bin");
  sortie = join(racine, "sortie");
  marque = join(racine, "pg_dump-appele");
  mkdirSync(faux);
  mkdirSync(sortie);
  writeFileSync(join(faux, "pg_dump"), `#!/usr/bin/env bash\ntouch "${marque}"\necho "pg_dump: error: connection failed: $*" >&2\nexit 1\n`);
  chmodSync(join(faux, "pg_dump"), 0o755);
});
afterAll(() => rmSync(racine, { recursive: true, force: true }));
beforeEach(() => rmSync(marque, { force: true }));

const lancer = (adresse: string) =>
  spawnSync("bash", [SCRIPT, sortie], {
    env: { PATH: `${faux}:${process.env.PATH}`, HOME: process.env.HOME ?? "/tmp", DATABASE_URL: adresse, BACKUP_PASSPHRASE: "phrase" },
    encoding: "utf8",
    timeout: 30_000,
  });
const textes = (r: ReturnType<typeof lancer>) => `${r.stdout}\n${r.stderr}`;

describe("forme de l'adresse de la base, vérifiée avant pg_dump", () => {
  it("refuse une adresse avec deux « @ » (mot de passe contenant un @), dit d'écrire %40, et n'en cite aucun morceau", () => {
    const r = lancer("postgresql://sauvegarde.ref:Secret@1990@aws-1-eu-west-3.pooler.supabase.com:5432/postgres");
    expect(r.status).toBe(1);
    expect(textes(r)).toMatch(/2 « @ »/);
    expect(textes(r)).toMatch(/%40/);
    expect(textes(r)).not.toMatch(/Secret|1990/);
    expect(existsSync(marque)).toBe(false);
  });

  it("refuse une adresse avec des crochets autour du mot de passe, sans en citer un morceau", () => {
    const r = lancer("postgresql://sauvegarde.ref:[Secret1990]@aws-1-eu-west-3.pooler.supabase.com:5432/postgres");
    expect(r.status).toBe(1);
    expect(textes(r)).toMatch(/crochets/);
    expect(textes(r)).toMatch(/YOUR-PASSWORD/);
    expect(textes(r)).not.toMatch(/Secret|1990/);
    expect(existsSync(marque)).toBe(false);
  });

  it("refuse le Transaction pooler de Supabase (port 6543) : il faut le Session pooler (5432)", () => {
    const r = lancer("postgresql://sauvegarde.ref:Secret1990@aws-1-eu-west-3.pooler.supabase.com:6543/postgres");
    expect(r.status).toBe(1);
    expect(textes(r)).toMatch(/5432/);
    expect(textes(r)).toMatch(/Session pooler/);
    expect(textes(r)).not.toMatch(/Secret|1990/);
    expect(existsSync(marque)).toBe(false);
  });

  it("refuse, sur le pooler Supabase, un utilisateur sans la référence du projet (« postgres » seul)", () => {
    const r = lancer("postgresql://postgres:Secret1990@aws-1-eu-west-3.pooler.supabase.com:5432/postgres");
    expect(r.status).toBe(1);
    expect(textes(r)).toMatch(/référence du projet/);
    expect(textes(r)).not.toMatch(/Secret|1990/);
    expect(existsSync(marque)).toBe(false);
  });

  it("refuse une adresse qui ne commence pas par postgresql://", () => {
    const r = lancer("mysql://u:Secret1990@127.0.0.1/base");
    expect(r.status).toBe(1);
    expect(textes(r)).toMatch(/postgresql:\/\//);
    expect(textes(r)).not.toMatch(/Secret|1990/);
    expect(existsSync(marque)).toBe(false);
  });

  it("accepte l'adresse correcte du Session pooler (mot de passe avec @ écrit %40) et appelle pg_dump", () => {
    const r = lancer("postgresql://sauvegarde.ref:Secret%401990@aws-1-eu-west-3.pooler.supabase.com:5432/postgres");
    expect(existsSync(marque)).toBe(true);
    expect(r.status).toBe(1); // le faux pg_dump échoue
    expect(textes(r)).toMatch(/Erreur : pg_dump a échoué/);
  });

  it("accepte une adresse locale sans mot de passe (les tests et le développement)", () => {
    lancer("postgresql://postgres@127.0.0.1:5432/base");
    expect(existsSync(marque)).toBe(true);
  });
});

describe("masquage du mot de passe dans les messages de pg_dump", () => {
  it("n'en laisse rien paraître, même quand l'outil affiche l'adresse entière", () => {
    const r = lancer("postgresql://sauvegarde.ref:Secret%401990@aws-1-eu-west-3.pooler.supabase.com:5432/postgres");
    expect(textes(r)).toContain("***");
    expect(textes(r)).not.toMatch(/Secret|1990/);
  });
});
