import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";

/**
 * Les messages d'erreur du serveur sont écrits en français. Pour qu'un utilisateur en anglais, portugais ou
 * espagnol les lise dans sa langue, chaque erreur des parcours critiques porte un CODE stable que le frontend
 * traduit (voir frontend/src/api/client.ts) ; le texte français reste dans la réponse, en secours.
 */
describe("codes d'erreur des parcours critiques", () => {
  it("connexion refusée : INVALID_CREDENTIALS, avec le message français conservé", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "inconnu@test.local", password: "Password123!" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
    expect(res.body.error).toBe("Email ou mot de passe incorrect");
  });

  it("requête sans session : AUTH_REQUIRED", async () => {
    const res = await request(app).get("/api/tenants");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_REQUIRED");
  });

  it("jeton falsifié : TOKEN_INVALID_OR_EXPIRED", async () => {
    const res = await request(app).get("/api/tenants").set("Authorization", "Bearer pas-un-jeton");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_INVALID_OR_EXPIRED");
  });

  it("essai terminé : TRIAL_ENDED (402)", async () => {
    const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: new Date(Date.now() - 86_400_000) });
    const res = await request(app).get("/api/properties").set(authHeader(tokenFor({ id: manager.id, role: "MANAGER" })));
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("TRIAL_ENDED");
  });

  it("fonction réservée à une formule supérieure : PLAN_REQUIRED, avec le nom de la formule en paramètre", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER", subscriptionEndsAt: new Date(Date.now() + 86_400_000 * 30) });
    const res = await request(app).get("/api/expenses").set(authHeader(tokenFor({ id: manager.id, role: "MANAGER" })));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLAN_REQUIRED");
    expect(typeof res.body.params?.plan).toBe("string");
    expect(res.body.error).toContain(res.body.params.plan);
  });

  it("mauvais rôle : ACCESS_DENIED", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: new Date(Date.now() + 86_400_000 * 30) });
    const res = await request(app).get("/api/contracts/mine").set(authHeader(tokenFor({ id: manager.id, role: "MANAGER" })));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCESS_DENIED");
  });
  describe("fiches introuvables : un code par type de fiche, le texte français restant en secours", () => {
    const INCONNU = "00000000-0000-4000-8000-000000000000";
    const cas: Array<[string, string, string, string]> = [
      ["/api/contracts/" + INCONNU, "CONTRACT_NOT_FOUND", "Contrat introuvable", "contrat"],
      ["/api/tenants/" + INCONNU, "TENANT_NOT_FOUND", "Locataire introuvable", "locataire"],
      ["/api/properties/" + INCONNU, "PROPERTY_NOT_FOUND", "Bien introuvable", "bien"],
      ["/api/owners/" + INCONNU, "OWNER_NOT_FOUND", "Propriétaire introuvable", "propriétaire"],
    ];
    it.each(cas)("GET %s : %s", async (chemin, code, message) => {
      const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 86_400_000 * 30) });
      const res = await request(app).get(chemin).set(authHeader(tokenFor({ id: manager.id, role: "MANAGER" })));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(code);
      expect(res.body.error).toBe(message);
    });
  });
});
