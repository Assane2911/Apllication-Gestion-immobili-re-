import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { agencySettings } from "../db/schema";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("GET /api/agency", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/agency");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app)
      .get("/api/agency")
      .set(authHeader(tokenFor({ id: "t1", role: "TENANT" }, "tenant-1")));
    expect(res.status).toBe(403);
  });

  it("crée des paramètres par défaut au premier accès", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(manager.id);
    expect(res.body.agencyName).toBe("Agence Immobilière Privée");

    const rows = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(rows).toHaveLength(1);
  });

  it("ne recrée pas de paramètres à un second appel", async () => {
    const manager = await createManager();
    await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));
    await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    const rows = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(rows).toHaveLength(1);
  });

  it("renvoie des paramètres distincts pour chaque gestionnaire", async () => {
    const manager = await createManager();
    const otherManager = await createManager();
    await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Agence Manager 1" });
    await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(otherManager)))
      .send({ agencyName: "Agence Manager 2" });

    const res = await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe("Agence Manager 1");
  });
});

describe("PUT /api/agency", () => {
  it("crée les paramètres si aucun n'existe encore", async () => {
    const manager = await createManager();

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Horizon Immobilier", phone: "+33 1 23 45 67 89" });

    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe("Horizon Immobilier");
    expect(res.body.phone).toBe("+33 1 23 45 67 89");
  });

  it("met à jour les paramètres existants", async () => {
    const manager = await createManager();
    await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Nouveau Nom Agence", legalNotice: "SIRET 123 456 789" });

    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe("Nouveau Nom Agence");
    expect(res.body.legalNotice).toBe("SIRET 123 456 789");
  });

  it("rejette une requête sans agencyName (champ requis)", async () => {
    const manager = await createManager();

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ phone: "+33 1 00 00 00 00" });

    expect(res.status).toBe(400);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor({ id: "t1", role: "TENANT" }, "tenant-1")))
      .send({ agencyName: "Tentative" });
    expect(res.status).toBe(403);
  });
});
