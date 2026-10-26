import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La base Supabase est à Paris (`eu-west-3`). Sans `regions` dans `vercel.json`, Vercel exécute les fonctions dans sa
 * région par défaut, `iad1` (côte Est des États-Unis) : chaque requête SQL traverse l'Atlantique, et une page qui en
 * enchaîne cinq ou six attend plusieurs fois cet aller-retour. Les utilisateurs sont à Dakar, bien plus près de Paris
 * que de la Virginie. La fonction doit donc tourner à Paris (`cdg1`), à côté de la base.
 *
 * Ces contrôles lisent les fichiers tels qu'ils seront livrés ; ils sont ignorés si le dépôt n'est pas complet.
 */
const RACINE = join(__dirname, "../../..");
const dispo = existsSync(join(RACINE, "backend/vercel.json")) && existsSync(join(RACINE, "DEPLOYMENT.md"));

const configuration = () => JSON.parse(readFileSync(join(RACINE, "backend/vercel.json"), "utf8")) as Record<string, unknown>;
const guide = () => readFileSync(join(RACINE, "DEPLOYMENT.md"), "utf8");

describe.skipIf(!dispo)("région d'exécution des fonctions du backend", () => {
  it("les fonctions tournent à Paris (cdg1), à côté de la base Supabase d'eu-west-3", () => {
    expect(configuration().regions).toEqual(["cdg1"]);
  });

  it("une seule région, voulue : la base n'est qu'à Paris, une fonction ailleurs ne ferait qu'ajouter de la distance", () => {
    expect(configuration().regions).toHaveLength(1);
  });

  it("aucune fonction n'est renvoyée vers une autre région que celle de la base", () => {
    const fonctions = (configuration().functions ?? {}) as Record<string, { regions?: string[] }>;
    for (const [chemin, reglage] of Object.entries(fonctions)) {
      expect(reglage.regions, `la fonction ${chemin} a sa propre région`).toBeUndefined();
    }
  });

  it("les tâches planifiées sont conservées", () => {
    const crons = (configuration().crons ?? []) as Array<{ path: string; schedule: string }>;
    expect(crons.map((c) => c.path)).toEqual(["/api/cron/daily", "/api/cron/rent-due-reminders"]);
  });

  it("le guide ne présente pas la région unique comme une limite du plan : le projet est sur Vercel Pro, qui en accepte plusieurs", () => {
    const texte = guide();
    expect(texte).not.toMatch(/Le plan Hobby n'accepte qu'une seule région/);
    expect(texte).toMatch(/Pro/);
    expect(texte).toMatch(/Hobby/);
  });

  it("les tâches planifiées : le guide ne les dit pas limitées à une exécution par jour, ce n'est plus le cas du plan Pro", () => {
    expect(guide()).not.toMatch(/Plan Hobby \(gratuit\)\*\* : les Cron Jobs/);
  });

  it("le guide de déploiement dit pourquoi, et quoi faire si la base change de région", () => {
    const texte = guide();
    expect(texte).toMatch(/cdg1/);
    expect(texte).toMatch(/eu-west-3/);
    expect(texte).toMatch(/même région|à côté de la base/i);
    expect(texte).toMatch(/regions/);
  });
});
