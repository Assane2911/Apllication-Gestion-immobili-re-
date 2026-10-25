import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { ApiError } from "../utils/asyncHandler";
import { initiatePayment } from "./payment.service";

/**
 * Audit de l'internationalisation (octobre 2026) : quand Stripe ou PayDunya refusaient de créer un paiement, leur texte
 * était renvoyé tel quel à l'utilisateur — en anglais ou en français selon le prestataire, jamais dans la langue
 * choisie, et parfois avec un détail de configuration (« Invalid API Key provided: sk_live_****abcd », « Invalid
 * Masterkey »). Le payeur n'a rien à faire d'un tel détail : l'erreur porte maintenant un code que l'interface
 * traduit, et le texte du prestataire va dans les journaux du serveur, pour l'exploitation.
 */
const original = {
  demoMode: env.payments.demoMode,
  stripeSecretKey: env.payments.stripeSecretKey,
  stripeWebhookSecret: env.payments.stripeWebhookSecret,
  stripeCurrencies: [...env.payments.stripeCurrencies],
  paydunya: { ...env.payments.paydunya },
};

afterEach(() => {
  env.payments.demoMode = original.demoMode;
  env.payments.stripeSecretKey = original.stripeSecretKey;
  env.payments.stripeWebhookSecret = original.stripeWebhookSecret;
  env.payments.stripeCurrencies = [...original.stripeCurrencies];
  env.payments.paydunya = { ...original.paydunya };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function refus(promesse: Promise<unknown>): Promise<ApiError> {
  try {
    await promesse;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error("Le paiement aurait dû être refusé");
}

function stripeRepond(corps: unknown) {
  env.payments.demoMode = false;
  env.payments.stripeSecretKey = "sk_test_fake_key";
  env.payments.stripeWebhookSecret = "whsec_test";
  env.payments.stripeCurrencies = ["EUR"];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => corps }));
}

function paydunyaRepond(corps: unknown) {
  env.payments.demoMode = false;
  env.payments.paydunya.masterKey = "master-key";
  env.payments.paydunya.privateKey = "private-key";
  env.payments.paydunya.token = "token";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => corps }));
}

const payerStripe = () =>
  initiatePayment({ method: "STRIPE", currency: "EUR", amount: 29, invoiceId: "inv-1", usage: "ABONNEMENT", payerEmail: "test@test.local" });
const payerPaydunya = () =>
  initiatePayment({ method: "PAYDUNYA", currency: "XOF", amount: 29, invoiceId: "inv-1", usage: "ABONNEMENT", payerEmail: "test@test.local" });

describe("paiement refusé par le prestataire — message renvoyé à l'utilisateur", () => {
  it("Stripe : une erreur de configuration ne laisse pas filer la clé API, même partielle", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    stripeRepond({ error: { type: "invalid_request_error", message: "Invalid API Key provided: sk_live_****abcd" } });

    const erreur = await refus(payerStripe());

    expect(erreur.statusCode).toBe(502);
    expect(erreur.code).toBe("CARD_PAYMENT_INIT_FAILED");
    expect(erreur.message).not.toMatch(/sk_live|Invalid API Key|abcd/);
    // Le détail reste disponible pour l'exploitation, dans les journaux du serveur.
    expect(JSON.stringify(journal.mock.calls)).toContain("Invalid API Key provided");
  });

  it("Stripe : même un refus de carte passe par le message traduit (la carte se saisit sur la page de Stripe, pas ici)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stripeRepond({ error: { type: "card_error", message: "Your card was declined." } });

    const erreur = await refus(payerStripe());

    expect(erreur.code).toBe("CARD_PAYMENT_INIT_FAILED");
    expect(erreur.message).not.toContain("declined");
  });

  it("PayDunya : le message du prestataire n'est pas renvoyé, un code traduisible l'est", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    paydunyaRepond({ response_code: "01", response_text: "Invalid Masterkey" });

    const erreur = await refus(payerPaydunya());

    expect(erreur.statusCode).toBe(502);
    expect(erreur.code).toBe("PAYDUNYA_INIT_FAILED");
    expect(erreur.message).not.toContain("Masterkey");
    expect(JSON.stringify(journal.mock.calls)).toContain("Invalid Masterkey");
  });

  it("PayDunya : une réponse sans texte donne le même résultat", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    paydunyaRepond({ response_code: "01" });

    const erreur = await refus(payerPaydunya());

    expect(erreur.code).toBe("PAYDUNYA_INIT_FAILED");
  });
});
