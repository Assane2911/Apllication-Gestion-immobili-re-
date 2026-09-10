import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { createManager, createTenant, createTenantPortalUser, tokenFor } from "../test/authHelpers";

// authenticate() et requireRole() gardent la quasi-totalité de l'API : ils
// n'étaient jusqu'ici exercés qu'indirectement (des tests de contrôleurs
// vérifient un 401/403 générique en passant, sans jamais isoler les branches
// réelles de jwt.verify - token absent, mal formé, expiré, ou signé avec une
// mauvaise clé - ni la logique de restriction de rôle elle-même). On utilise
// GET /api/issues/mine, une route simple (authenticate + requireRole("TENANT"),
// sans requireActiveSubscription) pour isoler ces deux middlewares.
describe("authenticate", () => {
  it("rejette (401) une requête sans en-tête Authorization", async () => {
    const res = await request(app).get("/api/issues/mine");
    expect(res.status).toBe(401);
  });

  it("rejette (401) un en-tête Authorization sans préfixe Bearer", async () => {
    const manager = await createManager();
    const res = await request(app)
      .get("/api/issues/mine")
      .set("Authorization", tokenFor(manager));
    expect(res.status).toBe(401);
  });

  it("rejette (401) un token mal formé (chaîne arbitraire)", async () => {
    const res = await request(app)
      .get("/api/issues/mine")
      .set("Authorization", "Bearer ceci-nest-pas-un-jwt");
    expect(res.status).toBe(401);
  });

  it("rejette (401) un token signé avec une mauvaise clé (falsifié)", async () => {
    const forged = jwt.sign({ userId: "quelqu-un", role: "MANAGER" }, "mauvaise-cle-secrete", {
      expiresIn: "1h",
    });
    const res = await request(app)
      .get("/api/issues/mine")
      .set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it("rejette (401) un token expiré", async () => {
    const expired = jwt.sign(
      { userId: "quelqu-un", role: "MANAGER" },
      process.env.JWT_SECRET!,
      { expiresIn: "-10s" }
    );
    const res = await request(app)
      .get("/api/issues/mine")
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it("accepte un token valide et attache l'utilisateur à la requête", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const tenantUser = await createTenantPortalUser(tenant);
    const res = await request(app)
      .get("/api/issues/mine")
      .set("Authorization", `Bearer ${tokenFor(tenantUser, tenant.id)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("requireRole", () => {
  it("rejette (403) un rôle authentifié mais non autorisé pour la route", async () => {
    const manager = await createManager();
    const res = await request(app)
      .get("/api/issues/mine")
      .set("Authorization", `Bearer ${tokenFor(manager)}`);
    expect(res.status).toBe(403);
  });

  it("autorise un rôle explicitement listé", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const tenantUser = await createTenantPortalUser(tenant);
    const res = await request(app)
      .get("/api/issues/mine")
      .set("Authorization", `Bearer ${tokenFor(tenantUser, tenant.id)}`);
    expect(res.status).toBe(200);
  });
});
