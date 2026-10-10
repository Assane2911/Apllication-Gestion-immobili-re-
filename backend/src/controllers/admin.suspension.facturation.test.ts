import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { adminAuditLogs, users } from "../db/schema";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

const MOTIF = "Facture impayée depuis 3 mois";
const SUB = "sub_test_facturation";
const URL_STRIPE = `https://api.stripe.com/v1/subscriptions/${SUB}`;

let cleOriginale: string;

beforeEach(() => {
  cleOriginale = env.payments.stripeSecretKey;
  env.payments.stripeSecretKey = "sk_test_fake_key";
  vi.spyOn(console, "error").mockImplementation(() => {});
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

function suspendre(id: string, token: string) {
  return request(app).post(`/api/admin/managers/${id}/suspend`).set(authHeader(token)).send({ reason: MOTIF });
}

function reactiver(id: string, token: string) {
  return request(app).post(`/api/admin/managers/${id}/reactivate`).set(authHeader(token));
}

async function relire(id: string) {
  const [u] = await testDb.select().from(users).where(eq(users.id, id));
  return u;
}

describe("suspension et facturation Stripe", () => {
  it("met en pause la facturation Stripe, puis suspend, et le trace", async () => {
    const token = await adminToken();
    const manager = await createManager({ stripeSubscriptionId: SUB });
    const fetchMock = vi.fn().mockResolvedValue(reponseStripe(true));
    vi.stubGlobal("fetch", fetchMock);

    const res = await suspendre(manager.id, token);

    expect(res.status).toBe(200);
    expect(res.body.billingPaused).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(URL_STRIPE);
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer sk_test_fake_key");
    const corps = new URLSearchParams(options.body as string);
    expect(corps.get("pause_collection[behavior]")).toBe("void");
    expect((await relire(manager.id)).suspendedAt).not.toBeNull();
    const [trace] = await testDb.select().from(adminAuditLogs);
    expect(trace.details).toContain("facturation Stripe mise en pause");
  });

  it("n'appelle pas Stripe pour un compte sans renouvellement automatique", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await suspendre(manager.id, token);

    expect(res.status).toBe(200);
    expect(res.body.billingPaused).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si Stripe refuse, la suspension est ANNULÉE (502) : rien n'est modifié ni tracé", async () => {
    const token = await adminToken();
    const manager = await createManager({ stripeSubscriptionId: SUB });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponseStripe(false, { error: { code: "api_error", message: "Boum" } })));

    const res = await suspendre(manager.id, token);

    expect(res.status).toBe(502);
    expect((await relire(manager.id)).suspendedAt).toBeNull();
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("si Stripe est injoignable, la suspension est annulée (502)", async () => {
    const token = await adminToken();
    const manager = await createManager({ stripeSubscriptionId: SUB });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("réseau coupé")));

    const res = await suspendre(manager.id, token);

    expect(res.status).toBe(502);
    expect((await relire(manager.id)).suspendedAt).toBeNull();
  });

  it("si Stripe n'est pas configuré alors que le compte a un abonnement Stripe, refuse (502)", async () => {
    const token = await adminToken();
    const manager = await createManager({ stripeSubscriptionId: SUB });
    env.payments.stripeSecretKey = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await suspendre(manager.id, token);

    expect(res.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await relire(manager.id)).suspendedAt).toBeNull();
  });

  it("un abonnement que Stripe ne connaît plus (resource_missing) n'empêche pas la suspension", async () => {
    const token = await adminToken();
    const manager = await createManager({ stripeSubscriptionId: SUB });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponseStripe(false, { error: { code: "resource_missing" } })));

    const res = await suspendre(manager.id, token);

    expect(res.status).toBe(200);
    expect((await relire(manager.id)).suspendedAt).not.toBeNull();
  });

  it("un compte déjà suspendu ne déclenche aucun appel Stripe (409)", async () => {
    const token = await adminToken();
    const manager = await createManager({ stripeSubscriptionId: SUB, suspendedAt: new Date() });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await suspendre(manager.id, token);

    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("réactivation et facturation Stripe", () => {
  it("reprend la facturation Stripe (pause_collection vidé), puis réactive, et le trace", async () => {
    const token = await adminToken();
    const manager = await createManager({ stripeSubscriptionId: SUB, suspendedAt: new Date(), suspensionReason: MOTIF });
    const fetchMock = vi.fn().mockResolvedValue(reponseStripe(true));
    vi.stubGlobal("fetch", fetchMock);

    const res = await reactiver(manager.id, token);

    expect(res.status).toBe(200);
    expect(res.body.billingResumed).toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(URL_STRIPE);
    const corps = new URLSearchParams(options.body as string);
    expect(corps.has("pause_collection")).toBe(true);
    expect(corps.get("pause_collection")).toBe("");
    expect(corps.has("pause_collection[behavior]")).toBe(false);
    expect((await relire(manager.id)).suspendedAt).toBeNull();
    const [trace] = await testDb.select().from(adminAuditLogs);
    expect(trace.details).toContain("facturation Stripe reprise");
  });

  it("si Stripe refuse, la réactivation est ANNULÉE (502) : le compte reste suspendu", async () => {
    const token = await adminToken();
    const manager = await createManager({ stripeSubscriptionId: SUB, suspendedAt: new Date(), suspensionReason: MOTIF });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponseStripe(false, { error: { code: "api_error" } })));

    const res = await reactiver(manager.id, token);

    expect(res.status).toBe(502);
    const apres = await relire(manager.id);
    expect(apres.suspendedAt).not.toBeNull();
    expect(apres.suspensionReason).toBe(MOTIF);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("n'appelle pas Stripe pour un compte sans renouvellement automatique", async () => {
    const token = await adminToken();
    const manager = await createManager({ suspendedAt: new Date() });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await reactiver(manager.id, token);

    expect(res.status).toBe(200);
    expect(res.body.billingResumed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un compte non suspendu ne déclenche aucun appel Stripe (409)", async () => {
    const token = await adminToken();
    const manager = await createManager({ stripeSubscriptionId: SUB });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect((await reactiver(manager.id, token)).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
