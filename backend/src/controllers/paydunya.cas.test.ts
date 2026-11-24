import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { invoices, platformSubscriptions } from "../db/schema";
import * as comptePaiement from "../services/comptePaiementAgence.service";
import * as emailService from "../services/email.service";
import * as paiementEnLigne from "../services/paiementEnLigne.service";
import * as nonRapproche from "../services/paiementNonRapproche.service";
import * as receipt from "../services/receipt.service";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Notification IPN PayDunya (paydunya.controller.ts) : cas limites trouvés en sabotant le contrôleur, que les tests
 * existants laissaient passer. Appel de confirmation (adresse, en-têtes, réponses refusées), messages et journaux des
 * refus, signalements au gestionnaire, rapprochement des factures et des abonnements, tolérance des montants et signature.
 */
const MASTER_KEY = "test-paydunya-master-key-do-not-use-in-production";
const sha512 = (valeur: string) => crypto.createHash("sha512").update(valeur).digest("hex");
const VALID_HASH = sha512(MASTER_KEY);
const JETON = "pd_jeton";

const ipn = (jeton: string | undefined, reference: string | undefined, hash: unknown = VALID_HASH) =>
  request(app)
    .post("/api/payments/paydunya/ipn")
    .send({ data: JSON.stringify({ status: "completed", hash, invoice: jeton === undefined ? {} : { token: jeton }, custom_data: reference === undefined ? {} : { reference } }) });

function confirmer(options: { total?: number | string; reference?: string; status?: string; sansMontant?: boolean; sansStatut?: boolean; ok?: boolean; code?: string } = {}) {
  const corps = {
    response_code: options.code ?? "00",
    ...(options.sansStatut ? {} : { status: options.status ?? "completed" }),
    invoice: options.sansMontant ? {} : { total_amount: options.total ?? 500 },
    ...(options.reference === undefined ? {} : { custom_data: { reference: options.reference } }),
  };
  const fetchMock = vi.fn().mockResolvedValue({ ok: options.ok ?? true, json: async () => corps });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let signalerLoyer: ReturnType<typeof vi.spyOn>;
let signalerAbonnement: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  signalerLoyer = vi.spyOn(nonRapproche, "signalerPaiementNonRapproche").mockResolvedValue(undefined as never);
  signalerAbonnement = vi.spyOn(nonRapproche, "signalerAbonnementNonRapproche").mockImplementation(() => undefined as never);
  vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loyer(extra: Partial<typeof invoices.$inferInsert> = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  const invoice = await createInvoice(contract.id, { status: "PENDING", paymentMethod: "PAYDUNYA", paymentRef: JETON, amount: 500, ...extra });
  return { manager, invoice };
}
const facture = async (id: string) => (await testDb.select().from(invoices).where(eq(invoices.id, id)))[0];

async function abonnement(montant = 15) {
  const manager = await createManager({ subscriptionStatus: "EXPIRED" });
  const [ligne] = await testDb
    .insert(platformSubscriptions)
    .values({ userId: manager.id, plan: "STARTER", amount: montant, status: "PENDING", paymentMethod: "PAYDUNYA", paymentRef: JETON, startDate: new Date(2026, 5, 1), endDate: new Date(2026, 6, 1) })
    .returning();
  return { manager, ligne };
}

describe("PayDunya : appel de confirmation", () => {
  it("interroge le bac à sable avec le jeton encodé et les trois clés dans leurs en-têtes", async () => {
    const avant = { ...env.payments.paydunya };
    env.payments.paydunya.privateKey = "cle-privee-test";
    env.payments.paydunya.token = "jeton-api-test";
    try {
      const fetchMock = confirmer({ reference: "ref" });

      await ipn("jeton avec/des?caractères", "ref");

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(`https://app.paydunya.com/sandbox-api/v1/checkout-invoice/confirm/${encodeURIComponent("jeton avec/des?caractères")}`);
      expect(options.headers).toEqual({ "PAYDUNYA-MASTER-KEY": MASTER_KEY, "PAYDUNYA-PRIVATE-KEY": "cle-privee-test", "PAYDUNYA-TOKEN": "jeton-api-test" });
    } finally {
      Object.assign(env.payments.paydunya, avant);
    }
  });

  it("une panne réseau est journalisée et répond 502 avec le message « Confirmation indisponible »", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("réseau coupé")));

    const res = await ipn(JETON, "ref");

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Confirmation indisponible" });
    expect(console.error).toHaveBeenCalledWith(`[paydunya] Échec réseau lors de la confirmation du token ${JETON}:`, expect.any(Error));
  });

  it.each([
    ["un statut HTTP en erreur, même avec un code « 00 »", { ok: false }],
    ["une réponse sans statut", { sansStatut: true }],
    ["un code de réponse refusé", { code: "99" }],
  ])("%s : rien n'est crédité, la confirmation refusée est journalisée (502)", async (_nom, options) => {
    const { invoice } = await loyer();
    confirmer({ reference: invoice.id, ...options });

    const res = await ipn(JETON, invoice.id);

    expect(res.status).toBe(502);
    expect((await facture(invoice.id)).status).toBe("PENDING");
    expect(console.error).toHaveBeenCalledWith(`[paydunya] Confirmation refusée par PayDunya pour le token ${JETON}:`, expect.anything());
  });

  it("une réponse illisible répond 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error("pas du JSON"); } }));

    const res = await ipn(JETON, "ref");

    expect(res.status).toBe(502);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Réponse de confirmation illisible"), expect.any(Error));
  });

  it("un montant confirmé sous forme de texte est converti : le loyer est soldé", async () => {
    const { invoice } = await loyer();
    confirmer({ reference: invoice.id, total: "500" });

    await ipn(JETON, invoice.id);

    expect((await facture(invoice.id)).status).toBe("PAID");
  });

  it("une confirmation sans montant ne solde rien, même quand le reste dû est nul, et signale un montant nul", async () => {
    const { invoice } = await loyer({ amountPaid: 500 });
    confirmer({ reference: invoice.id, sansMontant: true });

    await ipn(JETON, invoice.id);

    expect((await facture(invoice.id)).status).toBe("PENDING");
    expect(signalerLoyer).toHaveBeenCalledWith(expect.objectContaining({ montant: 0, raison: "le montant payé ne correspond plus au reste dû, qui a changé depuis le début du paiement" }));
  });

  it("une confirmation sans référence propre n'empêche pas le règlement ; une référence différente l'empêche et est journalisée", async () => {
    const { invoice } = await loyer();
    confirmer({ reference: undefined });
    await ipn(JETON, invoice.id);
    expect((await facture(invoice.id)).status).toBe("PAID");

    const autre = await loyer({ paymentRef: "pd_autre" });
    confirmer({ reference: "autre-reference" });
    await ipn("pd_autre", autre.invoice.id);
    expect((await facture(autre.invoice.id)).status).toBe("PENDING");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`référence PayDunya 'autre-reference' ≠ référence reçue '${autre.invoice.id}'`));
  });
});

describe("PayDunya : refus et messages", () => {
  it("un corps sans « data » exploitable répond 400 « Requête invalide » et le journalise", async () => {
    const res = await request(app).post("/api/payments/paydunya/ipn").send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Requête invalide" });
    expect(console.warn).toHaveBeenCalledWith("[paydunya] IPN reçue sans champ 'data' exploitable.");
  });

  it("une signature fausse répond 401 « Signature invalide » et le journalise ; une signature qui n'est pas du texte aussi", async () => {
    const fausse = await ipn(JETON, "ref", sha512("autre-cle"));
    const numerique = await ipn(JETON, "ref", 12345);

    expect(fausse.status).toBe(401);
    expect(fausse.body).toEqual({ error: "Signature invalide" });
    expect(numerique.status).toBe(401);
    expect(console.warn).toHaveBeenCalledWith("[paydunya] IPN rejetée : hash invalide (mauvaise master key ou tentative frauduleuse).");
  });

  it("une clé maître vide n'authentifie jamais une notification, même signée avec l'empreinte d'une clé vide", async () => {
    const avant = env.payments.paydunya.masterKey;
    env.payments.paydunya.masterKey = "";
    try {
      const fetchMock = confirmer();

      const res = await ipn(JETON, "ref", sha512(""));

      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      env.payments.paydunya.masterKey = avant;
    }
  });

  it("le corps peut arriver déjà éclaté en champs (objet), pas seulement en JSON texte", async () => {
    const { invoice } = await loyer();
    confirmer({ reference: invoice.id });

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send({ data: { hash: VALID_HASH, invoice: { token: JETON }, custom_data: { reference: invoice.id } } });

    expect(res.status).toBe(200);
    expect((await facture(invoice.id)).status).toBe("PAID");
  });

  it("une référence « sub… » qui n'est pas « sub_ » est un loyer, pas un abonnement", async () => {
    const { invoice } = await loyer();
    confirmer({ reference: "subvention-42" });

    await ipn(JETON, "subvention-42");

    expect((await facture(invoice.id)).status).toBe("PAID");
  });
});

describe("PayDunya : compte de paiement d'une agence", () => {
  const CLE_AGENCE = "cle-maitre-de-l-agence";
  const ipnAgence = (managerId: string, reference: string) =>
    request(app)
      .post(`/api/payments/paydunya/ipn/agence/${managerId}`)
      .send({ data: JSON.stringify({ hash: sha512(CLE_AGENCE), invoice: { token: JETON }, custom_data: { reference } }) });

  it("une agence sans compte actif reçoit 404 « Compte introuvable » et l'appel est journalisé", async () => {
    const res = await request(app).post("/api/payments/paydunya/ipn/agence/agence-inconnue").send({ data: "{}" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Compte introuvable" });
    expect(console.warn).toHaveBeenCalledWith("[paydunya] IPN reçue pour l'agence agence-inconnue, qui n'a pas de compte de paiement actif.");
  });

  it("une notification d'agence qui porte une référence d'abonnement est ignorée et journalisée, sans appeler PayDunya", async () => {
    vi.spyOn(comptePaiement, "lireIdentifiantsAgence").mockResolvedValue({ masterKey: CLE_AGENCE, privateKey: "p", token: "t", mode: "test" } as never);
    const fetchMock = confirmer();

    const res = await ipnAgence("agence-1", "sub_utilisateur_1");

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith("[paydunya] IPN de l'agence agence-1 portant une référence d'abonnement : ignorée.");
  });
});

describe("PayDunya : abonnement de la plateforme", () => {
  it("un abonnement introuvable est signalé avec le prestataire, le jeton, le montant confirmé et la raison", async () => {
    confirmer({ total: 15, reference: "sub_x_1" });

    await ipn("jeton-sans-abonnement", "sub_x_1");

    expect(signalerAbonnement).toHaveBeenCalledWith({ prestataire: "PAYDUNYA", referencePrestataire: "jeton-sans-abonnement", montant: 15, raison: "abonnement introuvable pour ce jeton" });
  });

  it("un montant confirmé différent de l'abonnement n'active rien et est signalé avec le montant confirmé", async () => {
    const { manager, ligne } = await abonnement(15);
    confirmer({ total: 10, reference: `sub_${manager.id}_1` });

    await ipn(JETON, `sub_${manager.id}_1`);

    expect((await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, ligne.id)))[0].status).toBe("PENDING");
    expect(signalerAbonnement).toHaveBeenCalledWith({ prestataire: "PAYDUNYA", referencePrestataire: JETON, montant: 10, raison: "montant différent de l'abonnement attendu" });
  });
});

describe("PayDunya : loyer", () => {
  it("un jeton qui ne correspond à aucune facture n'en solde aucune, même une autre facture réglée par PayDunya, et est signalé", async () => {
    const { invoice } = await loyer({ paymentRef: "pd_autre_jeton" });
    confirmer({ reference: invoice.id });

    await ipn("pd_jeton_inconnu", invoice.id);

    expect((await facture(invoice.id)).status).toBe("PENDING");
    expect(signalerLoyer).toHaveBeenCalledWith({
      prestataire: "PAYDUNYA",
      referenceFacture: invoice.id,
      referencePrestataire: "pd_jeton_inconnu",
      montant: 500,
      devise: "",
      raison: "la facture ne porte plus ce paiement : elle a été réglée autrement ou un autre paiement a été lancé depuis",
    });
  });

  it("une facture dont le jeton est celui du paiement mais réglée par un autre moyen n'est pas soldée", async () => {
    const { invoice } = await loyer({ paymentMethod: "STRIPE" });
    confirmer({ reference: invoice.id });

    await ipn(JETON, invoice.id);

    expect((await facture(invoice.id)).status).toBe("PENDING");
    expect(signalerLoyer).toHaveBeenCalledTimes(1);
  });

  it("le rejeu d'une notification pour une facture déjà réglée ne fait rien : ni règlement, ni signalement", async () => {
    const { invoice } = await loyer({ status: "PAID", amountPaid: 500 });
    confirmer({ reference: invoice.id });
    const solder = vi.spyOn(paiementEnLigne, "solderEnLigne");

    const res = await ipn(JETON, invoice.id);

    expect(res.status).toBe(200);
    expect(solder).not.toHaveBeenCalled();
    expect(signalerLoyer).not.toHaveBeenCalled();
  });

  it("une facture annulée n'est pas ressuscitée et le paiement est signalé avec la raison « annulée »", async () => {
    const { invoice } = await loyer({ status: "CANCELLED" });
    confirmer({ reference: invoice.id });

    await ipn(JETON, invoice.id);

    expect((await facture(invoice.id)).status).toBe("CANCELLED");
    expect(signalerLoyer).toHaveBeenCalledTimes(1);
    expect(signalerLoyer).toHaveBeenCalledWith({
      prestataire: "PAYDUNYA",
      referenceFacture: invoice.id,
      referencePrestataire: JETON,
      montant: 500,
      devise: "",
      raison: "la facture a été annulée",
    });
  });

  it("un montant payé différent du reste dû ne solde rien et est signalé avec le montant payé et la raison", async () => {
    const { invoice } = await loyer();
    confirmer({ reference: invoice.id, total: 300 });

    await ipn(JETON, invoice.id);

    expect((await facture(invoice.id)).status).toBe("PENDING");
    expect(signalerLoyer).toHaveBeenCalledWith({
      prestataire: "PAYDUNYA",
      referenceFacture: invoice.id,
      referencePrestataire: JETON,
      montant: 300,
      devise: "",
      raison: "le montant payé ne correspond plus au reste dû, qui a changé depuis le début du paiement",
    });
  });

  it.each([
    ["5 centimes", 500.05],
    ["50 centimes", 500.5],
  ])("un montant payé avec %s d'écart n'est pas accepté", async (_nom, montant) => {
    const { invoice } = await loyer();
    confirmer({ reference: invoice.id, total: montant });

    await ipn(JETON, invoice.id);

    expect((await facture(invoice.id)).status).toBe("PENDING");
  });

  it("le règlement est enregistré comme payé par PayDunya, et la quittance part pour cette facture", async () => {
    const { invoice } = await loyer();
    confirmer({ reference: invoice.id });
    const quittance = vi.spyOn(receipt, "sendPaymentReceiptEmail").mockResolvedValue(undefined as never);

    const res = await ipn(JETON, invoice.id);

    expect(res.body).toEqual({ success: true });
    const apres = await facture(invoice.id);
    expect(apres.status).toBe("PAID");
    expect(apres.paymentMethod).toBe("PAYDUNYA");
    expect(quittance).toHaveBeenCalledWith(invoice.id);
  });

  it("un échec de l'envoi de la quittance ne défait pas le règlement", async () => {
    const { invoice } = await loyer();
    confirmer({ reference: invoice.id });
    vi.spyOn(receipt, "sendPaymentReceiptEmail").mockRejectedValue(new Error("SMTP indisponible"));

    const res = await ipn(JETON, invoice.id);

    expect(res.status).toBe(200);
    expect((await facture(invoice.id)).status).toBe("PAID");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Échec de l'envoi de la quittance"), expect.any(Error));
  });

  it("une facture devenue non réglable entre la lecture et le règlement : 200, sans quittance", async () => {
    const { invoice } = await loyer();
    confirmer({ reference: invoice.id });
    vi.spyOn(paiementEnLigne, "solderEnLigne").mockResolvedValue(undefined as never);
    const quittance = vi.spyOn(receipt, "sendPaymentReceiptEmail").mockResolvedValue(undefined as never);

    const res = await ipn(JETON, invoice.id);

    expect(res.status).toBe(200);
    expect(quittance).not.toHaveBeenCalled();
  });
});
