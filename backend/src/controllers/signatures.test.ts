import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, contracts, inspections } from "../db/schema";
import {
  authHeader,
  createContract,
  createInspection,
  createManager,
  createProperty,
  createTenant,
  createTenantPortalUser,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Une signature électronique est une preuve : une fois posée, elle ne se remplace pas (sinon son auteur
 * pourrait la changer après coup, et la date de signature avancerait). Elle est aussi tracée au journal,
 * comme la signature du bail.
 */
const PREMIERE = "data:image/png;base64,PREMIERESIGNATURE";
const SECONDE = "data:image/png;base64,SECONDESIGNATURE";

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  const tenantUser = await createTenantPortalUser(tenant);
  return { manager, tenant, contract, h: authHeader(tokenFor(manager)), hLocataire: authHeader(tokenFor(tenantUser, tenant.id)) };
}

const signerBail = (h: Record<string, string>, id: string, signatureDataUrl: string) =>
  request(app).post(`/api/contracts/${id}/sign`).set(h).send({ signatureDataUrl });
const signerEdl = (h: Record<string, string>, id: string, signatureDataUrl: string) =>
  request(app).post(`/api/inspections/${id}/sign`).set(h).send({ signatureDataUrl });

describe("signature du bail : une seule fois par partie", () => {
  it("refuse au locataire de remplacer sa signature, sans toucher à la première", async () => {
    const { contract, hLocataire } = await agence();
    expect((await signerBail(hLocataire, contract.id, PREMIERE)).status).toBe(200);
    const [avant] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));

    const res = await signerBail(hLocataire, contract.id, SECONDE);

    expect(res.status).toBe(409);
    const [apres] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(apres.tenantSignatureUrl).toBe(PREMIERE);
    expect(apres.signedByTenantAt).toEqual(avant.signedByTenantAt);
  });

  it("refuse au gestionnaire de remplacer sa signature", async () => {
    const { contract, h } = await agence();
    expect((await signerBail(h, contract.id, PREMIERE)).status).toBe(200);

    const res = await signerBail(h, contract.id, SECONDE);

    expect(res.status).toBe(409);
    const [apres] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(apres.managerSignatureUrl).toBe(PREMIERE);
  });

  it("les deux parties peuvent chacune signer une fois", async () => {
    const { contract, h, hLocataire } = await agence();
    expect((await signerBail(hLocataire, contract.id, PREMIERE)).status).toBe(200);
    expect((await signerBail(h, contract.id, SECONDE)).status).toBe(200);
  });
});

describe("signature de l'état des lieux : une seule fois par partie, et tracée", () => {
  it("refuse au locataire de remplacer sa signature", async () => {
    const { manager, contract, hLocataire } = await agence();
    const edl = await createInspection(contract, manager.id, { status: "COMPLETED" });
    expect((await signerEdl(hLocataire, edl.id, PREMIERE)).status).toBe(200);
    const [avant] = await testDb.select().from(inspections).where(eq(inspections.id, edl.id));

    const res = await signerEdl(hLocataire, edl.id, SECONDE);

    expect(res.status).toBe(409);
    const [apres] = await testDb.select().from(inspections).where(eq(inspections.id, edl.id));
    expect(apres.tenantSignatureUrl).toBe(PREMIERE);
    expect(apres.signedByTenantAt).toEqual(avant.signedByTenantAt);
  });

  it("refuse au gestionnaire de remplacer sa signature", async () => {
    const { manager, contract, h } = await agence();
    const edl = await createInspection(contract, manager.id, { status: "COMPLETED" });
    expect((await signerEdl(h, edl.id, PREMIERE)).status).toBe(200);

    const res = await signerEdl(h, edl.id, SECONDE);

    expect(res.status).toBe(409);
    const [apres] = await testDb.select().from(inspections).where(eq(inspections.id, edl.id));
    expect(apres.managerSignatureUrl).toBe(PREMIERE);
  });

  it("inscrit chaque signature au journal d'activité de l'agence", async () => {
    const { manager, contract, h, hLocataire } = await agence();
    const edl = await createInspection(contract, manager.id, { status: "COMPLETED" });

    await signerEdl(hLocataire, edl.id, PREMIERE);
    await signerEdl(h, edl.id, SECONDE);

    const lignes = await testDb.select().from(activityLogs).where(eq(activityLogs.action, "inspection.sign"));
    expect(lignes).toHaveLength(2);
    expect(lignes.every((l: typeof activityLogs.$inferSelect) => l.managerId === manager.id && l.entityId === edl.id)).toBe(true);
    expect(lignes.map((l: typeof activityLogs.$inferSelect) => l.details).join(" ")).toContain("locataire");
    expect(lignes.map((l: typeof activityLogs.$inferSelect) => l.details).join(" ")).toContain("gestionnaire");
  });
});
