import * as Sentry from "@sentry/node";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { platformSubscriptions, users } from "../db/schema";
import { createManager } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Les refus du webhook PayDunya (IPN) que `paydunya.controller.test.ts` n'exerçait pas. Chacun protège le même principe : un
 * paiement n'active un abonnement ou ne solde une facture que si la notification est authentique, complète ET confirmée par
 * PayDunya pour le bon montant. Un refus oublié ici passerait inaperçu : le webhook répond 200 dans presque tous les cas.
 */

// Doit correspondre exactement à PAYDUNYA_MASTER_KEY forcée dans setupTestDb.ts.
const TEST_MASTER_KEY = "test-paydunya-master-key-do-not-use-in-production";
const VALID_HASH = crypto.createHash("sha512").update(TEST_MASTER_KEY).digest("hex");

const envoyerIpn = (data: unknown) => request(app).post("/api/payments/paydunya/ipn").send({ data });

function ipn(champs: { hash?: string | null; token?: string; reference?: string }) {
  return JSON.stringify({
    status: "completed",
    ...(champs.hash === null ? {} : { hash: champs.hash ?? VALID_HASH }),
    invoice: champs.token === undefined ? {} : { token: champs.token },
    custom_data: champs.reference === undefined ? {} : { reference: champs.reference },
  });
}

function mockConfirmation(montant: number, reference: string) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ response_code: "00", status: "completed", invoice: { total_amount: montant }, custom_data: { reference } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function creerAbonnementEnAttente(token: string, montant = 15) {
  const manager = await createManager({ subscriptionStatus: "EXPIRED" });
  const [abonnement] = await testDb
    .insert(platformSubscriptions)
    .values({
      userId: manager.id,
      plan: "STARTER",
      amount: montant,
      status: "PENDING",
      paymentMethod: "PAYDUNYA",
      paymentRef: token,
      startDate: new Date(2026, 5, 1),
      endDate: new Date(2026, 6, 1),
    })
    .returning();
  return { manager, abonnement };
}

describe("POST /api/payments/paydunya/ipn : refus de sécurité", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("répond 400 quand le champ « data » est une chaîne qui n'est pas du JSON", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await envoyerIpn("ceci { n'est pas du json");

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejette (401) une notification sans signature, ou avec une signature vide, sans appeler PayDunya", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const sansSignature = await envoyerIpn(ipn({ hash: null, token: "pd_token_x", reference: "ref" }));
    const signatureVide = await envoyerIpn(ipn({ hash: "", token: "pd_token_x", reference: "ref" }));

    expect(sansSignature.status).toBe(401);
    expect(signatureVide.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepte (200) sans rien faire une notification authentique mais incomplète : ni référence, ni jeton", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const sansReference = await envoyerIpn(ipn({ token: "pd_token_x" }));
    const sansJeton = await envoyerIpn(ipn({ reference: "ref" }));

    expect(sansReference.status).toBe(200);
    expect(sansJeton.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled(); // rien à confirmer, donc rien à créditer
  });

  it("renvoie 502 et ne crédite rien quand PayDunya refuse la confirmation (code de réponse autre que « 00 »)", async () => {
    const { manager, abonnement } = await creerAbonnementEnAttente("pd_token_refuse");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ response_code: "99", status: "completed", invoice: { total_amount: 15 } }) })
    );

    const res = await envoyerIpn(ipn({ token: "pd_token_refuse", reference: `sub_${manager.id}_1` }));

    expect(res.status).toBe(502);
    const [apres] = await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, abonnement.id));
    expect(apres.status).toBe("PENDING");
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.subscriptionStatus).toBe("EXPIRED");
  });

  it("renvoie 502 et ne crédite rien quand la réponse de confirmation de PayDunya est illisible", async () => {
    const { manager, abonnement } = await creerAbonnementEnAttente("pd_token_illisible");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      })
    );

    const res = await envoyerIpn(ipn({ token: "pd_token_illisible", reference: `sub_${manager.id}_1` }));

    expect(res.status).toBe(502);
    const [apres] = await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, abonnement.id));
    expect(apres.status).toBe("PENDING");
  });
});

describe("POST /api/payments/paydunya/ipn : abonnement de la plateforme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("n'active PAS l'accès quand le montant confirmé par PayDunya diffère de l'abonnement attendu, et le signale à Sentry", async () => {
    const signal = vi.spyOn(Sentry, "captureMessage");
    const { manager, abonnement } = await creerAbonnementEnAttente("pd_token_montant_faux", 15);
    mockConfirmation(1, `sub_${manager.id}_1`); // 1 payé au lieu de 15

    const res = await envoyerIpn(ipn({ token: "pd_token_montant_faux", reference: `sub_${manager.id}_1` }));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, abonnement.id));
    expect(apres.status).toBe("PENDING");
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.subscriptionStatus).toBe("EXPIRED"); // l'accès n'a pas été débloqué
    expect(signal).toHaveBeenCalledTimes(1);
    expect(signal.mock.calls[0][0]).toContain("montant différent de l'abonnement attendu");
  });

  it("tolère l'écart d'arrondi d'un centime près : le bon montant active bien l'abonnement", async () => {
    const { manager, abonnement } = await creerAbonnementEnAttente("pd_token_arrondi", 15);
    mockConfirmation(15.004, `sub_${manager.id}_1`);

    const res = await envoyerIpn(ipn({ token: "pd_token_arrondi", reference: `sub_${manager.id}_1` }));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, abonnement.id));
    expect(apres.status).toBe("PAID");
  });

  it("signale à Sentry un paiement encaissé pour un abonnement introuvable, et n'active rien", async () => {
    const signal = vi.spyOn(Sentry, "captureMessage");
    const manager = await createManager({ subscriptionStatus: "EXPIRED" });
    mockConfirmation(15, `sub_${manager.id}_1`);

    const res = await envoyerIpn(ipn({ token: "pd_token_inconnu", reference: `sub_${manager.id}_1` }));

    expect(res.status).toBe(200);
    expect(signal).toHaveBeenCalledTimes(1);
    expect(signal.mock.calls[0][0]).toContain("abonnement introuvable pour ce jeton");
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.subscriptionStatus).toBe("EXPIRED");
  });
});
