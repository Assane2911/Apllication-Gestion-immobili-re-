import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { expenses } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createOwner,
  createOwnerPortalUser,
  createProperty,
  createTenant,
  tokenFor,
  createPortalUser,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("GET /api/crg/:ownerId (gestionnaire)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20)); // 20 septembre 2026
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calcule le CRG mensuel d'un propriétaire, commission et net à reverser inclus", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 10 });
    const property = await createProperty(manager.id, { title: "Villa Ngor", ownerId: owner.id });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { amount: 1000, status: "PAID", paidAt: new Date(2026, 8, 5) });
    await testDb.insert(expenses).values({
      propertyId: property.id,
      category: "MAINTENANCE",
      title: "Plomberie",
      amount: 100,
      expenseDate: new Date(2026, 8, 10),
    });

    const res = await request(app)
      .get(`/api/crg/${owner.id}?month=9&year=2026`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.ownerName).toBe(`${owner.firstName} ${owner.lastName}`);
    expect(res.body.managementFeeRate).toBe(10);
    expect(res.body.properties).toEqual([
      {
        propertyId: property.id,
        propertyTitle: "Villa Ngor",
        currency: "EUR",
        loyersEncaisses: 1000,
        chargesDeduites: 100,
        commission: 100,
        netAReverser: 800,
      },
    ]);
    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 1000 });
    expect(res.body.totalChargesByCurrency).toEqual({ EUR: 100 });
    expect(res.body.totalCommissionByCurrency).toEqual({ EUR: 100 });
    expect(res.body.totalNetByCurrency).toEqual({ EUR: 800 });
  });

  it("ne mélange pas les devises entre deux biens d'un même propriétaire", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 8 });

    const propertyEur = await createProperty(manager.id, { currency: "EUR", ownerId: owner.id });
    const tenantEur = await createTenant(manager.id);
    const contractEur = await createContract(propertyEur.id, tenantEur.id, { currency: "EUR" });
    await createInvoice(contractEur.id, { amount: 1000, currency: "EUR", status: "PAID", paidAt: new Date(2026, 8, 5) });

    const propertyXof = await createProperty(manager.id, { currency: "XOF", ownerId: owner.id });
    const tenantXof = await createTenant(manager.id);
    const contractXof = await createContract(propertyXof.id, tenantXof.id, { currency: "XOF" });
    await createInvoice(contractXof.id, { amount: 500000, currency: "XOF", status: "PAID", paidAt: new Date(2026, 8, 5) });

    const res = await request(app)
      .get(`/api/crg/${owner.id}?month=9&year=2026`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 1000, XOF: 500000 });
    expect(res.body.totalCommissionByCurrency).toEqual({ EUR: 80, XOF: 40000 });
    expect(res.body.totalNetByCurrency).toEqual({ EUR: 920, XOF: 460000 });
  });

  it("ne mélange pas les devises AU SEIN d'un même bien : une charge en euros n'est pas comptée en francs CFA", async () => {
    // Le cas qui faussait le reversement : la ligne d'un bien portait la
    // devise du BIEN et y additionnait tout, sans regarder la devise propre
    // de chaque loyer et de chaque charge. Une assurance de 300 EUR sur un
    // bien en FCFA était donc déduite comme 300 FCFA (~0,46 EUR) : le
    // propriétaire était payé près de 197 000 FCFA de trop. La configuration
    // est réelle, pas théorique — un contrat peut légitimement porter une
    // devise différente de celle de son bien (voir contract.controller.ts).
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 8 });
    const property = await createProperty(manager.id, { currency: "XOF", ownerId: owner.id, title: "Villa Dakar" });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { currency: "XOF" });
    await createInvoice(contract.id, { amount: 500000, currency: "XOF", status: "PAID", paidAt: new Date(2026, 8, 5) });
    await testDb.insert(expenses).values({
      propertyId: property.id,
      category: "INSURANCE",
      title: "Assurance",
      amount: 300,
      currency: "EUR",
      expenseDate: new Date(2026, 8, 10),
    });

    const res = await request(app)
      .get(`/api/crg/${owner.id}?month=9&year=2026`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);

    // Le loyer en FCFA n'est pas amputé de la charge en euros.
    const ligneXof = res.body.properties.find((p: { currency: string }) => p.currency === "XOF");
    expect(ligneXof.loyersEncaisses).toBe(500000);
    expect(ligneXof.chargesDeduites).toBe(0);
    expect(ligneXof.netAReverser).toBe(460000);

    // Et la charge en euros reste visible, dans sa propre devise.
    const ligneEur = res.body.properties.find((p: { currency: string }) => p.currency === "EUR");
    expect(ligneEur.propertyTitle).toBe("Villa Dakar");
    expect(ligneEur.chargesDeduites).toBe(300);
    expect(ligneEur.netAReverser).toBe(-300);

    // La ligne FCFA figure bien dans les totaux avec 0 charge : elle existe
    // (elle porte le loyer), elle n'a simplement aucune charge dans SA devise.
    expect(res.body.totalChargesByCurrency).toEqual({ EUR: 300, XOF: 0 });
    expect(res.body.totalNetByCurrency).toEqual({ EUR: -300, XOF: 460000 });
  });

  it("inclut un bien du propriétaire sans aucune activité ce mois-ci, à zéro", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    const activeProperty = await createProperty(manager.id, { title: "Bien Actif", ownerId: owner.id });
    const inactiveProperty = await createProperty(manager.id, { title: "Bien Inactif", ownerId: owner.id });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(activeProperty.id, tenant.id);
    await createInvoice(contract.id, { amount: 600, status: "PAID", paidAt: new Date(2026, 8, 5) });

    const res = await request(app)
      .get(`/api/crg/${owner.id}?month=9&year=2026`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.properties).toHaveLength(2);
    const inactiveLine = res.body.properties.find((p: { propertyTitle: string }) => p.propertyTitle === "Bien Inactif");
    expect(inactiveLine).toEqual({
      propertyId: inactiveProperty.id,
      propertyTitle: "Bien Inactif",
      currency: "EUR",
      loyersEncaisses: 0,
      chargesDeduites: 0,
      commission: 0,
      netAReverser: 0,
    });
  });

  it("exclut les loyers et charges d'un autre mois que celui demandé", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    const property = await createProperty(manager.id, { ownerId: owner.id });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    // Encaissé en août, ne doit pas apparaître dans le CRG de septembre.
    await createInvoice(contract.id, { amount: 500, status: "PAID", paidAt: new Date(2026, 7, 20) });

    const res = await request(app)
      .get(`/api/crg/${owner.id}?month=9&year=2026`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.properties[0].loyersEncaisses).toBe(0);
    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 0 });
  });

  it("utilise le mois et l'année en cours par défaut quand ils ne sont pas fournis", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    const property = await createProperty(manager.id, { ownerId: owner.id });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    // "Aujourd'hui" est le 20 septembre 2026 (system time simulé ci-dessus).
    await createInvoice(contract.id, { amount: 500, status: "PAID", paidAt: new Date(2026, 8, 15) });

    const res = await request(app).get(`/api/crg/${owner.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.month).toBe(9);
    expect(res.body.year).toBe(2026);
    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 500 });
  });

  it("refuse un mois hors des bornes acceptées", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);

    const res = await request(app)
      .get(`/api/crg/${owner.id}?month=13`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(400);
  });

  it("ne permet pas à un gestionnaire de consulter le CRG d'un propriétaire d'une autre agence", async () => {
    const managerA = await createManager();
    const managerB = await createManager();
    const ownerB = await createOwner(managerB.id);

    const res = await request(app)
      .get(`/api/crg/${ownerB.id}`)
      .set(authHeader(tokenFor(managerA)));

    expect(res.status).toBe(404);
  });
});

describe("GET /api/crg/mine (propriétaire)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("permet au propriétaire connecté de consulter son propre CRG", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 5 });
    const ownerUser = await createOwnerPortalUser(owner);
    const property = await createProperty(manager.id, { ownerId: owner.id });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { amount: 800, status: "PAID", paidAt: new Date(2026, 8, 5) });

    const res = await request(app)
      .get("/api/crg/mine?month=9&year=2026")
      .set(authHeader(tokenFor(ownerUser, null, owner.id)));

    expect(res.status).toBe(200);
    expect(res.body.ownerId).toBe(owner.id);
    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 800 });
    expect(res.body.totalCommissionByCurrency).toEqual({ EUR: 40 });
  });

  it("refuse l'accès à un compte sans fiche propriétaire associée", async () => {
    // `createOwnerPortalUser` RATTACHE le compte à la fiche : ce compte-là en
    // a bien une, et le jeton sans ownerId ne change plus rien puisque c'est
    // la base qui tranche. Le cas à éconduire est donc celui d'un compte
    // OWNER que rien ne rattache.
    const orphelin = await createPortalUser("OWNER");

    const res = await request(app).get("/api/crg/mine").set(authHeader(tokenFor(orphelin, null, null)));

    expect(res.status).toBe(403);
  });

  it("refuse l'accès à un gestionnaire", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/crg/mine").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(403);
  });
});

describe("GET /api/crg/:ownerId/export et /api/crg/mine/export", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exporte le CRG en HTML côté gestionnaire, avec le net à reverser et l'IBAN du propriétaire", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, {
      managementFeeRate: 10,
      iban: "FR7630006000011234567890189",
      bic: "AGRIFRPP",
    });
    const property = await createProperty(manager.id, { title: "Villa Ngor", ownerId: owner.id });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { amount: 1000, status: "PAID", paidAt: new Date(2026, 8, 5) });

    const res = await request(app)
      .get(`/api/crg/${owner.id}/export?month=9&year=2026`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("COMPTE-RENDU DE GESTION");
    expect(res.text).toContain("Villa Ngor");
    expect(res.text).toContain("FR7630006000011234567890189");
    // Le compte-rendu emploie désormais la même écriture que le reste du
    // Service (voir utils/montant.ts) : « 900 € » et non « 900 EUR ». Ce
    // n'est pas que cosmétique — les totaux cumulés y traînaient des résidus
    // de flottants imprimés tels quels au propriétaire, du type
    // « 1870.4699999999998 EUR », juste à côté de son IBAN.
    expect(res.text).toContain("900 €");
  });

  it("neutralise un titre de bien contenant du HTML (XSS stockée)", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    await createProperty(manager.id, { title: '<script>alert(1)</script>', ownerId: owner.id });

    const res = await request(app)
      .get(`/api/crg/${owner.id}/export?month=9&year=2026`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<script>alert(1)</script>");
    expect(res.text).toContain("&lt;script&gt;");
  });

  it("permet au propriétaire connecté d'exporter son propre CRG en HTML", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 10 });
    const ownerUser = await createOwnerPortalUser(owner);
    const property = await createProperty(manager.id, { title: "Villa Ngor", ownerId: owner.id });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { amount: 500, status: "PAID", paidAt: new Date(2026, 8, 5) });

    const res = await request(app)
      .get("/api/crg/mine/export?month=9&year=2026")
      .set(authHeader(tokenFor(ownerUser, null, owner.id)));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Villa Ngor");
  });

  it("ne permet pas à un propriétaire d'exporter le CRG d'un autre propriétaire de la même agence", async () => {
    const manager = await createManager();
    const ownerA = await createOwner(manager.id);
    const ownerB = await createOwner(manager.id);
    const ownerUserA = await createOwnerPortalUser(ownerA);
    await createProperty(manager.id, { title: "Bien Confidentiel B", ownerId: ownerB.id });

    // Un propriétaire n'a pas de route "/:ownerId/export" à sa disposition
    // (rôle MANAGER requis) — seule "/mine/export" existe côté portail
    // propriétaire, et elle est scopée à son propre ownerId (voir
    // authenticate/requireRole ci-dessus) : cette requête est donc refusée
    // avant même de pouvoir cibler ownerB.
    const res = await request(app)
      .get(`/api/crg/${ownerB.id}/export`)
      .set(authHeader(tokenFor(ownerUserA, null, ownerA.id)));

    expect(res.status).toBe(403);
  });
});
