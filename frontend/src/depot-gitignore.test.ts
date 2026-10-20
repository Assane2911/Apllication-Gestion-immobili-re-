import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Un secret commité est publié pour toujours (l'historique le garde, même supprimé). Le `.gitignore` ne protégeait
 * que `.env` et `.env.local` : un `.env.production` (ou `.env.vercel`, tel que sorti par `vercel env pull`), un
 * keystore de signature Android ou une clé privée créés par erreur dans le dépôt partaient au prochain
 * `git add .`. Ce test interroge git lui-même (`git check-ignore`), sur des chemins qui n'existent pas encore.
 */
const RACINE = join(__dirname, "../..");

function ignore(chemin: string): boolean {
  const r = spawnSync("git", ["check-ignore", "-q", "--no-index", chemin], { cwd: RACINE });
  return r.status === 0;
}

describe.skipIf(!existsSync(join(RACINE, ".git")))(".gitignore protège les fichiers secrets", () => {
  it.each([
    "backend/.env",
    "backend/.env.local",
    "backend/.env.production",
    "backend/.env.development.local",
    "frontend/.env.vercel",
    "frontend/.env.production.local",
    "frontend/android/app/release.keystore",
    "frontend/android/app/upload-key.jks",
    "frontend/android/keystore.properties",
    "backend/certificats/cle-privee.pem",
    "backend/certificats/client.p12",
    "backend/id_rsa",
  ])("ignore %s", (chemin) => {
    expect(ignore(chemin), chemin).toBe(true);
  });

  it.each(["backend/.env.example", "frontend/.env.example", "backend/src/app.ts", "frontend/android/app/build.gradle"])(
    "ne cache pas %s",
    (chemin) => {
      expect(ignore(chemin), chemin).toBe(false);
    }
  );
});
