import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contractCotenants, messages, tenants } from "../db/schema";
import * as emailService from "../services/email.service";
import { authHeader, createAdmin, createContract, createManager, createProperty, createTenant, createTenantPortalUser, tokenFor, tokenLocataire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Messagerie : qui voit quoi, et quand le locataire est prévenu par e-mail. Un compte sans fiche locataire ne voit rien,
 * un administrateur n'a pas accès à la liste, et un message du gestionnaire ne fait jamais échouer l'envoi si l'e-mail
 * ne peut pas partir (locataire anonymisé, sans adresse, ou serveur d'envoi en panne).
 */

let courriel: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  courriel = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function agence(plan: "PRO" | "STARTER" = "PRO") {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: plan });
  const property = await createProperty(manager.id, { title: "Villa Ngor" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: "awa@example.com" });
  const contract = await createContract(property.id, tenant.id);
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}
const messagesDuBail = (contractId: string) => testDb.select().from(messages).where(eq(messages.contractId, contractId));

describe("accès à la liste des conversations", () => {
  it("un administrateur n'y a pas accès (403), même ancien gestionnaire", async () => {
    const admin = await createAdmin();

    const res = await request(app).get("/api/messages/conversations").set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCESS_DENIED");
  });

  it("un compte locataire sans fiche rattachée est refusé (TENANT_NOT_LINKED) et son compteur de non-lus est à zéro", async () => {
    const orphelin = await createManager(); // un compte quelconque, présenté comme locataire sans fiche
    const h = authHeader(tokenFor({ id: orphelin.id, role: "TENANT" }));

    const liste = await request(app).get("/api/messages/conversations").set(h);
    const nonLus = await request(app).get("/api/messages/unread-count").set(h);

    expect(liste.status).toBe(403);
    expect(liste.body.code).toBe("TENANT_NOT_LINKED");
    expect(nonLus.status).toBe(200);
    expect(nonLus.body).toEqual({ count: 0 });
  });

  it("un locataire sans aucun bail reçoit une liste vide, un gestionnaire sans bail aussi", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
    const sansBail = await createTenant(manager.id);
    await createTenantPortalUser(sansBail);
    const tenantListe = await request(app).get("/api/messages/conversations").set(authHeader(await tokenLocataire(sansBail.id)));
    const managerListe = await request(app).get("/api/messages/conversations").set(authHeader(tokenFor(manager)));

    for (const res of [tenantListe, managerListe]) {
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.total ?? res.body.pagination?.total ?? 0).toBe(0);
    }
  });
});

describe("POST /api/messages/:contractId : le locataire est prévenu par e-mail", () => {
  it("un message du gestionnaire prévient le locataire du fil, avec le contenu et le titre du bien", async () => {
    const { contract, h } = await agence();

    const res = await request(app).post(`/api/messages/${contract.id}`).set(h).send({ content: "Bonjour, le plombier passe demain." });

    expect(res.status).toBe(201);
    expect(courriel).toHaveBeenCalledTimes(1);
    expect(courriel.mock.calls[0][0]).toBe("awa@example.com");
    expect(String(courriel.mock.calls[0][2])).toContain("Bonjour, le plombier passe demain.");
    expect(String(courriel.mock.calls[0][2])).toContain("Villa Ngor");
    expect(await messagesDuBail(contract.id)).toHaveLength(1);
  });

  it("locataire anonymisé : le message est enregistré, aucun e-mail ne part", async () => {
    const { tenant, contract, h } = await agence();
    await testDb.update(tenants).set({ anonymizedAt: new Date() }).where(eq(tenants.id, tenant.id));

    const res = await request(app).post(`/api/messages/${contract.id}`).set(h).send({ content: "Bonjour" });

    expect(res.status).toBe(201);
    expect(courriel).not.toHaveBeenCalled();
    expect(await messagesDuBail(contract.id)).toHaveLength(1);
  });

  it("locataire sans adresse e-mail : le message est enregistré, aucun e-mail ne part", async () => {
    const { tenant, contract, h } = await agence();
    await testDb.update(tenants).set({ email: "" }).where(eq(tenants.id, tenant.id));

    const res = await request(app).post(`/api/messages/${contract.id}`).set(h).send({ content: "Bonjour" });

    expect(res.status).toBe(201);
    expect(courriel).not.toHaveBeenCalled();
  });

  it("serveur d'envoi en panne : le message est quand même enregistré (201) et l'incident consigné", async () => {
    const { contract, h } = await agence();
    courriel.mockRejectedValue(new Error("SMTP indisponible"));

    const res = await request(app).post(`/api/messages/${contract.id}`).set(h).send({ content: "Bonjour" });

    expect(res.status).toBe(201);
    expect(await messagesDuBail(contract.id)).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("notification de nouveau message"), expect.any(Error));
  });

  it("un message du locataire ne déclenche aucun e-mail (l'agence le voit dans sa messagerie)", async () => {
    const { tenant, contract } = await agence();
    await createTenantPortalUser(tenant);

    const res = await request(app).post(`/api/messages/${contract.id}`).set(authHeader(await tokenLocataire(tenant.id))).send({ content: "Merci !" });

    expect(res.status).toBe(201);
    expect(courriel).not.toHaveBeenCalled();
  });

  it("la messagerie est une fonction Pro : refusée au gestionnaire Starter, sans message enregistré ni e-mail ; le locataire de cette agence peut écrire", async () => {
    const { tenant, contract, h } = await agence("STARTER");

    const manager = await request(app).post(`/api/messages/${contract.id}`).set(h).send({ content: "Bonjour" });
    await createTenantPortalUser(tenant);
    const locataire = await request(app).post(`/api/messages/${contract.id}`).set(authHeader(await tokenLocataire(tenant.id))).send({ content: "Bonjour" });

    expect(manager.status).toBe(403);
    expect(courriel).not.toHaveBeenCalled();
    expect(locataire.status).toBe(201);
    expect(await messagesDuBail(contract.id)).toHaveLength(1);
  });

  it("un contenu vide ou démesuré est refusé avant tout enregistrement", async () => {
    const { contract, h } = await agence();

    expect((await request(app).post(`/api/messages/${contract.id}`).set(h).send({ content: "   " })).status).toBe(400);
    expect((await request(app).post(`/api/messages/${contract.id}`).set(h).send({ content: "x".repeat(5001) })).status).toBe(400);
    expect((await request(app).post(`/api/messages/${contract.id}`).set(h).send({ content: "x".repeat(5000) })).status).toBe(201);
    expect(await messagesDuBail(contract.id)).toHaveLength(1);
  });
});

describe("GET /api/messages/:contractId?tenantId=… : fils du bail côté gestionnaire", () => {
  it("un identifiant de locataire inconnu : 404 (CONVERSATION_NOT_FOUND)", async () => {
    const { contract, h } = await agence();

    const res = await request(app).get(`/api/messages/${contract.id}?tenantId=locataire-inexistant`).set(h);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CONVERSATION_NOT_FOUND");
  });

  it("un locataire qui n'est ni titulaire, ni colocataire, ni ancien colocataire : 404, aucun message exposé", async () => {
    const { manager, contract, h } = await agence();
    const etranger = await createTenant(manager.id, { firstName: "Moussa", lastName: "Fall" });

    const res = await request(app).get(`/api/messages/${contract.id}?tenantId=${etranger.id}`).set(h);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CONVERSATION_NOT_FOUND");
  });

  it("un ancien colocataire qui a des messages : fil consultable, mais on ne lui écrit plus (409)", async () => {
    const { manager, contract, h } = await agence();
    const ancien = await createTenant(manager.id, { firstName: "Binta", lastName: "Kane", email: "binta@example.com" });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: ancien.id });
    await testDb.insert(messages).values({ contractId: contract.id, senderId: manager.id, senderRole: "MANAGER", tenantId: ancien.id, content: "Bienvenue", isRead: false });
    await testDb.delete(contractCotenants).where(eq(contractCotenants.tenantId, ancien.id));

    const lecture = await request(app).get(`/api/messages/${contract.id}?tenantId=${ancien.id}`).set(h);
    const ecriture = await request(app).post(`/api/messages/${contract.id}?tenantId=${ancien.id}`).set(h).send({ content: "Encore" });

    expect(lecture.status).toBe(200);
    expect(JSON.stringify(lecture.body)).toContain("Bienvenue");
    expect(ecriture.status).toBe(409);
    expect(ecriture.body.code).toBe("COTENANT_THREAD_READ_ONLY");
  });

  it("un contrat inconnu : 404 (CONTRACT_NOT_FOUND)", async () => {
    const { h } = await agence();

    const res = await request(app).get("/api/messages/bail-inexistant").set(h);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CONTRACT_NOT_FOUND");
  });

  it("le bail d'une autre agence est refusé comme inconnu", async () => {
    const { contract } = await agence();
    const autre = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });

    const res = await request(app).get(`/api/messages/${contract.id}`).set(authHeader(tokenFor(autre)));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CONTRACT_NOT_FOUND");
  });
});
