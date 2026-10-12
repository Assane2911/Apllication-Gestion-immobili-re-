import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, contractGuarantors, contracts } from "../db/schema";
import { authHeader, createContract, createManager, createProperty, createTeamMember, createTenant, tokenFor, tokenLocataire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Garants d'un bail : saisis par l'agence, imprimés sur le bail, figés une fois le bail signé par le
 * locataire, effacés avec les données du locataire quand il exerce son droit à l'effacement.
 */
async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const property = await createProperty(manager.id, { title: "Studio A" });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id, { currency: "XOF", status: "ACTIVE" });
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}

const GARANT = { civility: "M", firstName: "Ibrahima", lastName: "Fall", phone: "+221 77 123 45 67", email: "IBRAHIMA@Example.com", address: "Dakar", maxAmount: 1500000 };
const ajouter = (h: Record<string, string>, contractId: string, corps: Record<string, unknown> = GARANT) =>
  request(app).post(`/api/contracts/${contractId}/guarantors`).set(h).send(corps);

describe("garants d'un bail", () => {
  it("ajoute un garant (téléphone international, email en minuscules), le liste et le journalise", async () => {
    const { manager, contract, h } = await agence();
    const res = await ajouter(h, contract.id);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ firstName: "Ibrahima", lastName: "Fall", phone: "+221771234567", email: "ibrahima@example.com", maxAmount: 1500000, civility: "M" });

    const liste = await request(app).get(`/api/contracts/${contract.id}/guarantors`).set(h);
    expect(liste.body).toHaveLength(1);
    const detail = await request(app).get(`/api/contracts/${contract.id}`).set(h);
    expect(detail.body.guarantors).toHaveLength(1);
    const page = await request(app).get("/api/contracts").set(h);
    expect(page.body.items[0].guarantorsCount).toBe(1);

    const journal = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(journal.some((l: { action: string }) => l.action === "contract.guarantor_add")).toBe(true);
  });

  it("valide la saisie : nom, téléphone, email, montant ; email et montant facultatifs", async () => {
    const { contract, h } = await agence();
    expect((await ajouter(h, contract.id, { ...GARANT, firstName: "" })).status).toBe(400);
    expect((await ajouter(h, contract.id, { ...GARANT, phone: "0612" })).status).toBe(400);
    expect((await ajouter(h, contract.id, { ...GARANT, email: "pas-un-email" })).status).toBe(400);
    expect((await ajouter(h, contract.id, { ...GARANT, maxAmount: -5 })).status).toBe(400);
    const minimal = await ajouter(h, contract.id, { firstName: "Awa", lastName: "Sow", phone: "+221 76 000 00 00", email: "", maxAmount: null });
    expect(minimal.status).toBe(201);
    expect(minimal.body).toMatchObject({ email: null, maxAmount: null, address: null, civility: null });
  });

  it("au plus 5 garants par bail", async () => {
    const { contract, h } = await agence();
    for (let i = 0; i < 5; i++) expect((await ajouter(h, contract.id, { ...GARANT, firstName: `G${i}` })).status).toBe(201);
    const sixieme = await ajouter(h, contract.id);
    expect(sixieme.status).toBe(409);
    expect(sixieme.body.error).toContain("au plus 5");
  });

  it("modifier un champ ne vide pas les autres", async () => {
    const { contract, h } = await agence();
    const g = await ajouter(h, contract.id);
    const res = await request(app).put(`/api/contracts/${contract.id}/guarantors/${g.body.id}`).set(h).send({ phone: "+221 70 111 22 33" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ phone: "+221701112233", email: "ibrahima@example.com", address: "Dakar", maxAmount: 1500000 });
    expect((await request(app).put(`/api/contracts/${contract.id}/guarantors/${g.body.id}`).set(h).send({})).status).toBe(400);
  });

  it("supprime un garant ; un garant d'un autre bail est introuvable par ce bail", async () => {
    const { manager, property, contract, h } = await agence();
    const autreLocataire = await createTenant(manager.id);
    const autreBail = await createContract(property.id, autreLocataire.id, { status: "ENDED" });
    const g = await ajouter(h, autreBail.id);
    expect((await request(app).delete(`/api/contracts/${contract.id}/guarantors/${g.body.id}`).set(h)).status).toBe(404);
    expect((await request(app).delete(`/api/contracts/${autreBail.id}/guarantors/${g.body.id}`).set(h)).status).toBe(204);
    expect(await testDb.select().from(contractGuarantors)).toHaveLength(0);
  });

  it("une fois le bail signé par le locataire, les garants sont figés", async () => {
    const { contract, h } = await agence();
    const g = await ajouter(h, contract.id);
    await testDb.update(contracts).set({ signedByTenantAt: new Date() }).where(eq(contracts.id, contract.id));

    for (const r of [
      await ajouter(h, contract.id),
      await request(app).put(`/api/contracts/${contract.id}/guarantors/${g.body.id}`).set(h).send({ lastName: "Autre" }),
      await request(app).delete(`/api/contracts/${contract.id}/guarantors/${g.body.id}`).set(h),
    ]) {
      expect(r.status).toBe(409);
      expect(r.body.error).toContain("signé par le locataire");
    }
    expect((await testDb.select().from(contractGuarantors))[0].lastName).toBe("Fall");
  });

  it("isole les agences et refuse le locataire", async () => {
    const { tenant, contract } = await agence();
    const autre = await createManager({ subscriptionStatus: "ACTIVE" });
    expect((await ajouter(authHeader(tokenFor(autre)), contract.id)).status).toBe(404);
    expect((await request(app).get(`/api/contracts/${contract.id}/guarantors`).set(authHeader(tokenFor(autre)))).status).toBe(404);
    expect((await ajouter(authHeader(await tokenLocataire(tenant.id)), contract.id)).status).toBe(403);
  });

  it("équipe : l'agent ajoute et modifie, mais ne supprime pas ; le comptable ne fait rien de tout cela", async () => {
    const { manager, contract } = await agence();
    const agent = await createTeamMember(manager.id, { teamRole: "AGENT" });
    const comptable = await createTeamMember(manager.id, { teamRole: "ACCOUNTANT" });
    const hAgent = authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, agent.id));
    const hCompta = authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, comptable.id));

    expect((await ajouter(hCompta, contract.id)).status).toBe(403);
    const g = await ajouter(hAgent, contract.id);
    expect(g.status).toBe(201);
    expect((await request(app).put(`/api/contracts/${contract.id}/guarantors/${g.body.id}`).set(hAgent).send({ lastName: "Ndiaye" })).status).toBe(200);
    expect((await request(app).delete(`/api/contracts/${contract.id}/guarantors/${g.body.id}`).set(hAgent)).status).toBe(403);
  });
});

describe("garants sur le bail et effacement", () => {
  it("le bail imprimé liste chaque garant et lui réserve un bloc de signature", async () => {
    const { contract, h } = await agence();
    await ajouter(h, contract.id);
    await ajouter(h, contract.id, { ...GARANT, firstName: "Coumba", lastName: "<b>Diop</b>", civility: "MME", maxAmount: null, email: null, address: null });

    const res = await request(app).get(`/api/documents/lease/${contract.id}`).set(h);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Garant :</strong> Monsieur Ibrahima Fall (Dakar)");
    expect(res.text).toContain("+221771234567");
    expect(res.text).toMatch(/Montant maximal garanti : 1[\s  .]?500[\s  .]?000/);
    expect(res.text).toContain("Madame Coumba &lt;b&gt;Diop&lt;/b&gt;");
    expect((res.text.match(/Le Garant :/g) ?? []).length).toBe(2);
  });

  it("sans garant, le bail est inchangé", async () => {
    const { contract, h } = await agence();
    const res = await request(app).get(`/api/documents/lease/${contract.id}`).set(h);
    expect(res.text).not.toContain("Garant");
  });

  it("anonymiser le locataire efface aussi les garants de ses baux, pas ceux des autres locataires", async () => {
    const { manager, property, tenant, contract, h } = await agence();
    await ajouter(h, contract.id);
    const autreLocataire = await createTenant(manager.id);
    const autreBail = await createContract(property.id, autreLocataire.id, { status: "ENDED" });
    await ajouter(h, autreBail.id, { ...GARANT, firstName: "Reste" });

    expect((await request(app).post(`/api/tenants/${tenant.id}/anonymiser`).set(h)).status).toBe(200);

    const [efface] = await testDb.select().from(contractGuarantors).where(eq(contractGuarantors.contractId, contract.id));
    expect(efface).toMatchObject({ firstName: "Garant", lastName: "anonymisé", phone: "", email: null, address: null, notes: null, civility: null });
    const [intact] = await testDb.select().from(contractGuarantors).where(eq(contractGuarantors.contractId, autreBail.id));
    expect(intact.firstName).toBe("Reste");
  });
});
