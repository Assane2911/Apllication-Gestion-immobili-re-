import * as Sentry from "@sentry/node";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { activityLogs, invoices, platformSubscriptions } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import * as emailService from "./email.service";
import { type EvenementPaiement, retrouverSessionDuPaiement, signalerRemboursementOuLitige } from "./remboursementPaiement.service";

/**
 * Remboursement ou litige d'un paiement Stripe déjà encaissé : la plateforme ne touche à rien, elle PRÉVIENT le gestionnaire.
 * Le fichier du webhook vérifie les parcours ; ici, le service seul : appel à Stripe, rattachement à la bonne facture, texte du
 * message et de la ligne de journal, devises, échappement, et la règle « ne jamais faire échouer le webhook pour un message ».
 */

let envoi: ReturnType<typeof vi.spyOn>;
let cleAvant: string;

function stripeRepond(corps: unknown, { ok = true, status = 200 } = {}) {
  const appel = vi.fn().mockResolvedValue({ ok, status, json: async () => corps });
  vi.stubGlobal("fetch", appel);
  return appel;
}
const stripeRetrouve = (id: string | null) => stripeRepond({ data: id ? [{ id }] : [] });

beforeEach(() => {
  cleAvant = env.payments.stripeSecretKey;
  env.payments.stripeSecretKey = "sk_test_cle_de_test";
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
});

afterEach(() => {
  env.payments.stripeSecretKey = cleAvant;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loyer(
  opts: { session?: string; title?: string; paymentMethod?: "STRIPE" | "CASH"; currency?: string; managerEmail?: string } = {}
) {
  const manager = await createManager(opts.managerEmail !== undefined ? { email: opts.managerEmail } : {});
  const property = await createProperty(manager.id, { title: opts.title ?? "Villa Ngor" });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  const invoice = await createInvoice(contract.id, {
    status: "PAID",
    paymentMethod: opts.paymentMethod ?? "STRIPE",
    paymentRef: opts.session ?? "cs_ok",
    amount: 500,
    periodMonth: 3,
    periodYear: 2026,
    currency: opts.currency ?? "EUR",
  });
  return { manager, property, invoice };
}

const remboursement = (extra: Partial<EvenementPaiement> = {}): EvenementPaiement => ({
  nature: "REMBOURSEMENT",
  referenceStripe: "ch_1",
  paymentIntent: "pi_1",
  montantBrut: 50000,
  devise: "eur",
  ...extra,
});
const litige = (extra: Partial<EvenementPaiement> = {}): EvenementPaiement => ({
  nature: "LITIGE",
  referenceStripe: "dp_1",
  paymentIntent: "pi_1",
  montantBrut: 50000,
  devise: "eur",
  ...extra,
});

const journal = (managerId: string) => testDb.select().from(activityLogs).where(eq(activityLogs.managerId, managerId));

describe("retrouverSessionDuPaiement : l'appel à Stripe", () => {
  it("interroge Stripe avec le paiement (encodé) et la clé secrète, et renvoie la session trouvée", async () => {
    const appel = stripeRetrouve("cs_abc");

    expect(await retrouverSessionDuPaiement("pi_a b&c")).toBe("cs_abc");

    const [url, init] = appel.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions?payment_intent=pi_a%20b%26c&limit=1");
    expect(init.headers.Authorization).toBe("Bearer sk_test_cle_de_test");
  });

  it("aucune session (liste vide, ou réponse sans données) : null, ce paiement n'est pas un paiement de la plateforme", async () => {
    stripeRepond({ data: [] });
    expect(await retrouverSessionDuPaiement("pi_1")).toBeNull();
    stripeRepond({});
    expect(await retrouverSessionDuPaiement("pi_1")).toBeNull();
    stripeRepond({ data: [{}] });
    expect(await retrouverSessionDuPaiement("pi_1")).toBeNull();
  });

  it("Stripe qui refuse : une erreur 502 explicite avec le code et le statut, pour que le webhook réponde en erreur et que Stripe rejoue", async () => {
    stripeRepond({}, { ok: false, status: 401 });

    await expect(retrouverSessionDuPaiement("pi_9")).rejects.toMatchObject({
      statusCode: 502,
      code: "STRIPE_PAYMENT_LOOKUP_FAILED",
      params: { paymentIntent: "pi_9", status: 401 },
    });
  });

  it("Stripe injoignable : l'erreur réseau remonte telle quelle (jamais avalée)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("réseau coupé")));

    await expect(retrouverSessionDuPaiement("pi_1")).rejects.toThrow("réseau coupé");
  });
});

describe("signalerRemboursementOuLitige : à qui, et quoi", () => {
  it("un échec de Stripe n'est pas avalé par le signalement : le webhook peut répondre en erreur", async () => {
    stripeRepond({}, { ok: false, status: 500 });

    await expect(signalerRemboursementOuLitige(remboursement())).rejects.toMatchObject({ statusCode: 502 });
    expect(envoi).not.toHaveBeenCalled();
  });

  it("un paiement inconnu de la plateforme ne déclenche ni message ni journal, ni erreur journalisée", async () => {
    const { manager } = await loyer();
    stripeRetrouve(null);
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    await signalerRemboursementOuLitige(remboursement());

    expect(erreur).not.toHaveBeenCalled();

    expect(envoi).not.toHaveBeenCalled();
    expect(await journal(manager.id)).toEqual([]);
  });

  it("une facture réglée autrement que par Stripe (même référence) n'est jamais rattachée", async () => {
    const { manager } = await loyer({ paymentMethod: "CASH" });
    stripeRetrouve("cs_ok");

    await signalerRemboursementOuLitige(remboursement());

    expect(envoi).not.toHaveBeenCalled();
    expect(await journal(manager.id)).toEqual([]);
  });

  it("une session qui ne correspond à aucune facture : rien, et ce n'est pas une erreur", async () => {
    const { manager } = await loyer({ session: "cs_ok" });
    stripeRetrouve("cs_autre");
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    await signalerRemboursementOuLitige(remboursement());

    expect(erreur).not.toHaveBeenCalled();

    expect(envoi).not.toHaveBeenCalled();
    expect(await journal(manager.id)).toEqual([]);
  });

  it("seul le gestionnaire du bien concerné est prévenu, jamais une autre agence", async () => {
    const concerne = await loyer({ session: "cs_a" });
    const autre = await loyer({ session: "cs_b" });
    stripeRetrouve("cs_a");

    await signalerRemboursementOuLitige(remboursement());

    expect(envoi).toHaveBeenCalledTimes(1);
    expect(envoi.mock.calls[0][0]).toBe(concerne.manager.email);
    expect((await journal(autre.manager.id)).length).toBe(0);
    expect((await journal(concerne.manager.id)).length).toBe(1);
  });

  it("l'abonnement à la plateforme n'est signalé qu'à Sentry (niveau erreur, étiqueté, montant converti), sans message ni journal", async () => {
    const manager = await createManager();
    await testDb.insert(platformSubscriptions).values({
      userId: manager.id,
      plan: "PRO",
      amount: 29,
      currency: "EUR",
      status: "PAID",
      paymentMethod: "STRIPE",
      paymentRef: "cs_abo",
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 8, 1),
    });
    stripeRetrouve("cs_abo");
    const signalement = vi.spyOn(Sentry, "captureMessage").mockReturnValue("id");

    await signalerRemboursementOuLitige(remboursement({ montantBrut: 2900 }));

    expect(signalement).toHaveBeenCalledTimes(1);
    const [message, contexte] = signalement.mock.calls[0] as unknown as [string, { level: string; tags: Record<string, string>; extra: Record<string, unknown> }];
    expect(message).toContain("remboursement");
    expect(contexte.level).toBe("error");
    expect(contexte.tags).toMatchObject({ source: "abonnement.remboursement_ou_litige", nature: "REMBOURSEMENT" });
    expect(contexte.extra).toMatchObject({ session: "cs_abo", reference: "ch_1", montant: 29, devise: "EUR" });
    expect(envoi).not.toHaveBeenCalled();
    expect(await journal(manager.id)).toEqual([]);
  });

  it("un abonnement prime : même si une facture portait la même référence, aucun gestionnaire n'est prévenu", async () => {
    const { manager } = await loyer({ session: "cs_double" });
    await testDb.insert(platformSubscriptions).values({
      userId: manager.id,
      plan: "PRO",
      amount: 29,
      currency: "EUR",
      status: "PAID",
      paymentMethod: "STRIPE",
      paymentRef: "cs_double",
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 8, 1),
    });
    stripeRetrouve("cs_double");
    vi.spyOn(Sentry, "captureMessage").mockReturnValue("id");

    await signalerRemboursementOuLitige(remboursement());

    expect(envoi).not.toHaveBeenCalled();
    expect(await journal(manager.id)).toEqual([]);
  });

  it("un litige sur un abonnement dit « litige » à Sentry ; un Sentry indisponible ne fait jamais échouer le signalement", async () => {
    const manager = await createManager();
    await testDb.insert(platformSubscriptions).values({
      userId: manager.id,
      plan: "PRO",
      amount: 29,
      currency: "EUR",
      status: "PAID",
      paymentMethod: "STRIPE",
      paymentRef: "cs_abo2",
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 8, 1),
    });
    stripeRetrouve("cs_abo2");
    const signalement = vi.spyOn(Sentry, "captureMessage").mockImplementation(() => {
      throw new Error("Sentry coupé");
    });

    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(signalerRemboursementOuLitige(litige())).resolves.toBeUndefined();

    expect(String(signalement.mock.calls[0][0])).toContain("litige");
    expect(erreur).not.toHaveBeenCalled(); // un suivi d'erreurs coupé n'est pas une erreur du signalement
  });

  it("la facture et l'abonnement ne sont jamais modifiés", async () => {
    const { invoice } = await loyer();
    stripeRetrouve("cs_ok");

    await signalerRemboursementOuLitige(remboursement());

    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres).toMatchObject({ status: "PAID", paymentMethod: "STRIPE", paymentRef: "cs_ok", amount: 500 });
  });
});

describe("signalerRemboursementOuLitige : le message et le journal", () => {
  it("remboursement : le journal et l'e-mail disent le montant remboursé, la période, le bien, et que la facture reste payée", async () => {
    const { manager, invoice } = await loyer();
    stripeRetrouve("cs_ok");

    await signalerRemboursementOuLitige(remboursement({ montantBrut: 12550 }));

    const [ligne] = await journal(manager.id);
    expect(ligne).toMatchObject({
      action: "paiement_en_ligne.rembourse",
      entityType: "invoice",
      entityId: invoice.id,
      entityLabel: "Villa Ngor — 03/2026",
      actorLabel: "Système",
    });
    expect(ligne.details).toContain("remboursé à hauteur de 125,5");
    expect(ligne.details).toContain("La facture reste enregistrée comme payée");
    expect(ligne.details).toContain("[REMBOURSEMENT:ch_1:12550]");

    const [destinataire, sujet, html] = envoi.mock.calls[0] as unknown as [string, string, string];
    expect(destinataire).toBe(manager.email);
    expect(sujet).toBe("Paiement en ligne remboursé — Villa Ngor, loyer 03/2026");
    expect(html).toContain("Un paiement a été remboursé");
    expect(html).toContain("125,5");
    expect(html).toContain("Nous n'avons rien modifié");
    expect(html).toContain("<code>ch_1</code>");
  });

  it("litige : le motif et la date limite (jour UTC) figurent dans le journal ET dans l'e-mail", async () => {
    const { manager } = await loyer();
    stripeRetrouve("cs_ok");

    await signalerRemboursementOuLitige(litige({ motif: "fraudulent", reponseAvant: new Date(Date.UTC(2026, 10, 12, 23, 30)) }));

    const [ligne] = await journal(manager.id);
    expect(ligne.action).toBe("paiement_en_ligne.litige");
    expect(ligne.details).toContain("motif : fraudulent");
    expect(ligne.details).toContain("réponse avant le 12 novembre 2026");
    expect(ligne.details).toContain("[LITIGE:dp_1:50000]");

    const [, sujet, html] = envoi.mock.calls[0] as unknown as [string, string, string];
    expect(sujet).toBe("Litige sur un paiement en ligne — Villa Ngor, loyer 03/2026");
    expect(html).toContain("Un paiement est contesté");
    expect(html).toContain("<code>fraudulent</code>");
    expect(html).toContain("Vous avez jusqu'au 12 novembre 2026");
    expect(html).toContain("<code>dp_1</code>");
  });

  it("litige sans motif ni date limite : ni « motif » ni « réponse avant » dans le message", async () => {
    const { manager } = await loyer();
    stripeRetrouve("cs_ok");

    await signalerRemboursementOuLitige(litige({ motif: null, reponseAvant: null }));

    const [ligne] = await journal(manager.id);
    expect(ligne.details).not.toContain("motif");
    expect(ligne.details).not.toContain("réponse avant");
    const html = envoi.mock.calls[0][2] as string;
    expect(html).not.toContain("motif");
    expect(html).not.toContain("Vous avez jusqu'au");
  });

  it("un remboursement ne mentionne jamais de motif ni de date limite, même si l'événement en porte", async () => {
    const { manager } = await loyer();
    stripeRetrouve("cs_ok");

    await signalerRemboursementOuLitige(remboursement({ motif: "duplicate", reponseAvant: new Date(Date.UTC(2026, 10, 12)) }));

    const [ligne] = await journal(manager.id);
    expect(ligne.details).not.toContain("duplicate");
    expect(ligne.details).not.toContain("réponse avant");
    expect(envoi.mock.calls[0][2] as string).not.toContain("duplicate");
  });

  it("le montant est converti selon la devise : les francs CFA n'ont pas de centimes, l'euro en a (÷ 100)", async () => {
    // Le texte lisible, sans la clé de dédoublonnage entre crochets (qui porte le montant brut).
    const lisible = (details: string) => details.replace(/\[[^\]]*\]/, "").replace(/\s| | /g, "");

    const cfa = await loyer({ session: "cs_cfa", currency: "XOF" });
    stripeRetrouve("cs_cfa");
    await signalerRemboursementOuLitige(remboursement({ devise: "xof", montantBrut: 150000, referenceStripe: "ch_cfa" }));
    expect(lisible((await journal(cfa.manager.id))[0].details)).toContain("150000");

    const euro = await loyer({ session: "cs_eur" });
    stripeRetrouve("cs_eur");
    await signalerRemboursementOuLitige(remboursement({ devise: "EUR", montantBrut: 150000, referenceStripe: "ch_eur" }));
    const texteEuro = lisible((await journal(euro.manager.id))[0].details);
    expect(texteEuro).toContain("1500€");
    expect(texteEuro).not.toContain("150000");
  });

  it("la devise de l'ÉVÉNEMENT est celle du message (c'est dans cette devise que l'argent est reparti)", async () => {
    const { manager } = await loyer({ currency: "EUR" });
    stripeRetrouve("cs_ok");

    await signalerRemboursementOuLitige(remboursement({ devise: "usd", montantBrut: 10000 }));

    const [ligne] = await journal(manager.id);
    expect(ligne.details).toContain("00");
    expect(ligne.details).not.toContain("€");
  });

  it("la date limite du litige est lue en UTC, quel que soit le fuseau du serveur", async () => {
    const tzAvant = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14 : 23 h 30 UTC le 12 est déjà le 13 sur place
    try {
      const { manager } = await loyer();
      stripeRetrouve("cs_ok");

      await signalerRemboursementOuLitige(litige({ reponseAvant: new Date(Date.UTC(2026, 10, 12, 23, 30)) }));

      expect((await journal(manager.id))[0].details).toContain("réponse avant le 12 novembre 2026");
    } finally {
      if (tzAvant === undefined) delete process.env.TZ;
      else process.env.TZ = tzAvant;
    }
  });

  it("un gestionnaire sans adresse e-mail : le journal est écrit, aucun message n'est tenté", async () => {
    const { manager } = await loyer({ managerEmail: "" });
    stripeRetrouve("cs_ok");
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    await signalerRemboursementOuLitige(remboursement());

    expect((await journal(manager.id)).length).toBe(1);
    expect(envoi).not.toHaveBeenCalled();
    expect(erreur).not.toHaveBeenCalled();
  });

  it("remboursement : le titre du bien est échappé dans l'e-mail comme dans le litige", async () => {
    await loyer({ title: "<b>Villa</b>" });
    stripeRetrouve("cs_ok");

    await signalerRemboursementOuLitige(remboursement());

    const html = envoi.mock.calls[0][2] as string;
    expect(html).not.toContain("<b>Villa");
    expect(html).toContain("&lt;b&gt;Villa");
  });

  it("le titre du bien, le motif et la référence sont échappés dans l'e-mail (aucun HTML saisi n'est repris)", async () => {
    const injection = '<img src=x onerror=alert(1)>';
    await loyer({ title: injection });
    stripeRetrouve("cs_ok");

    await signalerRemboursementOuLitige(litige({ motif: injection, referenceStripe: injection }));

    const html = envoi.mock.calls[0][2] as string;
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("signalerRemboursementOuLitige : un seul message par événement", () => {
  it("le même événement rejoué ne prévient qu'une fois, journal compris", async () => {
    const { manager } = await loyer();
    stripeRetrouve("cs_ok");

    await signalerRemboursementOuLitige(remboursement());
    await signalerRemboursementOuLitige(remboursement());

    expect(envoi).toHaveBeenCalledTimes(1);
    expect((await journal(manager.id)).length).toBe(1);
  });

  it("un autre montant remboursé, un autre débit, ou un litige sur le même paiement préviennent de nouveau", async () => {
    const { manager } = await loyer();
    stripeRetrouve("cs_ok");

    await signalerRemboursementOuLitige(remboursement({ montantBrut: 10000 }));
    await signalerRemboursementOuLitige(remboursement({ montantBrut: 20000 })); // remboursement supplémentaire
    await signalerRemboursementOuLitige(remboursement({ montantBrut: 20000, referenceStripe: "ch_2" })); // autre débit
    await signalerRemboursementOuLitige(litige({ referenceStripe: "ch_1", montantBrut: 20000 })); // même référence, autre nature

    expect(envoi).toHaveBeenCalledTimes(4);
    expect((await journal(manager.id)).length).toBe(4);
  });

  it("deux loyers de la MÊME agence touchés par un événement de même référence et montant : chacun est signalé (le doublon se juge par facture)", async () => {
    const { manager, property } = await loyer({ session: "cs_m1" });
    const tenant = await createTenant(manager.id);
    const contrat = await createContract(property.id, tenant.id);
    await createInvoice(contrat.id, { status: "PAID", paymentMethod: "STRIPE", paymentRef: "cs_m2", amount: 500, periodMonth: 4, periodYear: 2026 });

    stripeRetrouve("cs_m1");
    await signalerRemboursementOuLitige(remboursement());
    stripeRetrouve("cs_m2");
    await signalerRemboursementOuLitige(remboursement());

    expect(envoi).toHaveBeenCalledTimes(2);
    expect((await journal(manager.id)).length).toBe(2);
  });

  it("le même événement sur la facture d'une AUTRE agence n'est pas pris pour un doublon", async () => {
    const a = await loyer({ session: "cs_a" });
    const b = await loyer({ session: "cs_b" });

    stripeRetrouve("cs_a");
    await signalerRemboursementOuLitige(remboursement());
    stripeRetrouve("cs_b");
    await signalerRemboursementOuLitige(remboursement());

    expect(envoi).toHaveBeenCalledTimes(2);
    expect(envoi.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual([a.manager.email, b.manager.email].sort());
  });
});

describe("signalerRemboursementOuLitige : jamais d'échec bruyant après la recherche", () => {
  it("un échec d'envoi du courriel est journalisé et n'échoue pas, mais la ligne de journal est déjà posée", async () => {
    const { manager } = await loyer();
    stripeRetrouve("cs_ok");
    envoi.mockRejectedValueOnce(new Error("SMTP coupé"));
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(signalerRemboursementOuLitige(remboursement())).resolves.toBeUndefined();

    expect(erreur).toHaveBeenCalledTimes(1);
    expect(String(erreur.mock.calls[0][0])).toContain("remboursement");
    expect(String(erreur.mock.calls[0][0])).toContain("ch_1");
    expect((await journal(manager.id)).length).toBe(1);
  });

  it("un litige qui échoue est nommé « litige » dans le message d'erreur", async () => {
    await loyer();
    stripeRetrouve("cs_ok");
    envoi.mockRejectedValueOnce(new Error("SMTP coupé"));
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    await signalerRemboursementOuLitige(litige());

    expect(String(erreur.mock.calls[0][0])).toContain("litige");
    expect(String(erreur.mock.calls[0][0])).toContain("dp_1");
  });

  it("l'envoi qui a échoué ne bloque pas un nouvel essai : le journal étant déjà posé, le rejeu ne renvoie pas le message", async () => {
    await loyer();
    stripeRetrouve("cs_ok");
    envoi.mockRejectedValueOnce(new Error("SMTP coupé"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await signalerRemboursementOuLitige(remboursement());
    await signalerRemboursementOuLitige(remboursement());

    expect(envoi).toHaveBeenCalledTimes(1);
  });
});
