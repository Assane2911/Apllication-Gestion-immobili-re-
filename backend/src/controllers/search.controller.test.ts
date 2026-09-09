import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";

describe("GET /api/search", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/search").query({ q: "Dupont" });
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app)
      .get("/api/search")
      .query({ q: "Dupont" })
      .set(authHeader(tokenFor({ id: "t1", role: "TENANT" }, "tenant-1")));
    expect(res.status).toBe(403);
  });

  it("renvoie une liste vide pour une requête trop courte", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/search").query({ q: "a" }).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });

  it("trouve un locataire par prénom", async () => {
    const manager = await createManager();
    await createTenant(manager.id, { firstName: "Amadou", lastName: "Diallo" });

    const res = await request(app).get("/api/search").query({ q: "amad" }).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const tenantResult = res.body.results.find((r: { type: string }) => r.type === "tenant");
    expect(tenantResult).toBeTruthy();
    expect(tenantResult.title).toBe("Amadou Diallo");
  });

  it("trouve un bien par titre", async () => {
    const manager = await createManager();
    await createProperty(manager.id, { title: "Villa Les Almadies" });

    const res = await request(app).get("/api/search").query({ q: "almadies" }).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const propertyResult = res.body.results.find((r: { type: string }) => r.type === "property");
    expect(propertyResult).toBeTruthy();
    expect(propertyResult.title).toBe("Villa Les Almadies");
  });

  it("trouve un contrat et une facture via le nom du locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { title: "Résidence Test" });
    const tenant = await createTenant(manager.id, { firstName: "Fatou", lastName: "Ndiaye" });
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id);

    const res = await request(app).get("/api/search").query({ q: "fatou" }).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { type: string }) => r.type === "contract")).toBe(true);
    expect(res.body.results.some((r: { type: string }) => r.type === "invoice")).toBe(true);
  });

  it("isole les résultats par gestionnaire", async () => {
    const manager = await createManager();
    const otherManager = await createManager();
    await createTenant(otherManager.id, { firstName: "Amadou", lastName: "Diallo" });

    const res = await request(app).get("/api/search").query({ q: "amad" }).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });
});
