import { describe, expect, it } from "vitest";
import type { DashboardStats } from "../types";
import { actionsATraiter, csvSixMois, moisCourantEtPrecedent, resteAEncaisser, syntheseDuMois } from "./syntheseGestionnaire";

function stats(surcharge: Partial<DashboardStats> = {}): DashboardStats {
  return {
    totalProperties: 4,
    propertiesByStatus: { AVAILABLE: 0, OCCUPIED: 4, MAINTENANCE: 0 },
    totalTenants: 4,
    activeContracts: 4,
    occupancyRate: 100,
    monthlyRevenueByCurrency: { EUR: 1000 },
    monthlyExpectedByCurrency: { EUR: 1000 },
    openIssues: 0,
    lateInvoices: 0,
    revenueByMonth: {},
    expensesByMonth: {},
    ...surcharge,
  };
}

describe("moisCourantEtPrecedent", () => {
  it("passe l'année en janvier", () => {
    expect(moisCourantEtPrecedent(new Date(2027, 0, 15))).toEqual({ courant: "2027-01", precedent: "2026-12" });
  });
});

describe("resteAEncaisser", () => {
  it("ne garde que les devises où il manque de l'argent", () => {
    expect(
      resteAEncaisser(stats({ monthlyRevenueByCurrency: { EUR: 400, XOF: 100000 }, monthlyExpectedByCurrency: { EUR: 1000, XOF: 100000 } }))
    ).toEqual({ EUR: 600 });
  });

  it("ignore un surplus (acompte sur un autre mois)", () => {
    expect(resteAEncaisser(stats({ monthlyRevenueByCurrency: { EUR: 1200 } }))).toEqual({});
  });
});

describe("actionsATraiter", () => {
  it("renvoie une liste vide quand tout est à jour", () => {
    expect(actionsATraiter(stats())).toEqual([]);
  });

  it("signale les sorties à préparer (congés en cours), sans les dire urgentes, après les impayés et les incidents", () => {
    const actions = actionsATraiter(stats({ lateInvoices: 1, openIssues: 1, upcomingExits: 2 }));
    expect(actions.map((a) => a.cle)).toEqual(["late", "issues", "exits"]);
    expect(actions[2]).toEqual({ cle: "exits", compte: 2, lien: "/contracts", urgent: false });
    expect(actionsATraiter(stats({ upcomingExits: 0 }))).toEqual([]);
  });

  it("ajoute les échéances de l'agenda : les dépassées (urgentes, après les incidents) et celles de la semaine (information)", () => {
    const actions = actionsATraiter(stats({ lateInvoices: 1, openIssues: 1, upcomingExits: 1, agendaOverdueOther: 2, agendaSoon: 4 }));
    expect(actions.map((a) => a.cle)).toEqual(["late", "issues", "agendaOverdue", "exits", "agendaSoon"]);
    expect(actions[2]).toEqual({ cle: "agendaOverdue", compte: 2, lien: "/agenda", urgent: true });
    expect(actions[4]).toEqual({ cle: "agendaSoon", compte: 4, lien: "/agenda", urgent: false });
    expect(actionsATraiter(stats({ agendaOverdueOther: 0, agendaSoon: 0 }))).toEqual([]);
  });

  it("range les urgences avant les informations", () => {
    const actions = actionsATraiter(
      stats({
        lateInvoices: 2,
        openIssues: 3,
        monthlyRevenueByCurrency: { EUR: 200 },
        propertiesByStatus: { AVAILABLE: 1, OCCUPIED: 2, MAINTENANCE: 1 },
      })
    );
    expect(actions.map((a) => a.cle)).toEqual(["late", "issues", "remaining", "vacant", "maintenance"]);
    expect(actions.filter((a) => a.urgent).map((a) => a.cle)).toEqual(["late", "issues"]);
    expect(actions.find((a) => a.cle === "late")).toMatchObject({ compte: 2, lien: "/invoices" });
  });
});

describe("syntheseDuMois", () => {
  const maintenant = new Date(2026, 7, 20);

  it("calcule taux, reste, net et variation par devise", () => {
    const [eur] = syntheseDuMois(
      stats({
        monthlyRevenueByCurrency: { EUR: 1500 },
        monthlyExpectedByCurrency: { EUR: 2000 },
        revenueByMonth: { "2026-07": { EUR: 1000 } },
        expensesByMonth: { "2026-08": { EUR: 300 } },
      }),
      maintenant
    );
    expect(eur).toEqual({ currency: "EUR", encaisse: 1500, attendu: 2000, reste: 500, taux: 75, depenses: 300, net: 1200, variation: 50 });
  });

  it("garde chaque devise sur sa ligne, triées", () => {
    const lignes = syntheseDuMois(
      stats({ monthlyRevenueByCurrency: { XOF: 450000 }, monthlyExpectedByCurrency: { EUR: 600 }, expensesByMonth: { "2026-08": { XOF: 80000 } } }),
      maintenant
    );
    expect(lignes.map((l) => l.currency)).toEqual(["EUR", "XOF"]);
    expect(lignes[1]).toMatchObject({ encaisse: 450000, depenses: 80000, net: 370000 });
  });

  it("laisse taux et variation vides quand il n'y a rien à comparer", () => {
    const [ligne] = syntheseDuMois(stats({ monthlyRevenueByCurrency: { EUR: 0 }, monthlyExpectedByCurrency: {} }), maintenant);
    expect(ligne.taux).toBeNull();
    expect(ligne.variation).toBeNull();
  });
});

describe("csvSixMois", () => {
  it("écrit un montant français par ligne, net compris", () => {
    const csv = csvSixMois([{ month: "2026-08", currency: "EUR", revenue: 1234.5, expense: 34.5 }], {
      month: "Mois",
      currency: "Devise",
      revenue: "Revenus",
      expense: "Dépenses",
      net: "Net",
    });
    expect(csv.split("\n")).toEqual(["﻿\"Mois\";\"Devise\";\"Revenus\";\"Dépenses\";\"Net\"", "\"2026-08\";\"EUR\";1234,50;34,50;1200,00"]);
  });
});
