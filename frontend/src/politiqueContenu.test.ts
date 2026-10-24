import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Politique de sécurité de contenu (CSP) du site, envoyée en mode OBSERVATION (`Content-Security-Policy-Report-Only`) :
 * le navigateur ne bloque rien, il signale à /api/csp-report ce qu'il aurait bloqué. Elle devient bloquante dans une
 * étape suivante, une fois les rapports lus.
 *
 * Ce test tient trois choses :
 *  - l'en-tête existe et ses directives de base sont strictes (pas de script en ligne ni d'eval, pas d'objet) ;
 *  - l'en-tête qui BLOQUE déjà (`frame-ancestors 'self'`) reste inchangé ;
 *  - chaque script tiers que le code charge est autorisé : ajouter un nouveau script tiers sans mettre la politique à
 *    jour ferait échouer ce test, au lieu de produire des rapports (puis, plus tard, un blocage) en production.
 */
const RACINE = join(__dirname, "..");

type Entete = { key: string; value: string };
const config = JSON.parse(readFileSync(join(RACINE, "vercel.json"), "utf8")) as { headers: Array<{ source: string; headers: Entete[] }> };
const entetes = new Map(config.headers.find((r) => r.source === "/(.*)")!.headers.map((h) => [h.key.toLowerCase(), h.value]));

/** « directive -> sources » d'une politique. */
function directives(politique: string): Map<string, string[]> {
  return new Map(
    politique
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [nom, ...sources] = d.split(/\s+/);
        return [nom, sources] as [string, string[]];
      })
  );
}

const observation = entetes.get("content-security-policy-report-only") ?? "";
const dir = directives(observation);

function fichiersSource(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersSource(chemin);
    return /\.(ts|tsx)$/.test(nom) && !/\.test\./.test(nom) ? [chemin] : [];
  });
}

describe("politique de sécurité de contenu (observation)", () => {
  it("est envoyée en mode observation, pas en mode bloquant", () => {
    expect(observation).not.toBe("");
    expect(entetes.get("content-security-policy")).toBe("frame-ancestors 'self'");
  });

  it("n'autorise ni script en ligne ni eval, ni objet, et fige la base et les formulaires", () => {
    expect(dir.get("script-src")).toContain("'self'");
    expect(dir.get("script-src")).not.toContain("'unsafe-inline'");
    expect(dir.get("script-src")).not.toContain("'unsafe-eval'");
    expect(dir.get("object-src")).toEqual(["'none'"]);
    expect(dir.get("base-uri")).toEqual(["'self'"]);
    expect(dir.get("form-action")).toEqual(["'self'"]);
    expect(dir.get("default-src")).toEqual(["'self'"]);
  });

  it("signale les violations au point de collecte du backend", () => {
    const cible = dir.get("report-uri")?.[0] ?? "";
    expect(cible).toMatch(/^https:\/\/apllication-gestion-immobili-re\.vercel\.app\/api\/csp-report$/);
    expect(dir.get("connect-src")).toContain("https://apllication-gestion-immobili-re.vercel.app");
  });

  it("autorise chaque script tiers que le code charge", () => {
    const origines = new Set<string>();
    for (const f of fichiersSource(join(RACINE, "src"))) {
      const code = readFileSync(f, "utf8");
      // `script.src = "https://…"` ou une constante dont le nom contient SCRIPT_SRC.
      for (const m of code.matchAll(/(?:\.src\s*=\s*|SCRIPT_SRC\s*=\s*)[`"'](https:\/\/[^/`"'$]+)/g)) origines.add(m[1]);
    }
    expect([...origines].length).toBeGreaterThanOrEqual(4); // Google Identity, GA4, LinkedIn, Meta
    for (const origine of origines) expect(dir.get("script-src"), `script tiers non autorisé : ${origine}`).toContain(origine);
  });

  it("autorise la connexion Google (cadre, connexion, style) et l'envoi d'erreurs à Sentry", () => {
    expect(dir.get("frame-src")).toContain("https://accounts.google.com");
    expect(dir.get("connect-src")).toContain("https://accounts.google.com");
    expect(dir.get("style-src")).toContain("https://accounts.google.com");
    expect(dir.get("connect-src")).toContain("https://*.sentry.io");
  });

  it("autorise les mesures d'audience (GA4, LinkedIn, Meta) à envoyer leurs données", () => {
    for (const hote of ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://px.ads.linkedin.com", "https://www.facebook.com"]) {
      expect(dir.get("connect-src"), hote).toContain(hote);
    }
  });

  it("garde les polices servies par le site (aucune police tierce)", () => {
    expect(dir.get("font-src")).toEqual(["'self'", "data:"]);
  });
});
