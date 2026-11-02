import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import * as emailService from "../services/email.service";
import * as storageService from "../services/storage.service";
import { authHeader, createContract, createManager, createOwner, createProperty, createTenant, createTenantPortalUser, tokenFor, tokenProprietaire } from "../test/authHelpers";

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);

let signe: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.spyOn(storageService, "uploadPrivateFile").mockResolvedValue("messages/x.webm");
  signe = vi.spyOn(storageService, "getSignedUrl").mockImplementation(async (chemin: string) => `https://stockage.test/signe/${chemin}`);
  vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
});
afterEach(() => vi.restoreAllMocks());

const ecrire = (url: string, token: string, content: string) => request(app).post(url).set(authHeader(token)).send({ content });
const lire = (url: string, token: string, apresId?: string) => request(app).get(url).query(apresId ? { apresId } : {}).set(authHeader(token));
// Un message par milliseconde au moins : le tri se fait sur la date de création.
const pause = () => new Promise((r) => setTimeout(r, 15));

describe("Lecture incrémentale d'un fil de locataire (?apresId=)", () => {
  async function bail() {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portail = await createTenantPortalUser(tenant);
    return { contract, tokenManager: tokenFor(manager), tokenTenant: tokenFor(portail, tenant.id), url: `/api/messages/${contract.id}` };
  }

  it("sans repère, rend tout le fil et aucun `luesIds` (réponse inchangée)", async () => {
    const { url, tokenManager, tokenTenant } = await bail();
    await ecrire(url, tokenManager, "un");
    const res = await lire(url, tokenTenant);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.luesIds).toBeUndefined();
  });

  it("avec repère, ne rend que les messages postérieurs — jamais le repère lui-même, même à répétition", async () => {
    const { url, tokenManager, tokenTenant } = await bail();
    const premier = (await ecrire(url, tokenManager, "un")).body;
    await pause();
    const second = (await ecrire(url, tokenManager, "deux")).body;
    await pause();
    await ecrire(url, tokenManager, "trois");

    const apres1 = await lire(url, tokenTenant, premier.id);
    expect(apres1.body.messages.map((m: { content: string }) => m.content)).toEqual(["deux", "trois"]);
    const apres2 = await lire(url, tokenTenant, second.id);
    expect(apres2.body.messages.map((m: { content: string }) => m.content)).toEqual(["trois"]);

    // Le dernier message connu : plus rien de neuf, et ce n'est pas lui qui revient (la date de la base est plus précise que celle du client).
    const dernier = apres1.body.messages[1];
    const vide = await lire(url, tokenTenant, dernier.id);
    expect(vide.status).toBe(200);
    expect(vide.body.messages).toEqual([]);
  });

  it("ne signe que les vocaux renvoyés", async () => {
    const { url, tokenManager, tokenTenant } = await bail();
    const vocal = () => request(app).post(`${url}/audio`).set(authHeader(tokenManager)).field("durationSec", "5").attach("audio", WEBM, { filename: "v.webm", contentType: "audio/webm" });
    await vocal();
    await pause();
    const repere = (await ecrire(url, tokenManager, "texte")).body;
    await pause();
    await vocal();
    signe.mockClear();

    const res = await lire(url, tokenTenant, repere.id);
    expect(res.body.messages).toHaveLength(1);
    expect(signe).toHaveBeenCalledTimes(1);
  });

  it("`luesIds` : mes messages que l'autre partie a lus depuis", async () => {
    const { url, tokenManager, tokenTenant } = await bail();
    const envoye = (await ecrire(url, tokenManager, "bonjour")).body;
    const avant = await lire(url, tokenManager, envoye.id);
    expect(avant.body.luesIds).toEqual([]);

    await lire(url, tokenTenant); // le locataire ouvre son fil : ses messages reçus passent en « lus »
    const apres = await lire(url, tokenManager, envoye.id);
    expect(apres.body.luesIds).toEqual([envoye.id]);
    // Et seulement les MIENS : le locataire ne reçoit pas l'état de lecture des messages du gestionnaire.
    const cote = await lire(url, tokenTenant, envoye.id);
    expect(cote.body.luesIds).toEqual([]);
  });

  it("un repère inconnu, ou celui d'un autre fil, rend le fil entier plutôt que de laisser l'écran sans mise à jour", async () => {
    const { url, tokenManager, tokenTenant } = await bail();
    const autre = await bail();
    await ecrire(url, tokenManager, "un");
    await pause();
    await ecrire(url, tokenManager, "deux");
    const etranger = (await ecrire(autre.url, autre.tokenManager, "ailleurs")).body;

    expect((await lire(url, tokenTenant, "inconnu")).body.messages).toHaveLength(2);
    const avecRepereEtranger = await lire(url, tokenTenant, etranger.id);
    expect(avecRepereEtranger.body.messages.map((m: { content: string }) => m.content)).toEqual(["un", "deux"]);
  });

  it("ouvrir le fil en incrémental marque toujours lus les messages reçus", async () => {
    const { url, tokenManager, tokenTenant } = await bail();
    const premier = (await ecrire(url, tokenManager, "un")).body;
    await pause();
    await ecrire(url, tokenManager, "deux");
    await lire(url, tokenTenant, premier.id);
    const cote = await lire(url, tokenManager, premier.id);
    expect(cote.body.luesIds).toEqual(expect.arrayContaining([premier.id]));
    expect(cote.body.luesIds).toHaveLength(2);
  });
});

describe("Lecture incrémentale de la discussion propriétaire (?apresId=)", () => {
  async function agence() {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    return { owner, tokenManager: tokenFor(manager), tokenOwner: await tokenProprietaire(owner), urlGestionnaire: `/api/owner-messages/${owner.id}`, urlProprietaire: "/api/owner-messages/mine" };
  }

  it("rend seulement les messages postérieurs et l'état de lecture, des deux côtés", async () => {
    const { urlGestionnaire, urlProprietaire, tokenManager, tokenOwner } = await agence();
    const premier = (await ecrire(urlGestionnaire, tokenManager, "un")).body;
    await pause();
    await ecrire(urlGestionnaire, tokenManager, "deux");

    const cote = await lire(urlProprietaire, tokenOwner, premier.id);
    expect(cote.body.messages.map((m: { content: string }) => m.content)).toEqual(["deux"]);
    expect(cote.body.messages[0].senderId).toBeUndefined();
    expect(cote.body.luesIds).toEqual([]);

    const gestionnaire = await lire(urlGestionnaire, tokenManager, premier.id);
    expect(gestionnaire.body.messages.map((m: { content: string }) => m.content)).toEqual(["deux"]);
    expect(gestionnaire.body.messages[0].sender).toMatchObject({ role: "MANAGER" });
    expect(gestionnaire.body.luesIds).toHaveLength(2); // le propriétaire a ouvert son fil : ses deux messages reçus sont lus

    const vide = await lire(urlProprietaire, tokenOwner, cote.body.messages[0].id);
    expect(vide.body.messages).toEqual([]);
  });

  it("repère inconnu ou venant d'un autre propriétaire : le fil entier, sans fuite d'un autre fil", async () => {
    const a = await agence();
    const b = await agence();
    await ecrire(a.urlGestionnaire, a.tokenManager, "pour A");
    const autre = (await ecrire(b.urlGestionnaire, b.tokenManager, "pour B")).body;
    const res = await lire(a.urlProprietaire, a.tokenOwner, autre.id);
    expect(res.body.messages.map((m: { content: string }) => m.content)).toEqual(["pour A"]);
  });
});
