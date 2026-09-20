import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { owners, properties, users } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createOwner,
  createOwnerPortalUser,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("POST /api/owners", () => {
  it("crée une fiche propriétaire pour le gestionnaire connecté, avec les champs enrichis (IBAN, commission...)", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/owners")
      .set(authHeader(tokenFor(manager)))
      .send({
        firstName: "Fatou",
        lastName: "Diop",
        companyName: "SCI Les Baobabs",
        phone: "0612345678",
        email: "fatou@test.local",
        address: "12 avenue des Palmiers",
        iban: "FR7630006000011234567890189",
        bic: "AGRIFRPP",
        managementFeeRate: 10,
        notes: "Préfère les virements trimestriels",
      });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("fatou@test.local");
    expect(res.body.managerId).toBe(manager.id);
    expect(res.body.companyName).toBe("SCI Les Baobabs");
    expect(res.body.managementFeeRate).toBe(10);
  });

  it("applique le taux de commission par défaut (8%) quand il n'est pas fourni", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/owners")
      .set(authHeader(tokenFor(manager)))
      .send({ firstName: "Awa", lastName: "Ndiaye", phone: "0600000000", email: "awa@test.local" });

    expect(res.status).toBe(201);
    expect(res.body.managementFeeRate).toBe(8);
  });

  it("refuse deux propriétaires avec le même email chez le même gestionnaire", async () => {
    const manager = await createManager();
    await createOwner(manager.id, { email: "dup@test.local" });

    const res = await request(app)
      .post("/api/owners")
      .set(authHeader(tokenFor(manager)))
      .send({ firstName: "Bis", lastName: "Repetita", phone: "0600000000", email: "dup@test.local" });

    expect(res.status).toBe(409);
  });

  it("autorise le même email pour deux propriétaires d'agences différentes", async () => {
    const managerA = await createManager();
    await createOwner(managerA.id, { email: "partage@test.local" });
    const managerB = await createManager();

    const res = await request(app)
      .post("/api/owners")
      .set(authHeader(tokenFor(managerB)))
      .send({ firstName: "Autre", lastName: "Agence", phone: "0611111111", email: "partage@test.local" });

    expect(res.status).toBe(201);
  });
});

describe("GET /api/owners/:id", () => {
  it("refuse l'accès à la fiche d'un propriétaire d'un autre gestionnaire", async () => {
    const owner = await createOwner((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app).get(`/api/owners/${owner.id}`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });

  it("renvoie les biens associés au propriétaire", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    await createProperty(manager.id, { ownerId: owner.id, title: "Villa Almadies" });

    const res = await request(app).get(`/api/owners/${owner.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.properties).toHaveLength(1);
    expect(res.body.properties[0].title).toBe("Villa Almadies");
  });
});

describe("GET /api/owners & GET /api/owners/:id — portalStatus dérivé", () => {
  it("renvoie portalStatus=NONE tant qu'aucun accès portail n'a été créé", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);

    const list = await request(app).get("/api/owners").set(authHeader(tokenFor(manager)));
    const detail = await request(app).get(`/api/owners/${owner.id}`).set(authHeader(tokenFor(manager)));

    expect(list.body.items[0].portalStatus).toBe("NONE");
    expect(detail.body.portalStatus).toBe("NONE");
  });

  it("renvoie portalStatus=PENDING juste après l'invitation, avant que le propriétaire ne pose son mot de passe", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);

    await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager)));
    const list = await request(app).get("/api/owners").set(authHeader(tokenFor(manager)));
    const detail = await request(app).get(`/api/owners/${owner.id}`).set(authHeader(tokenFor(manager)));

    expect(list.body.items[0].portalStatus).toBe("PENDING");
    expect(detail.body.portalStatus).toBe("PENDING");
  });

  it("renvoie portalStatus=ACTIVE une fois le mot de passe posé (resetPasswordTokenHash retombé à null)", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    await createOwnerPortalUser(owner);

    const list = await request(app).get("/api/owners").set(authHeader(tokenFor(manager)));
    const detail = await request(app).get(`/api/owners/${owner.id}`).set(authHeader(tokenFor(manager)));

    expect(list.body.items[0].portalStatus).toBe("ACTIVE");
    expect(detail.body.portalStatus).toBe("ACTIVE");
  });

  it("ne renvoie jamais le hash de token brut au frontend", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager)));

    const detail = await request(app).get(`/api/owners/${owner.id}`).set(authHeader(tokenFor(manager)));

    expect(detail.body.resetPasswordTokenHash).toBeUndefined();
  });
});

describe("DELETE /api/owners/:id", () => {
  it("supprime un propriétaire sans bien associé", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);

    const res = await request(app).delete(`/api/owners/${owner.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    const remaining = await testDb.select().from(owners).where(eq(owners.id, owner.id));
    expect(remaining).toHaveLength(0);
  });

  it("refuse de supprimer un propriétaire associé à un bien", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    await createProperty(manager.id, { ownerId: owner.id });

    const res = await request(app).delete(`/api/owners/${owner.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
  });

  it("refuse de supprimer le propriétaire d'un autre gestionnaire", async () => {
    const owner = await createOwner((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app).delete(`/api/owners/${owner.id}`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });
});

describe("GET /api/owners — isolation entre gestionnaires", () => {
  it("ne renvoie que les propriétaires du gestionnaire connecté", async () => {
    const manager = await createManager();
    await createOwner(manager.id);
    await createOwner((await createManager()).id);

    const res = await request(app).get("/api/owners").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe("POST /api/owners/:id/invite", () => {
  it("crée le compte portail (role OWNER) via un token à usage unique, sans mot de passe communiqué", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { email: "invite@test.local" });

    const res = await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);

    const [createdUser] = await testDb.select().from(users).where(eq(users.email, "invite@test.local"));
    expect(createdUser).toBeDefined();
    expect(createdUser.role).toBe("OWNER");
    expect(createdUser.resetPasswordTokenHash).not.toBeNull();

    const [updatedOwner] = await testDb.select().from(owners).where(eq(owners.id, owner.id));
    expect(updatedOwner.userId).toBe(createdUser.id);
  });

  it("permet de renvoyer l'invitation tant qu'elle n'a pas été activée", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { email: "relance@test.local" });

    const first = await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager)));
    expect(first.status).toBe(200);
    const [userAfterFirst] = await testDb.select().from(users).where(eq(users.email, "relance@test.local"));

    const second = await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager)));
    expect(second.status).toBe(200);

    const [userAfterSecond] = await testDb.select().from(users).where(eq(users.email, "relance@test.local"));
    // Même compte réutilisé (pas de doublon), mais le token a été régénéré.
    expect(userAfterSecond.id).toBe(userAfterFirst.id);
    expect(userAfterSecond.resetPasswordTokenHash).not.toBe(userAfterFirst.resetPasswordTokenHash);
  });

  it("refuse une nouvelle invitation une fois l'accès déjà activé (mot de passe déjà défini)", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { email: "active@test.local" });

    await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager)));
    const [createdUser] = await testDb.select().from(users).where(eq(users.email, "active@test.local"));
    // Simule l'activation : resetPassword efface le token une fois le mot de passe posé.
    await testDb.update(users).set({ resetPasswordTokenHash: null, resetPasswordExpiresAt: null }).where(eq(users.id, createdUser.id));

    const res = await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
  });

  it("refuse d'inviter le propriétaire d'un autre gestionnaire", async () => {
    const owner = await createOwner((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });

  it("refuse l'invitation si un compte existe déjà avec cet email (hors owners)", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { email: "deja-utilise@test.local" });
    await createManager({ email: "deja-utilise@test.local" });

    const res = await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
  });
});

describe("POST /api/properties — association à un propriétaire", () => {
  it("refuse d'associer un bien au propriétaire d'un AUTRE gestionnaire", async () => {
    const manager = await createManager();
    const otherOwner = await createOwner((await createManager()).id);

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Bien Test", address: "1 rue Test", surface: 40, rent: 400, ownerId: otherOwner.id });

    expect(res.status).toBe(400);
  });

  it("associe un bien à un propriétaire du même gestionnaire", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Bien Test", address: "1 rue Test", surface: 40, rent: 400, ownerId: owner.id });

    expect(res.status).toBe(201);
    expect(res.body.ownerId).toBe(owner.id);
  });
});

describe("GET /api/owners/mine/dashboard — Espace propriétaire (résumé financier)", () => {
  it("renvoie le loyer perçu et en attente ce mois-ci, par bien, groupé par devise", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 10 });
    const propertyA = await createProperty(manager.id, { ownerId: owner.id, title: "Villa A", currency: "EUR" });
    const propertyB = await createProperty(manager.id, { ownerId: owner.id, title: "Villa B", currency: "EUR" });
    const tenant = await createTenant(manager.id);
    const contractA = await createContract(propertyA.id, tenant.id);
    const now = new Date();
    await createInvoice(contractA.id, {
      periodMonth: now.getMonth() + 1,
      periodYear: now.getFullYear(),
      amount: 500,
      currency: "EUR",
      status: "PAID",
      paidAt: now,
    });
    const contractB = await createContract(propertyB.id, tenant.id);
    await createInvoice(contractB.id, {
      periodMonth: now.getMonth() + 1,
      periodYear: now.getFullYear(),
      amount: 300,
      currency: "EUR",
      status: "PENDING",
    });

    const res = await request(app)
      .get("/api/owners/mine/dashboard")
      .set(authHeader(tokenFor({ id: "irrelevant-user-id", role: "OWNER" }, null, owner.id)));

    expect(res.status).toBe(200);
    expect(res.body.ownerName).toBe(`${owner.firstName} ${owner.lastName}`);
    expect(res.body.managementFeeRate).toBe(10);
    expect(res.body.collectedThisMonthByCurrency.EUR).toBe(500);
    expect(res.body.pendingThisMonthByCurrency.EUR).toBe(300);
    expect(res.body.properties).toHaveLength(2);
  });

  it("n'expose jamais les biens d'un autre propriétaire", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    const otherOwner = await createOwner(manager.id);
    await createProperty(manager.id, { ownerId: otherOwner.id, title: "Ne doit pas apparaître" });

    const res = await request(app)
      .get("/api/owners/mine/dashboard")
      .set(authHeader(tokenFor({ id: "irrelevant-user-id", role: "OWNER" }, null, owner.id)));

    expect(res.status).toBe(200);
    expect(res.body.properties).toHaveLength(0);
  });

  it("refuse l'accès à un rôle autre que OWNER", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/owners/mine/dashboard").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(403);
  });

  it("refuse si le token OWNER ne porte aucun ownerId", async () => {
    const res = await request(app)
      .get("/api/owners/mine/dashboard")
      .set(authHeader(tokenFor({ id: "irrelevant-user-id", role: "OWNER" })));

    expect(res.status).toBe(404);
  });
});
