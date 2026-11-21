import * as Sentry from "@sentry/node";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { platformSubscriptions, users } from "../db/schema";
import { createManager, createPlatformSubscription } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Les refus du webhook Stripe que `stripe.controller.test.ts` n'exerçait pas : corps absent, signature mal formée, corps
 * authentique mais illisible ou incomplet, abonnement introuvable, renouvellement sans montant. Le webhook répond 200 dans la
 * plupart des cas : sans ces tests, un refus supprimé par erreur laisserait passer un événement falsifié sans bruit.
 */

// Doit correspondre exactement à STRIPE_WEBHOOK_SECRET forcé dans setupTestDb.ts.
const SECRET_TEST = "whsec_test_do_not_use_in_production";

function signer(corps: string, horodatage = Math.floor(Date.now() / 1000), secret = SECRET_TEST) {
  const signature = crypto.createHmac("sha256", secret).update(`${horodatage}.${corps}`).digest("hex");
  return `t=${horodatage},v1=${signature}`;
}

function envoyer(corps: string, signature: string | null) {
  const requete = request(app).post("/api/payments/stripe/webhook").set("Content-Type", "application/json");
  if (signature) requete.set("stripe-signature", signature);
  return requete.send(corps);
}

describe("POST /api/payments/stripe/webhook : corps et signature", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("répond 400 quand le corps n'arrive pas brut (montage express.raw absent) : la signature ne serait pas vérifiable", async () => {
    const res = await request(app)
      .post("/api/payments/stripe/webhook")
      .set("Content-Type", "text/plain")
      .set("stripe-signature", signer("x"))
      .send("x");

    expect(res.status).toBe(400);
  });

  it("rejette (401) une signature sans horodatage", async () => {
    const corps = JSON.stringify({ type: "checkout.session.completed", data: { object: {} } });
    const v1 = crypto.createHmac("sha256", SECRET_TEST).update(corps).digest("hex");

    const res = await envoyer(corps, `v1=${v1}`);

    expect(res.status).toBe(401);
  });

  it("rejette (401) une signature dont l'horodatage n'est pas un nombre", async () => {
    const corps = JSON.stringify({ type: "checkout.session.completed", data: { object: {} } });

    const res = await envoyer(corps, "t=hier,v1=abcdef");

    expect(res.status).toBe(401);
  });

  it("rejette (401) un en-tête qui porte un horodatage mais aucune signature v1", async () => {
    const corps = JSON.stringify({ type: "checkout.session.completed", data: { object: {} } });

    const res = await envoyer(corps, `t=${Math.floor(Date.now() / 1000)}`);

    expect(res.status).toBe(401);
  });

  it("rejette (401) un événement rejoué trop tard, même correctement signé", async () => {
    const corps = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_vieux" } } });
    const ilYaUneHeure = Math.floor(Date.now() / 1000) - 3600;

    const res = await envoyer(corps, signer(corps, ilYaUneHeure));

    expect(res.status).toBe(401);
  });

  it("répond 400 quand le corps est authentique (bien signé) mais n'est pas du JSON", async () => {
    const corps = "ceci n'est pas du json";

    const res = await envoyer(corps, signer(corps));

    expect(res.status).toBe(400);
  });

  it("accepte (200) sans rien faire un événement authentique mais incomplet : ni session, ni référence", async () => {
    const signal = vi.spyOn(Sentry, "captureMessage");
    const corps = JSON.stringify({ type: "checkout.session.completed", data: { object: {} } });

    const res = await envoyer(corps, signer(corps));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(signal).not.toHaveBeenCalled();
  });
});

describe("POST /api/payments/stripe/webhook : abonnement de la plateforme", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("signale à Sentry un paiement encaissé pour un abonnement introuvable, et n'active rien", async () => {
    const signal = vi.spyOn(Sentry, "captureMessage");
    const manager = await createManager({ subscriptionStatus: "EXPIRED" });
    const corps = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_inconnue", payment_status: "paid", amount_total: 1500, currency: "eur", client_reference_id: `sub_${manager.id}_1` } },
    });

    const res = await envoyer(corps, signer(corps));

    expect(res.status).toBe(200);
    expect(signal).toHaveBeenCalledTimes(1);
    expect(signal.mock.calls[0][0]).toContain("abonnement introuvable pour cette session");
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.subscriptionStatus).toBe("EXPIRED");
  });

  it("ignore (200) un renouvellement automatique sans montant exploitable : l'abonnement n'est pas prolongé", async () => {
    const finActuelle = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "PRO",
      subscriptionEndsAt: finActuelle,
      stripeSubscriptionId: "sub_stripe_sans_montant",
    });
    // Un paiement précédent existe : sans le contrôle du montant, ce renouvellement aurait bien été appliqué.
    await createPlatformSubscription(manager.id, { status: "PAID", plan: "PRO", paymentMethod: "STRIPE", amount: 29 });
    const corps = JSON.stringify({
      type: "invoice.paid",
      data: { object: { id: "in_sans_montant", subscription: "sub_stripe_sans_montant", currency: "eur", billing_reason: "subscription_cycle" } },
    });

    const res = await envoyer(corps, signer(corps));

    expect(res.status).toBe(200);
    const lignes = await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.userId, manager.id));
    expect(lignes).toHaveLength(1); // aucune ligne de renouvellement ajoutée
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.subscriptionEndsAt?.getTime()).toBe(finActuelle.getTime());
  });
});
