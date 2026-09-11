import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { ApiError } from "../utils/asyncHandler";
import { initiatePayment } from "./payment.service";

/**
 * payment.service.ts n'avait aucun test direct : il n'était exercé qu'en
 * mode démo (via subscription.controller.test.ts / paydunya.controller.test.ts),
 * qui retombe systématiquement sur simulatedResult(). Les branches "clés
 * réellement configurées" — Stripe non câblé qui doit échouer clairement
 * (voir "Finir ou masquer le moyen de paiement Stripe non câblé"), et le
 * vrai flux PayDunya (succès, échec API, échec réseau) — n'étaient donc
 * jamais atteintes par aucun test.
 */
describe("initiatePayment", () => {
  const original = {
    demoMode: env.payments.demoMode,
    stripeSecretKey: env.payments.stripeSecretKey,
    paydunya: { ...env.payments.paydunya },
  };

  afterEach(() => {
    env.payments.demoMode = original.demoMode;
    env.payments.stripeSecretKey = original.stripeSecretKey;
    env.payments.paydunya = { ...original.paydunya };
    vi.unstubAllGlobals();
  });

  it("DEMO : renvoie toujours un paiement simulé confirmé (PAID)", async () => {
    const result = await initiatePayment({
      method: "DEMO",
      amount: 29,
      invoiceId: "inv-1",
      payerEmail: "test@test.local",
    });

    expect(result.status).toBe("PAID");
    expect(result.method).toBe("DEMO");
  });

  it("DEMO : est refusé (400) hors mode démo explicite", async () => {
    // Regression : "DEMO" confirme un paiement instantanement, sans
    // contrepartie. Il etait propose dans l'interface ET accepte par l'API,
    // ce qui permettait a un gestionnaire d'activer un abonnement payant
    // gratuitement, et a un locataire de solder son loyer sans le regler.
    // Masquer le bouton ne suffisait pas : l'API restait appelable
    // directement. Le refus vit donc dans initiatePayment, point de passage
    // unique des deux flux.
    env.payments.demoMode = false;

    await expect(
      initiatePayment({ method: "DEMO", amount: 25000, invoiceId: "inv-1", payerEmail: "a@test.local" })
    ).rejects.toThrow(ApiError);

    try {
      await initiatePayment({ method: "DEMO", amount: 25000, invoiceId: "inv-1", payerEmail: "a@test.local" });
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(400);
    }
  });

  it("PAYDUNYA : n'est plus simulé hors mode démo dès que les clés sont configurées", async () => {
    // Le drapeau demoMode ne concerne pas que la methode DEMO : il
    // court-circuitait aussi PayDunya, qui renvoyait un PAID sans encaissement.
    // Hors mode demo avec des cles configurees, l'appel reel doit avoir lieu.
    env.payments.demoMode = false;
    env.payments.paydunya = { ...original.paydunya, masterKey: "mk", privateKey: "pk", token: "tk" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response_code: "00", response_text: "https://paydunya.test/abc", token: "tok" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await initiatePayment({
      method: "PAYDUNYA",
      amount: 25000,
      invoiceId: "inv-2",
      payerEmail: "a@test.local",
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(result.status).toBe("REQUIRES_ACTION");
  });

  it("BANK_TRANSFER : renvoie toujours PENDING_VALIDATION, jamais un accès immédiat", async () => {
    const result = await initiatePayment({
      method: "BANK_TRANSFER",
      amount: 29,
      invoiceId: "inv-1",
      payerEmail: "test@test.local",
      bankReference: "VIR-2026-042",
    });

    expect(result.status).toBe("PENDING_VALIDATION");
    expect(result.reference).toBe("VIR-2026-042");
  });

  it("BANK_TRANSFER : génère une référence par défaut si aucune n'est fournie", async () => {
    const result = await initiatePayment({
      method: "BANK_TRANSFER",
      amount: 29,
      invoiceId: "inv-1",
      payerEmail: "test@test.local",
    });

    expect(result.reference).toBe("virement_inv-1");
  });

  it("STRIPE : retombe sur une simulation confirmée en mode démo (comportement par défaut)", async () => {
    env.payments.demoMode = true;

    const result = await initiatePayment({
      method: "STRIPE",
      amount: 29,
      invoiceId: "inv-1",
      payerEmail: "test@test.local",
    });

    expect(result.status).toBe("PAID");
    expect(result.method).toBe("STRIPE");
  });

  it("STRIPE : échoue clairement (503) hors mode démo si une clé est configurée, plutôt qu'une fausse redirection", async () => {
    env.payments.demoMode = false;
    env.payments.stripeSecretKey = "sk_test_fake_key";

    await expect(
      initiatePayment({ method: "STRIPE", amount: 29, invoiceId: "inv-1", payerEmail: "test@test.local" })
    ).rejects.toThrow(ApiError);

    try {
      await initiatePayment({ method: "STRIPE", amount: 29, invoiceId: "inv-1", payerEmail: "test@test.local" });
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(503);
    }
  });

  it("PAYDUNYA : retombe sur une simulation confirmée tant que les clés ne sont pas configurées", async () => {
    env.payments.demoMode = false; // même hors mode démo...
    env.payments.paydunya.masterKey = ""; // ...sans clé, on simule toujours

    const result = await initiatePayment({
      method: "PAYDUNYA",
      amount: 29,
      invoiceId: "inv-1",
      payerEmail: "test@test.local",
    });

    expect(result.status).toBe("PAID");
  });

  it("PAYDUNYA : crée une facture de paiement réelle et renvoie l'URL de redirection", async () => {
    env.payments.demoMode = false;
    env.payments.paydunya.masterKey = "master-key";
    env.payments.paydunya.privateKey = "private-key";
    env.payments.paydunya.token = "token";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response_code: "00",
        response_text: "https://paydunya.com/checkout/abc123",
        token: "paydunya-token-abc123",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await initiatePayment({
      method: "PAYDUNYA",
      amount: 29,
      invoiceId: "inv-1",
      payerEmail: "test@test.local",
      returnPath: "/subscription",
    });

    expect(result.status).toBe("REQUIRES_ACTION");
    expect(result.reference).toBe("paydunya-token-abc123");
    expect(result.redirectUrl).toBe("https://paydunya.com/checkout/abc123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("PAYDUNYA : échoue (502) si l'API répond avec une erreur", async () => {
    env.payments.demoMode = false;
    env.payments.paydunya.masterKey = "master-key";
    env.payments.paydunya.privateKey = "private-key";
    env.payments.paydunya.token = "token";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ response_code: "01", response_text: "Erreur PayDunya" }),
      })
    );

    await expect(
      initiatePayment({ method: "PAYDUNYA", amount: 29, invoiceId: "inv-1", payerEmail: "test@test.local" })
    ).rejects.toThrow(ApiError);
  });

  it("PAYDUNYA : échoue (502) proprement si l'appel réseau échoue", async () => {
    env.payments.demoMode = false;
    env.payments.paydunya.masterKey = "master-key";
    env.payments.paydunya.privateKey = "private-key";
    env.payments.paydunya.token = "token";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    await expect(
      initiatePayment({ method: "PAYDUNYA", amount: 29, invoiceId: "inv-1", payerEmail: "test@test.local" })
    ).rejects.toThrow(ApiError);
  });
});
