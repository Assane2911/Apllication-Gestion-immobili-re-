import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import {
  adminAuditLogs,
  contracts,
  invoices,
  listingLeads,
  listings,
  platformSubscriptions,
  properties,
  tenants,
  users,
} from "../db/schema";
import { deleteStorageObjectBestEffort } from "../services/storage.service";
import {
  authHeader,
  createAdmin,
  createContract,
  createInvoice,
  createManager,
  createPlatformSubscription,
  createProperty,
  createTeamMember,
  createTenant,
  createTenantPortalUser,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

const MOTIF = "Demande écrite du client du 12/10 — dossier INTERNE-9";
const SUB = "sub_test_suppression";
const URL_STRIPE = `https://api.stripe.com/v1/subscriptions/${SUB}`;

let cleOriginale: string;

beforeEach(() => {
  cleOriginale = env.payments.stripeSecretKey;
  env.payments.stripeSecretKey = "sk_test_fake_key";
  vi.mocked(deleteStorageObjectBestEffort).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  env.payments.stripeSecretKey = cleOriginale;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const reponseStripe = (ok: boolean, corps: unknown = {}) => ({ ok, status: ok ? 200 : 400, json: async () => corps });

async function adminToken() {
  return tokenFor(await createAdmin());
}

/** Un gestionnaire suspendu, prêt à être supprimé. */
const suspendu = (overrides: Partial<typeof users.$inferInsert> = {}) =>
  createManager({ suspendedAt: new Date(), suspensionReason: "Impayé", ...overrides });

function supprimer(id: string, token: string, corps: Record<string, unknown>) {
  return request(app).delete(`/api/admin/managers/${id}`).set(authHeader(token)).send(corps);
}

const existe = async (id: string) => (await testDb.select().from(users).where(eq(users.id, id))).length === 1;

describe("accès à la suppression", () => {
  it("exige l'authentification et refuse un gestionnaire", async () => {
    const cible = await suspendu();
    const autre = await createManager();
    expect((await request(app).delete(`/api/admin/managers/${cible.id}`).send({ email: cible.email, reason: MOTIF })).status).toBe(401);
    const res = await supprimer(cible.id, tokenFor(autre), { email: cible.email, reason: MOTIF });
    expect(res.status).toBe(403);
    expect(await existe(cible.id)).toBe(true);
  });
});

describe("garde-fous", () => {
  it("refuse (409) un compte non suspendu, sans rien supprimer ni tracer", async () => {
    const token = await adminToken();
    const cible = await createManager();
    await createProperty(cible.id);

    const res = await supprimer(cible.id, token, { email: cible.email, reason: MOTIF });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/suspendez d'abord/i);
    expect(await existe(cible.id)).toBe(true);
    expect(await testDb.select().from(properties).where(eq(properties.managerId, cible.id))).toHaveLength(1);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("refuse (400) un email ressaisi différent de celui du compte, sans rien supprimer", async () => {
    const token = await adminToken();
    const cible = await suspendu();

    const res = await supprimer(cible.id, token, { email: "autre@test.local", reason: MOTIF });

    expect(res.status).toBe(400);
    expect(await existe(cible.id)).toBe(true);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("exige un email et un motif d'au moins 3 caractères", async () => {
    const token = await adminToken();
    const cible = await suspendu();

    expect((await supprimer(cible.id, token, { reason: MOTIF })).status).toBe(400);
    expect((await supprimer(cible.id, token, { email: "  ", reason: MOTIF })).status).toBe(400);
    expect((await supprimer(cible.id, token, { email: cible.email })).status).toBe(400);
    expect((await supprimer(cible.id, token, { email: cible.email, reason: "ab" })).status).toBe(400);
    expect(await existe(cible.id)).toBe(true);
  });

  it("accepte l'email sans tenir compte de la casse ni des espaces de bord", async () => {
    const token = await adminToken();
    const cible = await suspendu();

    const res = await supprimer(cible.id, token, { email: `  ${cible.email.toUpperCase()} `, reason: MOTIF });

    expect(res.status).toBe(200);
    expect(await existe(cible.id)).toBe(false);
  });

  it("renvoie 404 pour un id inconnu, un collaborateur ou un administrateur", async () => {
    const admin = await createAdmin();
    const token = tokenFor(admin);
    const proprietaire = await suspendu();
    const collaborateur = await createTeamMember(proprietaire.id, { suspendedAt: new Date() });

    expect((await supprimer("inconnu", token, { email: "x@test.local", reason: MOTIF })).status).toBe(404);
    expect((await supprimer(collaborateur.id, token, { email: collaborateur.email, reason: MOTIF })).status).toBe(404);
    expect((await supprimer(admin.id, token, { email: admin.email, reason: MOTIF })).status).toBe(404);
    expect(await existe(collaborateur.id)).toBe(true);
    expect(await existe(admin.id)).toBe(true);
  });
});

describe("suppression d'un compte suspendu", () => {
  it("supprime tout l'espace de l'agence et rien d'autre, en conservant les comptes portail", async () => {
    const admin = await createAdmin();
    const cible = await suspendu();
    const autre = await createManager();

    // Espace de la cible : un bien avec photo, un locataire avec son compte portail,
    // un contrat, une facture, une annonce avec une demande, un paiement SaaS, un collaborateur.
    const bien = await createProperty(cible.id, { imageUrl: "https://stockage.test/biens/photo-1.jpg" });
    const locataire = await createTenant(cible.id);
    const portail = await createTenantPortalUser(locataire);
    const contrat = await createContract(bien.id, locataire.id);
    await createInvoice(contrat.id);
    const [annonce] = await testDb
      .insert(listings)
      .values({ managerId: cible.id, title: "Villa", description: "Belle villa", price: 1, location: "Dakar" })
      .returning();
    await testDb
      .insert(listingLeads)
      .values({ listingId: annonce.id, managerId: cible.id, prospectName: "Awa", prospectEmail: "a@test.local", prospectPhone: "+221770000000" });
    await createPlatformSubscription(cible.id);
    const collaborateur = await createTeamMember(cible.id);

    // Espace d'un AUTRE gestionnaire : ne doit pas bouger.
    const bienAutre = await createProperty(autre.id);
    const locataireAutre = await createTenant(autre.id);
    const contratAutre = await createContract(bienAutre.id, locataireAutre.id);
    await createInvoice(contratAutre.id);
    await createPlatformSubscription(autre.id);

    const res = await supprimer(cible.id, tokenFor(admin), { email: cible.email, reason: MOTIF });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, subscriptionCancelled: false });

    expect(await existe(cible.id)).toBe(false);
    expect(await existe(collaborateur.id)).toBe(false);
    expect(await testDb.select().from(properties).where(eq(properties.managerId, cible.id))).toHaveLength(0);
    expect(await testDb.select().from(tenants).where(eq(tenants.managerId, cible.id))).toHaveLength(0);
    expect(await testDb.select().from(contracts).where(eq(contracts.id, contrat.id))).toHaveLength(0);
    expect(await testDb.select().from(listings).where(eq(listings.managerId, cible.id))).toHaveLength(0);
    expect(await testDb.select().from(listingLeads).where(eq(listingLeads.managerId, cible.id))).toHaveLength(0);
    expect(await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.userId, cible.id))).toHaveLength(0);

    // Le compte de connexion du locataire lui appartient : il survit à son ancienne agence.
    expect(await existe(portail.id)).toBe(true);

    // Le voisin est intact.
    expect(await existe(autre.id)).toBe(true);
    expect(await testDb.select().from(properties).where(eq(properties.managerId, autre.id))).toHaveLength(1);
    expect(await testDb.select().from(contracts).where(eq(contracts.id, contratAutre.id))).toHaveLength(1);
    expect(await testDb.select().from(invoices).where(eq(invoices.contractId, contratAutre.id))).toHaveLength(1);
    expect(await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.userId, autre.id))).toHaveLength(1);
  });

  it("nettoie le stockage après la suppression", async () => {
    const token = await adminToken();
    const cible = await suspendu();
    await createProperty(cible.id, { imageUrl: "https://stockage.test/biens/photo-1.jpg" });

    await supprimer(cible.id, token, { email: cible.email, reason: MOTIF });

    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith("https://stockage.test/biens/photo-1.jpg");
  });

  it("trace la suppression avec l'email et la volumétrie, la trace survivant au compte", async () => {
    const admin = await createAdmin();
    const cible = await suspendu();
    await createProperty(cible.id);
    await createProperty(cible.id);
    await createTenant(cible.id);
    await createTeamMember(cible.id);

    await supprimer(cible.id, tokenFor(admin), { email: cible.email, reason: MOTIF });

    const trace = await testDb.select().from(adminAuditLogs);
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({ action: "manager.delete", adminId: admin.id, targetUserId: cible.id, targetLabel: cible.email });
    expect(trace[0].details).toContain("2 bien(s)");
    expect(trace[0].details).toContain("1 locataire(s)");
    expect(trace[0].details).toContain("1 collaborateur(s)");
    expect(trace[0].details).toContain(MOTIF);
  });

  it("invalide la session du compte supprimé (401) et refuse une seconde suppression (404)", async () => {
    const token = await adminToken();
    const cible = await suspendu();

    await supprimer(cible.id, token, { email: cible.email, reason: MOTIF });

    expect((await request(app).get("/api/auth/me").set(authHeader(tokenFor(cible)))).status).toBe(401);
    expect((await supprimer(cible.id, token, { email: cible.email, reason: MOTIF })).status).toBe(404);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(1);
  });
});

describe("abonnement Stripe à renouvellement automatique", () => {
  it("résilie l'abonnement immédiatement, puis supprime, et le trace", async () => {
    const token = await adminToken();
    const cible = await suspendu({ stripeSubscriptionId: SUB });
    const fetchMock = vi.fn().mockResolvedValue(reponseStripe(true));
    vi.stubGlobal("fetch", fetchMock);

    const res = await supprimer(cible.id, token, { email: cible.email, reason: MOTIF });

    expect(res.status).toBe(200);
    expect(res.body.subscriptionCancelled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(URL_STRIPE);
    expect(options.method).toBe("DELETE");
    expect(await existe(cible.id)).toBe(false);
    expect((await testDb.select().from(adminAuditLogs))[0].details).toContain("abonnement Stripe résilié");
  });

  it("annule la suppression (502) si Stripe refuse : le compte reste intact, sans trace", async () => {
    const token = await adminToken();
    const cible = await suspendu({ stripeSubscriptionId: SUB });
    await createProperty(cible.id);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponseStripe(false, { error: { code: "api_error", message: "boom" } })));

    const res = await supprimer(cible.id, token, { email: cible.email, reason: MOTIF });

    expect(res.status).toBe(502);
    expect(await existe(cible.id)).toBe(true);
    expect(await testDb.select().from(properties).where(eq(properties.managerId, cible.id))).toHaveLength(1);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("annule la suppression (502) si Stripe est injoignable", async () => {
    const token = await adminToken();
    const cible = await suspendu({ stripeSubscriptionId: SUB });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const res = await supprimer(cible.id, token, { email: cible.email, reason: MOTIF });

    expect(res.status).toBe(502);
    expect(await existe(cible.id)).toBe(true);
  });

  it("annule la suppression (502) si Stripe n'est pas configuré, plutôt que d'oublier l'abonnement", async () => {
    const token = await adminToken();
    const cible = await suspendu({ stripeSubscriptionId: SUB });
    env.payments.stripeSecretKey = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await supprimer(cible.id, token, { email: cible.email, reason: MOTIF });

    expect(res.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await existe(cible.id)).toBe(true);
  });

  it("tient pour résilié un abonnement que Stripe ne connaît plus", async () => {
    const token = await adminToken();
    const cible = await suspendu({ stripeSubscriptionId: SUB });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponseStripe(false, { error: { code: "resource_missing" } })));

    const res = await supprimer(cible.id, token, { email: cible.email, reason: MOTIF });

    expect(res.status).toBe(200);
    expect(await existe(cible.id)).toBe(false);
  });

  it("n'appelle pas Stripe pour un compte sans abonnement automatique", async () => {
    const token = await adminToken();
    const cible = await suspendu();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await supprimer(cible.id, token, { email: cible.email, reason: MOTIF });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("suppression à la demande du gestionnaire (DELETE /api/auth/account)", () => {
  it("résilie aussi l'abonnement Stripe, ce qu'elle omettait", async () => {
    const cible = await createManager({ stripeSubscriptionId: SUB });
    const fetchMock = vi.fn().mockResolvedValue(reponseStripe(true));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).delete("/api/auth/account").set(authHeader(tokenFor(cible))).send({ password: "Password123!" });

    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(URL_STRIPE);
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(await existe(cible.id)).toBe(false);
  });

  it("garde le compte intact (502) si Stripe refuse la résiliation", async () => {
    const cible = await createManager({ stripeSubscriptionId: SUB });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponseStripe(false, { error: { code: "api_error", message: "boom" } })));

    const res = await request(app).delete("/api/auth/account").set(authHeader(tokenFor(cible))).send({ password: "Password123!" });

    expect(res.status).toBe(502);
    expect(await existe(cible.id)).toBe(true);
  });
});
