import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";

/**
 * L'interface interrogeait autrefois une liste écrite en dur dans le
 * composant. Cette route est la source unique : elle applique la même règle
 * que le refus de paiement (indisponibilite dans payment.service.ts).
 */
describe("GET /api/payments/methods", () => {
  const original = {
    demoMode: env.payments.demoMode,
    stripeSecretKey: env.payments.stripeSecretKey,
    paydunya: { ...env.payments.paydunya },
  };

  afterEach(() => {
    env.payments.demoMode = original.demoMode;
    env.payments.stripeSecretKey = original.stripeSecretKey;
    env.payments.paydunya = { ...original.paydunya };
  });

  it("exige une authentification", async () => {
    const res = await request(app).get("/api/payments/methods?currency=XOF");
    expect(res.status).toBe(401);
  });

  it("ne propose que le virement quand aucune clé n'est configurée", async () => {
    env.payments.demoMode = false;
    env.payments.stripeSecretKey = "";
    env.payments.paydunya = { ...original.paydunya, masterKey: "", privateKey: "", token: "" };
    const manager = await createManager();

    const res = await request(app)
      .get("/api/payments/methods?currency=XOF")
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("XOF");
    expect(res.body.methods).toEqual(["BANK_TRANSFER"]);
  });

  it("ajoute PayDunya dès que les clés et la devise correspondent", async () => {
    env.payments.demoMode = false;
    env.payments.paydunya = { ...original.paydunya, masterKey: "mk", privateKey: "pk", token: "tk", currency: "XOF" };
    const manager = await createManager();

    const res = await request(app)
      .get("/api/payments/methods?currency=xof")
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    // La devise est normalisée en majuscules : « xof » et « XOF » désignent la
    // même chose côté appelant.
    expect(res.body.currency).toBe("XOF");
    expect(res.body.methods).toContain("PAYDUNYA");
  });

  it("n'expose jamais la cause technique d'une indisponibilité", async () => {
    env.payments.demoMode = false;
    env.payments.paydunya = { ...original.paydunya, masterKey: "", privateKey: "", token: "" };
    const manager = await createManager();

    const res = await request(app)
      .get("/api/payments/methods?currency=EUR")
      .set(authHeader(tokenFor(manager)));

    const corps = JSON.stringify(res.body);
    expect(corps).not.toContain("clés");
    expect(corps).not.toContain("STRIPE_SECRET_KEY");
  });
});
