import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { authHeader, createManager, createProperty, tokenFor } from "../test/authHelpers";

/**
 * PostgreSQL refuse le caractère nul (U+0000) dans un texte : toute valeur qui en contient — un identifiant dans
 * l'URL (`/api/properties/%00`), un paramètre de recherche, un champ du corps — faisait échouer la requête en
 * 500, avec trace d'erreur, envoi à Sentry et jusqu'à 2 s d'attente avant de répondre. Y compris sur une route
 * publique, sans compte. C'est une erreur de la requête, pas une panne : 400.
 */
async function gestionnaire() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 86_400_000 * 30) });
  return { manager, h: authHeader(tokenFor({ id: manager.id, role: "MANAGER" })) };
}

describe("caractère nul dans une requête", () => {
  it("identifiant nul dans l'URL : 400 au lieu de 500 (route authentifiée)", async () => {
    const { h } = await gestionnaire();
    for (const url of ["/api/properties/%00", "/api/tenants/%00", "/api/contracts/%00/guarantors", "/api/invoices/%00/cancel"]) {
      const res = await (url.endsWith("cancel") ? request(app).post(url) : request(app).get(url)).set(h);
      expect(res.status, url).toBe(400);
      expect(res.body.code, url).toBe("CARACTERE_INTERDIT");
    }
  });

  it("identifiant nul sur une route publique, sans compte : 400", async () => {
    const res = await request(app).get("/api/listings/public/%00");
    expect(res.status).toBe(400);
  });

  it("paramètre de recherche nul : 400", async () => {
    const { h } = await gestionnaire();
    const res = await request(app).get("/api/tenants?search=%00").set(h);
    expect(res.status).toBe(400);
  });

  it("champ du corps contenant un caractère nul, même imbriqué : 400", async () => {
    const { h } = await gestionnaire();
    const plat = await request(app).post("/api/properties").set(h).send({ title: "Villa\u0000", address: "12 rue des Palmiers", surface: 80, rent: 150000, currency: "XOF" });
    expect(plat.status).toBe(400);
    const imbrique = await request(app).post("/api/auth/login").send({ email: "a@b.com", password: "x", extra: { liste: ["ok", "a\u0000b"] } });
    expect(imbrique.status).toBe(400);
  });

  it("une requête normale n'est pas touchée", async () => {
    const { manager, h } = await gestionnaire();
    const bien = await createProperty(manager.id, { title: "Villa Ngor" });
    expect((await request(app).get(`/api/properties/${bien.id}`).set(h)).status).toBe(200);
    expect((await request(app).get("/api/tenants?search=Aminata").set(h)).status).toBe(200);
    const creation = await request(app).post("/api/properties").set(h).send({ title: "Résidence Étoile — « Nord »", address: "12 rue des Palmiers", surface: 80, rent: 150000, currency: "XOF" });
    expect(creation.status).toBe(201);
  });
});
