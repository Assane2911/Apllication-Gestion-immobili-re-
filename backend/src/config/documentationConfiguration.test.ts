import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La documentation de configuration ne doit pas pouvoir se décoller du code : `.env.example` est la liste de référence
 * des variables, `DEPLOYMENT.md` et le `README` sont ce que lit quelqu'un qui reprend le projet ou le déploie.
 *
 * Elle a pourtant dérivé : des variables lues par le code n'y figuraient plus, le guide de déploiement demandait de
 * reprendre tout `.env.example` — dont `PAYMENTS_DEMO_MODE=true` — puis de « tester un paiement en mode démo », ce qui,
 * sur Vercel, active le mode démo (un abonnement activé sans qu'un centime ne soit encaissé), et le démarrage rapide
 * du README échouait au `seed` avec un mot de passe qui n'existe plus.
 *
 * Ces contrôles lisent les fichiers tels qu'ils seront livrés ; ils sont ignorés si le dépôt n'est pas complet.
 */
const RACINE = join(__dirname, "../../..");
const dispo = existsSync(join(RACINE, "README.md")) && existsSync(join(RACINE, "backend/.env.example")) && existsSync(join(RACINE, "frontend/.env.example"));

const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");

/** Les fichiers source (hors tests) d'un dossier, récursivement. */
function sources(dossier: string, extensions: string[]): string[] {
  const resultat: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) resultat.push(...sources(chemin, extensions));
    else if (extensions.some((e) => nom.endsWith(e)) && !/\.test\.|\.spec\./.test(nom)) resultat.push(chemin);
  }
  return resultat;
}

/** Les variables d'un `.env.example`, qu'elles soient actives (`CLE=`) ou données en exemple (`# CLE=`). */
function variablesDocumentees(contenu: string): Set<string> {
  return new Set([...contenu.matchAll(/^#?\s?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
}

// Injectées par l'hébergeur, jamais à renseigner à la main (le `.env.example` l'explique en commentaire).
const INJECTEES = new Set(["VERCEL", "VERCEL_PROJECT_PRODUCTION_URL"]);

describe.skipIf(!dispo)("documentation de la configuration", () => {
  it("toutes les variables lues par le backend figurent dans backend/.env.example", () => {
    const lues = new Set<string>();
    for (const f of sources(join(RACINE, "backend/src"), [".ts"])) {
      for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) lues.add(m[1]);
    }
    const documentees = variablesDocumentees(lire("backend/.env.example"));
    const manquantes = [...lues].filter((v) => !documentees.has(v) && !INJECTEES.has(v)).sort();
    expect(manquantes, `variables lues mais absentes de backend/.env.example : ${manquantes.join(", ")}`).toEqual([]);
  });

  it("toutes les variables VITE_ lues par le frontend figurent dans frontend/.env.example", () => {
    const lues = new Set<string>();
    for (const f of sources(join(RACINE, "frontend/src"), [".ts", ".tsx"])) {
      for (const m of readFileSync(f, "utf8").matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) lues.add(m[1]);
    }
    const documentees = variablesDocumentees(lire("frontend/.env.example"));
    const manquantes = [...lues].filter((v) => !documentees.has(v)).sort();
    expect(manquantes, `variables lues mais absentes de frontend/.env.example : ${manquantes.join(", ")}`).toEqual([]);
  });

  it("backend/.env.example ne documente aucune variable que le code ne lit plus", () => {
    const lues = new Set<string>();
    for (const f of sources(join(RACINE, "backend/src"), [".ts"])) {
      for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) lues.add(m[1]);
    }
    const obsoletes = [...variablesDocumentees(lire("backend/.env.example"))].filter((v) => !lues.has(v)).sort();
    expect(obsoletes, `variables documentées mais jamais lues : ${obsoletes.join(", ")}`).toEqual([]);
  });

  describe("le mode démo des paiements ne s'active jamais par accident en production", () => {
    it("backend/.env.example ne le met pas à « true » : le copier tel quel sur Vercel l'activerait", () => {
      const actives = [...lire("backend/.env.example").matchAll(/^PAYMENTS_DEMO_MODE=(.*)$/gm)].map((m) => m[1].trim());
      expect(actives.filter((v) => v === "true")).toEqual([]);
      // Et l'exemple dit clairement quoi faire en production.
      expect(lire("backend/.env.example")).toMatch(/#.*PAYMENTS_DEMO_MODE=true/);
      expect(lire("backend/.env.example")).toMatch(/production/i);
    });

    it("DEPLOYMENT.md n'invite pas à tester un paiement en mode démo sur le déploiement, et dit comment le vérifier", () => {
      const guide = lire("DEPLOYMENT.md");
      expect(guide).not.toMatch(/Testez un paiement en mode démo/i);
      expect(guide).toMatch(/PAYMENTS_DEMO_MODE/);
      expect(guide).toMatch(/\/api\/payments\/methods/);
    });

    it("la documentation dit que « true » est ignoré sur un déploiement, comme le fait le code", () => {
      for (const chemin of ["DEPLOYMENT.md", "README.md", "backend/.env.example"]) {
        expect(lire(chemin), chemin).toMatch(/ignor/i);
      }
      expect(readFileSync(join(RACINE, "backend/src/config/modeDemo.ts"), "utf8")).toContain("ignore: valeur === \"true\"");
    });

    it("le README ne dit plus que le mode démo est actif par défaut", () => {
      const readme = lire("README.md");
      expect(readme).not.toMatch(/PAYMENTS_DEMO_MODE=true`\s*par défaut/);
      expect(readme).toMatch(/PAYMENTS_DEMO_MODE/);
      expect(readme).toMatch(/production/i);
    });
  });

  describe("le démarrage rapide du README fonctionne", () => {
    it("explique que le seed refuse une base distante sans SEED_ALLOW_REMOTE, et que le mot de passe est généré", () => {
      const readme = lire("README.md");
      expect(readme).toMatch(/SEED_ALLOW_REMOTE/);
      expect(readme).toMatch(/SEED_PASSWORD/);
      // Le mot de passe fixe d'avant n'existe plus : l'annoncer ferait croire à une connexion impossible.
      expect(readme).not.toMatch(/Demo1234!/);
    });

    it("annonce les mêmes comptes de démonstration que le seed", () => {
      const seed = readFileSync(join(RACINE, "backend/src/seed.ts"), "utf8");
      const emails = [...seed.matchAll(/"([a-z.]+@demo\.com)"/g)].map((m) => m[1]);
      expect(emails.length).toBeGreaterThan(0);
      const readme = lire("README.md");
      expect(readme).toContain("gestionnaire@demo.com");
      expect(readme).toContain("amine.silva@demo.com");
      expect(emails).toContain("gestionnaire@demo.com");
      expect(emails).toContain("amine.silva@demo.com");
    });

    it("indique la version de Node testée par la CI", () => {
      const ci = lire(".github/workflows/ci.yml");
      const version = ci.match(/node-version:\s*(\d+)/)?.[1];
      expect(version).toBeDefined();
      expect(lire("README.md")).toMatch(new RegExp(`Node\\.js\\s+${version}\\b`));
    });
  });

  describe("les e-mails partent d'un serveur qui correspond au domaine authentifié", () => {
    it("DEPLOYMENT.md explique la configuration, la vérification SPF / DKIM / DMARC et l'alerte Sentry", () => {
      const guide = lire("DEPLOYMENT.md");
      expect(guide).toMatch(/Délivrabilité des e-mails/);
      expect(guide).toMatch(/smtp\.zoho\.com/);
      expect(guide).toMatch(/spf=pass/);
      expect(guide).toMatch(/dkim=pass/);
      expect(guide).toMatch(/dmarc=pass/);
      expect(guide).toMatch(/Sentry/);
    });

    it("backend/.env.example donne la configuration d'un domaine à soi, pas seulement Gmail", () => {
      const exemple = lire("backend/.env.example");
      expect(exemple).toMatch(/smtp\.zoho\.com/);
      expect(exemple).toMatch(/EMAIL_FROM/);
      // Gmail ne signe pas au nom d'un autre domaine : l'exemple doit le dire.
      expect(exemple).toMatch(/SPF|DKIM/);
    });
  });

  describe("le secret de signature des jetons", () => {
    it("DEPLOYMENT.md et .env.example disent comment le générer et que le texte d'exemple est public", () => {
      const guide = lire("DEPLOYMENT.md");
      expect(guide).toMatch(/openssl rand -base64 48/);
      expect(guide).toMatch(/JWT_SECRET est faible/);
      expect(lire("backend/.env.example")).toMatch(/PUBLIQUE/);
    });

    it("le texte d'exemple de .env.example est bien celui que l'application reconnaît comme faible", async () => {
      const exemple = lire("backend/.env.example").match(/^JWT_SECRET=(.*)$/m)?.[1] ?? "";
      const { problemeSecretJwt } = await import("./secretJwt");
      expect(problemeSecretJwt(exemple)).toBe("exemple");
    });
  });

  describe("la surveillance de la disponibilité", () => {
    it("DEPLOYMENT.md explique les deux routes de santé et la sonde à poser sur celle qui vérifie la base", () => {
      const guide = lire("DEPLOYMENT.md");
      expect(guide).toMatch(/Surveillance de la disponibilité/);
      expect(guide).toMatch(/\/api\/health\/ready/);
      expect(guide).toMatch(/503/);
      expect(guide).toMatch(/UptimeRobot/);
      expect(guide).toMatch(/Keyword/);
    });

    it("le mot-clé de la sonde est la réponse exacte de la route, pas un « ok » que d'autres pages contiennent (« Token »)", () => {
      const guide = lire("DEPLOYMENT.md");
      expect(guide).toContain('mot-clé `"status":"ok"`');
      expect(guide).not.toMatch(/mot-clé `ok`/);
    });

    it("la route documentée existe dans l'application", () => {
      expect(readFileSync(join(RACINE, "backend/src/app.ts"), "utf8")).toContain('"/api/health/ready"');
    });
  });

  it("le README présente les rôles et les chapitres qui existent aujourd'hui", () => {
    const readme = lire("README.md");
    for (const role of ["MANAGER", "TENANT", "OWNER", "ADMIN"]) expect(readme).toContain(role);
    // Les fonctions ajoutées depuis la première version, et ce qui permet de reprendre le projet.
    for (const mot of [/propriétaire/i, /compte-rendu de gestion/i, /sauvegarde/i, /français.*anglais|fr, en, es, pt/i, /npm test/]) {
      expect(readme).toMatch(mot);
    }
  });
});
