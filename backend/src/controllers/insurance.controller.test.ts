import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { insurancePolicies } from "../db/schema";
import {
  authHeader,
  createInsurancePolicy,
  createManager,
  createProperty,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("POST /api/insurance-policies", () => {
  it("crée une police d'assurance pour un bien du gestionnaire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);

    const res = await request(app)
      .post("/api/insurance-policies")
      .set(authHeader(tokenFor(manager)))
      .send({
        propertyId: property.id,
        insurerName: "AXA Habitat",
        policyNumber: "AXA-2026-001",
        premiumAmount: 240,
        expiryDate: "2027-01-01",
      });

    expect(res.status).toBe(201);
    expect(res.body.insurerName).toBe("AXA Habitat");
    expect(res.body.policyNumber).toBe("AXA-2026-001");
    expect(res.body.premiumAmount).toBe(240);
    expect(res.body.propertyId).toBe(property.id);
  });

  it("refuse de créer une police sur le bien d'un autre gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const otherManager = await createManager();

    const res = await request(app)
      .post("/api/insurance-policies")
      .set(authHeader(tokenFor(otherManager)))
      .send({ propertyId: property.id, insurerName: "Intrus", policyNumber: "X", expiryDate: "2027-01-01" });

    expect(res.status).toBe(404);
  });

  it("hérite de la devise du bien quand la requête n'en précise aucune", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { currency: "XOF" });

    const res = await request(app)
      .post("/api/insurance-policies")
      .set(authHeader(tokenFor(manager)))
      .send({ propertyId: property.id, insurerName: "NSIA", policyNumber: "NSIA-1", expiryDate: "2027-01-01" });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe("XOF");
  });

  it("refuse une échéance antérieure ou égale à la date de prise d'effet", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);

    const res = await request(app)
      .post("/api/insurance-policies")
      .set(authHeader(tokenFor(manager)))
      .send({
        propertyId: property.id,
        insurerName: "AXA Habitat",
        policyNumber: "AXA-2026-002",
        startDate: "2026-06-01",
        expiryDate: "2026-06-01",
      });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/insurance-policies", () => {
  it("liste uniquement les polices des biens du gestionnaire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await createInsurancePolicy(property.id, { insurerName: "AXA" });

    const otherManager = await createManager();
    const otherProperty = await createProperty(otherManager.id);
    await createInsurancePolicy(otherProperty.id, { insurerName: "Autre" });

    const res = await request(app)
      .get("/api/insurance-policies")
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].insurerName).toBe("AXA");
  });

  it("filtre par bien quand propertyId est fourni", async () => {
    const manager = await createManager();
    const propertyA = await createProperty(manager.id);
    const propertyB = await createProperty(manager.id);
    await createInsurancePolicy(propertyA.id, { insurerName: "Pour A" });
    await createInsurancePolicy(propertyB.id, { insurerName: "Pour B" });

    const res = await request(app)
      .get("/api/insurance-policies")
      .query({ propertyId: propertyA.id })
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].insurerName).toBe("Pour A");
  });
});

describe("PUT /api/insurance-policies/:id", () => {
  it("met à jour une police du gestionnaire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const policy = await createInsurancePolicy(property.id, { insurerName: "Ancien assureur" });

    const res = await request(app)
      .put(`/api/insurance-policies/${policy.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({
        propertyId: property.id,
        insurerName: "Nouvel assureur",
        policyNumber: policy.policyNumber,
        expiryDate: "2028-01-01",
      });

    expect(res.status).toBe(200);
    expect(res.body.insurerName).toBe("Nouvel assureur");
  });

  it("refuse de modifier la police d'un autre gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const policy = await createInsurancePolicy(property.id);
    const otherManager = await createManager();

    const res = await request(app)
      .put(`/api/insurance-policies/${policy.id}`)
      .set(authHeader(tokenFor(otherManager)))
      .send({ propertyId: property.id, insurerName: "Intrus", policyNumber: "X", expiryDate: "2028-01-01" });

    expect(res.status).toBe(404);
  });

  /**
   * Un renouvellement (nouvelle échéance postérieure à l'ancienne) doit
   * pouvoir déclencher un nouveau rappel le moment venu : sans la remise à
   * zéro de reminderSentAt, une police renouvelée chaque année ne recevrait
   * jamais plus qu'un seul rappel pour toute sa durée de vie.
   */
  it("réinitialise reminderSentAt quand l'échéance recule (renouvellement)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const policy = await createInsurancePolicy(property.id, {
      expiryDate: new Date(2026, 5, 1),
      reminderSentAt: new Date(2026, 4, 1),
    });

    const res = await request(app)
      .put(`/api/insurance-policies/${policy.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({
        propertyId: property.id,
        insurerName: policy.insurerName,
        policyNumber: policy.policyNumber,
        expiryDate: "2027-06-01",
      });

    expect(res.status).toBe(200);
    const [enBase] = await testDb.select().from(insurancePolicies).where(eq(insurancePolicies.id, policy.id));
    expect(enBase.reminderSentAt).toBeNull();
  });

  it("ne réinitialise pas reminderSentAt si l'échéance ne change pas", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const sentAt = new Date(2026, 4, 1);
    const policy = await createInsurancePolicy(property.id, {
      expiryDate: new Date(2026, 5, 1),
      reminderSentAt: sentAt,
    });

    const res = await request(app)
      .put(`/api/insurance-policies/${policy.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({
        propertyId: property.id,
        insurerName: "Nom mis à jour",
        policyNumber: policy.policyNumber,
        expiryDate: "2026-06-01",
      });

    expect(res.status).toBe(200);
    const [enBase] = await testDb.select().from(insurancePolicies).where(eq(insurancePolicies.id, policy.id));
    expect(enBase.reminderSentAt?.getTime()).toBe(sentAt.getTime());
  });
});

describe("DELETE /api/insurance-policies/:id", () => {
  it("supprime une police du gestionnaire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const policy = await createInsurancePolicy(property.id);

    const res = await request(app)
      .delete(`/api/insurance-policies/${policy.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const rows = await testDb.select().from(insurancePolicies).where(eq(insurancePolicies.id, policy.id));
    expect(rows).toHaveLength(0);
  });

  it("refuse de supprimer la police d'un autre gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const policy = await createInsurancePolicy(property.id);
    const otherManager = await createManager();

    const res = await request(app)
      .delete(`/api/insurance-policies/${policy.id}`)
      .set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });
});
