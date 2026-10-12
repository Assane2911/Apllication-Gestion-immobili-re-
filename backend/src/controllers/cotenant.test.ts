import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, contractCotenants, contracts, messages } from "../db/schema";
import { authHeader, createContract, createManager, createProperty, createTeamMember, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Colocataires d'un bail : des locataires de l'agence ajoutés au bail du titulaire, imprimés sur le bail,
 * figés une fois le bail signé, protégés contre la suppression, et pris en compte dans l'export RGPD.
 */
async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const property = await createProperty(manager.id, { title: "Appartement T3" });
  const titulaire = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: "awa@example.com" });
  const coloc = await createTenant(manager.id, { firstName: "Binta", lastName: "Kane", email: "binta@example.com", civility: "MME" });
  const contract = await createContract(property.id, titulaire.id, { status: "ACTIVE" });
  return { manager, property, titulaire, coloc, contract, h: authHeader(tokenFor(manager)) };
}

const ajouter = (h: Record<string, string>, contractId: string, tenantId: string) =>
  request(app).post(`/api/contracts/${contractId}/cotenants`).set(h).send({ tenantId });

describe("colocataires d'un bail", () => {
  it("ajoute un colocataire, le liste avec sa fiche, l'affiche dans la liste des contrats et journalise", async () => {
    const { manager, coloc, contract, h } = await agence();
    const res = await ajouter(h, contract.id, coloc.id);
    expect(res.status).toBe(201);
    expect(res.body.tenant).toMatchObject({ id: coloc.id, firstName: "Binta" });

    const liste = await request(app).get(`/api/contracts/${contract.id}/cotenants`).set(h);
    expect(liste.body).toHaveLength(1);
    expect(liste.body[0].tenant.lastName).toBe("Kane");
    expect((await request(app).get(`/api/contracts/${contract.id}`).set(h)).body.cotenants).toHaveLength(1);
    expect((await request(app).get("/api/contracts").set(h)).body.items[0].cotenantNames).toEqual(["Binta Kane"]);

    const journal = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(journal.some((l: { action: string }) => l.action === "contract.cotenant_add")).toBe(true);
  });

  it("refuse le titulaire, un doublon, un locataire anonymisé, et au-delà de 5", async () => {
    const { manager, titulaire, coloc, contract, h } = await agence();
    expect((await ajouter(h, contract.id, titulaire.id)).body.error).toContain("déjà le titulaire");
    await ajouter(h, contract.id, coloc.id);
    expect((await ajouter(h, contract.id, coloc.id)).body.error).toContain("déjà colocataire");
    const anonyme = await createTenant(manager.id, { anonymizedAt: new Date() });
    expect((await ajouter(h, contract.id, anonyme.id)).status).toBe(409);

    for (let i = 0; i < 4; i++) {
      const t = await createTenant(manager.id, { email: `c${i}@example.com` });
      expect((await ajouter(h, contract.id, t.id)).status).toBe(201);
    }
    const septieme = await createTenant(manager.id, { email: "trop@example.com" });
    const res = await ajouter(h, contract.id, septieme.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("au plus 5");
  });

  it("isole les agences : ni le bail ni le locataire d'une autre agence", async () => {
    const { contract, h } = await agence();
    const autre = await createManager({ subscriptionStatus: "ACTIVE" });
    const etranger = await createTenant(autre.id);
    expect((await ajouter(h, contract.id, etranger.id)).status).toBe(404);
    expect((await ajouter(authHeader(tokenFor(autre)), contract.id, etranger.id)).status).toBe(404);
  });

  it("retire un colocataire ; un lien d'un autre bail est introuvable par celui-ci", async () => {
    const { manager, property, coloc, contract, h } = await agence();
    const lien = await ajouter(h, contract.id, coloc.id);
    const autreBail = await createContract(property.id, (await createTenant(manager.id, { email: "x@example.com" })).id, { status: "ENDED" });
    expect((await request(app).delete(`/api/contracts/${autreBail.id}/cotenants/${lien.body.id}`).set(h)).status).toBe(404);
    expect((await request(app).delete(`/api/contracts/${contract.id}/cotenants/${lien.body.id}`).set(h)).status).toBe(204);
    expect(await testDb.select().from(contractCotenants)).toHaveLength(0);
  });

  it("une fois le bail signé par le titulaire, la colocation est figée", async () => {
    const { manager, coloc, contract, h } = await agence();
    const lien = await ajouter(h, contract.id, coloc.id);
    await testDb.update(contracts).set({ signedByTenantAt: new Date() }).where(eq(contracts.id, contract.id));
    const autre = await createTenant(manager.id, { email: "autre@example.com" });

    for (const r of [await ajouter(h, contract.id, autre.id), await request(app).delete(`/api/contracts/${contract.id}/cotenants/${lien.body.id}`).set(h)]) {
      expect(r.status).toBe(409);
      expect(r.body.error).toContain("signé par le locataire");
    }
  });

  it("un colocataire ne peut pas être supprimé tant qu'il figure sur un bail", async () => {
    const { coloc, contract, h } = await agence();
    const lien = await ajouter(h, contract.id, coloc.id);
    const refus = await request(app).delete(`/api/tenants/${coloc.id}`).set(h);
    expect(refus.status).toBe(409);
    expect(refus.body.error).toContain("colocataire");

    await request(app).delete(`/api/contracts/${contract.id}/cotenants/${lien.body.id}`).set(h);
    expect((await request(app).delete(`/api/tenants/${coloc.id}`).set(h)).status).toBe(204);
  });

  it("supprimer le bail supprime les liens de colocation", async () => {
    const { coloc, contract, h } = await agence();
    await ajouter(h, contract.id, coloc.id);
    await testDb.delete(contracts).where(eq(contracts.id, contract.id));
    expect(await testDb.select().from(contractCotenants)).toHaveLength(0);
  });

  it("équipe : l'agent ajoute, ne retire pas ; le comptable ne fait ni l'un ni l'autre", async () => {
    const { manager, coloc, contract } = await agence();
    const agent = await createTeamMember(manager.id, { teamRole: "AGENT" });
    const comptable = await createTeamMember(manager.id, { teamRole: "ACCOUNTANT" });
    const hAgent = authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, agent.id));
    const hCompta = authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, comptable.id));
    expect((await ajouter(hCompta, contract.id, coloc.id)).status).toBe(403);
    const lien = await ajouter(hAgent, contract.id, coloc.id);
    expect(lien.status).toBe(201);
    expect((await request(app).delete(`/api/contracts/${contract.id}/cotenants/${lien.body.id}`).set(hAgent)).status).toBe(403);
  });
});

describe("colocataires sur le bail et dans l'export RGPD", () => {
  it("le bail imprimé liste chaque colocataire avec un bloc de signature", async () => {
    const { coloc, contract, h } = await agence();
    await ajouter(h, contract.id, coloc.id);
    const res = await request(app).get(`/api/documents/lease/${contract.id}`).set(h);
    expect(res.text).toContain("Colocataire :</strong> Madame Binta Kane (Email : binta@example.com");
    expect((res.text.match(/Le Colocataire :/g) ?? []).length).toBe(1);
  });

  it("sans colocataire, le bail est inchangé", async () => {
    const { contract, h } = await agence();
    expect((await request(app).get(`/api/documents/lease/${contract.id}`).set(h)).text).not.toContain("Colocataire");
  });

  it("l'export du colocataire inclut le bail partagé et ses factures, sans la signature ni les messages du titulaire", async () => {
    const { manager, coloc, contract, h } = await agence();
    await ajouter(h, contract.id, coloc.id);
    await testDb.update(contracts).set({ tenantSignatureUrl: "data:image/png;base64,SIGNATURE-DU-TITULAIRE" }).where(eq(contracts.id, contract.id));
    await testDb.insert(messages).values({ contractId: contract.id, senderId: manager.id, senderRole: "MANAGER", content: "Message privé au titulaire" });

    const res = await request(app).get(`/api/tenants/${coloc.id}/export`).set(h);
    expect(res.status).toBe(200);
    const donnees = JSON.parse(res.text);
    expect(donnees.contrats).toHaveLength(1);
    expect(donnees.contrats[0]).toMatchObject({ id: contract.id, qualite: "COLOCATAIRE", tenantSignatureUrl: null });
    expect(donnees.messages).toEqual([]);
    expect(res.text).not.toContain("SIGNATURE-DU-TITULAIRE");
    expect(res.text).not.toContain("Message privé au titulaire");
  });
});
