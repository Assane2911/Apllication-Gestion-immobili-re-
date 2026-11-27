import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { enregistrerCompteAgence } from "../services/comptePaiementAgence.service";
import {
  authHeader,
  createAdmin,
  createContract,
  createManager,
  createPortalUser,
  createProperty,
  createTenant,
  createTenantPortalUser,
  tokenCollaborateur,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";

/**
 * Audit par sabotage de payment.controller.ts : ce que l'interface propose comme moyens de paiement. Pour un abonnement, ce sont les
 * clés de la plateforme ; pour un loyer, c'est le compte PayDunya de L'AGENCE du demandeur — celle du bail pour un locataire, la
 * sienne pour un gestionnaire — dans la devise de ce compte. Un moyen proposé que le serveur refuserait au paiement est un bouton
 * qui ne marche pas ; un moyen proposé à la mauvaise agence enverrait l'argent au mauvais compte.
 */
const original = {
  demoMode: env.payments.demoMode,
  stripeSecretKey: env.payments.stripeSecretKey,
  stripeWebhookSecret: env.payments.stripeWebhookSecret,
  stripeCurrencies: [...env.payments.stripeCurrencies],
  rentOnline: env.payments.rentOnline,
  cle: env.payments.keysEncryptionKey,
  paydunya: { ...env.payments.paydunya },
};

beforeEach(() => {
  env.payments.demoMode = false;
  env.payments.stripeSecretKey = "";
  env.payments.stripeWebhookSecret = "";
  env.payments.stripeCurrencies = ["EUR"];
  env.payments.rentOnline = false;
  env.payments.keysEncryptionKey = "ab".repeat(32);
  env.payments.paydunya = { ...original.paydunya, masterKey: "", privateKey: "", token: "", currency: "XOF" };
});

afterEach(() => {
  env.payments.demoMode = original.demoMode;
  env.payments.stripeSecretKey = original.stripeSecretKey;
  env.payments.stripeWebhookSecret = original.stripeWebhookSecret;
  env.payments.stripeCurrencies = [...original.stripeCurrencies];
  env.payments.rentOnline = original.rentOnline;
  env.payments.keysEncryptionKey = original.cle;
  env.payments.paydunya = { ...original.paydunya };
});

const plateformePaydunya = (currency = "XOF") => {
  env.payments.paydunya = { ...original.paydunya, masterKey: "mk", privateKey: "pk", token: "tk", currency };
};
const plateformeStripe = (devises = ["EUR"]) => {
  env.payments.stripeSecretKey = "sk_test_x";
  env.payments.stripeWebhookSecret = "whsec_x";
  env.payments.stripeCurrencies = devises;
};
const compteAgence = (managerId: string, extra: Partial<Parameters<typeof enregistrerCompteAgence>[1]> = {}) =>
  enregistrerCompteAgence(managerId, { masterKey: "agence-master-1", privateKey: "agence-private-1", token: "agence-token-1", mode: "live", currency: "XOF", enabled: true, ...extra });

const methodes = (token: string, query: string) => request(app).get(`/api/payments/methods${query}`).set(authHeader(token));

async function agenceAvecLocataire() {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  await createContract(property.id, tenant.id);
  return { manager, tenant, tokenLocataire: await tokenLocataire(tenant.id) };
}

describe("abonnement (par défaut) : les clés de la plateforme", () => {
  it("sans paramètre, c'est un abonnement en euros ; la réponse porte la devise et la liste, rien d'autre", async () => {
    plateformeStripe();
    const manager = await createManager();

    const res = await methodes(tokenFor(manager), "");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ currency: "EUR", methods: ["STRIPE"] });
  });

  it("« abonnement » écrit explicitement vaut le défaut", async () => {
    plateformeStripe();
    const manager = await createManager();
    expect((await methodes(tokenFor(manager), "?usage=abonnement")).body).toEqual({ currency: "EUR", methods: ["STRIPE"] });
  });

  it("la devise est mise en majuscules ; une devise sans moyen donne une liste vide", async () => {
    plateformeStripe(["EUR"]);
    const manager = await createManager();
    const res = await methodes(tokenFor(manager), "?currency=usd");
    expect(res.body).toEqual({ currency: "USD", methods: [] });
  });

  it("une devise vide n'est jamais remplacée en silence par l'euro : la réponse la rend telle quelle, sans moyen", async () => {
    plateformeStripe(["EUR"]);
    const manager = await createManager();
    const res = await methodes(tokenFor(manager), "?currency=");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ currency: "", methods: [] });
  });

  it("PayDunya et Stripe sont proposés dans cet ordre quand les deux sont prêts pour la devise", async () => {
    plateformePaydunya("XOF");
    plateformeStripe(["EUR", "XOF"]);
    const manager = await createManager();
    expect((await methodes(tokenFor(manager), "?currency=XOF")).body.methods).toEqual(["PAYDUNYA", "STRIPE"]);
  });

  it("PayDunya n'est proposé que dans la devise de son compte", async () => {
    plateformePaydunya("XOF");
    const manager = await createManager();
    expect((await methodes(tokenFor(manager), "?currency=XOF")).body.methods).toEqual(["PAYDUNYA"]);
    expect((await methodes(tokenFor(manager), "?currency=EUR")).body.methods).toEqual([]);
  });

  it("le mode démo ajoute le moyen de démonstration, jamais autrement", async () => {
    const manager = await createManager();
    expect((await methodes(tokenFor(manager), "?currency=EUR")).body.methods).toEqual([]);
    env.payments.demoMode = true;
    expect((await methodes(tokenFor(manager), "?currency=EUR")).body.methods).toContain("DEMO");
  });

  it("le compte PayDunya d'une agence n'entre jamais dans l'abonnement", async () => {
    const { manager } = await agenceAvecLocataire();
    await compteAgence(manager.id);
    const res = await methodes(tokenFor(manager), "?currency=XOF&usage=abonnement");
    expect(res.body.methods).toEqual([]);
  });

  it.each([["loyers"], ["LOYER"], ["rent"], [""], ["abonnement,loyer"]])("refuse l'usage %j (400)", async (usage) => {
    const manager = await createManager();
    const res = await methodes(tokenFor(manager), `?usage=${encodeURIComponent(usage)}`);
    expect(res.status).toBe(400);
  });
});

describe("loyer : le compte PayDunya de l'agence du demandeur", () => {
  it("un locataire se voit proposer PayDunya quand SON agence a un compte actif dans la devise demandée", async () => {
    const { manager, tokenLocataire: jeton } = await agenceAvecLocataire();
    await compteAgence(manager.id, { currency: "XOF" });

    const res = await methodes(jeton, "?currency=XOF&usage=loyer");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ currency: "XOF", methods: ["PAYDUNYA"] });
  });

  it("la clé de la plateforme ne sert jamais à un loyer : même avec PayDunya configuré côté plateforme, rien sans compte d'agence", async () => {
    plateformePaydunya("XOF");
    plateformeStripe(["EUR", "XOF"]);
    const { tokenLocataire: jeton } = await agenceAvecLocataire();

    const res = await methodes(jeton, "?currency=XOF&usage=loyer");
    expect(res.body.methods).toEqual([]);
  });

  it("une devise différente de celle du compte de l'agence : rien n'est proposé", async () => {
    const { manager, tokenLocataire: jeton } = await agenceAvecLocataire();
    await compteAgence(manager.id, { currency: "XOF" });
    expect((await methodes(jeton, "?currency=EUR&usage=loyer")).body.methods).toEqual([]);
    expect((await methodes(jeton, "?currency=xof&usage=loyer")).body.methods).toEqual(["PAYDUNYA"]);
  });

  it("un compte suspendu ne propose plus rien", async () => {
    const { manager, tokenLocataire: jeton } = await agenceAvecLocataire();
    await compteAgence(manager.id, { enabled: false });
    expect((await methodes(jeton, "?currency=XOF&usage=loyer")).body.methods).toEqual([]);
  });

  it("jamais le compte d'une AUTRE agence : un locataire ne voit que celui de son propre gestionnaire", async () => {
    const mien = await agenceAvecLocataire();
    const autre = await agenceAvecLocataire();
    await compteAgence(autre.manager.id, { currency: "XOF" });

    expect((await methodes(mien.tokenLocataire, "?currency=XOF&usage=loyer")).body.methods).toEqual([]);
    expect((await methodes(autre.tokenLocataire, "?currency=XOF&usage=loyer")).body.methods).toEqual(["PAYDUNYA"]);
  });

  it("un gestionnaire voit ce que verraient ses locataires : le compte de SON agence", async () => {
    const { manager } = await agenceAvecLocataire();
    expect((await methodes(tokenFor(manager), "?currency=XOF&usage=loyer")).body.methods).toEqual([]);
    await compteAgence(manager.id, { currency: "XOF" });
    expect((await methodes(tokenFor(manager), "?currency=XOF&usage=loyer")).body.methods).toEqual(["PAYDUNYA"]);

    const autre = await createManager();
    expect((await methodes(tokenFor(autre), "?currency=XOF&usage=loyer")).body.methods).toEqual([]);
  });

  it("un collaborateur de l'agence voit le compte de l'agence", async () => {
    const { manager } = await agenceAvecLocataire();
    await compteAgence(manager.id, { currency: "XOF" });
    const res = await methodes(await tokenCollaborateur(manager), "?currency=XOF&usage=loyer");
    expect(res.status).toBe(200);
    expect(res.body.methods).toEqual(["PAYDUNYA"]);
  });

  it("un compte locataire sans fiche rattachée ne se voit proposer aucun moyen", async () => {
    const orphelin = await createPortalUser("TENANT");
    const res = await methodes(tokenFor(orphelin), "?currency=XOF&usage=loyer");
    expect(res.status).toBe(200);
    expect(res.body.methods).toEqual([]);
  });

  it("un administrateur, même avec un compte de paiement à son nom, ne se voit proposer rien pour un loyer : ce n'est ni un locataire ni un gestionnaire", async () => {
    const admin = await createAdmin();
    await compteAgence(admin.id, { currency: "XOF" });
    const res = await methodes(tokenFor(admin as never), "?currency=XOF&usage=loyer");
    expect(res.status).toBe(200);
    expect(res.body.methods).toEqual([]);
  });

  it("un propriétaire (espace propriétaire), même avec un compte de paiement à son nom, ne se voit proposer rien pour un loyer", async () => {
    const proprio = await createPortalUser("OWNER");
    await compteAgence(proprio.id, { currency: "XOF" });
    const res = await methodes(tokenFor(proprio), "?currency=XOF&usage=loyer");
    expect(res.status).toBe(200);
    expect(res.body.methods).toEqual([]);
  });

  it("le paiement du loyer par carte (Stripe) n'est proposé que quand l'option est activée sur la plateforme", async () => {
    plateformeStripe(["EUR"]);
    const { tokenLocataire: jeton } = await agenceAvecLocataire();
    expect((await methodes(jeton, "?currency=EUR&usage=loyer")).body.methods).toEqual([]);

    env.payments.rentOnline = true;
    expect((await methodes(jeton, "?currency=EUR&usage=loyer")).body.methods).toEqual(["STRIPE"]);
  });

  it("un compte non lisible (clé de chiffrement perdue) ne propose rien", async () => {
    const { manager, tokenLocataire: jeton } = await agenceAvecLocataire();
    await compteAgence(manager.id);
    env.payments.keysEncryptionKey = "cd".repeat(32);
    expect((await methodes(jeton, "?currency=XOF&usage=loyer")).body.methods).toEqual([]);
  });
});

describe("accès", () => {
  it("exige une connexion pour un loyer comme pour un abonnement", async () => {
    expect((await request(app).get("/api/payments/methods?usage=loyer")).status).toBe(401);
    expect((await request(app).get("/api/payments/methods")).status).toBe(401);
  });

  it("un locataire dont l'identifiant de portail existe sans bail reste servi, sans erreur", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const compte = await createTenantPortalUser(tenant);
    await compteAgence(manager.id, { currency: "XOF" });

    const res = await methodes(tokenFor(compte, tenant.id), "?currency=XOF&usage=loyer");
    expect(res.status).toBe(200);
    expect(res.body.methods).toEqual(["PAYDUNYA"]);
  });
});
