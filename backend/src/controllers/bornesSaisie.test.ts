import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { lireNombre } from "../utils/csvImport";

/**
 * Bornes de saisie des biens, locataires et contrats, à la main et par import CSV :
 * un nombre infini (« 1e999 » devient Infinity après coercition) ou une date de l'an 1
 * ne doivent jamais atteindre la base ni la génération des factures.
 */
async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  return { manager, h: authHeader(tokenFor(manager)) };
}

describe("lireNombre", () => {
  it("refuse un entier si long qu'il vaut l'infini", () => {
    expect(lireNombre("9".repeat(400))).toBeNull();
  });
});

describe("création d'un bien", () => {
  const base = { title: "Studio A", address: "12 rue des Écoles", surface: 28, rent: 250000 };

  it.each([
    ["loyer infini", { rent: "1e999" }],
    ["loyer au-delà du plafond", { rent: 2e12 }],
    ["surface infinie", { surface: "1e999" }],
    ["surface au-delà du plafond", { surface: 10_000_000 }],
    ["titre démesuré", { title: "T".repeat(201) }],
    ["adresse démesurée", { address: "A".repeat(301) }],
    ["description démesurée", { description: "D".repeat(5001) }],
  ])("refuse %s", async (_nom, surcharge) => {
    const { h } = await agence();
    const res = await request(app).post("/api/properties").set(h).send({ ...base, ...surcharge });
    expect(res.status).toBe(400);
  });
});

describe("création d'un locataire", () => {
  const base = { firstName: "Moussa", lastName: "Diop", phone: "+221771234567", email: "moussa@example.com" };

  it.each([
    ["prénom démesuré", { firstName: "P".repeat(101) }],
    ["nom démesuré", { lastName: "N".repeat(101) }],
    ["email démesuré", { email: `${"a".repeat(250)}@example.com` }],
  ])("refuse %s", async (_nom, surcharge) => {
    const { h } = await agence();
    const res = await request(app).post("/api/tenants").set(h).send({ ...base, ...surcharge });
    expect(res.status).toBe(400);
  });
});

describe("création d'un contrat", () => {
  async function pieces() {
    const { manager, h } = await agence();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    return { h, base: { propertyId: property.id, tenantId: tenant.id, rent: 500, deposit: 1000, startDate: "2026-01-01", endDate: "2027-01-01" } };
  }

  it.each([
    ["loyer infini", { rent: "1e999" }],
    ["dépôt infini", { deposit: "1e999" }],
    ["loyer au-delà du plafond", { rent: 2e12 }],
    ["début l'an 1 (des milliers de factures)", { startDate: "0001-01-01" }],
    ["fin dans plus de 100 ans", { endDate: "2300-01-01" }],
  ])("refuse %s", async (_nom, surcharge) => {
    const { h, base } = await pieces();
    const res = await request(app).post("/api/contracts").set(h).send({ ...base, ...surcharge });
    expect(res.status).toBe(400);
  });

  it("refuse aussi ces valeurs à la modification", async () => {
    const { manager, h } = await agence();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const res = await request(app).put(`/api/contracts/${contract.id}`).set(h).send({ rent: "1e999" });
    expect(res.status).toBe(400);
  });
});

describe("import CSV", () => {
  const apercu = (h: Record<string, string>, type: string, csv: string) => request(app).post("/api/import/preview").set(h).send({ type, csv });

  it("signale en erreur un bien au loyer infini, démesuré, ou au titre trop long", async () => {
    const { h } = await agence();
    const csv = [
      "titre;adresse;surface;loyer",
      `Studio A;12 rue des Écoles;28;${"9".repeat(400)}`,
      "Studio B;12 rue des Écoles;28;2000000000000",
      `${"T".repeat(201)};12 rue des Écoles;28;250000`,
      "Studio D;12 rue des Écoles;28;250000",
    ].join("\n");
    const res = await apercu(h, "properties", csv);
    expect(res.status).toBe(200);
    expect(res.body.lignes.map((l: { statut: string }) => l.statut)).toEqual(["ERREUR", "ERREUR", "ERREUR", "OK"]);
  });

  it("signale en erreur un locataire aux noms ou à l'email démesurés", async () => {
    const { h } = await agence();
    const csv = [
      "prenom;nom;telephone;email",
      `${"P".repeat(101)};Diop;+221771234567;a@example.com`,
      `Moussa;${"N".repeat(101)};+221771234568;b@example.com`,
      `Moussa;Diop;+221771234569;${"a".repeat(250)}@example.com`,
      "Moussa;Diop;+221771234570;d@example.com",
    ].join("\n");
    const res = await apercu(h, "tenants", csv);
    expect(res.body.lignes.map((l: { statut: string }) => l.statut)).toEqual(["ERREUR", "ERREUR", "ERREUR", "OK"]);
  });

  it("signale en erreur un contrat au loyer démesuré ou aux dates hors bornes", async () => {
    const { manager, h } = await agence();
    await createProperty(manager.id, { title: "Studio A" });
    await createTenant(manager.id, { email: "moussa@example.com" });
    const csv = [
      "bien;email_locataire;loyer;depot;debut;fin",
      "Studio A;moussa@example.com;2000000000000;0;01/01/2026;01/01/2027",
      "Studio A;moussa@example.com;500;0;01/01/1000;01/01/2027",
      "Studio A;moussa@example.com;500;0;01/01/2026;01/01/2300",
      "Studio A;moussa@example.com;500;0;01/01/2026;01/01/2027",
    ].join("\n");
    const res = await apercu(h, "contracts", csv);
    expect(res.body.lignes.map((l: { statut: string }) => l.statut)).toEqual(["ERREUR", "ERREUR", "ERREUR", "OK"]);
  });
});
