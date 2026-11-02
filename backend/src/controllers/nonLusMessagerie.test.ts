import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import * as emailService from "../services/email.service";
import { authHeader, createContract, createManager, createOwner, createProperty, createTenant, createTenantPortalUser, tokenFor, tokenProprietaire } from "../test/authHelpers";

beforeEach(() => {
  vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
});
afterEach(() => vi.restoreAllMocks());

const ecrire = (url: string, token: string, content = "Bonjour") => request(app).post(url).set(authHeader(token)).send({ content });
const compter = (url: string, token: string) => request(app).get(url).set(authHeader(token));

async function bail(manager?: Awaited<ReturnType<typeof createManager>>) {
  const gestionnaire = manager ?? (await createManager());
  const property = await createProperty(gestionnaire.id);
  const tenant = await createTenant(gestionnaire.id);
  const contract = await createContract(property.id, tenant.id);
  const portail = await createTenantPortalUser(tenant);
  return { gestionnaire, contract, tokenManager: tokenFor(gestionnaire), tokenTenant: tokenFor(portail, tenant.id), url: `/api/messages/${contract.id}` };
}

describe("Messages non lus — locataire (GET /api/messages/unread-count)", () => {
  it("compte les messages de l'agence pas encore lus, et retombe à zéro quand il ouvre son fil", async () => {
    const { url, tokenManager, tokenTenant } = await bail();
    expect((await compter("/api/messages/unread-count", tokenTenant)).body).toEqual({ count: 0 });
    await ecrire(url, tokenManager, "un");
    await ecrire(url, tokenManager, "deux");
    expect((await compter("/api/messages/unread-count", tokenTenant)).body).toEqual({ count: 2 });

    await request(app).get(url).set(authHeader(tokenTenant));
    expect((await compter("/api/messages/unread-count", tokenTenant)).body).toEqual({ count: 0 });
  });

  it("ne compte pas ses propres messages, ni ceux du fil d'un autre locataire", async () => {
    const a = await bail();
    const b = await bail();
    await ecrire(a.url, a.tokenTenant, "de moi");
    await ecrire(b.url, b.tokenManager, "pour B");
    expect((await compter("/api/messages/unread-count", a.tokenTenant)).body).toEqual({ count: 0 });
    expect((await compter("/api/messages/unread-count", b.tokenTenant)).body).toEqual({ count: 1 });
  });
});

describe("Messages non lus — gestionnaire (GET /api/messages/unread-count)", () => {
  it("additionne locataires et propriétaires, en distinguant les deux pour les onglets", async () => {
    const { gestionnaire, url, tokenManager, tokenTenant } = await bail();
    const owner = await createOwner(gestionnaire.id);
    const tokenOwner = await tokenProprietaire(owner);
    await ecrire(url, tokenTenant, "du locataire");
    await ecrire("/api/owner-messages/mine", tokenOwner, "du propriétaire 1");
    await ecrire("/api/owner-messages/mine", tokenOwner, "du propriétaire 2");
    // Ses propres messages ne comptent pas.
    await ecrire(`/api/owner-messages/${owner.id}`, tokenManager, "réponse");

    const res = await compter("/api/messages/unread-count", tokenManager);
    expect(res.body).toEqual({ count: 3, tenants: 1, owners: 2 });

    await request(app).get(`/api/owner-messages/${owner.id}`).set(authHeader(tokenManager));
    expect((await compter("/api/messages/unread-count", tokenManager)).body).toEqual({ count: 1, tenants: 1, owners: 0 });
    await request(app).get(url).set(authHeader(tokenManager));
    expect((await compter("/api/messages/unread-count", tokenManager)).body).toEqual({ count: 0, tenants: 0, owners: 0 });
  });

  it("ne compte jamais les messages d'une autre agence", async () => {
    const a = await bail();
    const b = await bail();
    await ecrire(b.url, b.tokenTenant, "chez B");
    const ownerB = await createOwner(b.gestionnaire.id);
    await ecrire("/api/owner-messages/mine", await tokenProprietaire(ownerB), "propriétaire de B");
    expect((await compter("/api/messages/unread-count", a.tokenManager)).body).toEqual({ count: 0, tenants: 0, owners: 0 });
  });
});

describe("Messages non lus — propriétaire (GET /api/owner-messages/unread-count)", () => {
  it("compte les messages de l'agence pas encore lus, puis zéro après ouverture du fil", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    const tokenOwner = await tokenProprietaire(owner);
    const tokenManager = tokenFor(manager);
    expect((await compter("/api/owner-messages/unread-count", tokenOwner)).body).toEqual({ count: 0 });
    await ecrire(`/api/owner-messages/${owner.id}`, tokenManager, "un");
    await ecrire(`/api/owner-messages/${owner.id}`, tokenManager, "deux");
    await ecrire("/api/owner-messages/mine", tokenOwner, "le mien");
    expect((await compter("/api/owner-messages/unread-count", tokenOwner)).body).toEqual({ count: 2 });
    await request(app).get("/api/owner-messages/mine").set(authHeader(tokenOwner));
    expect((await compter("/api/owner-messages/unread-count", tokenOwner)).body).toEqual({ count: 0 });
  });

  it("ne compte pas les messages adressés à un autre propriétaire de la même agence", async () => {
    const manager = await createManager();
    const a = await createOwner(manager.id);
    const b = await createOwner(manager.id, { firstName: "Moussa" });
    const tokenA = await tokenProprietaire(a);
    await tokenProprietaire(b);
    await ecrire(`/api/owner-messages/${b.id}`, tokenFor(manager), "pour Moussa");
    expect((await compter("/api/owner-messages/unread-count", tokenA)).body).toEqual({ count: 0 });
  });
});

describe("Messages non lus — accès", () => {
  it("chaque décompte est réservé à son rôle, et demande un jeton", async () => {
    const { tokenTenant } = await bail();
    const manager = await createManager();
    const tokenOwner = await tokenProprietaire(await createOwner(manager.id));
    expect((await compter("/api/messages/unread-count", tokenOwner)).status).toBe(403);
    expect((await compter("/api/owner-messages/unread-count", tokenTenant)).status).toBe(403);
    expect((await compter("/api/owner-messages/unread-count", tokenFor(manager))).status).toBe(403);
    expect((await request(app).get("/api/messages/unread-count")).status).toBe(401);
    expect((await request(app).get("/api/owner-messages/unread-count")).status).toBe(401);
  });
});
