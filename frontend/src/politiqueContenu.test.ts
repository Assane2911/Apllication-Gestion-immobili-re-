import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Politique de sécurité de contenu (CSP) du site, en deux étages :
 *  - `Content-Security-Policy` BLOQUE ce qui protège des scripts injectés : d'où le navigateur peut charger un script
 *    (`script-src`), pas d'objet, pas de changement de base, formulaires vers nous seuls, pas d'affichage du site dans
 *    le cadre d'un autre. Vérifié sur les pages publiques, avec les quatre scripts tiers, sans aucune violation ;
 *  - `Content-Security-Policy-Report-Only` garde la politique complète (images, connexions, cadres, polices) en
 *    OBSERVATION : le navigateur signale à /api/csp-report ce qu'il aurait bloqué, sans rien bloquer. Elle deviendra
 *    bloquante à son tour une fois les rapports des pages connectées lus.
 *
 * Ce test tient :
 *  - les directives de base de chaque étage (pas de script en ligne ni d'eval, pas d'objet) ;
 *  - la liste des scripts autorisés, identique dans les deux en-têtes : elle ne peut pas diverger ;
 *  - chaque script tiers que le code charge est autorisé : ajouter un nouveau script tiers sans mettre la politique à
 *    jour ferait échouer ce test, au lieu de bloquer ce script en production.
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
const bloquante = entetes.get("content-security-policy") ?? "";
const dirBloquante = directives(bloquante);

function fichiersSource(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersSource(chemin);
    return /\.(ts|tsx)$/.test(nom) && !/\.test\./.test(nom) ? [chemin] : [];
  });
}

describe("politique de sécurité de contenu : partie bloquante", () => {
  it("bloque les scripts venus d'ailleurs, les objets, le changement de base, les formulaires externes et l'affichage dans un autre site", () => {
    expect(dirBloquante.get("script-src")).toContain("'self'");
    expect(dirBloquante.get("script-src")).not.toContain("'unsafe-inline'");
    expect(dirBloquante.get("script-src")).not.toContain("'unsafe-eval'");
    expect(dirBloquante.get("object-src")).toEqual(["'none'"]);
    expect(dirBloquante.get("base-uri")).toEqual(["'self'"]);
    expect(dirBloquante.get("form-action")).toEqual(["'self'"]);
    expect(dirBloquante.get("frame-ancestors")).toEqual(["'self'"]);
  });

  it("la liste des scripts autorisés est la même que celle de l'observation", () => {
    expect(dirBloquante.get("script-src")).toEqual(dir.get("script-src"));
  });

  it("signale aussi ses violations au point de collecte", () => {
    expect(dirBloquante.get("report-uri")).toEqual(dir.get("report-uri"));
  });

  it("ne bloque pas encore le reste (images, connexions, polices, cadres) : c'est l'observation qui s'en charge", () => {
    for (const nom of ["default-src", "connect-src", "img-src", "font-src", "frame-src", "style-src", "media-src"]) {
      expect(dirBloquante.has(nom), nom).toBe(false);
    }
  });
});

describe("politique de sécurité de contenu (observation)", () => {
  it("garde la politique complète en mode observation", () => {
    expect(observation).not.toBe("");
    expect(dir.get("default-src")).toEqual(["'self'"]);
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
    for (const origine of origines) {
      expect(dirBloquante.get("script-src"), `script tiers bloqué : ${origine}`).toContain(origine);
      expect(dir.get("script-src"), `script tiers non autorisé : ${origine}`).toContain(origine);
    }
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
