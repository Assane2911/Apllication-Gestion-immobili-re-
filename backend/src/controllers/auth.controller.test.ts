import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { contracts, invoices, owners, properties, tenants, users } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createOwner,
  createOwnerPortalUser,
  createProperty,
  createTeamMember,
  createTenant,
  createTenantPortalUser,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("POST /api/auth/register puis /api/auth/login", () => {
  it("crée un compte non vérifié et bloque la connexion tant que l'email n'est pas confirmé", async () => {
    const registerRes = await request(app)
      .post("/api/auth/register")
      .send({ email: "nouveau@test.local", password: "Password123!" });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.pendingVerification).toBe(true);
    // `email` a volontairement disparu de la réponse : le renvoyer depuis la
    // base aurait suffi à distinguer une adresse libre d'une adresse déjà
    // prise, et rouvert l'énumération que cette réponse ferme (voir
    // enumerationComptes.test.ts).
    expect(registerRes.body).not.toHaveProperty("email");

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "nouveau@test.local", password: "Password123!" });

    expect(loginRes.status).toBe(403);
    expect(loginRes.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  // Ce test attendait un 409 « Un compte existe déjà avec cet email ». Ce
  // message permettait de tester une liste d'adresses pour savoir lesquelles
  // ont un compte ici. L'inscription répond désormais la même chose dans les
  // deux cas ; ce qui reste à garantir, c'est qu'aucun second compte n'est
  // créé et que l'existant n'est pas touché.
  it("ne crée pas de second compte si l'email existe déjà", async () => {
    await request(app).post("/api/auth/register").send({ email: "dup@test.local", password: "Password123!" });
    const secondRes = await request(app)
      .post("/api/auth/register")
      .send({ email: "dup@test.local", password: "AutreMotDePasse1!" });

    expect(secondRes.status).toBe(201);

    const comptes = await testDb.select().from(users).where(eq(users.email, "dup@test.local"));
    expect(comptes).toHaveLength(1);

    // Et le mot de passe du compte existant n'a pas été remplacé.
    await testDb.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, "dup@test.local"));
    const connexion = await request(app)
      .post("/api/auth/login")
      .send({ email: "dup@test.local", password: "AutreMotDePasse1!" });
    expect(connexion.status).toBe(401);
  });

  it("connecte un compte une fois l'email vérifié, avec un JWT exploitable sur /api/auth/me", async () => {
    await request(app).post("/api/auth/register").send({ email: "verifie@test.local", password: "Password123!" });

    // On simule la confirmation d'email (le flux réel passe par le lien envoyé
    // par email, hors-scope ici) en marquant directement le compte comme vérifié.
    await testDb
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.email, "verifie@test.local"));

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "verifie@test.local", password: "Password123!" });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTypeOf("string");
    expect(loginRes.body.user.email).toBe("verifie@test.local");
    expect(loginRes.body.user.subscription.isTrialActive).toBe(true);

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe("verifie@test.local");
  });

  it("refuse la connexion avec un mauvais mot de passe", async () => {
    await request(app).post("/api/auth/register").send({ email: "mdp@test.local", password: "Password123!" });
    await testDb.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, "mdp@test.local"));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "mdp@test.local", password: "MauvaisMotDePasse" });

    expect(res.status).toBe(401);
  });

  it("refuse /api/auth/me sans token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("Cookie httpOnly posé à la connexion (frontend web)", () => {
  it("pose un cookie httpOnly `token` à la connexion, exploitable par /me sans en-tête Authorization", async () => {
    await request(app).post("/api/auth/register").send({ email: "cookie@test.local", password: "Password123!" });
    await testDb.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, "cookie@test.local"));

    const agent = request.agent(app);
    const loginRes = await agent
      .post("/api/auth/login")
      .send({ email: "cookie@test.local", password: "Password123!" });

    expect(loginRes.status).toBe(200);
    const setCookie = (loginRes.headers["set-cookie"] ?? []) as unknown as string[];
    expect(setCookie.some((c) => c.startsWith("token=") && /HttpOnly/i.test(c))).toBe(true);

    // Même agent (jar de cookies) : /me répond sans aucun en-tête Authorization.
    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe("cookie@test.local");
  });

  it("POST /api/auth/logout efface le cookie : /me échoue ensuite (401) pour ce même navigateur", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "cookie-logout@test.local", password: "Password123!" });
    await testDb
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.email, "cookie-logout@test.local"));

    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "cookie-logout@test.local", password: "Password123!" });

    const logoutRes = await agent.post("/api/auth/logout");
    expect(logoutRes.status).toBe(204);

    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(401);
  });

  it("POST /api/auth/logout répond 204 même sans cookie (rien à effacer)", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(204);
  });

  /**
   * Régression : Vercel NE positionne PAS NODE_ENV à l'exécution (seule
   * VERCEL=1 fait partie de ses "System Environment Variables" documentées —
   * voir aussi trust proxy dans app.ts, qui teste déjà VERCEL et pas NODE_ENV
   * pour la même raison). Un cookie posé sans `Secure`/`SameSite=None` en
   * production réelle ne serait jamais renvoyé par le navigateur sur la
   * requête cross-site vers le backend (frontend et backend sont sur des
   * origines distinctes, y compris en preview) : l'authentification web
   * serait alors cassée dès le premier déploiement, silencieusement.
   */
  it("pose un cookie Secure + SameSite=None sur Vercel, même si NODE_ENV retombe sur 'development' (déploiement serverless réel)", async () => {
    const originalNodeEnv = env.nodeEnv;
    const originalVercel = process.env.VERCEL;
    env.nodeEnv = "development";
    process.env.VERCEL = "1";
    try {
      await request(app)
        .post("/api/auth/register")
        .send({ email: "cookie-vercel@test.local", password: "Password123!" });
      await testDb
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(users.email, "cookie-vercel@test.local"));

      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({ email: "cookie-vercel@test.local", password: "Password123!" });

      const setCookie = (loginRes.headers["set-cookie"] ?? []) as unknown as string[];
      const tokenCookie = setCookie.find((c) => c.startsWith("token="));
      expect(tokenCookie).toBeDefined();
      expect(tokenCookie).toMatch(/Secure/i);
      expect(tokenCookie).toMatch(/SameSite=None/i);
    } finally {
      env.nodeEnv = originalNodeEnv;
      if (originalVercel === undefined) {
        delete process.env.VERCEL;
      } else {
        process.env.VERCEL = originalVercel;
      }
    }
  });

  it("pose un cookie sans Secure, SameSite=Lax en développement local réel (hors Vercel)", async () => {
    const originalVercel = process.env.VERCEL;
    delete process.env.VERCEL;
    try {
      await request(app)
        .post("/api/auth/register")
        .send({ email: "cookie-local@test.local", password: "Password123!" });
      await testDb
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(users.email, "cookie-local@test.local"));

      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({ email: "cookie-local@test.local", password: "Password123!" });

      const setCookie = (loginRes.headers["set-cookie"] ?? []) as unknown as string[];
      const tokenCookie = setCookie.find((c) => c.startsWith("token="));
      expect(tokenCookie).toBeDefined();
      expect(tokenCookie).not.toMatch(/Secure/i);
      expect(tokenCookie).toMatch(/SameSite=Lax/i);
    } finally {
      if (originalVercel === undefined) {
        delete process.env.VERCEL;
      } else {
        process.env.VERCEL = originalVercel;
      }
    }
  });
});

describe("POST /api/auth/login puis /api/auth/me — compte propriétaire (Espace propriétaire)", () => {
  it("renvoie ownerId/ownerName au login et à /me, comme tenantId/tenantName pour un locataire", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, {
      firstName: "Fatou",
      lastName: "Diop",
      email: "fatou-login@test.local",
    });
    await createOwnerPortalUser(owner);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "fatou-login@test.local", password: "Password123!" });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.role).toBe("OWNER");
    expect(loginRes.body.user.ownerId).toBe(owner.id);
    expect(loginRes.body.user.ownerName).toBe("Fatou Diop");

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.owner.id).toBe(owner.id);
  });
});

describe("POST /api/auth/login puis /api/auth/me — compte collaborateur (multi-utilisateurs)", () => {
  /**
   * Vérifie le VRAI flux de connexion (pas un jeton forgé dans les tests
   * d'autorisation de team.controller.test.ts) : le jeton délivré à un
   * collaborateur doit porter l'id du PROPRIÉTAIRE de l'agence (voir
   * identiteJetonPourManager), pour que tout le reste du code — déjà scopé
   * sur cet id partout — lui donne accès aux mêmes données qu'au propriétaire,
   * sans aucune modification. /me doit pourtant afficher SA PROPRE identité.
   */
  it("se connecte avec son propre email, mais accède aux données de l'agence propriétaire", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    await createProperty(manager.id, { title: "Villa Ngor" });
    const collaborateur = await createTeamMember(manager.id, { email: "awa-login@test.local" });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "awa-login@test.local", password: "Password123!" });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.role).toBe("MANAGER");
    expect(loginRes.body.user.email).toBe("awa-login@test.local");
    expect(loginRes.body.user.collaboratorId).toBe(collaborateur.id);
    expect(loginRes.body.user.subscription.plan).toBe("ENTERPRISE");

    // Le jeton donne bien accès aux biens du PROPRIÉTAIRE, pas à une agence
    // vide rattachée au compte collaborateur lui-même.
    const propertiesRes = await request(app)
      .get("/api/properties")
      .set("Authorization", `Bearer ${loginRes.body.token}`);
    expect(propertiesRes.status).toBe(200);
    expect(propertiesRes.body.items.some((p: { title: string }) => p.title === "Villa Ngor")).toBe(true);

    const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${loginRes.body.token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe("awa-login@test.local");
    expect(meRes.body.collaboratorId).toBe(collaborateur.id);
  });

  it("logout-all-devices ne révoque que ses propres sessions, jamais celles du propriétaire", async () => {
    const manager = await createManager();
    await createTeamMember(manager.id, { email: "awa-revoc@test.local" });

    const collabLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "awa-revoc@test.local", password: "Password123!" });
    const collabToken = collabLogin.body.token as string;

    await request(app).post("/api/auth/logout-all").set("Authorization", `Bearer ${collabToken}`);

    // Le jeton du collaborateur lui-même est bien révoqué...
    const collabRetry = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${collabToken}`);
    expect(collabRetry.status).toBe(401);

    // ...mais le propriétaire, lui, n'a pas été déconnecté.
    const ownerRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${tokenFor(manager)}`);
    expect(ownerRes.status).toBe(200);
  });
});

describe("DELETE /api/auth/account — suppression définitive du compte gestionnaire", () => {
  it("refuse avec un mauvais mot de passe et ne supprime rien", async () => {
    const manager = await createManager();
    const token = tokenFor(manager);

    const res = await request(app)
      .delete("/api/auth/account")
      .set(authHeader(token))
      .send({ password: "MauvaisMotDePasse" });

    expect(res.status).toBe(401);
    const [stillThere] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(stillThere).toBeDefined();
  });

  it("refuse pour un compte qui n'est pas gestionnaire", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const tenantUser = await createTenantPortalUser(tenant);
    const token = tokenFor(tenantUser, tenant.id);

    const res = await request(app)
      .delete("/api/auth/account")
      .set(authHeader(token))
      .send({ password: "Password123!" });

    expect(res.status).toBe(403);
  });

  it("refuse sans authentification", async () => {
    const res = await request(app).delete("/api/auth/account").send({ password: "Password123!" });
    expect(res.status).toBe(401);
  });

  it("supprime définitivement le compte et toutes les données de l'agence avec le bon mot de passe", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id);
    const owner = await createOwner(manager.id);

    const token = tokenFor(manager);
    const res = await request(app)
      .delete("/api/auth/account")
      .set(authHeader(token))
      .send({ password: "Password123!" });

    expect(res.status).toBe(204);

    const [userRow] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(userRow).toBeUndefined();
    const [propertyRow] = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(propertyRow).toBeUndefined();
    const [tenantRow] = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(tenantRow).toBeUndefined();
    const [contractRow] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(contractRow).toBeUndefined();
    const [invoiceRow] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(invoiceRow).toBeUndefined();
    const [ownerRow] = await testDb.select().from(owners).where(eq(owners.id, owner.id));
    expect(ownerRow).toBeUndefined();
  });
});
