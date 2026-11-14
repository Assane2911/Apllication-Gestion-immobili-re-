import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, invoices, properties, tenants } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

afterEach(() => vi.restoreAllMocks());

/**
 * Exécute `action` UNE fois, juste avant la première lecture dont les colonnes satisfont `cible` : simule un événement qui
 * arrive entre les contrôles d'une suppression et son écriture (un paiement en ligne, la création d'un bail, la réactivation d'un bail).
 */
function entreLesControlesEtLEcriture(cible: (colonnes: Record<string, unknown>) => boolean, action: () => Promise<unknown>) {
  let fait = false;
  const origine = testDb.select.bind(testDb);
  vi.spyOn(testDb, "select").mockImplementation(((...args: unknown[]) => {
    const requete = origine(...(args as [])) as unknown as Record<string, (...a: unknown[]) => unknown>;
    const colonnes = args[0] as Record<string, unknown> | undefined;
    if (!colonnes || !cible(colonnes)) return requete;
    const depuis = requete.from.bind(requete);
    requete.from = (table: unknown) => {
      const suite = depuis(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const ou = suite.where.bind(suite);
      suite.where = (condition: unknown) => {
        const q = ou(condition) as unknown as { then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => unknown };
        const suiteDeLaLecture = q.then.bind(q);
        q.then = (ok, ko) => {
          if (fait) return suiteDeLaLecture(ok, ko);
          fait = true;
          return action().then(() => suiteDeLaLecture(ok, ko), ko);
        };
        return q;
      };
      return suite;
    };
    return requete;
  }) as never);
}

async function agence() {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Villa Ngor", status: "AVAILABLE" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
  return { manager, property, tenant, h: authHeader(tokenFor(manager)) };
}

describe("DELETE /api/contracts/:id — les contrôles sont redits dans l'écriture", () => {
  it("supprime un bail terminé sans encaissement, avec ses factures, et libère le bien", async () => {
    const { property, tenant, h } = await agence();
    await testDb.update(properties).set({ status: "OCCUPIED" }).where(eq(properties.id, property.id));
    const contract = await createContract(property.id, tenant.id, { status: "ENDED" });
    const facture = await createInvoice(contract.id, { status: "PENDING", amountPaid: 0, dueDate: new Date(Date.now() + 5 * 86_400_000) });

    const res = await request(app).delete(`/api/contracts/${contract.id}`).set(h);

    expect(res.status).toBe(204);
    expect(await testDb.select().from(contracts).where(eq(contracts.id, contract.id))).toHaveLength(0);
    expect(await testDb.select().from(invoices).where(eq(invoices.id, facture.id))).toHaveLength(0);
    const [bien] = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(bien.status).toBe("AVAILABLE");
  });

  it("refuse la suppression si un paiement arrive entre le contrôle et l'écriture : la facture réglée est conservée", async () => {
    const { property, tenant, h } = await agence();
    const contract = await createContract(property.id, tenant.id, { status: "ENDED" });
    const facture = await createInvoice(contract.id, { status: "PENDING", amountPaid: 0, dueDate: new Date(Date.now() + 5 * 86_400_000) });
    entreLesControlesEtLEcriture(
      (colonnes) => "photoUrl" in colonnes,
      () => testDb.update(invoices).set({ status: "PAID", amountPaid: facture.amount, paidAt: new Date() }).where(eq(invoices.id, facture.id))
    );

    const res = await request(app).delete(`/api/contracts/${contract.id}`).set(h);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONTRACT_HAS_SETTLED_INVOICES");
    expect(await testDb.select().from(contracts).where(eq(contracts.id, contract.id))).toHaveLength(1);
    const [conservee] = await testDb.select().from(invoices).where(eq(invoices.id, facture.id));
    expect(conservee.status).toBe("PAID");
  });

  it("refuse la suppression si le bail redevient actif entre le contrôle et l'écriture", async () => {
    const { property, tenant, h } = await agence();
    const contract = await createContract(property.id, tenant.id, { status: "ENDED" });
    entreLesControlesEtLEcriture(
      (colonnes) => "photoUrl" in colonnes,
      () => testDb.update(contracts).set({ status: "ACTIVE" }).where(eq(contracts.id, contract.id))
    );

    const res = await request(app).delete(`/api/contracts/${contract.id}`).set(h);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONTRACT_ACTIVE_NO_DELETE");
    expect(await testDb.select().from(contracts).where(eq(contracts.id, contract.id))).toHaveLength(1);
  });

  it("garde le bien occupé quand un autre bail y est encore actif", async () => {
    const { property, tenant, h } = await agence();
    const autre = await createTenant(property.managerId, { firstName: "Moussa", lastName: "Fall" });
    await testDb.update(properties).set({ status: "OCCUPIED" }).where(eq(properties.id, property.id));
    const termine = await createContract(property.id, tenant.id, { status: "ENDED" });
    await createContract(property.id, autre.id, { status: "ACTIVE" });

    const res = await request(app).delete(`/api/contracts/${termine.id}`).set(h);

    expect(res.status).toBe(204);
    const [bien] = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(bien.status).toBe("OCCUPIED");
  });
});

describe("DELETE /api/tenants/:id — un bail créé entre le contrôle et l'écriture", () => {
  it("supprime un locataire sans bail", async () => {
    const { tenant, h } = await agence();

    const res = await request(app).delete(`/api/tenants/${tenant.id}`).set(h);

    expect(res.status).toBe(204);
    expect(await testDb.select().from(tenants).where(eq(tenants.id, tenant.id))).toHaveLength(0);
  });

  it("répond 409 (et non 500) si un bail est créé pour lui entre le contrôle et la suppression, et garde le locataire", async () => {
    const { property, tenant, h } = await agence();
    entreLesControlesEtLEcriture(
      (colonnes) => "chemin" in colonnes,
      () => createContract(property.id, tenant.id, { status: "ACTIVE" })
    );

    const res = await request(app).delete(`/api/tenants/${tenant.id}`).set(h);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TENANT_HAS_CONTRACT_HISTORY");
    expect(await testDb.select().from(tenants).where(eq(tenants.id, tenant.id))).toHaveLength(1);
  });
});
