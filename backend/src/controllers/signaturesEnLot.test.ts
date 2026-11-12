import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { issueReports, messages } from "../db/schema";
import * as storageService from "../services/storage.service";
import { authHeader, createContract, createManager, createProperty, createTenant, createTenantPortalUser, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Les listes demandaient une URL signée PAR fichier : une page de 20 incidents à 10 photos faisait 200 appels au stockage, un fil
 * de messagerie un appel par vocal. Elles en font maintenant un seul par liste. Ces tests comptent les appels.
 */
let unitaire: ReturnType<typeof vi.spyOn>;
let enLot: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  unitaire = vi.spyOn(storageService, "getSignedUrl").mockImplementation(async (chemin: string) => `https://stockage.test/signe/${chemin}`);
  enLot = vi
    .spyOn(storageService, "getSignedUrls")
    .mockImplementation(async (chemins: string[]) => new Map(chemins.map((c) => [c, `https://stockage.test/signe/${c}`] as const)));
});
afterEach(() => vi.restoreAllMocks());

async function agence(overrides: Partial<Parameters<typeof createContract>[2]> = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id, overrides);
  const portail = await createTenantPortalUser(tenant);
  return { manager, tenant, contract, portail, h: authHeader(tokenFor(manager)), hLocataire: authHeader(tokenFor(portail, tenant.id)) };
}

describe("Incidents — photos signées en un seul appel par liste", () => {
  it("la liste du gestionnaire (4 incidents × 3 photos) fait UN appel au stockage, et chaque photo reçoit son lien", async () => {
    const { contract, tenant, h } = await agence();
    for (let i = 0; i < 4; i++) {
      await testDb.insert(issueReports).values({
        contractId: contract.id,
        tenantId: tenant.id,
        title: `Incident ${i}`,
        description: "Description",
        photoUrl: `issues/principale-${i}.jpg`,
        additionalPhotos: JSON.stringify([`issues/${i}-a.jpg`, `issues/${i}-b.jpg`]),
      });
    }

    const res = await request(app).get("/api/issues").set(h);

    expect(res.status).toBe(200);
    expect(enLot).toHaveBeenCalledTimes(1);
    expect(enLot.mock.calls[0][0]).toHaveLength(12);
    expect(unitaire).not.toHaveBeenCalled();
    const incident = res.body.items.find((i: { title: string }) => i.title === "Incident 2");
    expect(incident.photoUrl).toBe("https://stockage.test/signe/issues/principale-2.jpg");
    expect(JSON.parse(incident.additionalPhotos)).toEqual(["https://stockage.test/signe/issues/2-a.jpg", "https://stockage.test/signe/issues/2-b.jpg"]);
  });

  it("la liste du locataire aussi, et les anciennes photos déjà publiques (URL complète) ne sont pas signées", async () => {
    const { contract, tenant, hLocataire } = await agence();
    await testDb.insert(issueReports).values({
      contractId: contract.id,
      tenantId: tenant.id,
      title: "Ancien",
      description: "Description",
      photoUrl: "https://ancien-bucket.test/photo.jpg",
      additionalPhotos: JSON.stringify(["issues/nouvelle.jpg"]),
    });

    const res = await request(app).get("/api/issues/mine").set(hLocataire);

    expect(res.status).toBe(200);
    expect(enLot).toHaveBeenCalledTimes(1);
    expect(enLot.mock.calls[0][0]).toEqual(["issues/nouvelle.jpg"]);
    expect(unitaire).not.toHaveBeenCalled();
    expect(res.body[0].photoUrl).toBe("https://ancien-bucket.test/photo.jpg");
    expect(JSON.parse(res.body[0].additionalPhotos)).toEqual(["https://stockage.test/signe/issues/nouvelle.jpg"]);
  });

  it("une photo non signable disparaît de la liste sans la faire échouer : photo principale vide, supplémentaire écartée", async () => {
    const { contract, tenant, h } = await agence();
    await testDb.insert(issueReports).values({
      contractId: contract.id,
      tenantId: tenant.id,
      title: "Perdue",
      description: "Description",
      photoUrl: "issues/perdue.jpg",
      additionalPhotos: JSON.stringify(["issues/perdue.jpg", "issues/bonne.jpg"]),
    });
    enLot.mockImplementation(async (chemins: string[]) => new Map(chemins.map((c) => [c, c.includes("perdue") ? null : `https://stockage.test/signe/${c}`] as const)));

    const res = await request(app).get("/api/issues").set(h);

    expect(res.status).toBe(200);
    expect(res.body.items[0].photoUrl).toBe("");
    expect(JSON.parse(res.body.items[0].additionalPhotos)).toEqual(["https://stockage.test/signe/issues/bonne.jpg"]);
  });
});

describe("Baux — scans signés en un seul appel par liste", () => {
  it("la liste des baux (3 baux avec scan) fait UN appel au stockage", async () => {
    const manager = await createManager();
    for (let i = 0; i < 3; i++) {
      const property = await createProperty(manager.id);
      const tenant = await createTenant(manager.id);
      await createContract(property.id, tenant.id, { scannedContractUrl: `contracts/scan-${i}.pdf` });
    }
    // Un bail sans scan : rien à signer.
    await createContract((await createProperty(manager.id)).id, (await createTenant(manager.id)).id);

    const res = await request(app).get("/api/contracts").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(4);
    expect(enLot).toHaveBeenCalledTimes(1);
    expect(enLot.mock.calls[0][0]).toHaveLength(3);
    expect(unitaire).not.toHaveBeenCalled();
    const avecScan = res.body.items.filter((c: { scannedContractUrl?: string | null }) => c.scannedContractUrl);
    expect(avecScan).toHaveLength(3);
    expect(avecScan.every((c: { scannedContractUrl: string }) => c.scannedContractUrl.startsWith("https://stockage.test/signe/contracts/scan-"))).toBe(true);
  });

  it("un scan non signable ne fait pas échouer la liste (le chemin est renvoyé tel quel, comme avant)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, { scannedContractUrl: "contracts/perdu.pdf" });
    enLot.mockResolvedValue(new Map([["contracts/perdu.pdf", null]]));

    const res = await request(app).get("/api/contracts").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items[0].scannedContractUrl).toBe("contracts/perdu.pdf");
  });
});

describe("Messagerie — vocaux d'un fil signés en un seul appel", () => {
  it("le fil du locataire (3 vocaux) fait UN appel au stockage", async () => {
    const { manager, contract, tenant, hLocataire } = await agence();
    for (let i = 0; i < 3; i++) {
      await testDb.insert(messages).values({
        contractId: contract.id,
        senderId: manager.id,
        senderRole: "MANAGER",
        tenantId: tenant.id,
        content: "",
        audioPath: `messages/vocal-${i}.webm`,
        audioDurationSec: 5,
        audioMime: "audio/webm",
      });
    }
    await testDb.insert(messages).values({ contractId: contract.id, senderId: manager.id, senderRole: "MANAGER", tenantId: tenant.id, content: "Un message texte" });

    const res = await request(app).get(`/api/messages/${contract.id}`).set(hLocataire);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(4);
    expect(enLot).toHaveBeenCalledTimes(1);
    expect(enLot.mock.calls[0][0]).toHaveLength(3);
    expect(unitaire).not.toHaveBeenCalled();
    const vocaux = res.body.messages.filter((m: { audioUrl: string | null }) => m.audioUrl);
    expect(vocaux).toHaveLength(3);
    expect(vocaux.every((m: { audioPath?: string }) => m.audioPath === undefined)).toBe(true);
  });

  it("un vocal non signable s'affiche sans lecteur (audioUrl nul) sans faire échouer le fil", async () => {
    const { manager, contract, tenant, hLocataire } = await agence();
    await testDb.insert(messages).values({
      contractId: contract.id,
      senderId: manager.id,
      senderRole: "MANAGER",
      tenantId: tenant.id,
      content: "",
      audioPath: "messages/perdu.webm",
      audioDurationSec: 5,
      audioMime: "audio/webm",
    });
    enLot.mockResolvedValue(new Map([["messages/perdu.webm", null]]));

    const res = await request(app).get(`/api/messages/${contract.id}`).set(hLocataire);

    expect(res.status).toBe(200);
    expect(res.body.messages[0].audioUrl).toBeNull();
  });
});
