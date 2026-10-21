import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { authHeader, createAdmin, createContract, createManager, createOwner, createProperty, createTenant, tokenFor } from "../test/authHelpers";

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
  describe("conflits du quotidien : un code par règle, le texte français restant en secours", () => {
    const gestionnaire = () => createManager();

    it("deux locataires avec le même email : TENANT_EMAIL_EXISTS", async () => {
      const manager = await gestionnaire();
      await createTenant(manager.id, { email: "doublon@test.local" });
      const res = await request(app)
        .post("/api/tenants")
        .set(authHeader(tokenFor(manager)))
        .send({ firstName: "A", lastName: "B", phone: "+221778422993", email: "doublon@test.local" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("TENANT_EMAIL_EXISTS");
      expect(res.body.error).toBe("Un locataire avec cet email existe déjà");
    });

    it("deux propriétaires avec le même email : OWNER_EMAIL_EXISTS", async () => {
      const manager = await gestionnaire();
      await createOwner(manager.id, { email: "doublon@test.local" });
      const res = await request(app)
        .post("/api/owners")
        .set(authHeader(tokenFor(manager)))
        .send({ firstName: "A", lastName: "B", phone: "+221778422993", email: "doublon@test.local" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("OWNER_EMAIL_EXISTS");
    });

    it("supprimer un locataire qui a un bail actif : TENANT_HAS_ACTIVE_CONTRACT", async () => {
      const manager = await gestionnaire();
      const bien = await createProperty(manager.id);
      const locataire = await createTenant(manager.id);
      await createContract(bien.id, locataire.id);
      const res = await request(app).delete(`/api/tenants/${locataire.id}`).set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("TENANT_HAS_ACTIVE_CONTRACT");
      expect(res.body.error).toBe("Impossible de supprimer un locataire ayant un contrat actif");
    });

    it("supprimer un bien qui a un bail actif : PROPERTY_HAS_ACTIVE_CONTRACT", async () => {
      const manager = await gestionnaire();
      const bien = await createProperty(manager.id);
      const locataire = await createTenant(manager.id);
      await createContract(bien.id, locataire.id);
      const res = await request(app).delete(`/api/properties/${bien.id}`).set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PROPERTY_HAS_ACTIVE_CONTRACT");
    });

    it("supprimer un bail actif : CONTRACT_ACTIVE_NO_DELETE", async () => {
      const manager = await gestionnaire();
      const bien = await createProperty(manager.id);
      const locataire = await createTenant(manager.id);
      const bail = await createContract(bien.id, locataire.id);
      const res = await request(app).delete(`/api/contracts/${bail.id}`).set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONTRACT_ACTIVE_NO_DELETE");
    });
  });
  describe("refus du quotidien, validation et requêtes : un code par règle, le français restant en secours", () => {
    const gestionnaire = () => createManager();

    it("route inconnue : ROUTE_NOT_FOUND, avec la méthode et le chemin à insérer", async () => {
      const res = await request(app).get("/api/introuvable");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("ROUTE_NOT_FOUND");
      expect(res.body.params).toEqual({ method: "GET", path: "/api/introuvable" });
    });

    it("formulaire vide : VALIDATION_ERROR_FIELDS, avec les champs en cause", async () => {
      const manager = await gestionnaire();
      const res = await request(app).post("/api/tenants").set(authHeader(tokenFor(manager))).send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR_FIELDS");
      expect(res.body.params.fields).toContain("firstName");
    });

    it("numéro de téléphone sans indicatif : PHONE_INVALID, le message français conservé", async () => {
      const manager = await gestionnaire();
      const res = await request(app)
        .post("/api/tenants")
        .set(authHeader(tokenFor(manager)))
        .send({ firstName: "A", lastName: "B", phone: "0612345678", email: "tel@test.local" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("PHONE_INVALID");
      expect(res.body.error).toContain("indicatif du pays");
    });

    it("supprimer un propriétaire qui a des biens : OWNER_HAS_PROPERTIES", async () => {
      const manager = await gestionnaire();
      const proprietaire = await createOwner(manager.id);
      await createProperty(manager.id, { ownerId: proprietaire.id });
      const res = await request(app).delete(`/api/owners/${proprietaire.id}`).set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("OWNER_HAS_PROPERTIES");
    });

    it("supprimer un locataire ou un bien qui a un historique de baux : un code pour chacun", async () => {
      const manager = await gestionnaire();
      const bien = await createProperty(manager.id);
      const locataire = await createTenant(manager.id);
      await createContract(bien.id, locataire.id, { status: "ENDED" });
      const h = authHeader(tokenFor(manager));
      const locataireRes = await request(app).delete(`/api/tenants/${locataire.id}`).set(h);
      expect(locataireRes.status).toBe(409);
      expect(locataireRes.body.code).toBe("TENANT_HAS_CONTRACT_HISTORY");
      const bienRes = await request(app).delete(`/api/properties/${bien.id}`).set(h);
      expect(bienRes.status).toBe(409);
      expect(bienRes.body.code).toBe("PROPERTY_HAS_CONTRACT_HISTORY");
    });

    it("un second bail sur la même période : CONTRACT_OVERLAP_ACTIVE", async () => {
      const manager = await gestionnaire();
      const bien = await createProperty(manager.id);
      const locataire = await createTenant(manager.id);
      const autre = await createTenant(manager.id);
      await createContract(bien.id, locataire.id);
      const res = await request(app)
        .post("/api/contracts")
        .set(authHeader(tokenFor(manager)))
        .send({ propertyId: bien.id, tenantId: autre.id, startDate: "2026-06-01", endDate: "2027-06-01", rent: 500, deposit: 500 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONTRACT_OVERLAP_ACTIVE");
    });

    it("suspendre deux fois le même compte : ACCOUNT_ALREADY_SUSPENDED", async () => {
      const admin = await createAdmin();
      const manager = await gestionnaire();
      const h = authHeader(tokenFor({ id: admin.id, role: "ADMIN" }));
      expect((await request(app).post(`/api/admin/managers/${manager.id}/suspend`).set(h).send({ reason: "Impayés répétés" })).status).toBe(200);
      const res = await request(app).post(`/api/admin/managers/${manager.id}/suspend`).set(h).send({ reason: "Impayés répétés" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ACCOUNT_ALREADY_SUSPENDED");
    });

    it("recherche administrateur mal formée : SEARCH_PARAMS_INVALID", async () => {
      const admin = await createAdmin();
      const res = await request(app).get("/api/admin/managers?plan=PLATINE").set(authHeader(tokenFor({ id: admin.id, role: "ADMIN" })));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SEARCH_PARAMS_INVALID");
    });
  });
});
