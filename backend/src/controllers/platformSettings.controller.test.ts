import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { platformSettings } from "../db/schema";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Contrairement à agencySettings (un compte bancaire par agence, pour
 * encaisser ses loyers), platformSettings ne porte qu'UN SEUL compte : celui
 * de l'exploitant de la plateforme, destinataire des abonnements SaaS réglés
 * par virement. D'où ces deux angles de test : la ligne unique côté admin, et
 * ce qu'un gestionnaire — jamais un autre rôle — peut en lire.
 */
describe("GET /api/admin/settings", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/admin/settings");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un gestionnaire", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/admin/settings").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("crée la ligne unique par défaut au premier accès, sans la recréer ensuite", async () => {
    const admin = await createAdmin();

    const premier = await request(app).get("/api/admin/settings").set(authHeader(tokenFor(admin)));
    expect(premier.status).toBe(200);
    expect(premier.body.id).toBe("platform");
    expect(premier.body.iban).toBeNull();

    await request(app).get("/api/admin/settings").set(authHeader(tokenFor(admin)));

    const rows = await testDb.select().from(platformSettings);
    expect(rows).toHaveLength(1);
  });
});

describe("PUT /api/admin/settings", () => {
  it("enregistre un IBAN/BIC valides, normalisés", async () => {
    const admin = await createAdmin();

    const res = await request(app)
      .put("/api/admin/settings")
      .set(authHeader(tokenFor(admin)))
      .send({ iban: "fr76 3000 6000 0112 3456 7890 189", bic: "bnpafrpp xxx" });

    expect(res.status).toBe(200);
    expect(res.body.iban).toBe("FR7630006000011234567890189");
    expect(res.body.bic).toBe("BNPAFRPPXXX");
  });

  it("rejette (400) un IBAN dont la clé de contrôle est fausse", async () => {
    const admin = await createAdmin();

    const res = await request(app)
      .put("/api/admin/settings")
      .set(authHeader(tokenFor(admin)))
      .send({ iban: "FR76 3000 6000 0112 3456 7809 189" });

    expect(res.status).toBe(400);
    const rows = await testDb.select().from(platformSettings);
    expect(rows).toHaveLength(0);
  });

  it("refuse l'accès à un gestionnaire", async () => {
    const manager = await createManager();
    const res = await request(app)
      .put("/api/admin/settings")
      .set(authHeader(tokenFor(manager)))
      .send({ iban: "FR7630006000011234567890189" });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/subscription/bank-details (portail gestionnaire)", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/subscription/bank-details");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un administrateur (l'IBAN n'est pas à lui de le consulter par cette voie)", async () => {
    const admin = await createAdmin();
    const res = await request(app).get("/api/subscription/bank-details").set(authHeader(tokenFor(admin)));
    expect(res.status).toBe(403);
  });

  it("renvoie l'IBAN/BIC configurés par l'administrateur", async () => {
    const admin = await createAdmin();
    await request(app)
      .put("/api/admin/settings")
      .set(authHeader(tokenFor(admin)))
      .send({ iban: "FR7630006000011234567890189", bic: "BNPAFRPPXXX" });

    const manager = await createManager();
    const res = await request(app).get("/api/subscription/bank-details").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.iban).toBe("FR7630006000011234567890189");
    expect(res.body.bic).toBe("BNPAFRPPXXX");
  });

  it("renvoie null plutôt qu'une erreur quand la plateforme n'a pas encore renseigné son IBAN", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/subscription/bank-details").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.iban).toBeNull();
    expect(res.body.bic).toBeNull();
  });
});
