import { describe, expect, it } from "vitest";
import type { OwnerDashboard } from "../types";
import { csvTableauDeBord } from "./csvProprietaire";

const libelles = { property: "Bien", address: "Adresse", currency: "Devise", collected: "Perçu", pending: "En attente", month: "Mois", revenue: "Loyers perçus" };

function donnees(surcharge: Partial<OwnerDashboard> = {}): OwnerDashboard {
  return {
    ownerName: "Fatou Diop",
    managementFeeRate: 8,
    properties: [{ propertyId: "p1", title: 'Villa "Les Palmiers"', address: "Route de Ngor", currency: "EUR", collected: 1000, pending: 200.5 }],
    collectedThisMonthByCurrency: { EUR: 1000 },
    pendingThisMonthByCurrency: { EUR: 200.5 },
    revenueByMonth: { "2026-09": { EUR: 600 }, "2026-08": { XOF: 450000, EUR: 900 } },
    ...surcharge,
  };
}

describe("csvTableauDeBord", () => {
  it("commence par la marque d'octet UTF-8 et sépare les deux blocs par une ligne vide", () => {
    const csv = csvTableauDeBord(donnees(), libelles);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\n")).toContain("");
  });

  it("écrit les montants à la française et protège les guillemets d'un nom de bien", () => {
    const lignes = csvTableauDeBord(donnees(), libelles).split("\n");
    expect(lignes[1]).toBe('"Villa ""Les Palmiers""";"Route de Ngor";"EUR";1000,00;200,50');
  });

  it("trie les mois et garde chaque devise sur sa ligne, sans les additionner", () => {
    const lignes = csvTableauDeBord(donnees(), libelles).split("\n");
    const historique = lignes.slice(lignes.indexOf("") + 2);
    expect(historique).toEqual(['"2026-08";"EUR";900,00', '"2026-08";"XOF";450000,00', '"2026-09";"EUR";600,00']);
  });
});
