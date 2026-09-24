import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { invoices } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createPortalUser,
  createProperty,
  createTenant,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Stripe protège son propre appel via un Idempotency-Key (voir
 * initiateStripePayment, payment.service.ts) : deux clics simultanés sur
 * "Payer" renvoient la MÊME session Stripe. L'API PayDunya n'offre rien
 * d'équivalent — chaque appel à /checkout-invoice/create crée une facture
 * distincte chez PayDunya, quel que soit ce qu'on lui envoie.
 *
 * payInvoice ne protégeait que l'écriture finale en base (WHERE status IN
 * ETATS_MODIFIABLES) : les DEUX requêtes concurrentes passaient cette
 * vérification, appelaient toutes les deux PayDunya, et créaient donc deux
 * factures de paiement réelles pour un seul loyer — la seconde parfaitement
 * payable, sans qu'aucune des deux ne solde jamais l'autre.
 */
describe("payInvoice — idempotence PayDunya", () => {
  const original = { paydunya: { ...env.payments.paydunya } };

  afterEach(() => {
    env.payments.demoMode = true;
    env.payments.paydunya = { ...original.paydunya };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function setupLocataireAvecFacturePaydunya() {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    // XOF : la devise par défaut du compte PayDunya en test (voir config/env.ts,
    // PAYDUNYA_CURRENCY absente de setupTestDb) — indispensable pour que
    // PAYDUNYA passe le contrôle de devise de indisponibilite() et parte
    // réellement en réseau au lieu d'être refusé en amont.
    const invoice = await createInvoice(contract.id, { currency: "XOF", amount: 25000 });
    const tenantToken = await tokenLocataire(tenant.id);

    env.payments.demoMode = false;
    env.payments.paydunya = { ...original.paydunya, masterKey: "mk", privateKey: "pk", token: "tk" };

    return { manager, property, tenant, contract, invoice, tenantToken };
  }

  function reponsePaydunyaOk() {
    return { ok: true, json: async () => ({ response_code: "00", response_text: "https://paydunya.test/abc", token: "tok" }) };
  }

  it("refuse (409) un second paiement pendant qu'un premier est en cours, sans jamais appeler PayDunya", async () => {
    // Réclamation posée directement, comme le ferait le premier des deux clics
    // simultanés — la première étape de payInvoice pour cette requête-ci, sans
    // dépendre d'un minutage réel entre deux appels HTTP concurrents.
    const { invoice, tenantToken } = await setupLocataireAvecFacturePaydunya();
    await testDb.update(invoices).set({ paymentAttemptStartedAt: new Date() }).where(eq(invoices.id, invoice.id));

    const fetchMock = vi.fn().mockResolvedValue(reponsePaydunyaOk());
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/pay`)
      .set(authHeader(tenantToken))
      .send({ method: "PAYDUNYA" });

    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();

    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("PENDING");
  });

  it("une réclamation périmée (crash passé) n'empêche pas un nouvel essai légitime", async () => {
    // Le filet de rattrapage : si le processus s'était arrêté net juste après
    // avoir posé la marque (crash, redéploiement), rien ne devrait plus jamais
    // pouvoir régler cette facture. Une réclamation vieille de deux minutes,
    // bien au-delà des 60 s de délai, doit redevenir reprenable.
    const { invoice, tenantToken } = await setupLocataireAvecFacturePaydunya();
    await testDb
      .update(invoices)
      .set({ paymentAttemptStartedAt: new Date(Date.now() - 120_000) })
      .where(eq(invoices.id, invoice.id));

    const fetchMock = vi.fn().mockResolvedValue(reponsePaydunyaOk());
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/pay`)
      .set(authHeader(tenantToken))
      .send({ method: "PAYDUNYA" });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lève la réclamation même si PayDunya répond une erreur, pour ne jamais bloquer un nouvel essai", async () => {
    const { invoice, tenantToken } = await setupLocataireAvecFacturePaydunya();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ response_code: "01", response_text: "Erreur PayDunya" }) })
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const echec = await request(app)
      .post(`/api/invoices/${invoice.id}/pay`)
      .set(authHeader(tenantToken))
      .send({ method: "PAYDUNYA" });
    expect(echec.status).toBe(502);

    // La marque ne doit pas avoir survécu à l'échec.
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.paymentAttemptStartedAt).toBeNull();

    vi.unstubAllGlobals();
    const fetchMock = vi.fn().mockResolvedValue(reponsePaydunyaOk());
    vi.stubGlobal("fetch", fetchMock);

    const reessai = await request(app)
      .post(`/api/invoices/${invoice.id}/pay`)
      .set(authHeader(tenantToken))
      .send({ method: "PAYDUNYA" });

    expect(reessai.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deux paiements PayDunya déclenchés en même temps ne créent qu'UNE seule facture PayDunya", async () => {
    // Le scénario réel : deux requêtes HTTP concurrentes, sans manipulation
    // directe de la base. Le délai dans la réponse simulée laisse le temps à
    // la seconde requête d'atteindre sa propre tentative de réclamation avant
    // que la première ait relâché la sienne — exactement la fenêtre qui,
    // avant ce correctif, laissait passer les deux appels réseau.
    const { invoice, tenantToken } = await setupLocataireAvecFacturePaydunya();

    const fetchMock = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(reponsePaydunyaOk()), 40))
    );
    vi.stubGlobal("fetch", fetchMock);

    const [resA, resB] = await Promise.all([
      request(app).post(`/api/invoices/${invoice.id}/pay`).set(authHeader(tenantToken)).send({ method: "PAYDUNYA" }),
      request(app).post(`/api/invoices/${invoice.id}/pay`).set(authHeader(tenantToken)).send({ method: "PAYDUNYA" }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.paymentAttemptStartedAt).toBeNull();
  });
});
