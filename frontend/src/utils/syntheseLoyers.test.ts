import { describe, expect, it } from "vitest";
import type { Contract, Invoice } from "../types";
import { avancementBail, csvBaux, csvFactures, finProche, joursDeRetard, signatureEnAttente, syntheseBaux, syntheseFactures, trierBaux } from "./syntheseLoyers";

function facture(surcharge: Partial<Invoice> = {}): Invoice {
  return { id: "f", contractId: "c", periodMonth: 6, periodYear: 2026, amount: 500, currency: "EUR", dueDate: "2026-06-05T00:00:00.000Z", status: "PENDING", ...surcharge };
}

function bail(surcharge: Partial<Contract> = {}): Contract {
  return {
    id: "c",
    propertyId: "p",
    tenantId: "t",
    rent: 600,
    deposit: 1200,
    currency: "EUR",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-12-31T00:00:00.000Z",
    status: "ACTIVE",
    signedByManagerAt: "2026-01-01T00:00:00.000Z",
    signedByTenantAt: "2026-01-01T00:00:00.000Z",
    ...surcharge,
  } as Contract;
}

describe("joursDeRetard", () => {
  const maintenant = new Date(2026, 5, 20);
  it("compte les jours depuis l'échéance d'une facture due", () => {
    expect(joursDeRetard(facture({ status: "LATE" }), maintenant)).toBe(15);
  });
  it("renvoie 0 avant l'échéance, ou pour une facture soldée ou annulée", () => {
    expect(joursDeRetard(facture({ dueDate: "2026-06-25T00:00:00.000Z" }), maintenant)).toBe(0);
    expect(joursDeRetard(facture({ status: "PAID" }), maintenant)).toBe(0);
    expect(joursDeRetard(facture({ status: "CANCELLED" }), maintenant)).toBe(0);
  });
});

describe("syntheseFactures", () => {
  it("calcule reste dû, retard et taux de recouvrement par devise, acomptes déduits, annulations ignorées", () => {
    const s = syntheseFactures([
      facture({ id: "1", status: "PAID", amount: 500 }),
      facture({ id: "2", status: "LATE", amount: 500, montantRegle: 100, resteDu: 400 }),
      facture({ id: "3", status: "PENDING", amount: 500 }),
      facture({ id: "4", status: "CANCELLED", amount: 500 }),
      facture({ id: "5", status: "PENDING", amount: 300000, currency: "XOF" }),
    ]);
    expect(s).toEqual([
      { currency: "EUR", resteADu: 900, enRetard: 400, nbEnRetard: 1, encaisse: 600, tauxRecouvrement: 40 },
      { currency: "XOF", resteADu: 300000, enRetard: 0, nbEnRetard: 0, encaisse: 0, tauxRecouvrement: 0 },
    ]);
  });
  it("ne renvoie rien sans facture", () => {
    expect(syntheseFactures([])).toEqual([]);
  });
});

describe("csvFactures", () => {
  it("écrit période, montants à virgule et reste dû", () => {
    const csv = csvFactures(
      [facture({ status: "LATE", montantRegle: 100, resteDu: 400, contract: { tenant: { firstName: "Awa", lastName: "Diallo" }, property: { title: "Studio" } } as Invoice["contract"] })],
      { period: "Période", tenant: "Locataire", property: "Bien", currency: "Devise", amount: "Montant", paid: "Réglé", remaining: "Reste dû", dueDate: "Échéance", status: "Statut" },
      () => "En retard"
    );
    expect(csv.split("\n")[1]).toBe('"2026-06";"Awa Diallo";"Studio";"EUR";500,00;100,00;400,00;"2026-06-05";"En retard"');
  });
});

describe("avancementBail", () => {
  it("donne la part de durée écoulée et les jours restants", () => {
    const a = avancementBail("2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z", new Date(2026, 0, 16));
    expect(a).toEqual({ pourcentage: 50, joursRestants: 15, dureeJours: 30 });
  });
  it("borne entre 0 et 100", () => {
    expect(avancementBail("2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z", new Date(2025, 11, 1)).pourcentage).toBe(0);
    expect(avancementBail("2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z", new Date(2026, 5, 1)).pourcentage).toBe(100);
  });
});

describe("baux", () => {
  const maintenant = new Date(2026, 10, 1);
  it("détecte fin proche et signature en attente, sur les seuls baux actifs", () => {
    expect(finProche(bail({ endDate: "2026-12-15T00:00:00.000Z" }), maintenant)).toBe(true);
    expect(finProche(bail({ endDate: "2027-06-15T00:00:00.000Z" }), maintenant)).toBe(false);
    expect(finProche(bail({ endDate: "2026-12-15T00:00:00.000Z", status: "ENDED" }), maintenant)).toBe(false);
    expect(signatureEnAttente(bail({ signedByTenantAt: null }))).toBe(true);
    expect(signatureEnAttente(bail())).toBe(false);
    expect(signatureEnAttente(bail({ signedByTenantAt: null, status: "TERMINATED" }))).toBe(false);
  });

  it("résume les baux actifs par devise", () => {
    const s = syntheseBaux(
      [bail({ id: "a", endDate: "2027-06-30T00:00:00.000Z" }), bail({ id: "b", rent: 400, endDate: "2026-12-10T00:00:00.000Z", signedByManagerAt: null }), bail({ id: "c", currency: "XOF", rent: 300000, endDate: "2027-06-30T00:00:00.000Z" }), bail({ id: "d", status: "ENDED" })],
      maintenant
    );
    expect(s).toEqual({
      actifs: 3,
      loyers: [
        { currency: "EUR", total: 1000 },
        { currency: "XOF", total: 300000 },
      ],
      finsProches: 1,
      signaturesEnAttente: 1,
    });
  });

  it("trie par fin la plus proche (actifs d'abord) ou par loyer décroissant", () => {
    const liste = [
      bail({ id: "a", endDate: "2027-03-01T00:00:00.000Z", rent: 500 }),
      bail({ id: "b", endDate: "2026-11-20T00:00:00.000Z", rent: 900 }),
      bail({ id: "c", endDate: "2026-01-01T00:00:00.000Z", status: "ENDED", rent: 700 }),
    ];
    expect(trierBaux(liste, "fin").map((c) => c.id)).toEqual(["b", "a", "c"]);
    expect(trierBaux(liste, "loyerDesc").map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(trierBaux(liste, "recent").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("exporte les baux avec les signatures", () => {
    const csv = csvBaux(
      [bail({ property: { title: "Villa" }, tenant: { firstName: "Awa", lastName: "Diallo" }, signedByTenantAt: null } as Partial<Contract>)],
      { property: "Bien", tenant: "Locataire", rent: "Loyer", currency: "Devise", start: "Début", end: "Fin", status: "Statut", agencySigned: "Signé agence", tenantSigned: "Signé locataire", yes: "Oui", no: "Non" },
      () => "Actif"
    );
    expect(csv.split("\n")[1]).toBe('"Villa";"Awa Diallo";600,00;"EUR";"2026-01-01";"2026-12-31";"Actif";"Oui";"Non"');
  });
});
