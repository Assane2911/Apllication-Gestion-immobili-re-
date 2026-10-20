import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";

/**
 * Les réponses de l'API contiennent des données personnelles (locataires, pièces d'identité, factures, profil) :
 * sur un poste partagé (cybercafé, ordinateur familial), un navigateur qui les garde en cache les laisse lisibles
 * après la déconnexion. Seules les réponses publiques et sans donnée de compte peuvent rester sans consigne.
 */
describe("Cache-Control des réponses de l'API", () => {
  it("les réponses authentifiées ne sont jamais conservées", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE" });
    const token = tokenFor({ id: manager.id, role: "MANAGER" });
    for (const url of ["/api/auth/me", "/api/tenants", "/api/properties", "/api/invoices", "/api/dashboard/stats"]) {
      const res = await request(app).get(url).set(authHeader(token));
      expect(res.headers["cache-control"], url).toBe("no-store");
    }
  });

  it("un refus d'accès ou une route inconnue ne sont pas conservés non plus", async () => {
    for (const url of ["/api/tenants", "/api/auth/me", "/api/inconnue"]) {
      const res = await request(app).get(url);
      expect(res.headers["cache-control"], url).toBe("no-store");
    }
  });

  it("une connexion (jeton, profil) n'est pas conservée", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "x@y.com", password: "motdepasse-incorrect" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("n'écrase pas la consigne propre à un document", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE" });
    const res = await request(app).get("/api/documents/receipt/inconnue").set(authHeader(tokenFor({ id: manager.id, role: "MANAGER" })));
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
