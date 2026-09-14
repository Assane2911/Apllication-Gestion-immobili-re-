import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, invoices, properties, users } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// PNG 1x1 valide encodé en base64, pour satisfaire le format attendu par signContractSchema.
const SIGNATURE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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

describe("DELETE /api/contracts/:id", () => {
  // Régression : contrairement à deleteProperty/deleteTenant, cette route ne
  // vérifiait jusqu'ici RIEN avant de supprimer. Un contrat ACTIVE (locataire
  // en place) pouvait être effacé — factures PAID comprises — et le bien
  // repassait "AVAILABLE" sans aucune procédure de résiliation. Cela
  // contournait aussi les garde-fous de deleteProperty/deleteTenant, qui
  // refusent tant qu'un contrat existe : il suffisait de supprimer le contrat
  // ici (sans frein) puis le bien ou le locataire devenu "libre".
  it("refuse de supprimer un contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id); // status ACTIVE par défaut

    const res = await request(app).delete(`/api/contracts/${contract.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
    const stillThere = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(stillThere).toHaveLength(1);
  });

  it("refuse de supprimer un contrat clos ayant une facture déjà réglée", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { status: "ENDED" });
    await createInvoice(contract.id, { status: "PAID" });

    const res = await request(app).delete(`/api/contracts/${contract.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
    const stillThere = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(stillThere).toHaveLength(1);
  });

  it("refuse de supprimer un contrat clos ayant une facture en retard", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { status: "ENDED" });
    await createInvoice(contract.id, { status: "LATE" });

    const res = await request(app).delete(`/api/contracts/${contract.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
  });

  it("supprime un contrat clos sans facture réglée (factures en attente/annulées comprises)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { status: "ENDED" });
    await createInvoice(contract.id, { status: "CANCELLED" });

    const res = await request(app).delete(`/api/contracts/${contract.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    const remaining = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(remaining).toHaveLength(0);
    const remainingInvoices = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    expect(remainingInvoices).toHaveLength(0);
  });

  it("refuse de supprimer le contrat d'un autre gestionnaire", async () => {
    const managerA = await createManager();
    const managerB = await createManager();
    const property = await createProperty(managerA.id);
    const tenant = await createTenant(managerA.id);
    const contract = await createContract(property.id, tenant.id, { status: "ENDED" });

    const res = await request(app).delete(`/api/contracts/${contract.id}`).set(authHeader(tokenFor(managerB)));

    expect(res.status).toBe(404);
  });
});

describe("POST /api/contracts/:id/scan", () => {
  it("permet au gestionnaire d'uploader un scan papier de contrat", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const token = tokenFor(manager);

    const contractRes = await request(app)
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
    const contractId = contractRes.body.id;

    const res = await request(app)
      .post(`/api/contracts/${contractId}/scan`)
      .set(authHeader(token))
      .attach("scan", Buffer.from("%PDF-1.4 test contract"), {
        filename: "contrat-signe.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(200);
    expect(res.body.scannedContractUrl).toBeDefined();
  });

  it("refuse l'upload à un gestionnaire non propriétaire", async () => {
    const managerA = await createManager();
    const managerB = await createManager();
    const property = await createProperty(managerA.id);
    const tenant = await createTenant(managerA.id);

    const contractRes = await request(app)
      .post("/api/contracts")
      .set(authHeader(tokenFor(managerA)))
      .send({
        propertyId: property.id,
        tenantId: tenant.id,
        rent: 500,
        deposit: 1000,
        startDate: "2026-06-01",
        endDate: "2027-05-31",
      });
    const contractId = contractRes.body.id;

    const res = await request(app)
      .post(`/api/contracts/${contractId}/scan`)
      .set(authHeader(tokenFor(managerB)))
      .attach("scan", Buffer.from("%PDF-1.4 test contract"), {
        filename: "contrat-signe.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(403);
  });
});

/**
 * Régression : contrairement à createContract, updateContract ne revalidait
 * ni l'ordre des dates, ni les chevauchements avec un autre contrat ACTIF du
 * même bien, ni l'occupation réelle du ou des biens concernés — un contrat
 * pouvait ainsi, après modification, chevaucher un autre bail actif sur le
 * même bien (double location silencieuse) sans qu'aucune requête ne le
 * détecte, et un bien pouvait rester à tort OCCUPIED ou AVAILABLE après un
 * changement de bien ou une réactivation.
 */
describe("PUT /api/contracts/:id — revalidation", () => {
  it("rejette une date de fin antérieure ou égale à la date de début", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2027, 0, 1),
      status: "ACTIVE",
    });

    const res = await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ endDate: "2025-06-01" });

    expect(res.status).toBe(400);
  });

  it("refuse d'étendre les dates d'un contrat actif si elles chevauchent alors un autre contrat actif du même bien", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenantA = await createTenant(manager.id);
    const tenantB = await createTenant(manager.id);
    await createContract(property.id, tenantA.id, {
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2026, 5, 1),
      status: "ACTIVE",
    });
    const contractB = await createContract(property.id, tenantB.id, {
      startDate: new Date(2026, 6, 1),
      endDate: new Date(2027, 0, 1),
      status: "ACTIVE",
    });

    // On étend le début de B pour qu'il chevauche désormais A.
    const res = await request(app)
      .put(`/api/contracts/${contractB.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ startDate: "2026-03-01" });

    expect(res.status).toBe(409);
  });

  it("refuse de déplacer un contrat actif vers un bien déjà loué sur la même période", async () => {
    const manager = await createManager();
    const propertyA = await createProperty(manager.id, { status: "OCCUPIED" });
    const propertyB = await createProperty(manager.id, { status: "OCCUPIED" });
    const tenantA = await createTenant(manager.id);
    const tenantB = await createTenant(manager.id);
    const contractA = await createContract(propertyA.id, tenantA.id, { status: "ACTIVE" });
    await createContract(propertyB.id, tenantB.id, { status: "ACTIVE" }); // mêmes dates par défaut

    const res = await request(app)
      .put(`/api/contracts/${contractA.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ propertyId: propertyB.id });

    expect(res.status).toBe(409);
  });

  it("libère l'ancien bien et occupe le nouveau quand un contrat actif change de bien", async () => {
    const manager = await createManager();
    const propertyA = await createProperty(manager.id, { status: "OCCUPIED" });
    const propertyB = await createProperty(manager.id); // AVAILABLE
    const tenant = await createTenant(manager.id);
    const contract = await createContract(propertyA.id, tenant.id, { status: "ACTIVE" });

    const res = await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ propertyId: propertyB.id });

    expect(res.status).toBe(200);

    const [apresA] = await testDb.select().from(properties).where(eq(properties.id, propertyA.id));
    const [apresB] = await testDb.select().from(properties).where(eq(properties.id, propertyB.id));
    expect(apresA.status).toBe("AVAILABLE");
    expect(apresB.status).toBe("OCCUPIED");
  });

  it("réoccupe le bien quand un contrat terminé est réactivé (ENDED -> ACTIVE)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id); // AVAILABLE
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { status: "ENDED" });

    const res = await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "ACTIVE" });

    expect(res.status).toBe(200);

    const [apres] = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(apres.status).toBe("OCCUPIED");
  });

  // Régression : updateProperty refuse déjà de changer la devise d'un bien
  // tant qu'un contrat actif existe, précisément parce que les factures déjà
  // émises restent figées dans l'ancienne devise (elles héritent du CONTRAT,
  // jamais du bien). Ce même garde-fou n'existait pas au niveau du contrat.
  it("refuse de changer la devise d'un contrat ayant déjà des factures", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { currency: "EUR" });
    await createInvoice(contract.id, { currency: "EUR", status: "PENDING" });

    const res = await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ currency: "XOF" });

    expect(res.status).toBe(409);
    const [inchangé] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(inchangé.currency).toBe("EUR");
  });

  it("autorise le changement de devise tant qu'aucune facture (autre qu'annulée) n'existe", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { currency: "EUR" });
    await createInvoice(contract.id, { currency: "EUR", status: "CANCELLED" });

    const res = await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ currency: "XOF" });

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("XOF");
  });
});

describe("POST /api/contracts/:id/sign", () => {
  it("permet au locataire du contrat de signer", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/sign`)
      .set(authHeader(tokenFor({ id: "peu-importe", role: "TENANT" }, tenant.id)))
      .send({ signatureDataUrl: SIGNATURE_DATA_URL });

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(apres.signedByTenantAt).not.toBeNull();
  });

  it("permet au gestionnaire propriétaire du bien de signer", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/sign`)
      .set(authHeader(tokenFor(manager)))
      .send({ signatureDataUrl: SIGNATURE_DATA_URL });

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(apres.signedByManagerAt).not.toBeNull();
  });

  /**
   * Régression : la branche `else` ne vérifiait que
   * `property.managerId === req.user.userId`, jamais le rôle réel. Un
   * compte ADMIN promu depuis un ancien compte MANAGER
   * (scripts/createAdmin.ts conserve le même id utilisateur lors de la
   * promotion) tombait dans cette branche comme s'il était toujours
   * gestionnaire, et pouvait signer à sa place le contrat d'un de ses
   * anciens biens.
   */
  it("refuse même quand l'id de l'admin correspond à un ancien managerId", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    // Simule scripts/createAdmin.ts : promotion d'un compte existant vers
    // ADMIN par UPDATE, qui conserve le même id utilisateur.
    await testDb.update(users).set({ role: "ADMIN" }).where(eq(users.id, manager.id));

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/sign`)
      .set(authHeader(tokenFor({ id: manager.id, role: "ADMIN" })))
      .send({ signatureDataUrl: SIGNATURE_DATA_URL });

    expect(res.status).toBe(403);
    const [apres] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(apres.signedByManagerAt).toBeNull();
  });

  it("refuse à un locataire de signer le contrat d'un autre locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const autreTenant = await createTenant(manager.id);

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/sign`)
      .set(authHeader(tokenFor({ id: "peu-importe", role: "TENANT" }, autreTenant.id)))
      .send({ signatureDataUrl: SIGNATURE_DATA_URL });

    expect(res.status).toBe(403);
  });
});

