import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { ApiError } from "../utils/asyncHandler";
import {
  initiatePayment,
  MOYENS_DE_PAIEMENT,
  moyensDePaiementDisponibles,
  versPlusPetiteUnite,
} from "./payment.service";

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
  });

  it("DEMO : renvoie toujours un paiement simulé confirmé (PAID)", async () => {
    const result = await initiatePayment({
      method: "DEMO",
      currency: "XOF",
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
      initiatePayment({ method: "DEMO", currency: "XOF", amount: 25000, invoiceId: "inv-1", payerEmail: "a@test.local" })
    ).rejects.toThrow(ApiError);

    try {
      await initiatePayment({ method: "DEMO", currency: "XOF", amount: 25000, invoiceId: "inv-1", payerEmail: "a@test.local" });
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
      currency: "XOF",
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
      currency: "XOF",
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
      currency: "XOF",
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
      currency: "XOF",
      amount: 29,
      invoiceId: "inv-1",
      payerEmail: "test@test.local",
    });

    expect(result.status).toBe("PAID");
    expect(result.method).toBe("STRIPE");
  });

  it("STRIPE : refuse (503) sans secret de webhook, car le paiement ne pourrait jamais être confirmé", async () => {
    // Ce test remplace « Stripe n'est pas encore câblé » : l'intégration
    // existe désormais. Le risque a changé de nature — une clé secrète seule
    // permettrait d'encaisser, mais sans secret de webhook aucune
    // confirmation ne serait authentifiable, et le client paierait sans que
    // sa facture ne soit jamais soldée.
    env.payments.demoMode = false;
    env.payments.stripeSecretKey = "sk_test_fake_key";
    env.payments.stripeWebhookSecret = "";
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await initiatePayment({
        method: "STRIPE",
        currency: "EUR",
        amount: 29,
        invoiceId: "inv-1",
        payerEmail: "test@test.local",
      });
      expect.unreachable("un paiement Stripe sans secret de webhook ne doit pas aboutir");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(503);
    }

    expect(fetchMock).not.toHaveBeenCalled();
    journal.mockRestore();
  });

  it("STRIPE : refuse (503) une devise absente de STRIPE_CURRENCIES", async () => {
    env.payments.demoMode = false;
    env.payments.stripeSecretKey = "sk_test_fake_key";
    env.payments.stripeWebhookSecret = "whsec_test";
    env.payments.stripeCurrencies = ["EUR"];
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await initiatePayment({
        method: "STRIPE",
        currency: "XOF",
        amount: 15000,
        invoiceId: "inv-1",
        payerEmail: "test@test.local",
      });
      expect.unreachable("une devise non déclarée ne doit pas partir chez Stripe");
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(503);
      expect((err as ApiError).message).toContain("XOF");
    }

    journal.mockRestore();
  });

  it("STRIPE : crée une session Checkout et renvoie son URL de redirection", async () => {
    env.payments.demoMode = false;
    env.payments.stripeSecretKey = "sk_test_fake_key";
    env.payments.stripeWebhookSecret = "whsec_test";
    env.payments.stripeCurrencies = ["EUR"];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await initiatePayment({
      method: "STRIPE",
      currency: "EUR",
      amount: 29,
      invoiceId: "sub_mgr_1",
      payerEmail: "test@test.local",
      returnPath: "/subscription",
    });

    expect(result.status).toBe("REQUIRES_ACTION");
    // L'identifiant de session devient paymentRef : c'est par lui que le
    // webhook retrouvera l'abonnement.
    expect(result.reference).toBe("cs_test_123");
    expect(result.redirectUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_123");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(options.headers.Authorization).toBe("Bearer sk_test_fake_key");
    const corps = new URLSearchParams(options.body as string);
    expect(corps.get("mode")).toBe("payment");
    expect(corps.get("client_reference_id")).toBe("sub_mgr_1");
    expect(corps.get("line_items[0][price_data][currency]")).toBe("eur");
    // 29 EUR = 2900 centimes.
    expect(corps.get("line_items[0][price_data][unit_amount]")).toBe("2900");
  });

  it("STRIPE : n'ajoute pas de centimes à une devise qui n'en a pas (XOF)", async () => {
    // Le piège symétrique de celui de PayDunya : Stripe attend la plus petite
    // unité de la devise, mais le franc CFA n'a pas de sous-unité. Multiplier
    // par 100 facturerait 1 500 000 FCFA au lieu de 15 000.
    env.payments.demoMode = false;
    env.payments.stripeSecretKey = "sk_test_fake_key";
    env.payments.stripeWebhookSecret = "whsec_test";
    env.payments.stripeCurrencies = ["XOF"];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "cs_x", url: "https://checkout.stripe.com/c/pay/cs_x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await initiatePayment({
      method: "STRIPE",
      currency: "XOF",
      amount: 15000,
      invoiceId: "inv-1",
      payerEmail: "test@test.local",
    });

    const corps = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(corps.get("line_items[0][price_data][unit_amount]")).toBe("15000");
  });

  it("STRIPE : échoue (502) proprement si Stripe répond une erreur", async () => {
    env.payments.demoMode = false;
    env.payments.stripeSecretKey = "sk_test_fake_key";
    env.payments.stripeWebhookSecret = "whsec_test";
    env.payments.stripeCurrencies = ["EUR"];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: "Clé invalide" } }) })
    );

    await expect(
      initiatePayment({
        method: "STRIPE",
        currency: "EUR",
        amount: 29,
        invoiceId: "inv-1",
        payerEmail: "test@test.local",
      })
    ).rejects.toThrow(ApiError);
  });

  // Ce test affirmait exactement le contraire : « retombe sur une simulation
  // confirmée tant que les clés ne sont pas configurées », clés vidées et
  // demoMode à false, avec expect(result.status).toBe("PAID"). Il verrouillait
  // donc le défaut le plus coûteux du service — une clé absente en production
  // rendait la plateforme gratuite en silence. Le comportement attendu est
  // désormais l'inverse, et ces trois cas en tiennent la frontière.
  it("PAYDUNYA : refuse (503) hors mode démo si les clés manquent, au lieu de simuler un paiement", async () => {
    env.payments.demoMode = false;
    env.payments.paydunya.masterKey = "";
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await initiatePayment({
        method: "PAYDUNYA",
        currency: "XOF",
        amount: 25000,
        invoiceId: "inv-1",
        payerEmail: "a@test.local",
      });
      expect.unreachable("un paiement sans clé ne doit jamais aboutir hors mode démo");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(503);
    }

    // Aucun appel réseau : le refus est décidé avant, sur la configuration.
    expect(fetchMock).not.toHaveBeenCalled();
    // La cause exacte reste côté serveur — c'est le seul indice de l'exploitant.
    expect(journal).toHaveBeenCalled();
    expect(journal.mock.calls[0]?.[0]).toContain("PAYDUNYA");
    journal.mockRestore();
  });

  it("PAYDUNYA : simule encore sans clés SI le mode démo est explicite (flux de développement)", async () => {
    // Le garde-fou ne doit pas coûter le développement local : en mode démo
    // assumé, l'absence de clés reste un paiement simulé.
    env.payments.demoMode = true;
    env.payments.paydunya = { ...original.paydunya, masterKey: "", privateKey: "", token: "" };

    const result = await initiatePayment({
      method: "PAYDUNYA",
      currency: "XOF",
      amount: 25000,
      invoiceId: "inv-1",
      payerEmail: "a@test.local",
    });

    expect(result.status).toBe("PAID");
  });

  it("STRIPE : refuse (503) hors mode démo si la clé manque, au lieu de simuler un paiement", async () => {
    // Même trou que PayDunya, et jamais couvert : la condition
    // `!stripeSecretKey || demoMode` simulait un PAID dès que la clé était
    // absente, production comprise.
    env.payments.demoMode = false;
    env.payments.stripeSecretKey = "";
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await initiatePayment({
        method: "STRIPE",
        currency: "XOF",
        amount: 29,
        invoiceId: "inv-1",
        payerEmail: "a@test.local",
      });
      expect.unreachable("un paiement sans clé ne doit jamais aboutir hors mode démo");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(503);
    }

    expect(journal).toHaveBeenCalled();
    journal.mockRestore();
  });

  it("PAYDUNYA : refuse (503) un montant libellé dans une autre devise que celle du compte", async () => {
    // L'API PayDunya ne transporte pas de devise : `total_amount` est lu dans
    // celle du compte. Un abonnement affiché 29 € envoyé tel quel sur un
    // compte sénégalais aurait été facturé 29 FCFA, soit environ quatre
    // centimes — et la souscription aurait paru réussir.
    env.payments.demoMode = false;
    env.payments.paydunya = { ...original.paydunya, masterKey: "mk", privateKey: "pk", token: "tk", currency: "XOF" };
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await initiatePayment({
        method: "PAYDUNYA",
        currency: "EUR",
        amount: 29,
        invoiceId: "sub-1",
        payerEmail: "a@test.local",
      });
      expect.unreachable("un montant en EUR ne doit pas partir vers un compte en XOF");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(503);
      expect((err as ApiError).message).toContain("EUR");
    }

    // Rien n'est parti sur le réseau : le refus précède l'appel.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(journal).toHaveBeenCalled();
    journal.mockRestore();
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
      currency: "XOF",
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
      initiatePayment({ method: "PAYDUNYA", currency: "XOF", amount: 29, invoiceId: "inv-1", payerEmail: "test@test.local" })
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
      initiatePayment({ method: "PAYDUNYA", currency: "XOF", amount: 29, invoiceId: "inv-1", payerEmail: "test@test.local" })
    ).rejects.toThrow(ApiError);
  });
});

describe("moyensDePaiementDisponibles", () => {
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

  /**
   * La propriété qui compte vraiment. L'interface affichait une liste écrite à
   * la main pendant que le serveur appliquait ses propres conditions : d'où un
   * bouton PayDunya proposé, puis refusé en 503, avec un message invitant à
   * choisir « un autre » moyen inexistant. Ce test interdit à cette divergence
   * de réapparaître : tout moyen annoncé doit aboutir, tout moyen écarté doit être
   * refusé — vérifié en appelant réellement initiatePayment.
   */
  async function verifierCoherence(devisePayee: string) {
    const disponibles = moyensDePaiementDisponibles(devisePayee);

    for (const method of MOYENS_DE_PAIEMENT) {
      let aAbouti = true;
      try {
        await initiatePayment({
          method,
          currency: devisePayee,
          amount: 25000,
          invoiceId: "inv-coherence",
          payerEmail: "a@test.local",
        });
      } catch {
        aAbouti = false;
      }

      expect(
        aAbouti,
        `${method} annoncé ${disponibles.includes(method) ? "disponible" : "indisponible"} mais ${aAbouti ? "accepté" : "refusé"} par initiatePayment (devise ${devisePayee})`
      ).toBe(disponibles.includes(method));
    }

    return disponibles;
  }

  it("mode démo : tout est proposé, et tout aboutit", async () => {
    env.payments.demoMode = true;
    env.payments.paydunya = { ...original.paydunya, masterKey: "", privateKey: "", token: "" };

    const disponibles = await verifierCoherence("EUR");
    expect(disponibles).toEqual(MOYENS_DE_PAIEMENT);
  });

  it("hors mode démo sans aucune clé : seul le virement reste, et il est le seul à aboutir", async () => {
    env.payments.demoMode = false;
    env.payments.stripeSecretKey = "";
    env.payments.paydunya = { ...original.paydunya, masterKey: "", privateKey: "", token: "", currency: "XOF" };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const disponibles = await verifierCoherence("XOF");
    expect(disponibles).toEqual(["BANK_TRANSFER"]);
  });

  it("hors mode démo, clés posées et devise compatible : PayDunya redevient proposable", async () => {
    env.payments.demoMode = false;
    env.payments.stripeSecretKey = "";
    env.payments.paydunya = { ...original.paydunya, masterKey: "mk", privateKey: "pk", token: "tk", currency: "XOF" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ response_code: "00", response_text: "https://paydunya.test/abc", token: "tok" }),
      })
    );

    const disponibles = await verifierCoherence("XOF");
    expect(disponibles).toEqual(["PAYDUNYA", "BANK_TRANSFER"]);
  });

  it("clés posées mais facture dans une autre devise : PayDunya disparaît de la liste", async () => {
    // Le cas qui coûtait de l'argent : un montant en EUR envoyé à un compte en
    // XOF aurait été facturé au centième du prix. L'interface ne doit donc
    // même pas le proposer.
    env.payments.demoMode = false;
    env.payments.stripeSecretKey = "";
    env.payments.paydunya = { ...original.paydunya, masterKey: "mk", privateKey: "pk", token: "tk", currency: "XOF" };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const disponibles = await verifierCoherence("EUR");
    expect(disponibles).toEqual(["BANK_TRANSFER"]);
  });
});

describe("versPlusPetiteUnite", () => {
  it("convertit en centimes les devises à décimales", () => {
    expect(versPlusPetiteUnite(29, "EUR")).toBe(2900);
    expect(versPlusPetiteUnite(9.5, "EUR")).toBe(950);
    expect(versPlusPetiteUnite(500, "usd")).toBe(50000);
  });

  it("laisse intactes les devises sans sous-unité", () => {
    // Un franc CFA ne se divise pas en centimes : 15 000 XOF valent 15000,
    // pas 1 500 000. Même règle pour le yen et le franc CFA d'Afrique centrale.
    expect(versPlusPetiteUnite(15000, "XOF")).toBe(15000);
    expect(versPlusPetiteUnite(15000, "xof")).toBe(15000);
    expect(versPlusPetiteUnite(25000, "XAF")).toBe(25000);
    expect(versPlusPetiteUnite(3000, "JPY")).toBe(3000);
  });

  it("arrondit à l'entier, Stripe n'acceptant pas de décimale", () => {
    expect(versPlusPetiteUnite(29.999, "EUR")).toBe(3000);
    expect(versPlusPetiteUnite(15000.4, "XOF")).toBe(15000);
  });
});
