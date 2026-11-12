import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import * as emailService from "../services/email.service";
import { authHeader, createContract, createManager, createOwner, createProperty, createTenant, createTenantPortalUser, tokenFor, tokenProprietaire } from "../test/authHelpers";

beforeEach(() => {
  vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
});
afterEach(() => vi.restoreAllMocks());

/**
 * Chaque message du gestionnaire déclenche un e-mail au locataire et chaque vocal dépose un fichier dans le stockage privé : l'envoi est
 * plafonné par compte (60 par fenêtre de 15 minutes), très au-dessus d'un usage réel.
 */
async function bail() {
  const gestionnaire = await createManager({ subscriptionPlan: "PRO" });
  const property = await createProperty(gestionnaire.id);
  const tenant = await createTenant(gestionnaire.id);
  const contract = await createContract(property.id, tenant.id);
  const portail = await createTenantPortalUser(tenant);
  return { gestionnaire, tokenManager: tokenFor(gestionnaire), tokenTenant: tokenFor(portail, tenant.id), url: `/api/messages/${contract.id}` };
}

const envoyer = (url: string, token: string) => request(app).post(url).set(authHeader(token)).send({ content: "ok" });

describe("messagerie — plafond d'envoi par compte", () => {
  it("accepte 60 envois, refuse le 61e (429, code traduisible), sans plafonner la lecture", async () => {
    const { url, tokenTenant } = await bail();
    for (let i = 0; i < 60; i++) expect((await envoyer(url, tokenTenant)).status).toBe(201);

    const refuse = await envoyer(url, tokenTenant);
    expect(refuse.status).toBe(429);
    expect(refuse.body.code).toBe("MESSAGE_RATE_LIMITED");

    // La lecture du fil et le compteur de non lus restent ouverts (rafraîchissement automatique).
    expect((await request(app).get(url).set(authHeader(tokenTenant))).status).toBe(200);
    expect((await request(app).get("/api/messages/unread-count").set(authHeader(tokenTenant))).status).toBe(200);
  }, 60_000);

  it("compte aussi les messages vocaux, et refuse le dépôt avant même de lire le fichier", async () => {
    const { url, tokenTenant } = await bail();
    for (let i = 0; i < 60; i++) await envoyer(url, tokenTenant);

    const res = await request(app)
      .post(`${url}/audio`)
      .set(authHeader(tokenTenant))
      .field("durationSec", "5")
      .attach("audio", Buffer.from("x"), { filename: "v.webm", contentType: "audio/webm" });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("MESSAGE_RATE_LIMITED");
  }, 60_000);

  it("est propre à chaque compte : un locataire au plafond ne bloque ni son gestionnaire, ni un autre locataire", async () => {
    const a = await bail();
    const b = await bail();
    for (let i = 0; i < 60; i++) await envoyer(a.url, a.tokenTenant);
    expect((await envoyer(a.url, a.tokenTenant)).status).toBe(429);

    expect((await envoyer(a.url, a.tokenManager)).status).toBe(201);
    expect((await envoyer(b.url, b.tokenTenant)).status).toBe(201);
  }, 60_000);

  it("s'applique aussi à la discussion avec les propriétaires, dans les deux sens", async () => {
    const gestionnaire = await createManager({ subscriptionPlan: "PRO" });
    const owner = await createOwner(gestionnaire.id);
    const tokenOwner = await tokenProprietaire(owner);
    for (let i = 0; i < 60; i++) await request(app).post("/api/owner-messages/mine").set(authHeader(tokenOwner)).send({ content: "ok" });

    const refuse = await request(app).post("/api/owner-messages/mine").set(authHeader(tokenOwner)).send({ content: "ok" });
    expect(refuse.status).toBe(429);
    expect(refuse.body.code).toBe("MESSAGE_RATE_LIMITED");
    // Le gestionnaire, lui, n'est pas au plafond.
    expect((await request(app).post(`/api/owner-messages/${owner.id}`).set(authHeader(tokenFor(gestionnaire))).send({ content: "réponse" })).status).toBe(201);
  }, 60_000);
});
