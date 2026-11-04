import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { agencyPaymentAccounts, invoices } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  tokenCollaborateur,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Les loyers payés en ligne doivent arriver sur le compte PayDunya de l'AGENCE, jamais sur celui de la plateforme :
 * chaque agence enregistre ses propres identifiants (chiffrés), le paiement part avec eux, et la confirmation est
 * vérifiée avec eux.
 */
describe("compte de paiement PayDunya de l'agence", () => {
  const original = {
    demoMode: env.payments.demoMode,
    cle: env.payments.keysEncryptionKey,
    paydunya: { ...env.payments.paydunya },
  };
  const CLE = "ab".repeat(32);
  const AGENCE = { masterKey: "agence-master-key-1", privateKey: "agence-private-key-1", token: "agence-token-1234", mode: "live", currency: "xof" };

  afterEach(() => {
    env.payments.demoMode = original.demoMode;
    env.payments.keysEncryptionKey = original.cle;
    env.payments.paydunya = { ...original.paydunya };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Plateforme « réellement » configurée (hors démo), avec la clé de chiffrement. */
  function plateformeConfiguree() {
    env.payments.demoMode = false;
    env.payments.keysEncryptionKey = CLE;
    env.payments.paydunya = { ...original.paydunya, masterKey: "plateforme-master", privateKey: "plateforme-private", token: "plateforme-token", currency: "XOF" };
  }

  async function agenceAvecCompte() {
    const manager = await createManager();
    const res = await request(app).put("/api/agency/payment-account").set(authHeader(tokenFor(manager))).send(AGENCE);
    expect(res.status).toBe(200);
    return manager;
  }

  async function locataireAvecFacture(managerId: string, currency = "XOF") {
    const property = await createProperty(managerId);
    const tenant = await createTenant(managerId);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { currency, amount: 25000 });
    return { invoice, tenantToken: await tokenLocataire(tenant.id) };
  }

  function hashDe(cle: string) {
    return crypto.createHash("sha512").update(cle).digest("hex");
  }
  function corpsIpn(hash: string, token: string, reference: string) {
    return { data: JSON.stringify({ status: "completed", hash, invoice: { token }, custom_data: { reference } }) };
  }
  function confirmation(reference: string, montant: number) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response_code: "00", status: "completed", invoice: { total_amount: montant }, custom_data: { reference } }),
    });
  }

  describe("enregistrement", () => {
    it("chiffre les identifiants en base et n'en renvoie jamais aucun", async () => {
      plateformeConfiguree();
      const manager = await agenceAvecCompte();

      const [ligne] = await testDb.select().from(agencyPaymentAccounts).where(eq(agencyPaymentAccounts.managerId, manager.id));
      for (const clair of [AGENCE.masterKey, AGENCE.privateKey, AGENCE.token]) {
        expect(JSON.stringify(ligne)).not.toContain(clair);
      }
      expect(ligne.tokenLast4).toBe("1234");
      expect(ligne.currency).toBe("XOF");

      const lu = await request(app).get("/api/agency/payment-account").set(authHeader(tokenFor(manager)));
      expect(lu.status).toBe(200);
      expect(lu.body).toEqual({ configure: true, enabled: true, mode: "live", currency: "XOF", tokenLast4: "1234", disponible: true });
      expect(JSON.stringify(lu.body)).not.toContain("agence-");
    });

    it("refuse d'enregistrer quand la plateforme n'a pas de clé de chiffrement", async () => {
      plateformeConfiguree();
      env.payments.keysEncryptionKey = "";
      const manager = await createManager();

      const res = await request(app).put("/api/agency/payment-account").set(authHeader(tokenFor(manager))).send(AGENCE);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("AGENCY_PAYMENTS_UNAVAILABLE");
      expect(await testDb.select().from(agencyPaymentAccounts)).toHaveLength(0);

      const lu = await request(app).get("/api/agency/payment-account").set(authHeader(tokenFor(manager)));
      expect(lu.body.disponible).toBe(false);
    });

    it("refuse des identifiants mal formés", async () => {
      plateformeConfiguree();
      const manager = await createManager();
      const res = await request(app)
        .put("/api/agency/payment-account")
        .set(authHeader(tokenFor(manager)))
        .send({ ...AGENCE, masterKey: "court", currency: "FCFA" });
      expect(res.status).toBe(400);
    });

    it("est réservé au propriétaire de l'agence, pas à un collaborateur", async () => {
      plateformeConfiguree();
      const manager = await createManager();
      const res = await request(app)
        .put("/api/agency/payment-account")
        .set(authHeader(await tokenCollaborateur(manager)))
        .send(AGENCE);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("AGENCY_PAYMENT_OWNER_ONLY");
      expect(await testDb.select().from(agencyPaymentAccounts)).toHaveLength(0);
    });

    it("chaque agence ne voit que son propre compte", async () => {
      plateformeConfiguree();
      await agenceAvecCompte();
      const autre = await createManager();
      const lu = await request(app).get("/api/agency/payment-account").set(authHeader(tokenFor(autre)));
      expect(lu.body.configure).toBe(false);
    });

    it("se suspend et se supprime", async () => {
      plateformeConfiguree();
      const manager = await agenceAvecCompte();
      const entete = authHeader(tokenFor(manager));

      const suspendu = await request(app).patch("/api/agency/payment-account").set(entete).send({ enabled: false });
      expect(suspendu.body.enabled).toBe(false);

      const supprime = await request(app).delete("/api/agency/payment-account").set(entete);
      expect(supprime.status).toBe(204);
      expect(await testDb.select().from(agencyPaymentAccounts)).toHaveLength(0);

      const absent = await request(app).patch("/api/agency/payment-account").set(entete).send({ enabled: true });
      expect(absent.status).toBe(404);
    });
  });

  describe("moyens proposés au locataire", () => {
    it("PayDunya n'est proposé que si SON agence a un compte actif, dans la devise de ce compte", async () => {
      plateformeConfiguree();
      const avec = await agenceAvecCompte();
      const sans = await createManager();
      const a = await locataireAvecFacture(avec.id);
      const b = await locataireAvecFacture(sans.id);

      const chezAvec = await request(app).get("/api/payments/methods?currency=XOF&usage=loyer").set(authHeader(a.tenantToken));
      const chezSans = await request(app).get("/api/payments/methods?currency=XOF&usage=loyer").set(authHeader(b.tenantToken));
      const enEuros = await request(app).get("/api/payments/methods?currency=EUR&usage=loyer").set(authHeader(a.tenantToken));

      expect(chezAvec.body.methods).toContain("PAYDUNYA");
      expect(chezSans.body.methods).toEqual(["BANK_TRANSFER"]);
      expect(enEuros.body.methods).not.toContain("PAYDUNYA");

      await request(app).patch("/api/agency/payment-account").set(authHeader(tokenFor(avec))).send({ enabled: false });
      const suspendu = await request(app).get("/api/payments/methods?currency=XOF&usage=loyer").set(authHeader(a.tenantToken));
      expect(suspendu.body.methods).toEqual(["BANK_TRANSFER"]);
    });
  });

  describe("paiement d'un loyer", () => {
    it("part avec les identifiants de l'agence, jamais ceux de la plateforme", async () => {
      plateformeConfiguree();
      const manager = await agenceAvecCompte();
      const { invoice, tenantToken } = await locataireAvecFacture(manager.id);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ response_code: "00", response_text: "https://paydunya.test/pay/abc", token: "pd_tok_agence" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const res = await request(app).post(`/api/invoices/${invoice.id}/pay`).set(authHeader(tenantToken)).send({ method: "PAYDUNYA" });

      expect(res.status).toBe(200);
      expect(res.body.payment.redirectUrl).toBe("https://paydunya.test/pay/abc");
      const [url, init] = fetchMock.mock.calls[0];
      // Mode « live » de l'agence, pas le mode « test » de la plateforme.
      expect(String(url)).toBe("https://app.paydunya.com/api/v1/checkout-invoice/create");
      expect(init.headers).toMatchObject({
        "PAYDUNYA-MASTER-KEY": AGENCE.masterKey,
        "PAYDUNYA-PRIVATE-KEY": AGENCE.privateKey,
        "PAYDUNYA-TOKEN": AGENCE.token,
      });
      expect(JSON.stringify(init.headers)).not.toContain("plateforme-");
      const corps = JSON.parse(init.body);
      expect(corps.actions.callback_url).toBe(`${env.publicBackendUrl}/api/payments/paydunya/ipn/agence/${manager.id}`);

      const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
      expect(apres.paymentMethod).toBe("PAYDUNYA");
      expect(apres.paymentRef).toBe("pd_tok_agence");
    });

    it("refuse PayDunya quand l'agence n'a pas de compte, sans appeler personne et sans utiliser les clés de la plateforme", async () => {
      plateformeConfiguree();
      const manager = await createManager();
      const { invoice, tenantToken } = await locataireAvecFacture(manager.id);
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const res = await request(app).post(`/api/invoices/${invoice.id}/pay`).set(authHeader(tenantToken)).send({ method: "PAYDUNYA" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RENT_ONLINE_PAYMENT_DISABLED");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("RENT_ONLINE_PAYMENTS n'ouvre plus PayDunya à la plateforme pour un loyer", async () => {
      plateformeConfiguree();
      const avant = env.payments.rentOnline;
      env.payments.rentOnline = true;
      try {
        const manager = await createManager();
        const { tenantToken } = await locataireAvecFacture(manager.id);
        const res = await request(app).get("/api/payments/methods?currency=XOF&usage=loyer").set(authHeader(tenantToken));
        expect(res.body.methods).not.toContain("PAYDUNYA");
      } finally {
        env.payments.rentOnline = avant;
      }
    });
  });

  describe("notification de paiement de l'agence", () => {
    async function factureEnAttente(managerId: string, token: string) {
      const property = await createProperty(managerId);
      const tenant = await createTenant(managerId);
      const contract = await createContract(property.id, tenant.id);
      return createInvoice(contract.id, { status: "PENDING", paymentMethod: "PAYDUNYA", paymentRef: token, currency: "XOF", amount: 25000 });
    }

    it("solde la facture quand le hash et la confirmation viennent des clés de l'agence", async () => {
      plateformeConfiguree();
      const manager = await agenceAvecCompte();
      const facture = await factureEnAttente(manager.id, "pd_tok_1");
      const fetchMock = confirmation(facture.id, 25000);
      vi.stubGlobal("fetch", fetchMock);

      const res = await request(app)
        .post(`/api/payments/paydunya/ipn/agence/${manager.id}`)
        .send(corpsIpn(hashDe(AGENCE.masterKey), "pd_tok_1", facture.id));

      expect(res.status).toBe(200);
      // La confirmation interroge PayDunya avec les clés de l'agence, en production (mode « live »).
      expect(fetchMock).toHaveBeenCalledWith(
        "https://app.paydunya.com/api/v1/checkout-invoice/confirm/pd_tok_1",
        expect.objectContaining({ headers: expect.objectContaining({ "PAYDUNYA-MASTER-KEY": AGENCE.masterKey, "PAYDUNYA-TOKEN": AGENCE.token }) })
      );
      const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, facture.id));
      expect(apres.status).toBe("PAID");
    });

    it("rejette le hash de la plateforme : seul celui de l'agence fait foi", async () => {
      plateformeConfiguree();
      const manager = await agenceAvecCompte();
      const facture = await factureEnAttente(manager.id, "pd_tok_2");
      const fetchMock = confirmation(facture.id, 25000);
      vi.stubGlobal("fetch", fetchMock);

      const res = await request(app)
        .post(`/api/payments/paydunya/ipn/agence/${manager.id}`)
        .send(corpsIpn(hashDe(original.paydunya.masterKey), "pd_tok_2", facture.id));

      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
      const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, facture.id));
      expect(apres.status).toBe("PENDING");
    });

    it("ne solde pas la facture d'une autre agence, même avec le hash et la confirmation de la première", async () => {
      plateformeConfiguree();
      const agenceA = await agenceAvecCompte();
      const agenceB = await createManager();
      const factureDeB = await factureEnAttente(agenceB.id, "pd_tok_3");
      vi.stubGlobal("fetch", confirmation(factureDeB.id, 25000));

      const res = await request(app)
        .post(`/api/payments/paydunya/ipn/agence/${agenceA.id}`)
        .send(corpsIpn(hashDe(AGENCE.masterKey), "pd_tok_3", factureDeB.id));

      expect(res.status).toBe(200);
      const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, factureDeB.id));
      expect(apres.status).toBe("PENDING");
    });

    it("ignore une référence d'abonnement : le compte d'une agence ne sert qu'à ses loyers", async () => {
      plateformeConfiguree();
      const manager = await agenceAvecCompte();
      const fetchMock = confirmation("sub_x_1", 15);
      vi.stubGlobal("fetch", fetchMock);

      const res = await request(app)
        .post(`/api/payments/paydunya/ipn/agence/${manager.id}`)
        .send(corpsIpn(hashDe(AGENCE.masterKey), "pd_tok_4", "sub_x_1"));

      expect(res.status).toBe(200);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("répond 404 pour une agence sans compte actif", async () => {
      plateformeConfiguree();
      const manager = await createManager();
      const res = await request(app)
        .post(`/api/payments/paydunya/ipn/agence/${manager.id}`)
        .send(corpsIpn(hashDe(AGENCE.masterKey), "pd_tok_5", "x"));
      expect(res.status).toBe(404);
    });
  });
});
