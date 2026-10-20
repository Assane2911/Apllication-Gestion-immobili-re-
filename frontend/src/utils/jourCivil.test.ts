import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ecartEnJours, formaterJour } from "./jourCivil";

/**
 * Les dates « de calendrier » (début et fin de bail, échéance, date d'une dépense, d'un état des lieux, d'une
 * police) sont enregistrées à minuit UTC du jour choisi. Lues avec le fuseau du navigateur, elles reculent d'un
 * jour à l'ouest de Greenwich — Brésil, Haïti, Antilles, Québec — et le « 1er mars » s'affiche « 28/02 ».
 */
beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
  // Garde-fou du test lui-même : sans ce fuseau, il ne prouverait rien.
  expect(new Date("2026-03-01T00:00:00.000Z").getDate()).toBe(28);
});

describe("formaterJour", () => {
  it("affiche le jour enregistré, pas celui de la veille, à l'ouest de Greenwich", () => {
    expect(formaterJour("2026-03-01T00:00:00.000Z", "fr-FR")).toBe("01/03/2026");
    expect(formaterJour("2026-03-01T00:00:00.000Z", "en-GB")).toBe("01/03/2026");
  });

  it("accepte une date déjà construite et des options de mise en forme", () => {
    expect(formaterJour(new Date("2026-03-01T00:00:00.000Z"), "fr-FR", { month: "long", year: "numeric" })).toBe("mars 2026");
  });
});

describe("ecartEnJours", () => {
  it("compte les jours entre aujourd'hui (jour de l'utilisateur) et le jour enregistré", () => {
    // Le 28/02 à 22h à São Paulo, il est déjà le 01/03 en UTC : « aujourd'hui » reste le 28/02 pour l'utilisateur.
    const maintenant = new Date("2026-03-01T01:00:00.000Z");
    expect(ecartEnJours("2026-03-01T00:00:00.000Z", maintenant)).toBe(1);
    expect(ecartEnJours("2026-03-02T00:00:00.000Z", maintenant)).toBe(2);
    expect(ecartEnJours("2026-02-28T00:00:00.000Z", maintenant)).toBe(0);
  });
});

function fichiersSource(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersSource(chemin);
    return /\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom) ? [chemin] : [];
  });
}

describe("garde", () => {
  it("aucune date de calendrier n'est mise en forme avec le fuseau du navigateur", () => {
    const champs = "startDate|endDate|dueDate|expenseDate|expiryDate|inspectionDate|preferredDate";
    const motif = new RegExp(`new Date\\([^)]*\\b(${champs})\\)\\.toLocale`);
    const fautifs = fichiersSource(join(__dirname, ".."))
      .filter((chemin) => motif.test(readFileSync(chemin, "utf8")))
      .map((chemin) => chemin.replace(join(__dirname, ".."), "src"));

    expect(fautifs).toEqual([]);
  });
});
