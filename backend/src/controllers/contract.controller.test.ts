import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { authHeader, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";

describe("POST /api/contracts", () => {
  beforeEach(() => {
    // Contrat démarrant "aujourd'hui" : au moins la facture du mois courant
    // doit être générée automatiquement à la création.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 1));
  });

  it("crée un contrat, génère ses factures et passe le bien en OCCUPIED", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { status: "AVAILABLE" });
    const tenant = await createTenant(manager.id);
    const token = tokenFor(manager);

    const res = await request(app)
      .post("/api/contracts")
      .set(authHeader(token))
      .send({
        propertyId: property.id,
        tenantId: tenant.id,
        rent: 500,
        deposit: 1000,
        startDate: "2026-06-01",
        endDate: "2027-05-31",
      });

    expect(res.status).toBe(201);
    expect(res.body.property.id).toBe(property.id);
    expect(res.body.tenant.id).toBe(tenant.id);
    expect(res.body.invoices.length).toBeGreaterThanOrEqual(1);

    const propertyRes = await request(app)
      .get(`/api/properties/${property.id}`)
      .set(authHeader(token));
    expect(propertyRes.body.status).toBe("OCCUPIED");
  });

  it("refuse de créer un contrat sur un bien appartenant à un autre gestionnaire", async () => {
    const managerA = await createManager();
    const managerB = await createManager();
    const propertyOfA = await createProperty(managerA.id);
    const tenantOfB = await createTenant(managerB.id);
    const tokenB = tokenFor(managerB);

    const res = await request(app)
      .post("/api/contracts")
      .set(authHeader(tokenB))
      .send({
        propertyId: propertyOfA.id,
        tenantId: tenantOfB.id,
        rent: 500,
        deposit: 1000,
        startDate: "2026-06-01",
        endDate: "2027-05-31",
      });

    expect(res.status).toBe(404);
  });

  it("refuse de créer un contrat actif qui chevauche un contrat actif existant sur le même bien", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant1 = await createTenant(manager.id);
    const tenant2 = await createTenant(manager.id);
    const token = tokenFor(manager);

    const first = await request(app)
      .post("/api/contracts")
      .set(authHeader(token))
      .send({
        propertyId: property.id,
        tenantId: tenant1.id,
        rent: 500,
        deposit: 1000,
        startDate: "2026-06-01",
        endDate: "2027-05-31",
      });
    expect(first.status).toBe(201);

    const overlapping = await request(app)
      .post("/api/contracts")
      .set(authHeader(token))
      .send({
        propertyId: property.id,
        tenantId: tenant2.id,
        rent: 600,
        deposit: 1200,
        startDate: "2026-09-01",
        endDate: "2027-08-31",
      });
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error).toContain("contrat actif");
  });
});

describe("GET /api/contracts/:id — isolation entre gestionnaires", () => {
  it("renvoie 404 si le contrat appartient à un autre gestionnaire", async () => {
    const managerA = await createManager();
    const managerB = await createManager();
    const propertyOfA = await createProperty(managerA.id);
    const tenantOfA = await createTenant(managerA.id);
    const tokenA = tokenFor(managerA);
    const tokenB = tokenFor(managerB);

    const createRes = await request(app)
      .post("/api/contracts")
      .set(authHeader(tokenA))
      .send({
        propertyId: propertyOfA.id,
        tenantId: tenantOfA.id,
        rent: 500,
        deposit: 1000,
        startDate: "2026-06-01",
        endDate: "2027-05-31",
      });
    expect(createRes.status).toBe(201);
    const contractId = createRes.body.id;

    const asOwner = await request(app).get(`/api/contracts/${contractId}`).set(authHeader(tokenA));
    expect(asOwner.status).toBe(200);

    const asOther = await request(app).get(`/api/contracts/${contractId}`).set(authHeader(tokenB));
    expect(asOther.status).toBe(404);
  });
});
