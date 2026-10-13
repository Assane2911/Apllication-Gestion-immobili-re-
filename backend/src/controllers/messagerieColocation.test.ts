import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { initDb } from "../db/init";
import { contractCotenants, contracts, messages } from "../db/schema";
import * as emailService from "../services/email.service";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenFor, tokenLocataire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Messagerie en colocation : chaque locataire du bail (titulaire ou colocataire) a son propre fil
 * avec l'agence, que les autres locataires ne voient pas. Le gestionnaire voit un fil par locataire.
 */
let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  envoi = vi.spyOn(emailService, "sendEmail");
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function colocation() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const property = await createProperty(manager.id, { title: "Appartement T3" });
  const titulaire = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: "awa@example.com" });
  const coloc = await createTenant(manager.id, { firstName: "Binta", lastName: "Kane", email: "binta@example.com" });
  const contract = await createContract(property.id, titulaire.id, { status: "ACTIVE" });
  await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });
  return {
    manager,
    titulaire,
    coloc,
    contract,
    hGestion: authHeader(tokenFor(manager)),
    hTitulaire: authHeader(await tokenLocataire(titulaire.id)),
    hColoc: authHeader(await tokenLocataire(coloc.id)),
  };
}

const ecrire = (h: Record<string, string>, contractId: string, content: string, tenantId?: string) =>
  request(app)
    .post(`/api/messages/${contractId}`)
    .query(tenantId ? { tenantId } : {})
    .set(h)
    .send({ content });
const lire = (h: Record<string, string>, contractId: string, tenantId?: string) =>
  request(app)
    .get(`/api/messages/${contractId}`)
    .query(tenantId ? { tenantId } : {})
    .set(h);
const contenus = (res: request.Response) => res.body.messages.map((m: { content: string }) => m.content);

describe("fils de discussion en colocation", () => {
  it("le colocataire écrit à l'agence dans son fil, que le titulaire ne voit pas (et inversement)", async () => {
    const { contract, coloc, hTitulaire, hColoc } = await colocation();

    const envoye = await ecrire(hColoc, contract.id, "Bonjour, ici Binta");
    expect(envoye.status).toBe(201);
    expect(envoye.body.tenantId).toBe(coloc.id);
    await ecrire(hTitulaire, contract.id, "Bonjour, ici Awa");

    expect(contenus(await lire(hColoc, contract.id))).toEqual(["Bonjour, ici Binta"]);
    expect(contenus(await lire(hTitulaire, contract.id))).toEqual(["Bonjour, ici Awa"]);
    // Le paramètre tenantId n'ouvre pas le fil d'un autre locataire.
    expect(contenus(await lire(hColoc, contract.id, contract.tenantId))).toEqual(["Bonjour, ici Binta"]);
  });

  it("le gestionnaire voit un fil par locataire, et répond au colocataire, qui reçoit l'email", async () => {
    const { contract, coloc, titulaire, hGestion, hColoc } = await colocation();
    await ecrire(hColoc, contract.id, "Question de Binta");

    const liste = await request(app).get("/api/messages/conversations").set(hGestion);
    expect(liste.status).toBe(200);
    // Un bail, deux fils (le titulaire et le colocataire) : le total compte les fils.
    expect(liste.body.total).toBe(2);
    expect(liste.body.items.map((c: { tenantId: string; qualite: string; lastMessage: { content: string } | null }) => [c.tenantId, c.qualite, c.lastMessage?.content ?? null])).toEqual([
      [titulaire.id, "TITULAIRE", null],
      [coloc.id, "COLOCATAIRE", "Question de Binta"],
    ]);
    expect(liste.body.items[1].id).toBe(`${contract.id}:${coloc.id}`);

    const fil = await lire(hGestion, contract.id, coloc.id);
    expect(fil.status).toBe(200);
    expect(fil.body.contract.tenant.firstName).toBe("Binta");
    expect(fil.body.qualite).toBe("COLOCATAIRE");
    expect(contenus(fil)).toEqual(["Question de Binta"]);
    const [lu] = await testDb.select().from(messages).where(eq(messages.content, "Question de Binta"));
    expect(lu.isRead).toBe(true);

    const reponse = await ecrire(hGestion, contract.id, "Réponse à Binta", coloc.id);
    expect(reponse.status).toBe(201);
    expect(reponse.body.tenantId).toBe(coloc.id);
    expect(envoi.mock.calls.map((c: unknown[]) => c[0])).toEqual(["binta@example.com"]);
    expect(envoi.mock.calls[0][2]).toContain("Binta Kane");
    // Le fil du titulaire, ouvert par défaut, n'en sait rien.
    expect(contenus(await lire(hGestion, contract.id))).toEqual([]);
  });

  it("refuse un fil sans rapport avec le bail, et le bail d'une autre agence", async () => {
    const { manager, contract, hGestion } = await colocation();
    const etranger = await createTenant(manager.id);

    expect((await lire(hGestion, contract.id, etranger.id)).status).toBe(404);
    expect((await ecrire(hGestion, contract.id, "x", etranger.id)).status).toBe(404);
    expect((await lire(authHeader(tokenFor(await createManager())), contract.id)).status).toBe(403);
    expect((await lire(authHeader(await tokenLocataire(etranger.id)), contract.id)).status).toBe(403);
  });

  it("le colocataire voit son fil dans sa liste, avec sa qualité", async () => {
    const { contract, coloc, hColoc } = await colocation();

    const liste = await request(app).get("/api/messages/conversations").set(hColoc);

    expect(liste.status).toBe(200);
    expect(liste.body.items).toHaveLength(1);
    expect(liste.body.items[0]).toMatchObject({ id: `${contract.id}:${coloc.id}`, contractId: contract.id, tenantId: coloc.id, qualite: "COLOCATAIRE" });
  });

  it("retiré du bail : son fil reste lisible par le gestionnaire, mais on ne lui écrit plus et il perd l'accès", async () => {
    const { contract, coloc, hGestion, hColoc } = await colocation();
    await ecrire(hColoc, contract.id, "Avant mon départ");
    await testDb.delete(contractCotenants);

    const liste = await request(app).get("/api/messages/conversations").set(hGestion);
    expect(liste.body.items.map((c: { tenantId: string }) => c.tenantId)).toContain(coloc.id);
    expect(contenus(await lire(hGestion, contract.id, coloc.id))).toEqual(["Avant mon départ"]);
    expect((await ecrire(hGestion, contract.id, "Encore là ?", coloc.id)).status).toBe(409);
    expect((await lire(hColoc, contract.id)).status).toBe(403);
    expect((await ecrire(hColoc, contract.id, "Je peux ?")).status).toBe(403);
  });

  it("un ancien message non rattaché appartient au fil du titulaire", async () => {
    const { manager, contract, hTitulaire, hColoc } = await colocation();
    await testDb.insert(messages).values({ contractId: contract.id, senderId: manager.id, senderRole: "MANAGER", content: "Message d'avant", tenantId: null });

    expect(contenus(await lire(hTitulaire, contract.id))).toEqual(["Message d'avant"]);
    expect(contenus(await lire(hColoc, contract.id))).toEqual([]);
  });
});

describe("pagination des fils du gestionnaire", () => {
  const liste = (h: Record<string, string>, page: number, pageSize: number) =>
    request(app).get("/api/messages/conversations").query({ page, pageSize }).set(h);
  const cles = (res: request.Response) => res.body.items.map((c: { contractId: string; qualite: string }) => `${c.contractId.slice(-4)}:${c.qualite}`);

  it("pagine les FILS, pas les baux : la taille de page, l'ordre et le total sont exacts avec une colocation", async () => {
    const { manager, contract, hGestion } = await colocation();
    // Dates de création explicites : B (récent) > A (colocation) > C (ancien).
    await testDb.update(contracts).set({ createdAt: new Date(2026, 5, 1) }).where(eq(contracts.id, contract.id));
    const bail = async (titre: string, createdAt: Date) => {
      const bien = await createProperty(manager.id, { title: titre });
      const locataire = await createTenant(manager.id, { firstName: titre });
      return createContract(bien.id, locataire.id, { status: "ACTIVE", createdAt });
    };
    const contractB = await bail("B", new Date(2026, 8, 1));
    const contractC = await bail("C", new Date(2026, 0, 1));

    const p1 = await liste(hGestion, 1, 2);
    const p2 = await liste(hGestion, 2, 2);

    expect(p1.body).toMatchObject({ total: 4, totalPages: 2, page: 1, pageSize: 2 });
    expect(p1.body.items).toHaveLength(2);
    expect(p2.body.items).toHaveLength(2);
    expect([...cles(p1), ...cles(p2)]).toEqual([
      `${contractB.id.slice(-4)}:TITULAIRE`,
      `${contract.id.slice(-4)}:TITULAIRE`,
      `${contract.id.slice(-4)}:COLOCATAIRE`,
      `${contractC.id.slice(-4)}:TITULAIRE`,
    ]);
    // Chaque fil n'apparaît qu'une fois, d'une page à l'autre.
    const ids = [...p1.body.items, ...p2.body.items].map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("un titulaire ou un colocataire actuel qui a écrit ne compte pas pour un fil de plus", async () => {
    const { contract, hGestion, hTitulaire, hColoc } = await colocation();
    await ecrire(hTitulaire, contract.id, "D'Awa");
    await ecrire(hColoc, contract.id, "De Binta");
    await ecrire(hGestion, contract.id, "Réponse à Binta", contract.tenantId);

    const res = await liste(hGestion, 1, 20);

    expect(res.body.total).toBe(2);
    expect(cles(res)).toEqual([`${contract.id.slice(-4)}:TITULAIRE`, `${contract.id.slice(-4)}:COLOCATAIRE`]);
  });

  it("un ancien colocataire qui a écrit compte pour UN fil, quel que soit le nombre de ses messages", async () => {
    const { contract, hGestion, hColoc } = await colocation();
    await ecrire(hColoc, contract.id, "Premier");
    await ecrire(hColoc, contract.id, "Deuxième");
    await ecrire(hColoc, contract.id, "Troisième");
    await testDb.delete(contractCotenants);

    const res = await liste(hGestion, 1, 20);

    expect(res.body.total).toBe(2);
    expect(cles(res)).toEqual([`${contract.id.slice(-4)}:TITULAIRE`, `${contract.id.slice(-4)}:COLOCATAIRE`]);
    expect(res.body.items[1].lastMessage.content).toBe("Troisième");
  });

  it("ne compte ni ne montre les fils d'une autre agence", async () => {
    const { hGestion } = await colocation();
    await colocation();

    const res = await liste(hGestion, 1, 20);

    expect(res.body.total).toBe(2);
  });

  it("une page au-delà de la dernière est vide, avec le bon total", async () => {
    const { hGestion } = await colocation();

    const res = await liste(hGestion, 5, 20);

    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(2);
  });
});

describe("notifications et export RGPD", () => {
  it("le gestionnaire est notifié par fil ; le titulaire garde la clé historique", async () => {
    const { contract, coloc, hColoc, hTitulaire, hGestion } = await colocation();
    await ecrire(hColoc, contract.id, "De Binta");
    await ecrire(hTitulaire, contract.id, "D'Awa");

    const res = await request(app).get("/api/notifications").set(hGestion);
    const messagesNotifies = res.body.notifications.filter((n: { type: string }) => n.type === "message");
    expect(messagesNotifies.map((n: { id: string; title: string }) => [n.id, n.title]).sort()).toEqual(
      [
        [`message-${contract.id}`, "1 nouveau message de Awa Sow"],
        [`message-${contract.id}-${coloc.id}`, "1 nouveau message de Binta Kane"],
      ].sort()
    );
  });

  it("chaque locataire n'est notifié que des messages de son fil", async () => {
    const { contract, coloc, hGestion, hColoc, hTitulaire } = await colocation();
    await ecrire(hGestion, contract.id, "Pour Binta", coloc.id);

    const pourColoc = await request(app).get("/api/notifications/mine").set(hColoc);
    const pourTitulaire = await request(app).get("/api/notifications/mine").set(hTitulaire);
    expect(pourColoc.body.notifications.some((n: { type: string }) => n.type === "message")).toBe(true);
    expect(pourTitulaire.body.notifications.some((n: { type: string }) => n.type === "message")).toBe(false);
  });

  it("l'export d'un colocataire contient son fil, pas celui du titulaire", async () => {
    const { contract, coloc, hGestion, hColoc, hTitulaire } = await colocation();
    await ecrire(hColoc, contract.id, "Message de Binta");
    await ecrire(hTitulaire, contract.id, "Message d'Awa");

    const exportColoc = await request(app).get(`/api/tenants/${coloc.id}/export`).set(hGestion);

    expect(exportColoc.status).toBe(200);
    expect(exportColoc.body.messages.map((m: { content: string }) => m.content)).toEqual(["Message de Binta"]);
  });
});

describe("initDb : rattachement des messages existants", () => {
  it("rattache au titulaire les messages écrits avant les fils par locataire", async () => {
    const { manager, contract, titulaire } = await colocation();
    await testDb.execute(sql`ALTER TABLE messages DROP COLUMN tenant_id`);
    await testDb.execute(
      sql`INSERT INTO messages (id, contract_id, sender_id, sender_role, content) VALUES ('ancien-1', ${contract.id}, ${manager.id}, 'MANAGER', 'Historique')`
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await initDb();

    const [ligne] = await testDb.select().from(messages).where(eq(messages.id, "ancien-1"));
    expect(ligne.tenantId).toBe(titulaire.id);
  });
});
