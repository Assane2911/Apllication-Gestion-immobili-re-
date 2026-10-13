import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contractCotenants, contracts, invoices } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Écran de modification complet d'un contrat : tout est modifiable tant que le bail n'est pas signé,
 * sauf ce que les factures déjà émises rendraient faux (destinataire, prorata, mois facturés) et le
 * dépôt dont la restitution est déjà enregistrée.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function bail(extra: Partial<typeof contracts.$inferInsert> = {}) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const property = await createProperty(manager.id, { title: "Studio A" });
  const autreBien = await createProperty(manager.id, { title: "Studio B" });
  const tenant = await createTenant(manager.id);
  const autreLocataire = await createTenant(manager.id, { email: "autre@example.com" });
  const contract = await createContract(property.id, tenant.id, {
    status: "ENDED",
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2026-12-31T00:00:00Z"),
    ...extra,
  });
  return { manager, property, autreBien, tenant, autreLocataire, contract, h: authHeader(tokenFor(manager)) };
}

const modifier = (h: Record<string, string>, id: string, corps: Record<string, unknown>) => request(app).put(`/api/contracts/${id}`).set(h).send(corps);
const lire = async (id: string) => (await testDb.select().from(contracts).where(eq(contracts.id, id)))[0];

describe("modification complète d'un contrat sans facture", () => {
  it("modifie d'un coup bien, locataire, loyer, dépôt, dates, échéance, type, droit et clauses", async () => {
    const { autreBien, autreLocataire, contract, h } = await bail();
    const res = await modifier(h, contract.id, {
      propertyId: autreBien.id,
      tenantId: autreLocataire.id,
      rent: 650,
      deposit: 1300,
      startDate: "2026-02-01",
      endDate: "2027-01-31",
      paymentDay: 10,
      leaseType: "MEUBLE",
      applicableLaw: "Droit sénégalais",
      terms: "Animaux interdits.",
    });
    expect(res.status).toBe(200);
    expect(await lire(contract.id)).toMatchObject({
      propertyId: autreBien.id,
      tenantId: autreLocataire.id,
      rent: 650,
      deposit: 1300,
      paymentDay: 10,
      leaseType: "MEUBLE",
      applicableLaw: "Droit sénégalais",
      terms: "Animaux interdits.",
    });
  });

  it("efface le droit applicable et le jour d'échéance quand on les vide", async () => {
    const { contract, h } = await bail({ applicableLaw: "Droit X", paymentDay: 5 });
    await modifier(h, contract.id, { applicableLaw: "", paymentDay: null });
    expect(await lire(contract.id)).toMatchObject({ applicableLaw: null, paymentDay: null });
  });
});

describe("garde-fous liés aux factures émises", () => {
  it("refuse de changer le bien ou le locataire d'un contrat facturé", async () => {
    const { autreBien, autreLocataire, contract, h } = await bail();
    await createInvoice(contract.id, { periodMonth: 1, periodYear: 2026, status: "PAID", amountPaid: 500 });

    for (const corps of [{ propertyId: autreBien.id }, { tenantId: autreLocataire.id }]) {
      const res = await modifier(h, contract.id, corps);
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("changeraient de destinataire");
    }
  });

  it("une facture annulée ne bloque pas : elle ne réclame plus rien à personne", async () => {
    const { autreLocataire, contract, h } = await bail();
    await createInvoice(contract.id, { periodMonth: 1, periodYear: 2026, status: "CANCELLED" });
    expect((await modifier(h, contract.id, { tenantId: autreLocataire.id })).status).toBe(200);
  });

  it("refuse de déplacer la date de début d'un contrat facturé", async () => {
    const { contract, h } = await bail();
    await createInvoice(contract.id, { periodMonth: 1, periodYear: 2026 });
    const res = await modifier(h, contract.id, { startDate: "2026-01-15" });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("date de début");
    // Renvoyer la même date n'est pas un changement.
    expect((await modifier(h, contract.id, { startDate: "2026-01-01" })).status).toBe(200);
  });

  it("prolonger le bail est toujours possible ; le raccourcir avant un mois facturé ne l'est pas", async () => {
    const { contract, h } = await bail();
    await createInvoice(contract.id, { periodMonth: 9, periodYear: 2026 });

    expect((await modifier(h, contract.id, { endDate: "2027-06-30" })).status).toBe(200);
    expect((await modifier(h, contract.id, { endDate: "2026-09-30" })).status).toBe(200);
    const trop = await modifier(h, contract.id, { endDate: "2026-08-31" });
    expect(trop.status).toBe(409);
    expect(trop.body.error).toContain("09/2026");
    expect(new Date((await lire(contract.id)).endDate).toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("le dépôt ne change plus une fois sa restitution enregistrée", async () => {
    const { contract, h } = await bail({ depositRefundedAt: new Date(), depositDeductions: "[]" });
    const res = await modifier(h, contract.id, { deposit: 2000 });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("restitution");
    expect((await modifier(h, contract.id, { deposit: 1000 })).status).toBe(200); // inchangé : accepté
  });

  it("bail signé par le locataire : contenu figé, statut toujours modifiable", async () => {
    const { contract, h } = await bail({ signedByTenantAt: new Date() });
    expect((await modifier(h, contract.id, { terms: "Nouvelle clause" })).status).toBe(409);
    expect((await modifier(h, contract.id, { status: "TERMINATED" })).status).toBe(200);
  });
});

describe("isolation", () => {
  it("n'accepte ni le bien ni le locataire d'une autre agence", async () => {
    const { contract, h } = await bail();
    const autre = await createManager({ subscriptionStatus: "ACTIVE" });
    const bienEtranger = await createProperty(autre.id);
    const locataireEtranger = await createTenant(autre.id);
    expect((await modifier(h, contract.id, { propertyId: bienEtranger.id })).status).toBe(404);
    expect((await modifier(h, contract.id, { tenantId: locataireEtranger.id })).status).toBe(404);
    expect(await testDb.select().from(invoices)).toHaveLength(0);
  });
});

describe("PUT /api/contracts/:id — titulaire et colocataires", () => {
  it("refuse de faire d'un colocataire le titulaire (la même personne y figurerait deux fois), puis l'accepte une fois retiré", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const h = authHeader(tokenFor(manager));
    const property = await createProperty(manager.id);
    const awa = await createTenant(manager.id, { firstName: "Awa" });
    const binta = await createTenant(manager.id, { firstName: "Binta" });
    const contract = await createContract(property.id, awa.id, { status: "ACTIVE" });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: binta.id });

    const refus = await request(app).put(`/api/contracts/${contract.id}`).set(h).send({ tenantId: binta.id });

    expect(refus.status).toBe(409);
    expect(refus.body.error).toContain("retirez-le des colocataires");
    expect((await testDb.select().from(contracts).where(eq(contracts.id, contract.id)))[0].tenantId).toBe(awa.id);

    await testDb.delete(contractCotenants);
    expect((await request(app).put(`/api/contracts/${contract.id}`).set(h).send({ tenantId: binta.id })).status).toBe(200);
  });

  it("un titulaire inchangé dans la requête n'est pas pris pour un colocataire", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const h = authHeader(tokenFor(manager));
    const property = await createProperty(manager.id);
    const awa = await createTenant(manager.id);
    const contract = await createContract(property.id, awa.id, { status: "ACTIVE" });

    expect((await request(app).put(`/api/contracts/${contract.id}`).set(h).send({ tenantId: awa.id, terms: "Clause" })).status).toBe(200);
  });
});
