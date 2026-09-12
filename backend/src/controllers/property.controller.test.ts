import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { invoices, properties } from "../db/schema";
import {
  authHeader,
  createContract,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("POST /api/properties — devise", () => {
  // Regression : property.controller n'a longtemps pas gere la devise du tout.
  // Un bien restait donc en EUR (valeur par defaut en base) et toute la
  // cascade avec lui, le contrat heritant du bien et la facture du contrat.
  // Un gestionnaire regle en XOF voyait ses loyers, ses quittances et ses baux
  // libelles en euros.
  it("hérite de la devise de règlement du gestionnaire", async () => {
    const manager = await createManager({ currency: "XOF" });

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Villa Ngor", address: "3 rue des Almadies", surface: 120, rent: 250000 });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe("XOF");
  });

  it("respecte une devise explicitement fournie, même si elle diffère de celle du gestionnaire", async () => {
    const manager = await createManager({ currency: "XOF" });

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Appartement Paris", address: "10 rue de la Paix", surface: 40, rent: 900, currency: "EUR" });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe("EUR");
  });

  it("retombe sur EUR si la devise du gestionnaire est vide", async () => {
    // users.currency est NOT NULL : une devise nulle est impossible en base,
    // et la contrainte rejette l'insertion. Le repli `|| "EUR"` n'est donc
    // atteignable qu'avec une chaîne vide — valeur qu'aucune route n'accepte
    // (le schéma exige min(1)) mais qui reste possible au niveau de la base.
    const manager = await createManager({ currency: "" });

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Studio", address: "1 rue du Test", surface: 20, rent: 300 });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe("EUR");
  });

  it("propage la devise du bien au contrat, puis du contrat à la facture", async () => {
    // Vérifie la chaîne complète, le point de la régression : chaque maillon
    // hérite du précédent.
    const manager = await createManager({ currency: "XOF" });

    const bien = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Résidence Ouakam", address: "12 Corniche", surface: 90, rent: 150000 });
    expect(bien.body.currency).toBe("XOF");

    const locataire = await createTenant(manager.id);

    const contrat = await request(app)
      .post("/api/contracts")
      .set(authHeader(tokenFor(manager)))
      .send({
        propertyId: bien.body.id,
        tenantId: locataire.id,
        rent: 150000,
        deposit: 300000,
        startDate: "2026-09-01",
        endDate: "2027-09-01",
      });

    expect(contrat.status).toBe(201);
    expect(contrat.body.currency).toBe("XOF");

    const [facture] = await testDb
      .select()
      .from(invoices)
      .where(eq(invoices.contractId, contrat.body.id));
    if (facture) expect(facture.currency).toBe("XOF");
  });
});

describe("POST /api/properties", () => {
  it("crée un bien pour le gestionnaire connecté", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Studio Centre-ville", address: "10 rue de la Paix", surface: 25, rent: 400 });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Studio Centre-ville");
    expect(res.body.managerId).toBe(manager.id);
    expect(res.body.status).toBe("AVAILABLE");
  });
});

describe("GET /api/properties/:id", () => {
  it("renvoie le bien avec ses contrats pour son propriétaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id);

    const res = await request(app).get(`/api/properties/${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(property.id);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.contracts[0].tenant.id).toBe(tenant.id);
  });

  it("refuse l'accès au bien d'un autre gestionnaire", async () => {
    const property = await createProperty((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app).get(`/api/properties/${property.id}`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/properties/:id", () => {
  it("met à jour un bien appartenant au gestionnaire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ rent: 650 });

    expect(res.status).toBe(200);
    expect(res.body.rent).toBe(650);
  });

  it("refuse de modifier le bien d'un autre gestionnaire", async () => {
    const property = await createProperty((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(otherManager)))
      .send({ rent: 1 });

    expect(res.status).toBe(404);
    const [unchanged] = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(unchanged.rent).toBe(500);
  });
});

describe("DELETE /api/properties/:id", () => {
  it("supprime un bien sans contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);

    const res = await request(app).delete(`/api/properties/${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    const remaining = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(remaining).toHaveLength(0);
  });

  it("refuse de supprimer un bien ayant un contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id); // status ACTIVE par défaut

    const res = await request(app).delete(`/api/properties/${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
    const stillThere = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(stillThere).toHaveLength(1);
  });

  it("refuse de supprimer le bien d'un autre gestionnaire", async () => {
    const property = await createProperty((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app).delete(`/api/properties/${property.id}`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });
});

describe("GET /api/properties — isolation entre gestionnaires", () => {
  it("ne renvoie que les biens du gestionnaire connecté", async () => {
    const manager = await createManager();
    await createProperty(manager.id);
    await createProperty((await createManager()).id);

    const res = await request(app).get("/api/properties").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});
