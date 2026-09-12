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

describe("GET /api/documents/receipt/:invoiceId", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/documents/receipt/whatever");
    expect(res.status).toBe(401);
  });

  it("renvoie 404 si la facture n'existe pas", async () => {
    const manager = await createManager();
    const res = await request(app)
      .get("/api/documents/receipt/introuvable")
      .set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(404);
  });

  it("autorise le gestionnaire propriétaire du bien à récupérer la quittance", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { status: "PAID", paidAt: new Date() });

    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.type).toContain("text/html");
    expect(res.text).toContain(tenant.firstName);
  });

  it("refuse l'accès à un gestionnaire qui n'est pas propriétaire du bien", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id);

    const otherManager = await createManager();
    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(403);
  });

  it("autorise le locataire concerné à récupérer sa propre quittance", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { status: "PAID", paidAt: new Date() });

    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(tokenFor({ id: "tenant-user", role: "TENANT" }, tenant.id)));

    expect(res.status).toBe(200);
  });

  it("refuse l'accès à un autre locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id);

    const otherTenant = await createTenant(manager.id);
    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(tokenFor({ id: "other-user", role: "TENANT" }, otherTenant.id)));

    expect(res.status).toBe(403);
  });

  it("refuse de générer une quittance pour une facture impayée (statut PENDING)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { status: "PENDING" });

    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("PAID");
  });
});

describe("GET /api/documents/lease/:contractId", () => {
  it("renvoie 404 si le contrat n'existe pas", async () => {
    const manager = await createManager();
    const res = await request(app)
      .get("/api/documents/lease/introuvable")
      .set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(404);
  });

  it("autorise le gestionnaire propriétaire du bien à récupérer le bail", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .get(`/api/documents/lease/${contract.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.type).toContain("text/html");
  });

  it("refuse l'accès à un gestionnaire qui n'est pas propriétaire du bien", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const otherManager = await createManager();
    const res = await request(app)
      .get(`/api/documents/lease/${contract.id}`)
      .set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(403);
  });

  it("autorise le locataire concerné à récupérer son propre bail", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .get(`/api/documents/lease/${contract.id}`)
      .set(authHeader(tokenFor({ id: "tenant-user", role: "TENANT" }, tenant.id)));

    expect(res.status).toBe(200);
  });

  it("refuse l'accès à un autre locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const otherTenant = await createTenant(manager.id);
    const res = await request(app)
      .get(`/api/documents/lease/${contract.id}`)
      .set(authHeader(tokenFor({ id: "other-user", role: "TENANT" }, otherTenant.id)));

    expect(res.status).toBe(403);
  });
});

describe("GET /api/documents/lease-scan/:contractId", () => {
  it("renvoie 404 si le contrat n'a pas de scan papier", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .get(`/api/documents/lease-scan/${contract.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(404);
  });

  it("renvoie l'URL signée pour le gestionnaire propriétaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      scannedContractUrl: "contracts/test-scan.pdf",
    } as any);

    const res = await request(app)
      .get(`/api/documents/lease-scan/${contract.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
  });

  it("renvoie l'URL signée pour le locataire du contrat", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      scannedContractUrl: "contracts/test-scan.pdf",
    } as any);

    const res = await request(app)
      .get(`/api/documents/lease-scan/${contract.id}`)
      .set(authHeader(tokenFor({ id: "tenant-user", role: "TENANT" }, tenant.id)));

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
  });

  it("refuse l'accès à un gestionnaire tiers", async () => {
    const managerA = await createManager();
    const managerB = await createManager();
    const property = await createProperty(managerA.id);
    const tenant = await createTenant(managerA.id);
    const contract = await createContract(property.id, tenant.id, {
      scannedContractUrl: "contracts/test-scan.pdf",
    } as any);

    const res = await request(app)
      .get(`/api/documents/lease-scan/${contract.id}`)
      .set(authHeader(tokenFor(managerB)));

    expect(res.status).toBe(403);
  });
});

