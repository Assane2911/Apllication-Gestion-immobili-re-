import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import type { CompteAgenceEncaissant } from "./comptePaiementAgence.service";
import {
  cancelStripeSubscriptionAtPeriodEnd,
  cancelStripeSubscriptionNow,
  depuisPlusPetiteUnite,
  indisponibilite,
  indisponibiliteSelonUsage,
  initiatePayment,
  MOYENS_DE_PAIEMENT,
  moyensDePaiementDisponibles,
  setStripeCollectionPaused,
} from "./payment.service";

/**
 * Cas limites des paiements (payment.service.ts), trouvés en sabotant le service : chaque test ci-dessous échoue si la ligne
 * qu'il garde est modifiée, alors que les tests existants passaient tous.
 */
const original = {
  demoMode: env.payments.demoMode,
  stripeSecretKey: env.payments.stripeSecretKey,
  stripeWebhookSecret: env.payments.stripeWebhookSecret,
  stripeCurrencies: [...env.payments.stripeCurrencies],
  paydunya: { ...env.payments.paydunya },
  rentOnline: env.payments.rentOnline,
};

beforeEach(() => {
  env.payments.demoMode = false;
  env.payments.stripeSecretKey = "sk_test_cle";
  env.payments.stripeWebhookSecret = "whsec_test";
  env.payments.stripeCurrencies = ["EUR"];
  env.payments.paydunya = { ...original.paydunya, masterKey: "mk-plateforme", privateKey: "pk-plateforme", token: "tk-plateforme", mode: "test", currency: "XOF" };
  env.payments.rentOnline = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  env.payments.demoMode = original.demoMode;
  env.payments.stripeSecretKey = original.stripeSecretKey;
  env.payments.stripeWebhookSecret = original.stripeWebhookSecret;
  env.payments.stripeCurrencies = [...original.stripeCurrencies];
  env.payments.paydunya = { ...original.paydunya };
  env.payments.rentOnline = original.rentOnline;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const reponse = (corps: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => corps });
const simuler = (r: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue(r);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
const erreurDe = (promesse: Promise<unknown>) => promesse.then(() => null, (e) => e as { statusCode: number; code?: string; params?: Record<string, unknown> });

const SESSION_STRIPE = { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" };
const stripe = (extra: Record<string, unknown> = {}) =>
  initiatePayment({ method: "STRIPE", currency: "EUR", amount: 29, invoiceId: "sub_mgr_1", usage: "ABONNEMENT", payerEmail: "Test@Test.local", returnPath: "/subscription", ...extra } as Parameters<typeof initiatePayment>[0]);
const corpsStripe = (fetchMock: ReturnType<typeof simuler>) => new URLSearchParams(fetchMock.mock.calls[0][1].body as string);

const COMPTE: CompteAgenceEncaissant = {
  identifiants: { masterKey: "mk-agence", privateKey: "pk-agence", token: "tk-agence", mode: "live", currency: "XOF" },
  nomAgence: "Agence du Port",
  managerId: "mgr-9",
};
const REPONSE_PAYDUNYA = { response_code: "00", response_text: "https://paydunya.test/abc", token: "tok-1" };
const paydunya = (extra: Record<string, unknown> = {}) =>
  initiatePayment({ method: "PAYDUNYA", currency: "XOF", amount: 54838.71, invoiceId: "inv-1", usage: "ABONNEMENT", payerEmail: "a@test.local", returnPath: "/portail", ...extra } as Parameters<typeof initiatePayment>[0]);
const corpsPaydunya = (fetchMock: ReturnType<typeof simuler>) => JSON.parse(fetchMock.mock.calls[0][1].body as string);

describe("initiatePayment — aiguillage", () => {
  it("un abonnement paie avec les clés de la plateforme, même si un compte d'agence est fourni", async () => {
    const fetchMock = simuler(reponse(REPONSE_PAYDUNYA));

    await paydunya({ compteAgence: COMPTE });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create");
    expect(options.headers["PAYDUNYA-MASTER-KEY"]).toBe("mk-plateforme");
    expect(corpsPaydunya(fetchMock).actions.callback_url).toBe(`${env.publicBackendUrl}/api/payments/paydunya/ipn`);
  });

  it("un loyer paie avec les clés, le nom, le mode et l'adresse de notification de l'agence", async () => {
    const fetchMock = simuler(reponse(REPONSE_PAYDUNYA));

    await paydunya({ usage: "LOYER", compteAgence: COMPTE });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.paydunya.com/api/v1/checkout-invoice/create");
    expect(options.headers["PAYDUNYA-MASTER-KEY"]).toBe("mk-agence");
    expect(options.headers["PAYDUNYA-PRIVATE-KEY"]).toBe("pk-agence");
    expect(options.headers["PAYDUNYA-TOKEN"]).toBe("tk-agence");
    const corps = corpsPaydunya(fetchMock);
    expect(corps.store.name).toBe("Agence du Port");
    expect(corps.invoice.description).toBe("Paiement inv-1 — Agence du Port");
    expect(corps.actions.callback_url).toBe(`${env.publicBackendUrl}/api/payments/paydunya/ipn/agence/mgr-9`);
  });

  it("un moyen inconnu en mode démo est traité comme le paiement démo", async () => {
    env.payments.demoMode = true;

    const res = await initiatePayment({ method: "INCONNU" as never, currency: "EUR", amount: 10, invoiceId: "inv-1", usage: "ABONNEMENT", payerEmail: "a@test.local" });

    expect(res.method).toBe("DEMO");
    expect(res.status).toBe("PAID");
  });

  it("un refus garde son code et ses paramètres", async () => {
    const err = await erreurDe(stripe({ currency: "USD" }));

    expect(err?.statusCode).toBe(503);
    expect(err?.code).toBe("PAYMENT_CURRENCY_UNSUPPORTED");
    expect(err?.params).toEqual({ currency: "USD" });
  });

  it("le paiement simulé a une référence et un message reconnaissables", async () => {
    env.payments.demoMode = true;
    const demo = await initiatePayment({ method: "DEMO", currency: "EUR", amount: 100, invoiceId: "inv-1", usage: "ABONNEMENT", payerEmail: "a@test.local" });
    const simuleStripe = await initiatePayment({ method: "STRIPE", currency: "EUR", amount: 100, invoiceId: "inv-1", usage: "ABONNEMENT", payerEmail: "a@test.local" });

    expect(demo.message).toBe("Paiement démo de 100 EUR confirmé instantanément.");
    expect(simuleStripe.reference).toMatch(/^demo_stripe_inv-1_\d+$/);
  });
});

describe("conversions et disponibilité", () => {
  it("relit un montant en francs CFA quelle que soit la casse de la devise", () => {
    expect(depuisPlusPetiteUnite(15000, "xof")).toBe(15000);
  });

  it("un moyen non configuré est refusé avec son statut et son code ; chaque clé PayDunya manquante suffit à le refuser", () => {
    env.payments.stripeSecretKey = "";
    expect(indisponibilite("STRIPE", "EUR")).toMatchObject({ status: 503, code: "PAYMENT_METHOD_UNAVAILABLE" });
    env.payments.stripeSecretKey = "sk";
    env.payments.stripeWebhookSecret = "";
    expect(indisponibilite("STRIPE", "EUR")).toMatchObject({ status: 503, code: "PAYMENT_METHOD_UNAVAILABLE" });
    env.payments.stripeWebhookSecret = "whsec";

    for (const cle of ["masterKey", "privateKey", "token"] as const) {
      env.payments.paydunya = { ...env.payments.paydunya, [cle]: "" };
      expect(indisponibilite("PAYDUNYA", "XOF")).toMatchObject({ status: 503, code: "PAYMENT_METHOD_UNAVAILABLE" });
      env.payments.paydunya = { ...env.payments.paydunya, [cle]: "rempli" };
    }
    expect(indisponibilite("PAYDUNYA", "XOF")).toBeNull();
  });

  it("le mode démo refuse avec son code quand il n'est pas activé", () => {
    expect(indisponibilite("DEMO", "EUR")).toMatchObject({ status: 400, code: "PAYMENT_DEMO_UNAVAILABLE" });
  });

  it("la devise est comparée sans tenir compte de la casse, chez Stripe comme chez PayDunya ; un écart est refusé avec son code et sa devise", () => {
    expect(indisponibilite("STRIPE", "eur")).toBeNull();
    expect(indisponibilite("PAYDUNYA", "xof")).toBeNull();
    env.payments.paydunya = { ...env.payments.paydunya, currency: "xof" };
    expect(indisponibilite("PAYDUNYA", "XOF")).toBeNull();

    expect(indisponibilite("STRIPE", "USD")).toMatchObject({ status: 503, code: "PAYMENT_CURRENCY_UNSUPPORTED", params: { currency: "USD" } });
    expect(indisponibilite("PAYDUNYA", "EUR")).toMatchObject({ status: 503, code: "PAYMENT_CURRENCY_UNSUPPORTED", params: { currency: "EUR" } });
  });

  it("un loyer par PayDunya sans compte d'agence est refusé (400), avec un compte d'une autre devise (503, devise donnée), accepté avec un compte de la même devise quelle que soit la casse", () => {
    expect(indisponibiliteSelonUsage("PAYDUNYA", "XOF", "LOYER", null)).toMatchObject({ status: 400, code: "RENT_ONLINE_PAYMENT_DISABLED" });
    expect(indisponibiliteSelonUsage("PAYDUNYA", "EUR", "LOYER", COMPTE)).toMatchObject({ status: 503, code: "PAYMENT_CURRENCY_UNSUPPORTED", params: { currency: "EUR" } });
    expect(indisponibiliteSelonUsage("PAYDUNYA", "XOF", "LOYER", COMPTE)).toBeNull();
    const minuscules = { ...COMPTE, identifiants: { ...COMPTE.identifiants, currency: "xof" } };
    expect(indisponibiliteSelonUsage("PAYDUNYA", "XOF", "LOYER", minuscules)).toBeNull();
    // Un compte d'agence valide ne dépend pas des clés de la plateforme.
    env.payments.paydunya = { ...env.payments.paydunya, masterKey: "", privateKey: "", token: "" };
    expect(indisponibiliteSelonUsage("PAYDUNYA", "XOF", "LOYER", COMPTE)).toBeNull();
  });

  it("un loyer par Stripe n'est accepté que si l'option est activée ; un abonnement ne dépend pas de l'option", () => {
    expect(indisponibiliteSelonUsage("STRIPE", "EUR", "LOYER")).toMatchObject({ status: 400, code: "RENT_ONLINE_PAYMENT_DISABLED" });
    expect(indisponibiliteSelonUsage("STRIPE", "EUR", "ABONNEMENT")).toBeNull();
    env.payments.rentOnline = true;
    expect(indisponibiliteSelonUsage("STRIPE", "EUR", "LOYER")).toBeNull();
  });

  it("propose les moyens dans l'ordre de l'interface, démo comprise, et tient compte du compte d'agence pour un loyer", () => {
    env.payments.demoMode = true;
    expect(MOYENS_DE_PAIEMENT).toEqual(["PAYDUNYA", "STRIPE", "DEMO"]);
    expect(moyensDePaiementDisponibles("EUR")).toEqual(["PAYDUNYA", "STRIPE", "DEMO"]);

    env.payments.demoMode = false;
    expect(moyensDePaiementDisponibles("XOF", "LOYER", COMPTE)).toEqual(["PAYDUNYA"]);
    // Sans compte PayDunya de l'agence : aucun moyen en ligne pour un loyer (l'agence enregistre le règlement à la main).
    expect(moyensDePaiementDisponibles("XOF", "LOYER", null)).toEqual([]);
  });
});

describe("Stripe Checkout — requête envoyée", () => {
  it("envoie la session complète : mode, payeur, références, quantité, nom, description et adresses de retour", async () => {
    const fetchMock = simuler(reponse(SESSION_STRIPE));

    await stripe({ invoiceId: "sub_mgr_1" });

    const corps = corpsStripe(fetchMock);
    expect(corps.get("mode")).toBe("payment");
    expect(corps.get("customer_email")).toBe("Test@Test.local");
    expect(corps.get("client_reference_id")).toBe("sub_mgr_1");
    expect(corps.get("metadata[reference]")).toBe("sub_mgr_1");
    expect(corps.get("line_items[0][quantity]")).toBe("1");
    expect(corps.get("line_items[0][price_data][product_data][name]")).toBe(env.payments.storeName);
    expect(corps.get("line_items[0][price_data][product_data][description]")).toBe("Paiement sub_mgr_1");
    expect(corps.get("success_url")).toBe(`${env.frontendUrl}/subscription?stripe=succes`);
    expect(corps.get("cancel_url")).toBe(`${env.frontendUrl}/subscription?stripe=annule`);
    expect(corps.has("line_items[0][price_data][recurring][interval]")).toBe(false);
  });

  it("sans chemin de retour, revient à la racine du site", async () => {
    const fetchMock = simuler(reponse(SESSION_STRIPE));

    await stripe({ returnPath: undefined });

    expect(corpsStripe(fetchMock).get("success_url")).toBe(`${env.frontendUrl}/?stripe=succes`);
  });

  it("un renouvellement automatique passe en mode abonnement, mensuel par défaut, annuel sur demande", async () => {
    const mensuel = simuler(reponse(SESSION_STRIPE));
    await stripe({ autoRenew: true });
    const parDefaut = corpsStripe(mensuel);
    const annuel = simuler(reponse(SESSION_STRIPE));
    await stripe({ autoRenew: true, billingCycle: "ANNUAL" });
    const sur = corpsStripe(annuel);
    const explicite = simuler(reponse(SESSION_STRIPE));
    await stripe({ autoRenew: true, billingCycle: "MONTHLY" });

    expect(parDefaut.get("mode")).toBe("subscription");
    expect(parDefaut.get("line_items[0][price_data][recurring][interval]")).toBe("month");
    expect(sur.get("line_items[0][price_data][recurring][interval]")).toBe("year");
    expect(corpsStripe(explicite).get("line_items[0][price_data][recurring][interval]")).toBe("month");
  });

  it("la clé d'idempotence porte la référence, le montant et 12 caractères du payeur, sans tenir compte de la casse de son adresse", async () => {
    const a = simuler(reponse(SESSION_STRIPE));
    await stripe({ payerEmail: "Awa@Test.local" });
    const b = simuler(reponse(SESSION_STRIPE));
    await stripe({ payerEmail: "awa@test.local" });

    const cleA = a.mock.calls[0][1].headers["Idempotency-Key"] as string;
    const cleB = b.mock.calls[0][1].headers["Idempotency-Key"] as string;
    expect(cleA).toMatch(/^checkout_sub_mgr_1_2900_[0-9a-f]{12}$/);
    expect(cleB).toBe(cleA);
  });

  it("refuse avec le bon code et le bon statut : réseau, réponse illisible, refus de Stripe, réponse sans identifiant ou sans adresse", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("réseau")));
    const reseau = await erreurDe(stripe());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error("pas du json"); } }));
    const illisible = await erreurDe(stripe());
    simuler(reponse(SESSION_STRIPE, false));
    const refuse = await erreurDe(stripe());
    simuler(reponse({ url: SESSION_STRIPE.url }));
    const sansId = await erreurDe(stripe());
    simuler(reponse({ id: SESSION_STRIPE.id }));
    const sansUrl = await erreurDe(stripe());

    expect([reseau?.statusCode, reseau?.code]).toEqual([502, "PAYMENT_PROVIDER_UNREACHABLE"]);
    expect([illisible?.statusCode, illisible?.code]).toEqual([502, "PAYMENT_PROVIDER_BAD_RESPONSE"]);
    for (const e of [refuse, sansId, sansUrl]) expect([e?.statusCode, e?.code]).toEqual([502, "CARD_PAYMENT_INIT_FAILED"]);
  });
});

describe("PayDunya — requête envoyée", () => {
  it("envoie la facture complète : clés distinctes, montant arrondi, description, boutique, payeur, référence et adresses", async () => {
    const fetchMock = simuler(reponse(REPONSE_PAYDUNYA));

    const res = await paydunya({ invoiceId: "inv-77", payerEmail: "locataire@test.local" });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create");
    expect(options.headers["PAYDUNYA-MASTER-KEY"]).toBe("mk-plateforme");
    expect(options.headers["PAYDUNYA-PRIVATE-KEY"]).toBe("pk-plateforme");
    expect(options.headers["PAYDUNYA-TOKEN"]).toBe("tk-plateforme");
    const corps = corpsPaydunya(fetchMock);
    expect(corps.invoice.total_amount).toBe(54839);
    expect(corps.invoice.description).toBe(`Paiement inv-77 — ${env.payments.storeName}`);
    expect(corps.store.name).toBe(env.payments.storeName);
    expect(corps.customer.email).toBe("locataire@test.local");
    expect(corps.custom_data.reference).toBe("inv-77");
    expect(corps.actions.return_url).toBe(`${env.frontendUrl}/portail?paydunya=succes`);
    expect(corps.actions.cancel_url).toBe(`${env.frontendUrl}/portail?paydunya=annule`);
    expect(res).toMatchObject({ method: "PAYDUNYA", status: "REQUIRES_ACTION", reference: "tok-1", redirectUrl: "https://paydunya.test/abc" });
  });

  it("sans chemin de retour, revient à la racine du site ; en mode réel, utilise l'API de production", async () => {
    env.payments.paydunya = { ...env.payments.paydunya, mode: "live" };
    const fetchMock = simuler(reponse(REPONSE_PAYDUNYA));

    await paydunya({ returnPath: undefined });

    expect(fetchMock.mock.calls[0][0]).toBe("https://app.paydunya.com/api/v1/checkout-invoice/create");
    expect(corpsPaydunya(fetchMock).actions.return_url).toBe(`${env.frontendUrl}/?paydunya=succes`);
  });

  it("refuse avec le bon code : réseau, réponse illisible, refus HTTP même avec un corps valide, code de réponse autre que 00, réponse sans jeton ou sans adresse", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("réseau")));
    const reseau = await erreurDe(paydunya());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error("pas du json"); } }));
    const illisible = await erreurDe(paydunya());
    simuler(reponse(REPONSE_PAYDUNYA, false));
    const refuse = await erreurDe(paydunya());
    simuler(reponse({ ...REPONSE_PAYDUNYA, response_code: "01" }));
    const autreCode = await erreurDe(paydunya());
    simuler(reponse({ response_code: "00", response_text: REPONSE_PAYDUNYA.response_text }));
    const sansJeton = await erreurDe(paydunya());
    simuler(reponse({ response_code: "00", token: "tok-1" }));
    const sansAdresse = await erreurDe(paydunya());

    expect([reseau?.statusCode, reseau?.code]).toEqual([502, "PAYDUNYA_UNREACHABLE"]);
    expect([illisible?.statusCode, illisible?.code]).toEqual([502, "PAYDUNYA_BAD_RESPONSE"]);
    for (const e of [refuse, autreCode, sansJeton, sansAdresse]) expect([e?.statusCode, e?.code]).toEqual([502, "PAYDUNYA_INIT_FAILED"]);
  });
});

describe("Résiliation et pause d'abonnement Stripe", () => {
  const corpsDe = (fetchMock: ReturnType<typeof simuler>) => (fetchMock.mock.calls[0][1].body ?? "") as string;

  describe("cancelStripeSubscriptionAtPeriodEnd", () => {
    it("sans clé Stripe, échoue sans appeler Stripe, avec son code", async () => {
      env.payments.stripeSecretKey = "";
      const fetchMock = simuler(reponse({}));

      const err = await erreurDe(cancelStripeSubscriptionAtPeriodEnd("sub_123"));

      expect([err?.statusCode, err?.code]).toEqual([502, "STRIPE_NOT_CONFIGURED_CANCEL_RENEWAL"]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("demande la fin à l'échéance de CET abonnement, avec la clé, et réussit sans relire la réponse", async () => {
      const fetchMock = simuler({ ok: true });

      await cancelStripeSubscriptionAtPeriodEnd("sub_123");

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.stripe.com/v1/subscriptions/sub_123");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer sk_test_cle");
      expect(corpsDe(fetchMock)).toBe("cancel_at_period_end=true");
    });

    it("tient pour résilié un abonnement que Stripe ne connaît plus, refuse tout autre échec, et signale un réseau indisponible", async () => {
      simuler(reponse({ error: { code: "resource_missing" } }, false));
      await expect(cancelStripeSubscriptionAtPeriodEnd("sub_123")).resolves.toBeUndefined();

      simuler(reponse({ error: { code: "autre", message: "refus" } }, false));
      const refuse = await erreurDe(cancelStripeSubscriptionAtPeriodEnd("sub_123"));
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("réseau")));
      const reseau = await erreurDe(cancelStripeSubscriptionAtPeriodEnd("sub_123"));

      expect([refuse?.statusCode, refuse?.code]).toEqual([502, "STRIPE_REFUSED_CANCEL_RENEWAL"]);
      expect([reseau?.statusCode, reseau?.code]).toEqual([502, "STRIPE_UNREACHABLE_NOTHING_CHANGED"]);
    });
  });

  describe("setStripeCollectionPaused", () => {
    it("sans clé Stripe, échoue sans appeler Stripe, avec son code", async () => {
      env.payments.stripeSecretKey = "";
      const fetchMock = simuler(reponse({}));

      const err = await erreurDe(setStripeCollectionPaused("sub_123", true));

      expect([err?.statusCode, err?.code]).toEqual([502, "STRIPE_NOT_CONFIGURED_PAUSE_BILLING"]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("met en pause en annulant les factures, ou reprend en vidant la pause", async () => {
      const pause = simuler({ ok: true });
      await setStripeCollectionPaused("sub_123", true);
      const corpsPause = corpsDe(pause);
      const reprise = simuler({ ok: true });
      await setStripeCollectionPaused("sub_123", false);

      expect(decodeURIComponent(corpsPause)).toBe("pause_collection[behavior]=void");
      expect(corpsDe(reprise)).toBe("pause_collection=");
    });

    it("tient pour déjà en pause un abonnement inconnu de Stripe, refuse tout autre échec, signale un réseau indisponible", async () => {
      simuler(reponse({ error: { code: "resource_missing" } }, false));
      await expect(setStripeCollectionPaused("sub_123", true)).resolves.toBeUndefined();

      simuler(reponse({ error: { code: "autre" } }, false));
      const refuse = await erreurDe(setStripeCollectionPaused("sub_123", true));
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("réseau")));
      const reseau = await erreurDe(setStripeCollectionPaused("sub_123", true));

      expect([refuse?.statusCode, refuse?.code]).toEqual([502, "STRIPE_REFUSED_BILLING_UPDATE"]);
      expect([reseau?.statusCode, reseau?.code]).toEqual([502, "STRIPE_UNREACHABLE_NOTHING_CHANGED"]);
    });
  });

  describe("cancelStripeSubscriptionNow", () => {
    it("sans clé Stripe, échoue sans appeler Stripe, avec son code", async () => {
      env.payments.stripeSecretKey = "";
      const fetchMock = simuler(reponse({}));

      const err = await erreurDe(cancelStripeSubscriptionNow("sub_123"));

      expect([err?.statusCode, err?.code]).toEqual([502, "STRIPE_NOT_CONFIGURED_CANCEL_SUBSCRIPTION"]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("supprime CET abonnement par une requête DELETE avec la clé, et réussit sans relire la réponse", async () => {
      const fetchMock = simuler({ ok: true });

      await cancelStripeSubscriptionNow("sub_123");

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.stripe.com/v1/subscriptions/sub_123");
      expect(options.method).toBe("DELETE");
      expect(options.headers.Authorization).toBe("Bearer sk_test_cle");
    });

    it("tient pour résilié un abonnement inconnu de Stripe, refuse tout autre échec, signale un réseau indisponible", async () => {
      simuler(reponse({ error: { code: "resource_missing" } }, false));
      await expect(cancelStripeSubscriptionNow("sub_123")).resolves.toBeUndefined();

      simuler(reponse({ error: { code: "autre" } }, false));
      const refuse = await erreurDe(cancelStripeSubscriptionNow("sub_123"));
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("réseau")));
      const reseau = await erreurDe(cancelStripeSubscriptionNow("sub_123"));

      expect([refuse?.statusCode, refuse?.code]).toEqual([502, "STRIPE_REFUSED_CANCEL_SUBSCRIPTION"]);
      expect([reseau?.statusCode, reseau?.code]).toEqual([502, "STRIPE_UNREACHABLE_NOTHING_DELETED"]);
    });
  });
});
