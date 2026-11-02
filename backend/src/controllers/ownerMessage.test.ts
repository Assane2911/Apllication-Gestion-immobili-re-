import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { ownerMessages, owners } from "../db/schema";
import * as emailService from "../services/email.service";
import * as storageService from "../services/storage.service";
import { authHeader, createManager, createOwner, createOwnerPortalUser, createProperty, tokenFor, tokenProprietaire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

let upload: ReturnType<typeof vi.spyOn>;
let suppression: ReturnType<typeof vi.spyOn>;
let courriel: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  upload = vi.spyOn(storageService, "uploadPrivateFile").mockResolvedValue("messages/proprio-1.webm");
  vi.spyOn(storageService, "getSignedUrl").mockImplementation(async (chemin: string) => `https://stockage.test/signe/${chemin}`);
  suppression = vi.spyOn(storageService, "deleteStorageObjectBestEffort").mockResolvedValue(undefined);
  courriel = vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
});
afterEach(() => vi.restoreAllMocks());

/** Une agence, un propriétaire invité (compte portail) et les deux jetons. */
async function agence(overrides: Parameters<typeof createManager>[0] = {}) {
  const manager = await createManager(overrides);
  const owner = await createOwner(manager.id);
  const tokenOwner = await tokenProprietaire(owner);
  return { manager, owner, tokenManager: tokenFor(manager), tokenOwner };
}

const ecrire = (ownerId: string, token: string, content = "Bonjour") =>
  request(app).post(`/api/owner-messages/${ownerId}`).set(authHeader(token)).send({ content });

function envoyerVocal(url: string, token: string, octets: Buffer = WEBM, opts: { type?: string; duree?: string } = {}) {
  return request(app)
    .post(url)
    .set(authHeader(token))
    .field("durationSec", opts.duree ?? "9")
    .attach("audio", octets, { filename: "vocal.webm", contentType: opts.type ?? "audio/webm;codecs=opus" });
}

describe("Discussion agence ↔ propriétaire : texte", () => {
  it("le gestionnaire écrit, le propriétaire lit puis répond, et chacun voit l'échange", async () => {
    const { owner, tokenManager, tokenOwner } = await agence();

    const envoi = await ecrire(owner.id, tokenManager, "Votre CRG de mars est prêt.");
    expect(envoi.status).toBe(201);
    expect(envoi.body).toMatchObject({ content: "Votre CRG de mars est prêt.", senderRole: "MANAGER", isRead: false, audioUrl: null });

    const cote = await request(app).get("/api/owner-messages/mine").set(authHeader(tokenOwner));
    expect(cote.status).toBe(200);
    expect(cote.body.messages).toHaveLength(1);
    expect(cote.body.messages[0].content).toBe("Votre CRG de mars est prêt.");
    // L'auteur (id et adresse de connexion) ne sort pas de l'espace gestionnaire.
    expect(cote.body.messages[0].senderId).toBeUndefined();
    expect(cote.body.messages[0].sender).toBeUndefined();

    const reponse = await request(app).post("/api/owner-messages/mine").set(authHeader(tokenOwner)).send({ content: "Merci !" });
    expect(reponse.status).toBe(201);
    expect(reponse.body.senderRole).toBe("OWNER");

    const fil = await request(app).get(`/api/owner-messages/${owner.id}`).set(authHeader(tokenManager));
    expect(fil.status).toBe(200);
    expect(fil.body.messages.map((m: { content: string }) => m.content)).toEqual(["Votre CRG de mars est prêt.", "Merci !"]);
    expect(fil.body.messages[1].sender).toMatchObject({ role: "OWNER" });
    expect(fil.body.owner).toMatchObject({ id: owner.id, hasPortalAccess: true });
  });

  it("refuse un message vide ou trop long", async () => {
    const { owner, tokenManager, tokenOwner } = await agence();
    expect((await ecrire(owner.id, tokenManager, "   ")).status).toBe(400);
    expect((await ecrire(owner.id, tokenManager, "x".repeat(5001))).status).toBe(400);
    expect((await request(app).post("/api/owner-messages/mine").set(authHeader(tokenOwner)).send({ content: "" })).status).toBe(400);
  });

  it("ouvrir le fil marque lus les messages reçus, pas ceux que l'on a écrits", async () => {
    const { owner, tokenManager, tokenOwner } = await agence();
    await ecrire(owner.id, tokenManager, "Question");
    await request(app).post("/api/owner-messages/mine").set(authHeader(tokenOwner)).send({ content: "Réponse" });

    // Le propriétaire ouvre : le message du gestionnaire passe en lu, le sien reste non lu côté gestionnaire.
    await request(app).get("/api/owner-messages/mine").set(authHeader(tokenOwner));
    const lignes = await testDb.select().from(ownerMessages).where(eq(ownerMessages.ownerId, owner.id));
    expect(lignes.find((m: typeof ownerMessages.$inferSelect) => m.senderRole === "MANAGER")?.isRead).toBe(true);
    expect(lignes.find((m: typeof ownerMessages.$inferSelect) => m.senderRole === "OWNER")?.isRead).toBe(false);

    const liste = await request(app).get("/api/owner-messages/conversations").set(authHeader(tokenManager));
    expect(liste.body.items[0].unreadCount).toBe(1);
    await request(app).get(`/api/owner-messages/${owner.id}`).set(authHeader(tokenManager));
    const apres = await request(app).get("/api/owner-messages/conversations").set(authHeader(tokenManager));
    expect(apres.body.items[0].unreadCount).toBe(0);
  });

  it("prévient le propriétaire par e-mail quand l'agence lui écrit, et seulement dans ce sens", async () => {
    const { owner, tokenManager, tokenOwner } = await agence();
    await ecrire(owner.id, tokenManager, "Bonjour à vous");
    expect(courriel).toHaveBeenCalledTimes(1);
    expect(courriel.mock.calls[0][0]).toBe(owner.email);
    expect(courriel.mock.calls[0][2]).toContain("/proprietaire/messages");
    expect(courriel.mock.calls[0][2]).toContain("Bonjour à vous");

    courriel.mockClear();
    await request(app).post("/api/owner-messages/mine").set(authHeader(tokenOwner)).send({ content: "Merci" });
    expect(courriel).not.toHaveBeenCalled();
  });

  it("un échec d'envoi du courriel ne fait pas échouer le message", async () => {
    const { owner, tokenManager } = await agence();
    courriel.mockRejectedValue(new Error("smtp"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await ecrire(owner.id, tokenManager)).status).toBe(201);
  });
});

describe("Discussion agence ↔ propriétaire : accès et isolation", () => {
  it("un gestionnaire ne lit ni n'écrit dans le fil d'un propriétaire d'une autre agence", async () => {
    const { owner } = await agence();
    const autre = await createManager();
    const jeton = tokenFor(autre);
    expect((await request(app).get(`/api/owner-messages/${owner.id}`).set(authHeader(jeton))).status).toBe(404);
    expect((await ecrire(owner.id, jeton)).status).toBe(404);
    expect((await envoyerVocal(`/api/owner-messages/${owner.id}/audio`, jeton)).status).toBe(404);
    expect(upload).not.toHaveBeenCalled();
    expect(await testDb.select().from(ownerMessages)).toHaveLength(0);
  });

  it("la liste des fils ne montre que les propriétaires de l'agence", async () => {
    const a = await agence();
    const b = await agence();
    await ecrire(a.owner.id, a.tokenManager, "pour A");
    await ecrire(b.owner.id, b.tokenManager, "pour B");

    const res = await request(app).get("/api/owner-messages/conversations").set(authHeader(a.tokenManager));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([a.owner.id]);
    expect(res.body.items[0].lastMessage.content).toBe("pour A");
  });

  it("un propriétaire ne voit que son fil, jamais celui d'un autre propriétaire de la même agence", async () => {
    const { manager, owner, tokenManager, tokenOwner } = await agence();
    const second = await createOwner(manager.id, { firstName: "Moussa" });
    const tokenSecond = await tokenProprietaire(second);
    await ecrire(owner.id, tokenManager, "secret de Fatou");
    await ecrire(second.id, tokenManager, "secret de Moussa");

    const sien = await request(app).get("/api/owner-messages/mine").set(authHeader(tokenSecond));
    expect(sien.body.messages.map((m: { content: string }) => m.content)).toEqual(["secret de Moussa"]);
    const autre = await request(app).get("/api/owner-messages/mine").set(authHeader(tokenOwner));
    expect(autre.body.messages.map((m: { content: string }) => m.content)).toEqual(["secret de Fatou"]);
    // Les routes du gestionnaire lui sont fermées, même avec l'identifiant de sa propre fiche.
    expect((await request(app).get(`/api/owner-messages/${owner.id}`).set(authHeader(tokenOwner))).status).toBe(403);
    expect((await request(app).get("/api/owner-messages/conversations").set(authHeader(tokenOwner))).status).toBe(403);
  });

  it("refuse l'accès aux locataires, sans jeton, et à un compte sans fiche propriétaire", async () => {
    const { owner } = await agence();
    expect((await request(app).get("/api/owner-messages/mine")).status).toBe(401);
    expect((await request(app).get(`/api/owner-messages/${owner.id}`)).status).toBe(401);

    const manager = await createManager();
    expect((await request(app).get("/api/owner-messages/mine").set(authHeader(tokenFor(manager)))).status).toBe(403);

    // Un compte OWNER dont la fiche a été détachée n'ouvre rien : la base tranche, pas le jeton.
    const orphelin = await createOwner(manager.id);
    const compte = await createOwnerPortalUser(orphelin);
    await testDb.update(owners).set({ userId: null }).where(eq(owners.id, orphelin.id));
    const res = await request(app).get("/api/owner-messages/mine").set(authHeader(tokenFor(compte, null, orphelin.id)));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OWNER_NOT_LINKED");
  });

  it("n'écrit pas à un propriétaire sans accès à son espace, ni à un propriétaire anonymisé", async () => {
    const manager = await createManager();
    const sansAcces = await createOwner(manager.id);
    const res = await ecrire(sansAcces.id, tokenFor(manager));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("OWNER_NO_PORTAL_ACCESS");

    await testDb.update(owners).set({ anonymizedAt: new Date() }).where(eq(owners.id, sansAcces.id));
    expect((await ecrire(sansAcces.id, tokenFor(manager))).body.code).toBe("OWNER_ANONYMIZED_LOCKED");
    expect(courriel).not.toHaveBeenCalled();
  });

  it("l'envoi par le gestionnaire est réservé à la formule Pro ; le propriétaire écrit toujours", async () => {
    const { owner, tokenManager, tokenOwner } = await agence({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });
    const refus = await ecrire(owner.id, tokenManager);
    expect(refus.status).toBe(403);
    expect(refus.body.code).toBe("PLAN_REQUIRED");
    expect((await envoyerVocal(`/api/owner-messages/${owner.id}/audio`, tokenManager)).status).toBe(403);
    expect(upload).not.toHaveBeenCalled();

    expect((await request(app).post("/api/owner-messages/mine").set(authHeader(tokenOwner)).send({ content: "Je peux écrire" })).status).toBe(201);
  });

  it("l'agence dont l'abonnement est échu ne peut plus consulter la liste, mais le propriétaire garde son accès", async () => {
    const { tokenOwner } = await agence({ subscriptionStatus: "EXPIRED", trialEndsAt: new Date(Date.now() - 86_400_000) });
    expect((await request(app).get("/api/owner-messages/mine").set(authHeader(tokenOwner))).status).toBe(200);
  });
});

describe("Discussion agence ↔ propriétaire : messages vocaux", () => {
  it("le gestionnaire et le propriétaire s'envoient des vocaux : stockage privé, lien signé, jamais le chemin", async () => {
    const { owner, tokenManager, tokenOwner } = await agence();

    const du_gestionnaire = await envoyerVocal(`/api/owner-messages/${owner.id}/audio`, tokenManager);
    expect(du_gestionnaire.status).toBe(201);
    expect(upload.mock.calls[0][1]).toBe("messages");
    expect(du_gestionnaire.body).toMatchObject({ content: "", audioDurationSec: 9, audioMime: "audio/webm", audioUrl: "https://stockage.test/signe/messages/proprio-1.webm" });
    expect(du_gestionnaire.body.audioPath).toBeUndefined();
    // Le courriel annonce un vocal, avec sa durée.
    expect(courriel.mock.calls[0][2]).toContain("0:09");

    upload.mockResolvedValue("messages/proprio-2.webm");
    const du_proprietaire = await envoyerVocal("/api/owner-messages/mine/audio", tokenOwner);
    expect(du_proprietaire.status).toBe(201);
    expect(du_proprietaire.body.senderRole).toBe("OWNER");

    const cote = await request(app).get("/api/owner-messages/mine").set(authHeader(tokenOwner));
    expect(cote.body.messages).toHaveLength(2);
    expect(cote.body.messages[0].audioUrl).toBe("https://stockage.test/signe/messages/proprio-1.webm");
    expect(cote.body.messages[0].audioPath).toBeUndefined();
  });

  it("aperçu de la liste : le dernier message est signalé comme vocal, sans lien ni chemin", async () => {
    const { owner, tokenManager } = await agence();
    await envoyerVocal(`/api/owner-messages/${owner.id}/audio`, tokenManager);
    const res = await request(app).get("/api/owner-messages/conversations").set(authHeader(tokenManager));
    const dernier = res.body.items[0].lastMessage;
    expect(dernier.isVoice).toBe(true);
    expect(dernier.audioPath).toBeUndefined();
    expect(dernier.audioUrl).toBeUndefined();
  });

  it("applique les mêmes contrôles que la messagerie des locataires (contenu, type, durée, présence)", async () => {
    const { owner, tokenManager, tokenOwner } = await agence();
    const url = `/api/owner-messages/${owner.id}/audio`;

    const mensonge = await envoyerVocal(url, tokenManager, PNG);
    expect(mensonge.body.code).toBe("AUDIO_CONTENT_MISMATCH");
    const typeRefuse = await envoyerVocal(url, tokenManager, PNG, { type: "image/png" });
    expect(typeRefuse.body.code).toBe("AUDIO_TYPE_NOT_ALLOWED");
    expect((await envoyerVocal(url, tokenManager, WEBM, { duree: "0" })).status).toBe(400);
    expect((await envoyerVocal(url, tokenManager, WEBM, { duree: "400" })).status).toBe(400);
    const sansFichier = await request(app).post(url).set(authHeader(tokenManager)).field("durationSec", "5");
    expect(sansFichier.body.code).toBe("AUDIO_REQUIRED");
    expect((await envoyerVocal("/api/owner-messages/mine/audio", tokenOwner, PNG)).body.code).toBe("AUDIO_CONTENT_MISMATCH");
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("Discussion agence ↔ propriétaire : effacement", () => {
  async function avecVocaux() {
    const ctx = await agence();
    await envoyerVocal(`/api/owner-messages/${ctx.owner.id}/audio`, ctx.tokenManager);
    upload.mockResolvedValue("messages/du-proprietaire.webm");
    await envoyerVocal("/api/owner-messages/mine/audio", ctx.tokenOwner);
    await ecrire(ctx.owner.id, ctx.tokenManager, "texte");
    return ctx;
  }

  it("l'anonymisation du propriétaire efface sa discussion (texte et vocaux) et retire les fichiers du stockage", async () => {
    const { owner, tokenManager } = await avecVocaux();
    const res = await request(app).post(`/api/owners/${owner.id}/anonymiser`).set(authHeader(tokenManager));
    expect(res.status).toBe(200);

    expect(await testDb.select().from(ownerMessages).where(eq(ownerMessages.ownerId, owner.id))).toHaveLength(0);
    expect(suppression).toHaveBeenCalledWith("messages/proprio-1.webm");
    expect(suppression).toHaveBeenCalledWith("messages/du-proprietaire.webm");

    // Plus de fil dans la liste de l'agence, et plus aucune écriture possible.
    const liste = await request(app).get("/api/owner-messages/conversations").set(authHeader(tokenManager));
    expect(liste.body.total).toBe(0);
    expect((await ecrire(owner.id, tokenManager)).status).toBe(409);
  });

  it("la suppression de la fiche d'un propriétaire sans bien emporte son fil et ses fichiers", async () => {
    const { owner, tokenManager } = await avecVocaux();
    const res = await request(app).delete(`/api/owners/${owner.id}`).set(authHeader(tokenManager));
    expect(res.status).toBe(204);
    expect(await testDb.select().from(ownerMessages)).toHaveLength(0);
    expect(suppression).toHaveBeenCalledWith("messages/proprio-1.webm");
    expect(suppression).toHaveBeenCalledWith("messages/du-proprietaire.webm");
  });

  it("l'anonymisation d'un propriétaire ne touche pas la discussion d'un autre", async () => {
    const { manager, owner, tokenManager } = await avecVocaux();
    const second = await createOwner(manager.id, { firstName: "Moussa" });
    await createOwnerPortalUser(second);
    await ecrire(second.id, tokenManager, "pour Moussa");

    await request(app).post(`/api/owners/${owner.id}/anonymiser`).set(authHeader(tokenManager));
    const restant = await testDb.select().from(ownerMessages);
    expect(restant.map((m: typeof ownerMessages.$inferSelect) => m.ownerId)).toEqual([second.id]);
  });

  it("la suppression du compte de l'agence efface aussi les vocaux de ses propriétaires", async () => {
    const { manager, tokenManager } = await avecVocaux();
    await createProperty(manager.id);
    const res = await request(app).delete("/api/auth/account").set(authHeader(tokenManager)).send({ password: "Password123!" });
    expect(res.status).toBeLessThan(300);
    expect(await testDb.select().from(ownerMessages)).toHaveLength(0);
    expect(suppression).toHaveBeenCalledWith("messages/proprio-1.webm");
    expect(suppression).toHaveBeenCalledWith("messages/du-proprietaire.webm");
  });
});

describe("Cloche de l'agence", () => {
  it("signale les messages non lus d'un propriétaire, puis s'éteint quand le fil est ouvert", async () => {
    const { owner, tokenManager, tokenOwner } = await agence();
    await request(app).post("/api/owner-messages/mine").set(authHeader(tokenOwner)).send({ content: "Où en est mon virement ?" });
    await request(app).post("/api/owner-messages/mine").set(authHeader(tokenOwner)).send({ content: "Merci de me répondre" });

    const cloche = await request(app).get("/api/notifications").set(authHeader(tokenManager));
    const notif = cloche.body.notifications.find((n: { id: string }) => n.id === `owner-message-${owner.id}`);
    expect(notif).toMatchObject({ type: "message", link: "/messages/proprietaires" });
    expect(notif.title).toContain("2 nouveaux messages");
    expect(notif.title).toContain("Fatou Diop");

    await request(app).get(`/api/owner-messages/${owner.id}`).set(authHeader(tokenManager));
    const apres = await request(app).get("/api/notifications").set(authHeader(tokenManager));
    expect(apres.body.notifications.some((n: { id: string }) => n.id === `owner-message-${owner.id}`)).toBe(false);
  });

  it("ne signale pas les messages des propriétaires d'une autre agence", async () => {
    const a = await agence();
    const b = await agence();
    await request(app).post("/api/owner-messages/mine").set(authHeader(b.tokenOwner)).send({ content: "pour B" });
    const cloche = await request(app).get("/api/notifications").set(authHeader(a.tokenManager));
    expect(cloche.body.notifications.some((n: { id: string }) => n.id.startsWith("owner-message-"))).toBe(false);
  });
});
