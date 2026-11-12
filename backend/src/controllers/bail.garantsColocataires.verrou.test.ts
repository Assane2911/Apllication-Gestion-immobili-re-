import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contractCotenants, contractGuarantors, contracts } from "../db/schema";
import { testDb } from "../test/setupTestDb";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";

afterEach(() => vi.restoreAllMocks());

const SIGNATURE = "data:image/png;base64," + "A".repeat(60_000);
const MARQUEUR = "AAAAAAAA";

async function setup() {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  return { manager, tenant, contract, h: authHeader(tokenFor(manager)) };
}

const garantValide = { firstName: "Moussa", lastName: "Diop", phone: "+221771234567" };

/**
 * Le locataire signe le bail JUSTE avant l'écriture de la liste des garants ou des colocataires : ce que produit sa signature (sur son
 * téléphone) arrivée entre le moment où le gestionnaire a chargé le bail et celui où son enregistrement s'écrit. Déterministe, sans
 * dépendre de l'ordonnancement des requêtes. Plusieurs transactions précèdent celle-ci dans la requête (limiteurs de débit…) : on
 * reconnaît la bonne à son code, qui relit le bail sous verrou.
 */
function signatureJusteAvantLEcriture(contractId: string) {
  const origine = testDb.transaction.bind(testDb);
  let fait = false;
  return vi.spyOn(testDb, "transaction").mockImplementation((async (corps: unknown) => {
    if (!fait && String(corps).includes("bailNonSigneSousVerrou")) {
      fait = true;
      await testDb.update(contracts).set({ signedByTenantAt: new Date(), tenantSignatureUrl: "data:image/png;base64,AAAA" }).where(eq(contracts.id, contractId));
    }
    return origine(corps as never);
  }) as never);
}

describe("Garants — le verrou « bail signé » tient même si la signature arrive entre la lecture et l'écriture", () => {
  it("l'ajout d'un garant est refusé (409) et rien n'est écrit", async () => {
    const { contract, h } = await setup();
    const espion = signatureJusteAvantLEcriture(contract.id);

    const res = await request(app).post(`/api/contracts/${contract.id}/guarantors`).set(h).send(garantValide);
    espion.mockRestore();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LEASE_SIGNED_GUARANTORS_LOCKED");
    expect(await testDb.select().from(contractGuarantors).where(eq(contractGuarantors.contractId, contract.id))).toHaveLength(0);
  });

  it("la modification d'un garant est refusée (409) et ses données ne changent pas", async () => {
    const { contract, h } = await setup();
    const [garant] = await testDb.insert(contractGuarantors).values({ contractId: contract.id, firstName: "Moussa", lastName: "Diop", phone: "+221771234567" }).returning();
    const espion = signatureJusteAvantLEcriture(contract.id);

    const res = await request(app).put(`/api/contracts/${contract.id}/guarantors/${garant.id}`).set(h).send({ lastName: "Autre" });
    espion.mockRestore();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LEASE_SIGNED_GUARANTORS_LOCKED");
    expect((await testDb.select().from(contractGuarantors).where(eq(contractGuarantors.id, garant.id)))[0].lastName).toBe("Diop");
  });

  it("le retrait d'un garant est refusé (409) et le garant reste", async () => {
    const { contract, h } = await setup();
    const [garant] = await testDb.insert(contractGuarantors).values({ contractId: contract.id, firstName: "Moussa", lastName: "Diop", phone: "+221771234567" }).returning();
    const espion = signatureJusteAvantLEcriture(contract.id);

    const res = await request(app).delete(`/api/contracts/${contract.id}/guarantors/${garant.id}`).set(h);
    espion.mockRestore();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LEASE_SIGNED_GUARANTORS_LOCKED");
    expect(await testDb.select().from(contractGuarantors).where(eq(contractGuarantors.id, garant.id))).toHaveLength(1);
  });

  it("sur un bail non signé, l'ajout, la modification et le retrait fonctionnent toujours", async () => {
    const { contract, h } = await setup();

    const cree = await request(app).post(`/api/contracts/${contract.id}/guarantors`).set(h).send(garantValide);
    expect(cree.status).toBe(201);
    const maj = await request(app).put(`/api/contracts/${contract.id}/guarantors/${cree.body.id}`).set(h).send({ lastName: "Sow" });
    expect(maj.status).toBe(200);
    expect(maj.body.lastName).toBe("Sow");
    const retire = await request(app).delete(`/api/contracts/${contract.id}/guarantors/${cree.body.id}`).set(h);
    expect(retire.status).toBe(204);
  });

  it("le plafond de 5 garants reste appliqué", async () => {
    const { contract, h } = await setup();
    for (let i = 0; i < 5; i++) expect((await request(app).post(`/api/contracts/${contract.id}/guarantors`).set(h).send({ ...garantValide, firstName: `G${i}` })).status).toBe(201);

    const refuse = await request(app).post(`/api/contracts/${contract.id}/guarantors`).set(h).send(garantValide);

    expect(refuse.status).toBe(409);
    expect(refuse.body.code).toBe("GUARANTOR_LIMIT");
  });
});

describe("Colocataires — le verrou « bail signé » tient même si la signature arrive entre la lecture et l'écriture", () => {
  it("l'ajout d'un colocataire est refusé (409) et rien n'est écrit", async () => {
    const { manager, contract, h } = await setup();
    const coloc = await createTenant(manager.id);
    const espion = signatureJusteAvantLEcriture(contract.id);

    const res = await request(app).post(`/api/contracts/${contract.id}/cotenants`).set(h).send({ tenantId: coloc.id });
    espion.mockRestore();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LEASE_SIGNED_COTENANTS_LOCKED");
    expect(await testDb.select().from(contractCotenants).where(eq(contractCotenants.contractId, contract.id))).toHaveLength(0);
  });

  it("le retrait d'un colocataire est refusé (409) et le colocataire reste", async () => {
    const { manager, contract, h } = await setup();
    const coloc = await createTenant(manager.id);
    const [lien] = await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id }).returning();
    const espion = signatureJusteAvantLEcriture(contract.id);

    const res = await request(app).delete(`/api/contracts/${contract.id}/cotenants/${lien.id}`).set(h);
    espion.mockRestore();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LEASE_SIGNED_COTENANTS_LOCKED");
    expect(await testDb.select().from(contractCotenants).where(eq(contractCotenants.id, lien.id))).toHaveLength(1);
  });

  it("sur un bail non signé, l'ajout et le retrait fonctionnent toujours, et un doublon est refusé", async () => {
    const { manager, contract, h } = await setup();
    const coloc = await createTenant(manager.id);

    const ajoute = await request(app).post(`/api/contracts/${contract.id}/cotenants`).set(h).send({ tenantId: coloc.id });
    expect(ajoute.status).toBe(201);
    const doublon = await request(app).post(`/api/contracts/${contract.id}/cotenants`).set(h).send({ tenantId: coloc.id });
    expect(doublon.status).toBe(409);
    expect(doublon.body.code).toBe("TENANT_ALREADY_COTENANT");
    const retire = await request(app).delete(`/api/contracts/${contract.id}/cotenants/${ajoute.body.id}`).set(h);
    expect(retire.status).toBe(204);
  });
});

describe("GET /api/tenants/:id — l'historique des baux ne renvoie pas les images de signature", () => {
  it("garde les dates de signature et les biens, sans les images", async () => {
    const { manager, tenant, contract } = await setup();
    await testDb.update(contracts).set({ managerSignatureUrl: SIGNATURE, tenantSignatureUrl: SIGNATURE, signedByManagerAt: new Date(), signedByTenantAt: new Date() }).where(eq(contracts.id, contract.id));

    const res = await request(app).get(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.contracts[0].signedByTenantAt).toBeTruthy();
    expect(res.body.contracts[0].property.id).toBe(contract.propertyId);
    expect(res.body.contracts[0]).not.toHaveProperty("tenantSignatureUrl");
    expect(res.body.contracts[0]).not.toHaveProperty("managerSignatureUrl");
    expect(JSON.stringify(res.body)).not.toContain(MARQUEUR);
  });
});
