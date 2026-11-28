import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { contractCotenants, messages } from "../db/schema";
import * as emailService from "../services/email.service";
import { newMessageFromManagerEmail } from "../services/email.service";
import * as storageService from "../services/storage.service";
import { authHeader, createContract, createManager, createProperty, createTenant, createTenantPortalUser, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { libelleMessageVocal } from "../utils/messageVocal";

/**
 * Audit par sabotage de message.controller.ts : ce que les tests de la messagerie ne vérifiaient pas. Les frontières entre fils
 * (un locataire qui a plusieurs baux, un colocataire dans deux baux, un ancien colocataire), la liste des conversations (ordre,
 * pages, total, dernier message, anciennes lignes sans locataire), ce que la lecture rend et marque comme lu, la pastille des
 * non-lus, et le message vocal (durée, formule, type, notification au locataire).
 */
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypM4A ", "ascii"), Buffer.alloc(64, 1)]);

let courriel: ReturnType<typeof vi.spyOn>;
let signe: ReturnType<typeof vi.spyOn>;
let signeEnLot: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  courriel = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(storageService, "uploadPrivateFile").mockResolvedValue("messages/123-456.webm");
  signe = vi.spyOn(storageService, "getSignedUrl").mockImplementation(async (chemin: string) => `https://stockage.test/${chemin}`);
  signeEnLot = vi.spyOn(storageService, "getSignedUrls").mockImplementation(async (chemins: string[]) => new Map(chemins.map((c) => [c, `https://stockage.test/${c}`] as const)));
});
afterEach(() => vi.restoreAllMocks());

let compteur = 0;
async function agence(options: { plan?: "PRO" | "STARTER"; locataire?: Partial<typeof import("../db/schema").tenants.$inferInsert> } = {}) {
  const n = ++compteur;
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: options.plan ?? "PRO" });
  const property = await createProperty(manager.id, { title: "Villa Ngor" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: `awa${n}@example.com`, ...options.locataire });
  const contract = await createContract(property.id, tenant.id);
  const compte = await createTenantPortalUser(tenant);
  return { manager, property, tenant, contract, compte, hM: authHeader(tokenFor(manager)), hT: authHeader(tokenFor(compte, tenant.id)) };
}
type Agence = Awaited<ReturnType<typeof agence>>;

/** Un second bail du même locataire, sur un autre bien. */
async function autreBail(a: Agence, titre: string, createdAt?: Date) {
  const property = await createProperty(a.manager.id, { title: titre });
  return createContract(property.id, a.tenant.id, createdAt ? { createdAt } : {});
}
async function colocataire(a: Agence, contractIds: string[], id: string) {
  const coloc = await createTenant(a.manager.id, { id, firstName: "Binta", lastName: "Kane", email: `${id}@example.com` });
  for (const contractId of contractIds) await testDb.insert(contractCotenants).values({ contractId, tenantId: coloc.id });
  const compte = await createTenantPortalUser(coloc);
  return { coloc, compte, h: authHeader(tokenFor(compte, coloc.id)) };
}
type Ligne = { contractId: string; senderId: string; senderRole: "MANAGER" | "TENANT"; content: string } & Partial<typeof messages.$inferInsert>;
async function ecrire(v: Ligne) {
  const [m] = await testDb.insert(messages).values({ isRead: false, ...v }).returning();
  return m;
}
const contenus = (res: request.Response) => (res.body.messages as Array<{ content: string }>).map((m) => m.content);
const jour = (n: number) => new Date(2026, 7, n, 10, 0, 0);

describe("frontières entre fils", () => {
  it("un locataire titulaire de deux baux ne voit dans chaque fil que les messages de CE bail, anciennes lignes comprises", async () => {
    const a = await agence();
    const bailB = await autreBail(a, "Villa Mamelles");
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: a.tenant.id, content: "dans A", createdAt: jour(1) });
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: null, content: "ancienne ligne de A", createdAt: jour(2) });
    await ecrire({ contractId: bailB.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: a.tenant.id, content: "dans B", createdAt: jour(3) });
    await ecrire({ contractId: bailB.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: null, content: "ancienne ligne de B", createdAt: jour(4) });

    const parGestionnaire = await request(app).get(`/api/messages/${a.contract.id}`).set(a.hM);
    const parLocataire = await request(app).get(`/api/messages/${a.contract.id}`).set(a.hT);

    expect(contenus(parGestionnaire)).toEqual(["dans A", "ancienne ligne de A"]);
    expect(contenus(parLocataire)).toEqual(["dans A", "ancienne ligne de A"]);
    expect(parLocataire.body.qualite).toBe("TITULAIRE");
  });

  it("un colocataire de deux baux ne voit dans chaque fil que ses messages de CE bail ; il est qualifié « colocataire »", async () => {
    const a = await agence();
    const bailB = await autreBail(a, "Villa Mamelles");
    const { coloc, h } = await colocataire(a, [a.contract.id, bailB.id], "coloc-deux-baux");
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: coloc.id, content: "coloc dans A", createdAt: jour(1) });
    await ecrire({ contractId: bailB.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: coloc.id, content: "coloc dans B", createdAt: jour(2) });

    const parLocataire = await request(app).get(`/api/messages/${a.contract.id}`).set(h);
    const parGestionnaire = await request(app).get(`/api/messages/${a.contract.id}?tenantId=${coloc.id}`).set(a.hM);

    expect(contenus(parLocataire)).toEqual(["coloc dans A"]);
    expect(contenus(parGestionnaire)).toEqual(["coloc dans A"]);
    expect(parLocataire.body.qualite).toBe("COLOCATAIRE");
    expect(parGestionnaire.body.qualite).toBe("COLOCATAIRE");
    expect(parGestionnaire.body.tenantId).toBe(coloc.id);
  });

  it("l'ancien colocataire : son fil reste lisible, qualifié « colocataire », mais on ne lui envoie plus de message vocal (409)", async () => {
    const a = await agence();
    const ancien = await createTenant(a.manager.id, { id: "ancien-colocataire", firstName: "Zeina", lastName: "Ba" });
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "TENANT", tenantId: ancien.id, content: "Bonjour, c'est Zeina" });

    const lecture = await request(app).get(`/api/messages/${a.contract.id}?tenantId=${ancien.id}`).set(a.hM);
    const vocal = await request(app).post(`/api/messages/${a.contract.id}/audio?tenantId=${ancien.id}`).set(a.hM).field("durationSec", "12").attach("audio", WEBM, { filename: "v.webm", contentType: "audio/webm" });

    expect(lecture.status).toBe(200);
    expect(lecture.body.qualite).toBe("COLOCATAIRE");
    expect(contenus(lecture)).toEqual(["Bonjour, c'est Zeina"]);
    expect([vocal.status, vocal.body.code]).toEqual([409, "COTENANT_THREAD_READ_ONLY"]);
  });

  it("le gestionnaire d'une autre agence reçoit « Contrat introuvable » (404)", async () => {
    const a = await agence();
    const autre = await agence();

    const res = await request(app).get(`/api/messages/${a.contract.id}`).set(autre.hM);

    expect([res.status, res.body.code, res.body.error]).toEqual([404, "CONTRACT_NOT_FOUND", "Contrat introuvable"]);
  });
});

describe("lecture d'un fil", () => {
  it("rend le bail avec son bien et son locataire, l'identifiant du locataire, et au gestionnaire seulement l'auteur de chaque message", async () => {
    const a = await agence();
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: a.tenant.id, content: "Bonjour" });

    const gestionnaire = await request(app).get(`/api/messages/${a.contract.id}`).set(a.hM);
    const locataire = await request(app).get(`/api/messages/${a.contract.id}`).set(a.hT);

    expect(gestionnaire.body.contract.property).toMatchObject({ id: a.property.id, title: "Villa Ngor" });
    expect(gestionnaire.body.contract.tenant).toMatchObject({ id: a.tenant.id, firstName: "Awa" });
    expect(gestionnaire.body.tenantId).toBe(a.tenant.id);
    expect(gestionnaire.body.messages[0].sender).toEqual({ id: a.manager.id, email: a.manager.email, role: "MANAGER" });
    expect(locataire.body.messages[0].sender).toBeUndefined();
    expect(locataire.body.messages[0].senderId).toBeUndefined();
  });

  it("ne marque comme lus que les messages de CE fil reçus par le lecteur ; ceux des autres baux restent non lus", async () => {
    const a = await agence();
    const bailB = await autreBail(a, "Villa Mamelles");
    const dansA = await ecrire({ contractId: a.contract.id, senderId: a.compte.id, senderRole: "TENANT", tenantId: a.tenant.id, content: "Message dans A" });
    const dansB = await ecrire({ contractId: bailB.id, senderId: a.compte.id, senderRole: "TENANT", tenantId: a.tenant.id, content: "Message dans B" });

    await request(app).get(`/api/messages/${a.contract.id}`).set(a.hM);

    expect((await testDb.select().from(messages).where(eq(messages.id, dansA.id)))[0].isRead).toBe(true);
    expect((await testDb.select().from(messages).where(eq(messages.id, dansB.id)))[0].isRead).toBe(false);
  });

  it("en lecture incrémentale, les messages « lus » rendus sont les MIENS de ce fil, jamais ceux des autres baux", async () => {
    const a = await agence();
    const bailB = await autreBail(a, "Villa Mamelles");
    const repere = await ecrire({ contractId: a.contract.id, senderId: a.compte.id, senderRole: "TENANT", tenantId: a.tenant.id, content: "Repère", createdAt: jour(1) });
    const miennePortee = await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: a.tenant.id, content: "Ma réponse", isRead: true, createdAt: jour(2) });
    await ecrire({ contractId: bailB.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: a.tenant.id, content: "Ma réponse ailleurs", isRead: true, createdAt: jour(3) });

    const res = await request(app).get(`/api/messages/${a.contract.id}`).query({ apresId: repere.id }).set(a.hM);

    expect(res.body.luesIds).toEqual([miennePortee.id]);
    expect(contenus(res)).toEqual(["Ma réponse"]);
  });

  it("un message vocal dont le lien n'a pas pu être généré s'affiche sans lecteur (audioUrl nul, pas absent)", async () => {
    const a = await agence();
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: a.tenant.id, content: "", audioPath: "messages/perdu.webm", audioDurationSec: 5, audioMime: "audio/webm" });
    signeEnLot.mockResolvedValue(new Map());

    const res = await request(app).get(`/api/messages/${a.contract.id}`).set(a.hM);

    expect(res.status).toBe(200);
    expect(res.body.messages[0]).toHaveProperty("audioUrl", null);
    expect(res.body.messages[0].audioPath).toBeUndefined();
  });
});

describe("liste des conversations d'un locataire", () => {
  it("les baux les plus récents d'abord, par pages, avec le vrai total, le bien et le DERNIER message (ligne non rattachée comprise)", async () => {
    const a = await agence();
    await testDb.update((await import("../db/schema")).contracts).set({ createdAt: jour(1) }).where(eq((await import("../db/schema")).contracts.id, a.contract.id));
    const bail2 = await autreBail(a, "Villa Mamelles", jour(2));
    const bail3 = await autreBail(a, "Villa Almadies", jour(3));
    const etranger = await agence();
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: a.tenant.id, content: "ancien", createdAt: jour(10) });
    await ecrire({ contractId: a.contract.id, senderId: a.compte.id, senderRole: "TENANT", tenantId: a.tenant.id, content: "intermédiaire", createdAt: jour(11) });
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: null, content: "récent, ligne non rattachée", createdAt: jour(12) });
    await ecrire({ contractId: etranger.contract.id, senderId: etranger.manager.id, senderRole: "MANAGER", tenantId: etranger.tenant.id, content: "chez un autre" });

    const page1 = await request(app).get("/api/messages/conversations?pageSize=2&page=1").set(a.hT);
    const page2 = await request(app).get("/api/messages/conversations?pageSize=2&page=2").set(a.hT);

    expect(page1.body.items.map((c: { contractId: string }) => c.contractId)).toEqual([bail3.id, bail2.id]);
    expect(page2.body.items.map((c: { contractId: string }) => c.contractId)).toEqual([a.contract.id]);
    for (const page of [page1, page2]) expect(page.body).toMatchObject({ total: 3, totalPages: 2, pageSize: 2 });
    const premier = page2.body.items[0];
    expect(premier).toMatchObject({ id: `${a.contract.id}:${a.tenant.id}`, tenantId: a.tenant.id, qualite: "TITULAIRE" });
    expect(premier.property).toMatchObject({ title: "Villa Ngor" });
    expect(premier.lastMessage).toMatchObject({ content: "récent, ligne non rattachée", isVoice: false });
    expect(premier.lastMessage.audioPath).toBeUndefined();
    expect(page1.body.items[0].lastMessage).toBeNull();
  });
});

describe("liste des conversations d'un gestionnaire", () => {
  it("un fil par titulaire, colocataire et ancien colocataire, dans cet ordre ; chaque fil porte SON locataire ; aucun fil d'une autre agence", async () => {
    const a = await agence();
    const { coloc } = await colocataire(a, [a.contract.id], "coloc-z");
    const ancien = await createTenant(a.manager.id, { id: "ancien-a", firstName: "Zeina", lastName: "Ba" });
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "TENANT", tenantId: ancien.id, content: "message de l'ancien", createdAt: jour(5) });
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: null, content: "ligne non rattachée du titulaire", createdAt: jour(6) });
    const autre = await agence();
    const ancienAilleurs = await createTenant(autre.manager.id, { id: "ancien-ailleurs", firstName: "Awa", lastName: "Fall" });
    await ecrire({ contractId: autre.contract.id, senderId: autre.manager.id, senderRole: "TENANT", tenantId: ancienAilleurs.id, content: "chez l'autre agence" });

    const res = await request(app).get("/api/messages/conversations").set(a.hM);

    const items = res.body.items as Array<{ tenantId: string; qualite: string; tenant: { id: string }; lastMessage: { content: string } | null }>;
    expect(items.map((i) => [i.tenantId, i.qualite])).toEqual([[a.tenant.id, "TITULAIRE"], [coloc.id, "COLOCATAIRE"], [ancien.id, "COLOCATAIRE"]]);
    expect(items.map((i) => i.tenant.id)).toEqual([a.tenant.id, coloc.id, ancien.id]);
    expect(res.body.total).toBe(3);
    expect(items[0].lastMessage?.content).toBe("ligne non rattachée du titulaire");
    expect(items[2].lastMessage?.content).toBe("message de l'ancien");
  });
});

describe("pastille des messages non lus d'un locataire", () => {
  it("compte les messages de l'agence non lus de SON fil, anciennes lignes non rattachées comprises, mais pas celles des baux des autres", async () => {
    const a = await agence();
    const autre = await agence();
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: a.tenant.id, content: "rattaché" });
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: null, content: "ancienne ligne" });
    await ecrire({ contractId: a.contract.id, senderId: a.manager.id, senderRole: "MANAGER", tenantId: a.tenant.id, content: "déjà lu", isRead: true });
    await ecrire({ contractId: autre.contract.id, senderId: autre.manager.id, senderRole: "MANAGER", tenantId: null, content: "ancienne ligne d'un autre bail" });

    const res = await request(app).get("/api/messages/unread-count").set(a.hT);

    expect(res.body).toEqual({ count: 2 });
  });
});

describe("message vocal", () => {
  const envoyer = (contractId: string, header: Record<string, string>, duree: string, octets: Buffer = WEBM, type = "audio/webm") =>
    request(app).post(`/api/messages/${contractId}/audio`).set(header).field("durationSec", duree).attach("audio", octets, { filename: "v.webm", contentType: type });

  it("la durée est un nombre entier de secondes, de 1 à 185 (3 minutes + 5 secondes de tolérance)", async () => {
    const a = await agence();

    const decimale = await envoyer(a.contract.id, a.hM, "12.5");
    const limite = await envoyer(a.contract.id, a.hM, "185");
    const trop = await envoyer(a.contract.id, a.hM, "186");

    expect(decimale.status).toBe(400);
    expect(limite.status).toBe(201);
    expect(trop.status).toBe(400);
  });

  it("exige la formule Pro du gestionnaire (403), pas celle du locataire", async () => {
    const starter = await agence({ plan: "STARTER" });

    const gestionnaire = await envoyer(starter.contract.id, starter.hM, "12");
    const locataire = await envoyer(starter.contract.id, starter.hT, "12");

    expect(gestionnaire.status).toBe(403);
    expect(locataire.status).toBe(201);
  });

  it("garde le type de l'enregistrement (MP4 de Safari), n'est jamais écrit « déjà lu », et un lien de signature en échec ne fait pas échouer l'envoi", async () => {
    const a = await agence();
    signe.mockRejectedValue(new Error("stockage indisponible"));

    const res = await envoyer(a.contract.id, a.hT, "12", MP4, "audio/mp4");

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ audioMime: "audio/mp4", audioDurationSec: 12, audioUrl: null, isRead: false });
    const [ligne] = await testDb.select().from(messages).where(eq(messages.contractId, a.contract.id));
    expect(ligne).toMatchObject({ audioMime: "audio/mp4", isRead: false });
  });

  it("le locataire est prévenu par e-mail, dans SA langue, avec son nom, le bien et la durée du vocal ; un échec d'envoi ne fait pas échouer le vocal", async () => {
    const a = await agence({ locataire: { language: "en" } });
    const attendu = newMessageFromManagerEmail({
      tenantName: "Awa Sow",
      propertyTitle: "Villa Ngor",
      content: libelleMessageVocal("en", 12),
      frontendUrl: env.frontendUrl,
      langue: "en",
    });

    const res = await envoyer(a.contract.id, a.hM, "12");

    expect(res.status).toBe(201);
    expect(courriel).toHaveBeenCalledTimes(1);
    expect(courriel.mock.calls[0]).toEqual([a.tenant.email, attendu.subject, attendu.html]);

    courriel.mockRejectedValue(new Error("smtp en panne"));
    const enPanne = await envoyer(a.contract.id, a.hM, "12");
    expect(enPanne.status).toBe(201);
  });

  it("aucun e-mail quand c'est le locataire qui écrit, quand le locataire est effacé, ou quand il n'a pas d'adresse", async () => {
    const a = await agence();
    const efface = await agence({ locataire: { anonymizedAt: new Date() } });
    const sansAdresse = await agence({ locataire: { email: "" } });

    await envoyer(a.contract.id, a.hT, "12");
    await envoyer(efface.contract.id, efface.hM, "12");
    await envoyer(sansAdresse.contract.id, sansAdresse.hM, "12");

    expect(courriel).not.toHaveBeenCalled();
  });
});

describe("message texte : notification dans la langue du locataire", () => {
  it("le courriel est celui de la langue du locataire (ici l'espagnol)", async () => {
    const a = await agence({ locataire: { language: "es" } });
    const attendu = newMessageFromManagerEmail({ tenantName: "Awa Sow", propertyTitle: "Villa Ngor", content: "Bonjour", frontendUrl: env.frontendUrl, langue: "es" });

    const res = await request(app).post(`/api/messages/${a.contract.id}`).set(a.hM).send({ content: "Bonjour" });

    expect(res.status).toBe(201);
    expect(courriel.mock.calls[0]).toEqual([a.tenant.email, attendu.subject, attendu.html]);
  });
});
