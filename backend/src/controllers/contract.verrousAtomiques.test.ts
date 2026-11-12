import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts } from "../db/schema";
import { testDb } from "../test/setupTestDb";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";

async function setup(overrides: Partial<typeof contracts.$inferInsert> = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id, overrides);
  return { manager, contract };
}

async function ligne(id: string) {
  const [row] = await testDb.select().from(contracts).where(eq(contracts.id, id));
  return row;
}

/**
 * Fait arriver un événement concurrent JUSTE avant la transaction d'écriture de la modification du bail : c'est ce que
 * produit une autre requête (signature du locataire, restitution du dépôt) arrivée entre la lecture des verrous et
 * l'écriture. Déterministe, sans dépendre de l'ordonnancement des requêtes. Plusieurs transactions précèdent celle-ci
 * dans la requête (limiteurs de débit…) : on reconnaît la bonne à son code, qui pose le verrou du bien.
 */
function avantLEcriture(evenement: () => Promise<unknown>) {
  const origine = testDb.transaction.bind(testDb);
  let fait = false;
  return vi.spyOn(testDb, "transaction").mockImplementation((async (corps: unknown) => {
    if (!fait && String(corps).includes("verrouillerBienPourContrat")) {
      fait = true;
      await evenement();
    }
    return origine(corps as never);
  }) as never);
}

describe("PUT /api/contracts/:id — les verrous du bail tiennent même si l'état change entre la lecture et l'écriture", () => {
  it("un changement de clauses arrivé alors que le locataire vient de signer est refusé (409) et n'écrit rien", async () => {
    const { manager, contract } = await setup({ terms: "Clauses d'origine" });
    const espion = avantLEcriture(() =>
      testDb.update(contracts).set({ signedByTenantAt: new Date(), tenantSignatureUrl: "data:image/png;base64,AAAA" }).where(eq(contracts.id, contract.id))
    );

    const res = await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ terms: "Clauses modifiées après la signature" });
    espion.mockRestore();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LEASE_SIGNED_LOCKED");
    const apres = await ligne(contract.id);
    expect(apres.terms).toBe("Clauses d'origine");
    expect(apres.signedByTenantAt).not.toBeNull();
  });

  it("un changement du dépôt arrivé alors que sa restitution vient d'être enregistrée est refusé (409) et n'écrit rien", async () => {
    const { manager, contract } = await setup({ deposit: 1000 });
    const espion = avantLEcriture(() => testDb.update(contracts).set({ depositRefundedAt: new Date(), depositDeductions: "[]" }).where(eq(contracts.id, contract.id)));

    const res = await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ deposit: 2500 });
    espion.mockRestore();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DEPOSIT_REFUND_LOCKED");
    expect((await ligne(contract.id)).deposit).toBe(1000);
  });

  it("un changement de statut reste possible sur un bail signé (résilier ne réécrit rien de ce qui a été signé)", async () => {
    const { manager, contract } = await setup();
    await testDb.update(contracts).set({ signedByTenantAt: new Date(), tenantSignatureUrl: "data:image/png;base64,AAAA" }).where(eq(contracts.id, contract.id));

    const res = await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "TERMINATED" });

    expect(res.status).toBe(200);
    expect((await ligne(contract.id)).status).toBe("TERMINATED");
  });

  it("un bail non signé reste modifiable normalement", async () => {
    const { manager, contract } = await setup({ terms: "Avant" });

    const res = await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ terms: "Après" });

    expect(res.status).toBe(200);
    expect((await ligne(contract.id)).terms).toBe("Après");
  });
});
