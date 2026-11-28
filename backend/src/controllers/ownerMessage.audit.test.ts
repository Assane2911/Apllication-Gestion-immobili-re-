import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { ownerMessages, owners } from "../db/schema";
import * as emailService from "../services/email.service";
import { newMessageForOwnerEmail } from "../services/email.service";
import * as storageService from "../services/storage.service";
import { authHeader, createManager, createOwner, createOwnerPortalUser, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { nomAvecCivilite } from "../utils/nom";

/**
 * Audit par sabotage de ownerMessage.controller.ts : ce que les tests de la discussion agence ↔ propriétaire ne vérifiaient pas.
 * Ce que le gestionnaire sait de chaque propriétaire, la liste des fils (qui y figure, dans quel ordre, par pages, avec quel
 * dernier message et combien de non-lus), les bornes d'un fil à l'autre à la lecture, l'e-mail envoyé au propriétaire, et
 * les messages vocaux (refus d'un fichier absent ou d'un propriétaire injoignable, type et durée conservés).
 */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypM4A ", "ascii"), Buffer.alloc(64, 1)]);

let upload: ReturnType<typeof vi.spyOn>;
let courriel: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  upload = vi.spyOn(storageService, "uploadPrivateFile").mockResolvedValue("messages/proprio-1.webm");
  vi.spyOn(storageService, "getSignedUrl").mockImplementation(async (chemin: string) => `https://stockage.test/${chemin}`);
  vi.spyOn(storageService, "getSignedUrls").mockImplementation(async (chemins: string[]) => new Map(chemins.map((c) => [c, `https://stockage.test/${c}`] as const)));
  courriel = vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
});
afterEach(() => vi.restoreAllMocks());

let compteur = 0;
/** Un propriétaire de l'agence, avec (ou sans) compte portail. */
async function proprietaire(managerId: string, valeurs: Partial<typeof owners.$inferInsert> = {}, portail = true) {
  const owner = await createOwner(managerId, { id: `proprio-${++compteur}`, ...valeurs });
  const compte = portail ? await createOwnerPortalUser(owner) : null;
  const [fiche] = await testDb.select().from(owners).where(eq(owners.id, owner.id));
  return { owner: fiche as typeof owners.$inferSelect, compte, h: compte ? authHeader(tokenFor(compte, null, owner.id)) : undefined };
}
type Ligne = { ownerId: string; managerId: string; senderId: string; senderRole: "MANAGER" | "OWNER"; content: string } & Partial<typeof ownerMessages.$inferInsert>;
async function ecrire(v: Ligne) {
  const [m] = await testDb.insert(ownerMessages).values({ isRead: false, ...v }).returning();
  return m;
}
const jour = (n: number) => new Date(2026, 7, n, 10, 0, 0);
const contenus = (res: request.Response) => (res.body.messages as Array<{ content: string }>).map((m) => m.content);

describe("ce que le gestionnaire sait de chaque propriétaire", () => {
  it("le fil rend l'identité complète du propriétaire, son nom affiché, et s'il a accès à son espace", async () => {
    const manager = await createManager();
    const { owner } = await proprietaire(manager.id, { firstName: "Fatou", lastName: "Diop", companyName: "Diop Immobilier", civility: "MME" });
    const sansAcces = await proprietaire(manager.id, { firstName: "Moussa", lastName: "Ba" }, false);
    await ecrire({ ownerId: sansAcces.owner.id, managerId: manager.id, senderId: manager.id, senderRole: "MANAGER", content: "Bonjour" });

    const avecAcces = await request(app).get(`/api/owner-messages/${owner.id}`).set(authHeader(tokenFor(manager)));
    const sans = await request(app).get(`/api/owner-messages/${sansAcces.owner.id}`).set(authHeader(tokenFor(manager)));

    expect(avecAcces.body.owner).toEqual({
      id: owner.id,
      firstName: "Fatou",
      lastName: "Diop",
      companyName: "Diop Immobilier",
      civility: "MME",
      displayName: nomAvecCivilite(owner),
      hasPortalAccess: true,
    });
    expect(sans.body.owner.hasPortalAccess).toBe(false);
  });
});

describe("liste des fils de l'agence", () => {
  it("n'y figurent que les propriétaires avec accès ou avec messages, de cette agence, non effacés ; le plus récemment actif d'abord, puis par nom", async () => {
    const manager = await createManager();
    const autreAgence = await createManager();
    const ow1 = await proprietaire(manager.id, { lastName: "Zed", firstName: "Awa" });
    const ow2 = await proprietaire(manager.id, { lastName: "Alpha", firstName: "Awa" });
    const ow3 = await proprietaire(manager.id, { lastName: "Beta", firstName: "Awa" }, false);
    const ow4 = await proprietaire(manager.id, { lastName: "Mu", firstName: "Anna" });
    const ow5 = await proprietaire(manager.id, { lastName: "Mu", firstName: "Zoe" });
    const ow6 = await proprietaire(manager.id, { lastName: "Abel", firstName: "Awa" });
    await proprietaire(manager.id, { lastName: "Sans", firstName: "Rien" }, false);
    const efface = await proprietaire(manager.id, { lastName: "Efface", firstName: "Awa", anonymizedAt: new Date() });
    const ailleurs = await proprietaire(autreAgence.id, { lastName: "Ailleurs", firstName: "Awa" });
    await ecrire({ ownerId: efface.owner.id, managerId: manager.id, senderId: manager.id, senderRole: "MANAGER", content: "ancien fil effacé", createdAt: jour(20) });
    await ecrire({ ownerId: ailleurs.owner.id, managerId: autreAgence.id, senderId: autreAgence.id, senderRole: "MANAGER", content: "chez l'autre agence", createdAt: jour(21) });
    await ecrire({ ownerId: ow1.owner.id, managerId: manager.id, senderId: manager.id, senderRole: "MANAGER", content: "tout récent", createdAt: jour(15) });
    await ecrire({ ownerId: ow2.owner.id, managerId: manager.id, senderId: manager.id, senderRole: "MANAGER", content: "ancien", createdAt: jour(2) });
    await ecrire({ ownerId: ow3.owner.id, managerId: manager.id, senderId: manager.id, senderRole: "MANAGER", content: "sans accès", createdAt: jour(1) });

    const page1 = await request(app).get("/api/owner-messages/conversations?pageSize=2&page=1").set(authHeader(tokenFor(manager)));
    const page2 = await request(app).get("/api/owner-messages/conversations?pageSize=2&page=2").set(authHeader(tokenFor(manager)));
    const page3 = await request(app).get("/api/owner-messages/conversations?pageSize=2&page=3").set(authHeader(tokenFor(manager)));

    const ids = (r: request.Response) => (r.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids(page1)).toEqual([ow1.owner.id, ow2.owner.id]);
    expect(ids(page2)).toEqual([ow3.owner.id, ow6.owner.id]);
    expect(ids(page3)).toEqual([ow4.owner.id, ow5.owner.id]);
    for (const page of [page1, page2, page3]) expect(page.body).toMatchObject({ total: 6, totalPages: 3, pageSize: 2 });
  });

  it("chaque fil porte son propriétaire, son DERNIER message et le nombre de messages du propriétaire non lus (pas ceux de l'agence)", async () => {
    const manager = await createManager();
    const ow = await proprietaire(manager.id, { firstName: "Fatou", lastName: "Diop", civility: "MME" });
    await ecrire({ ownerId: ow.owner.id, managerId: manager.id, senderId: ow.compte!.id, senderRole: "OWNER", content: "premier", createdAt: jour(1) });
    await ecrire({ ownerId: ow.owner.id, managerId: manager.id, senderId: ow.compte!.id, senderRole: "OWNER", content: "déjà lu", isRead: true, createdAt: jour(2) });
    await ecrire({ ownerId: ow.owner.id, managerId: manager.id, senderId: ow.compte!.id, senderRole: "OWNER", content: "second", createdAt: jour(3) });
    await ecrire({ ownerId: ow.owner.id, managerId: manager.id, senderId: manager.id, senderRole: "MANAGER", content: "réponse de l'agence", createdAt: jour(4) });
    const calme = await proprietaire(manager.id, { firstName: "Moussa", lastName: "Ba" });

    const res = await request(app).get("/api/owner-messages/conversations").set(authHeader(tokenFor(manager)));

    const [avecMessages, sansMessage] = res.body.items;
    expect(avecMessages).toMatchObject({ id: ow.owner.id, unreadCount: 2, owner: { id: ow.owner.id, displayName: nomAvecCivilite(ow.owner), hasPortalAccess: true } });
    expect(avecMessages.lastMessage).toMatchObject({ content: "réponse de l'agence", isVoice: false });
    expect(avecMessages.lastMessage.audioPath).toBeUndefined();
    expect(sansMessage).toMatchObject({ id: calme.owner.id, unreadCount: 0, lastMessage: null });
  });
});

describe("lecture d'un fil", () => {
  it("ne marque comme lus que les messages de CE propriétaire ; en lecture incrémentale, ne rend « lus » que MES messages de ce fil ; sans repère, pas de liste de lus", async () => {
    const manager = await createManager();
    const a = await proprietaire(manager.id, { firstName: "Awa" });
    const b = await proprietaire(manager.id, { firstName: "Bintou" });
    const repere = await ecrire({ ownerId: a.owner.id, managerId: manager.id, senderId: a.compte!.id, senderRole: "OWNER", content: "Repère", createdAt: jour(1) });
    const maReponse = await ecrire({ ownerId: a.owner.id, managerId: manager.id, senderId: manager.id, senderRole: "MANAGER", content: "Ma réponse", isRead: true, createdAt: jour(2) });
    await ecrire({ ownerId: b.owner.id, managerId: manager.id, senderId: manager.id, senderRole: "MANAGER", content: "Ma réponse à Bintou", isRead: true, createdAt: jour(3) });
    const deBintou = await ecrire({ ownerId: b.owner.id, managerId: manager.id, senderId: b.compte!.id, senderRole: "OWNER", content: "Message de Bintou", createdAt: jour(4) });
    const h = authHeader(tokenFor(manager));

    const sansRepere = await request(app).get(`/api/owner-messages/${a.owner.id}`).set(h);
    const avecRepere = await request(app).get(`/api/owner-messages/${a.owner.id}`).query({ apresId: repere.id }).set(h);

    expect(sansRepere.body).not.toHaveProperty("luesIds");
    expect(avecRepere.body.luesIds).toEqual([maReponse.id]);
    expect(contenus(avecRepere)).toEqual(["Ma réponse"]);
    expect((await testDb.select().from(ownerMessages).where(eq(ownerMessages.id, deBintou.id)))[0].isRead).toBe(false);
  });

  it("le gestionnaire voit l'identifiant et l'adresse de connexion de l'auteur de chaque message", async () => {
    const manager = await createManager();
    const ow = await proprietaire(manager.id);
    await ecrire({ ownerId: ow.owner.id, managerId: manager.id, senderId: ow.compte!.id, senderRole: "OWNER", content: "Bonjour" });

    const res = await request(app).get(`/api/owner-messages/${ow.owner.id}`).set(authHeader(tokenFor(manager)));

    expect(res.body.messages[0].sender).toEqual({ id: ow.compte!.id, email: ow.compte!.email, role: "OWNER" });
  });
});

describe("accès et écriture du gestionnaire", () => {
  it("le propriétaire d'une autre agence est « introuvable » (404, code et message), et le contenu est validé AVANT l'accès (400)", async () => {
    const manager = await createManager();
    const ailleurs = await proprietaire((await createManager()).id);

    const lecture = await request(app).get(`/api/owner-messages/${ailleurs.owner.id}`).set(authHeader(tokenFor(manager)));
    const videAilleurs = await request(app).post(`/api/owner-messages/${ailleurs.owner.id}`).set(authHeader(tokenFor(manager))).send({ content: "   " });

    expect([lecture.status, lecture.body.code, lecture.body.error]).toEqual([404, "OWNER_NOT_FOUND", "Propriétaire introuvable"]);
    expect(videAilleurs.status).toBe(400);
  });

  it("un vocal à un propriétaire sans accès à son espace est refusé (409), rien n'est téléversé ; un vocal au propriétaire garde son type et sa durée", async () => {
    const manager = await createManager();
    const sansAcces = await proprietaire(manager.id, {}, false);
    const avecAcces = await proprietaire(manager.id);
    const h = authHeader(tokenFor(manager));
    const envoyer = (ownerId: string) => request(app).post(`/api/owner-messages/${ownerId}/audio`).set(h).field("durationSec", "12").attach("audio", MP4, { filename: "v.m4a", contentType: "audio/mp4" });

    const refuse = await envoyer(sansAcces.owner.id);
    const accepte = await envoyer(avecAcces.owner.id);

    expect([refuse.status, refuse.body.code]).toEqual([409, "OWNER_NO_PORTAL_ACCESS"]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(accepte.status).toBe(201);
    expect(accepte.body).toMatchObject({ audioMime: "audio/mp4", audioDurationSec: 12, content: "" });
  });
});

describe("messages vocaux du propriétaire", () => {
  it("un enregistrement absent est refusé (400 AUDIO_REQUIRED) ; sinon il est rangé dans le dossier « messages » avec son type et sa durée", async () => {
    const manager = await createManager();
    const ow = await proprietaire(manager.id);

    const absent = await request(app).post("/api/owner-messages/mine/audio").set(ow.h!).field("durationSec", "9");
    const present = await request(app).post("/api/owner-messages/mine/audio").set(ow.h!).field("durationSec", "12").attach("audio", MP4, { filename: "v.m4a", contentType: "audio/mp4" });

    expect([absent.status, absent.body.code]).toEqual([400, "AUDIO_REQUIRED"]);
    expect(present.status).toBe(201);
    expect(present.body).toMatchObject({ audioMime: "audio/mp4", audioDurationSec: 12, senderRole: "OWNER" });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][1]).toBe("messages");
  });
});

describe("e-mail au propriétaire", () => {
  it("le propriétaire est prévenu dans SA langue, avec son nom et l'adresse du site ; rien si le propriétaire n'a pas d'adresse", async () => {
    const manager = await createManager();
    const ow = await proprietaire(manager.id, { firstName: "Fatou", lastName: "Diop", civility: "MME", language: "en", email: "fatou@example.com" });
    const sansAdresse = await proprietaire(manager.id, { email: "" });
    const attendu = newMessageForOwnerEmail({ ownerName: nomAvecCivilite(ow.owner), content: "Votre CRG est prêt", frontendUrl: env.frontendUrl, langue: "en" });
    const h = authHeader(tokenFor(manager));

    await request(app).post(`/api/owner-messages/${ow.owner.id}`).set(h).send({ content: "Votre CRG est prêt" });
    const sansEmail = await request(app).post(`/api/owner-messages/${sansAdresse.owner.id}`).set(h).send({ content: "Bonjour" });

    expect(sansEmail.status).toBe(201);
    expect(courriel).toHaveBeenCalledTimes(1);
    expect(courriel.mock.calls[0]).toEqual(["fatou@example.com", attendu.subject, attendu.html]);
  });

  it("un propriétaire effacé ne reçoit rien : l'écriture est refusée (409 OWNER_ANONYMIZED_LOCKED) avant tout enregistrement ou e-mail", async () => {
    const manager = await createManager();
    const efface = await proprietaire(manager.id, { email: "ancien@example.com", anonymizedAt: new Date() });

    const res = await request(app).post(`/api/owner-messages/${efface.owner.id}`).set(authHeader(tokenFor(manager))).send({ content: "Bonjour" });

    expect([res.status, res.body.code]).toEqual([409, "OWNER_ANONYMIZED_LOCKED"]);
    expect(courriel).not.toHaveBeenCalled();
    expect(await testDb.select().from(ownerMessages).where(eq(ownerMessages.ownerId, efface.owner.id))).toHaveLength(0);
  });
});

