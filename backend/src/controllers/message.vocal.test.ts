import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { messages } from "../db/schema";
import * as storageService from "../services/storage.service";
import { authHeader, createContract, createManager, createProperty, createTenant, createTenantPortalUser, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypM4A ", "ascii"), Buffer.alloc(64, 1)]);
const OGG = Buffer.concat([Buffer.from("OggS", "ascii"), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

let upload: ReturnType<typeof vi.spyOn>;
let signe: ReturnType<typeof vi.spyOn>;
let signeEnLot: ReturnType<typeof vi.spyOn>;
let suppression: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  upload = vi.spyOn(storageService, "uploadPrivateFile").mockResolvedValue("messages/123-456.webm");
  signe = vi.spyOn(storageService, "getSignedUrl").mockImplementation(async (chemin: string) => `https://stockage.test/signe/${chemin}`);
  signeEnLot = vi.spyOn(storageService, "getSignedUrls").mockImplementation(async (chemins: string[]) => new Map(chemins.map((c) => [c, `https://stockage.test/signe/${c}`] as const)));
  suppression = vi.spyOn(storageService, "deleteStorageObjectBestEffort").mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

async function bail() {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  const portail = await createTenantPortalUser(tenant);
  return { manager, tenant, contract, tokenManager: tokenFor(manager), tokenTenant: tokenFor(portail, tenant.id) };
}

function envoyer(contractId: string, token: string, octets: Buffer, opts: { type?: string; duree?: string | null } = {}) {
  const req = request(app).post(`/api/messages/${contractId}/audio`).set(authHeader(token));
  if (opts.duree !== null) req.field("durationSec", opts.duree ?? "12");
  return req.attach("audio", octets, { filename: "vocal.webm", contentType: opts.type ?? "audio/webm;codecs=opus" });
}

describe("Messages vocaux (POST /api/messages/:contractId/audio)", () => {
  it("range l'enregistrement dans le stockage privé et renvoie un lien signé, jamais le chemin", async () => {
    const { contract, tokenManager } = await bail();
    const res = await envoyer(contract.id, tokenManager, WEBM);

    expect(res.status).toBe(201);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][1]).toBe("messages");
    expect(upload.mock.calls[0][0]).toMatchObject({ mimetype: "audio/webm" });
    expect(res.body).toMatchObject({ content: "", audioDurationSec: 12, audioMime: "audio/webm", audioUrl: "https://stockage.test/signe/messages/123-456.webm" });
    expect(res.body.audioPath).toBeUndefined();
    const [ligne] = await testDb.select().from(messages).where(eq(messages.contractId, contract.id));
    expect(ligne.audioPath).toBe("messages/123-456.webm");
  });

  it("accepte aussi les enregistrements de Safari (MP4) et de Firefox (Ogg)", async () => {
    const { contract, tokenManager } = await bail();
    expect((await envoyer(contract.id, tokenManager, MP4, { type: "audio/mp4" })).status).toBe(201);
    expect((await envoyer(contract.id, tokenManager, OGG, { type: "audio/ogg;codecs=opus" })).status).toBe(201);
  });

  it("refuse un fichier dont le contenu n'est pas celui du type déclaré, sans rien téléverser", async () => {
    const { contract, tokenManager } = await bail();
    const res = await envoyer(contract.id, tokenManager, PNG);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUDIO_CONTENT_MISMATCH");
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuse un type qui n'est pas de l'audio", async () => {
    const { contract, tokenManager } = await bail();
    const res = await envoyer(contract.id, tokenManager, PNG, { type: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUDIO_TYPE_NOT_ALLOWED");
    expect(upload).not.toHaveBeenCalled();
  });

  it("exige un enregistrement et une durée valide (1 seconde à 3 minutes)", async () => {
    const { contract, tokenManager } = await bail();
    const sansFichier = await request(app).post(`/api/messages/${contract.id}/audio`).set(authHeader(tokenManager)).field("durationSec", "12");
    expect(sansFichier.status).toBe(400);
    expect(sansFichier.body.code).toBe("AUDIO_REQUIRED");

    expect((await envoyer(contract.id, tokenManager, WEBM, { duree: null })).status).toBe(400);
    expect((await envoyer(contract.id, tokenManager, WEBM, { duree: "0" })).status).toBe(400);
    expect((await envoyer(contract.id, tokenManager, WEBM, { duree: "400" })).status).toBe(400);
    expect((await envoyer(contract.id, tokenManager, WEBM, { duree: "abc" })).status).toBe(400);
    expect((await envoyer(contract.id, tokenManager, WEBM, { duree: "183" })).status).toBe(201);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("le locataire écrit dans son propre fil ; un autre gestionnaire n'a aucun accès au bail", async () => {
    const { contract, tokenTenant } = await bail();
    expect((await envoyer(contract.id, tokenTenant, WEBM)).status).toBe(201);

    upload.mockClear();
    const autre = await createManager();
    const refus = await envoyer(contract.id, tokenFor(autre), WEBM);
    expect([403, 404]).toContain(refus.status);
    expect(upload).not.toHaveBeenCalled();
  });

  it("sans jeton, refuse", async () => {
    const { contract } = await bail();
    const res = await request(app).post(`/api/messages/${contract.id}/audio`).field("durationSec", "5").attach("audio", WEBM, { filename: "v.webm", contentType: "audio/webm" });
    expect(res.status).toBe(401);
  });
});

describe("Lecture d'un fil contenant des vocaux", () => {
  it("joint un lien signé à chaque vocal, sans jamais exposer le chemin ni l'auteur au locataire", async () => {
    const { contract, tokenManager, tokenTenant } = await bail();
    await envoyer(contract.id, tokenManager, WEBM);
    await request(app).post(`/api/messages/${contract.id}`).set(authHeader(tokenManager)).send({ content: "Bonjour" });

    const cote = await request(app).get(`/api/messages/${contract.id}`).set(authHeader(tokenTenant));
    expect(cote.status).toBe(200);
    const [vocal, texte] = cote.body.messages;
    expect(vocal.audioUrl).toBe("https://stockage.test/signe/messages/123-456.webm");
    expect(vocal.audioPath).toBeUndefined();
    expect(vocal.senderId).toBeUndefined();
    expect(texte.audioUrl).toBeNull();
    expect(texte.content).toBe("Bonjour");
  });

  it("n'échoue pas quand un lien signé est impossible : le message s'affiche sans lecteur", async () => {
    const { contract, tokenManager } = await bail();
    await envoyer(contract.id, tokenManager, WEBM);
    // Le fil se lit par lot (un seul appel au stockage) : une panne y rend tous les liens nuls.
    signeEnLot.mockImplementation(async (chemins: string[]) => new Map(chemins.map((c) => [c, null] as const)));
    signe.mockRejectedValue(new Error("stockage indisponible"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await request(app).get(`/api/messages/${contract.id}`).set(authHeader(tokenManager));
    expect(res.status).toBe(200);
    expect(res.body.messages[0].audioUrl).toBeNull();
    expect(res.body.messages[0].audioDurationSec).toBe(12);
  });

  it("indique dans la liste des fils que le dernier message est un vocal, sans lien ni chemin", async () => {
    const { contract, tokenManager } = await bail();
    await envoyer(contract.id, tokenManager, WEBM);
    signe.mockClear();
    const res = await request(app).get("/api/messages/conversations").set(authHeader(tokenManager));
    const dernier = res.body.items[0].lastMessage;
    expect(dernier.isVoice).toBe(true);
    expect(dernier.audioPath).toBeUndefined();
    expect(dernier.audioUrl).toBeUndefined();
    expect(signe).not.toHaveBeenCalled();
  });
});

describe("Effacement des vocaux", () => {
  it("l'anonymisation d'un locataire retire sa voix du stockage, sans toucher aux vocaux de l'agence", async () => {
    const { contract, tenant, tokenManager, tokenTenant } = await bail();
    await envoyer(contract.id, tokenTenant, WEBM);
    upload.mockResolvedValue("messages/agence.webm");
    await envoyer(contract.id, tokenManager, WEBM);

    const res = await request(app).post(`/api/tenants/${tenant.id}/anonymiser`).set(authHeader(tokenManager));
    expect(res.status).toBe(200);

    // Le fichier est retiré du stockage (la suppression de l'accès au portail emporte aussi ses messages en base).
    expect(suppression).toHaveBeenCalledWith("messages/123-456.webm");
    expect(suppression).not.toHaveBeenCalledWith("messages/agence.webm");
    const lignes = await testDb.select().from(messages).where(eq(messages.contractId, contract.id));
    expect(lignes.some((m: typeof messages.$inferSelect) => m.senderRole === "TENANT")).toBe(false);
    expect(lignes.find((m: typeof messages.$inferSelect) => m.senderRole === "MANAGER")?.audioPath).toBe("messages/agence.webm");
  });
});
