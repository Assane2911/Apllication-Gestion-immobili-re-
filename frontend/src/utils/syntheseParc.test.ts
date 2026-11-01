import { describe, expect, it } from "vitest";
import type { Owner, Property, Tenant } from "../types";
import { csvBiens, csvLocataires, csvProprietaires, loyerAuM2, nomProprietaire, syntheseBiens, trierBiens } from "./syntheseParc";

function bien(surcharge: Partial<Property> = {}): Property {
  return {
    id: "b1",
    title: "Studio",
    address: "1 rue de la Paix",
    surface: 30,
    rent: 600,
    currency: "EUR",
    status: "AVAILABLE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...surcharge,
  };
}

describe("loyerAuM2", () => {
  it("rapporte le loyer à la surface", () => {
    expect(loyerAuM2(600, 30)).toBe(20);
  });
  it("renvoie null sans surface", () => {
    expect(loyerAuM2(600, 0)).toBeNull();
  });
});

describe("syntheseBiens", () => {
  it("compte les statuts et le taux d'occupation", () => {
    const s = syntheseBiens([bien({ status: "OCCUPIED" }), bien({ status: "OCCUPIED" }), bien({ status: "AVAILABLE" }), bien({ status: "MAINTENANCE" })]);
    expect(s.parStatut).toEqual({ AVAILABLE: 1, OCCUPIED: 2, MAINTENANCE: 1 });
    expect(s.tauxOccupation).toBe(50);
  });

  it("garde chaque devise séparée : loyer loué, manque à gagner et loyer moyen au m²", () => {
    const s = syntheseBiens([
      bien({ status: "OCCUPIED", rent: 800, surface: 40, currency: "EUR" }),
      bien({ status: "AVAILABLE", rent: 400, surface: 20, currency: "EUR" }),
      bien({ status: "OCCUPIED", rent: 300000, surface: 60, currency: "XOF" }),
    ]);
    expect(s.parDevise).toEqual([
      { currency: "EUR", loyerLoue: 800, manqueAGagner: 400, loyerM2Moyen: 20 },
      { currency: "XOF", loyerLoue: 300000, manqueAGagner: 0, loyerM2Moyen: 5000 },
    ]);
  });

  it("renvoie un taux nul sans bien", () => {
    expect(syntheseBiens([])).toEqual({ parStatut: { AVAILABLE: 0, OCCUPIED: 0, MAINTENANCE: 0 }, tauxOccupation: 0, parDevise: [] });
  });
});

describe("trierBiens", () => {
  const liste = [bien({ id: "a", title: "Villa", rent: 900, surface: 90 }), bien({ id: "b", title: "Atelier", rent: 300, surface: 25 }), bien({ id: "c", title: "Studio", rent: 600, surface: 30 })];
  it("trie sans modifier la liste d'origine", () => {
    expect(trierBiens(liste, "loyerAsc").map((b) => b.id)).toEqual(["b", "c", "a"]);
    expect(trierBiens(liste, "loyerDesc").map((b) => b.id)).toEqual(["a", "c", "b"]);
    expect(trierBiens(liste, "surfaceDesc").map((b) => b.id)).toEqual(["a", "c", "b"]);
    expect(trierBiens(liste, "titre").map((b) => b.id)).toEqual(["b", "c", "a"]);
    expect(trierBiens(liste, "recent").map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(liste.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });
});

describe("nomProprietaire", () => {
  it("préfère la société quand elle existe", () => {
    expect(nomProprietaire({ firstName: "Awa", lastName: "Ndiaye", companyName: "SCI Baobab" })).toBe("SCI Baobab");
    expect(nomProprietaire({ firstName: "Awa", lastName: "Ndiaye", companyName: " " })).toBe("Awa Ndiaye");
  });
});

describe("exports CSV", () => {
  it("biens : montants français, statut lisible, propriétaire nommé", () => {
    const csv = csvBiens(
      [bien({ title: 'Villa "Les Palmiers"', ownerId: "o1", status: "OCCUPIED", rent: 1234.5, surface: 50 })],
      new Map([["o1", "SCI Baobab"]]),
      { title: "Titre", address: "Adresse", surface: "Surface", rent: "Loyer", currency: "Devise", rentPerM2: "Loyer au m²", status: "Statut", owner: "Propriétaire" },
      () => "Loué"
    );
    expect(csv.split("\n")[1]).toBe('"Villa ""Les Palmiers""";"1 rue de la Paix";50,00;1234,50;"EUR";24,69;"Loué";"SCI Baobab"');
  });

  it("locataires : saute les fiches anonymisées", () => {
    const base: Tenant = { id: "t1", firstName: "Awa", lastName: "Ndiaye", phone: "+221770000000", email: "awa@exemple.com", createdAt: "2026-01-01T00:00:00.000Z", userId: "u1" };
    const csv = csvLocataires([base, { ...base, id: "t2", firstName: "X", anonymizedAt: "2026-02-01T00:00:00.000Z" }], {
      name: "Nom",
      phone: "Téléphone",
      email: "Email",
      portal: "Portail",
      reliability: "Fiabilité",
      yes: "Oui",
      no: "Non",
    });
    expect(csv.split("\n")).toHaveLength(2);
    // Le « + » d'un numéro international est neutralisé (apostrophe) : un tableur le lirait sinon comme une formule.
    expect(csv.split("\n")[1]).toBe('"Awa Ndiaye";"\'+221770000000";"awa@exemple.com";"Oui";""');
  });

  it("propriétaires : aucune donnée bancaire", () => {
    const o: Owner = { id: "o1", firstName: "Awa", lastName: "Ndiaye", email: "a@b.sn", phone: "1", managementFeeRate: 8, portalStatus: "PENDING", iban: "FR7630001007941234567890185", createdAt: "2026-01-01T00:00:00.000Z" };
    const csv = csvProprietaires([o], { name: "Nom", company: "Société", phone: "Tél", email: "Email", feeRate: "Commission", portal: "Portail" }, () => "Invité");
    expect(csv).not.toContain("FR76");
    expect(csv.split("\n")[1]).toBe('"Awa Ndiaye";"";"1";"a@b.sn";8,00;"Invité"');
  });
});

describe("aSurveiller / trierLocataires", () => {
  const base: Tenant = { id: "t", firstName: "Awa", lastName: "Ndiaye", phone: "1", email: "a@b.sn", createdAt: "2026-01-01T00:00:00.000Z" };
  const fiab = (niveau: "excellent" | "bon" | "moyen" | "risque" | "insuffisant", score: number | null, enRetardActuel = 0) => ({ score, niveau, payeATemps: 0, payeEnRetard: 0, enRetardActuel });

  it("signale un niveau moyen ou risque, ou un retard en cours", async () => {
    const { aSurveiller } = await import("./syntheseParc");
    expect(aSurveiller({ fiabilite: fiab("risque", 30) })).toBe(true);
    expect(aSurveiller({ fiabilite: fiab("moyen", 60) })).toBe(true);
    expect(aSurveiller({ fiabilite: fiab("bon", 80, 1) })).toBe(true);
    expect(aSurveiller({ fiabilite: fiab("excellent", 95) })).toBe(false);
    expect(aSurveiller({ fiabilite: fiab("insuffisant", null) })).toBe(false);
    expect(aSurveiller({})).toBe(false);
    expect(aSurveiller({ fiabilite: fiab("risque", 10), anonymizedAt: "2026-02-01T00:00:00.000Z" })).toBe(false);
  });

  it("trie par fiabilité croissante, sans score à la fin, et par nom", async () => {
    const { trierLocataires } = await import("./syntheseParc");
    const liste = [
      { ...base, id: "a", lastName: "Zongo", fiabilite: fiab("excellent", 95) },
      { ...base, id: "b", lastName: "Ba", fiabilite: fiab("insuffisant", null) },
      { ...base, id: "c", lastName: "Diop", fiabilite: fiab("risque", 20) },
    ];
    expect(trierLocataires(liste, "fiabilite").map((l) => l.id)).toEqual(["c", "a", "b"]);
    expect(trierLocataires(liste, "nom").map((l) => l.id)).toEqual(["b", "c", "a"]);
    expect(trierLocataires(liste, "recent").map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("trie les propriétaires par commission décroissante", async () => {
    const { trierProprietaires } = await import("./syntheseParc");
    const o = (id: string, managementFeeRate: number): Owner => ({ id, firstName: "A", lastName: id, email: "", phone: "", managementFeeRate, portalStatus: "NONE", createdAt: "" });
    expect(trierProprietaires([o("x", 5), o("y", 10), o("z", 8)], "commission").map((p) => p.id)).toEqual(["y", "z", "x"]);
  });
});
