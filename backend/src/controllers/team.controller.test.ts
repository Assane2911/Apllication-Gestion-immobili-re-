import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import {
  authHeader,
  createManager,
  createProperty,
  createTeamMember,
  tokenCollaborateur,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("GET /api/team", () => {
  it("liste les collaborateurs de l'agence, en attente ou actifs", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    await createTeamMember(manager.id, { email: "awa@test.local", resetPasswordTokenHash: "en-attente" });
    await createTeamMember(manager.id, { email: "moussa@test.local", resetPasswordTokenHash: null });

    const res = await request(app).get("/api/team").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const awa = res.body.find((c: { email: string }) => c.email === "awa@test.local");
    const moussa = res.body.find((c: { email: string }) => c.email === "moussa@test.local");
    expect(awa.status).toBe("PENDING");
    expect(moussa.status).toBe("ACTIVE");
  });

  it("ne montre jamais les collaborateurs d'une autre agence", async () => {
    const managerA = await createManager();
    const managerB = await createManager();
    await createTeamMember(managerB.id, { email: "autre-agence@test.local" });

    const res = await request(app).get("/api/team").set(authHeader(tokenFor(managerA)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("est aussi consultable par un collaborateur", async () => {
    const manager = await createManager();
    const token = await tokenCollaborateur(manager);

    const res = await request(app).get("/api/team").set(authHeader(token));

    expect(res.status).toBe(200);
  });
});

describe("POST /api/team — inviter un collaborateur", () => {
  // Multi-utilisateurs : fonctionnalité Entreprise (CGU §3).
  it("refuse à un gestionnaire Pro (réservé à Entreprise)", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });

    const res = await request(app)
      .post("/api/team")
      .set(authHeader(tokenFor(manager)))
      .send({ email: "nouveau@test.local" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Entreprise");
  });

  it("crée un compte collaborateur (role MANAGER, rattaché) via un token à usage unique", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });

    const res = await request(app)
      .post("/api/team")
      .set(authHeader(tokenFor(manager)))
      .send({ email: "nouveau@test.local" });

    expect(res.status).toBe(201);
    const [created] = await testDb.select().from(users).where(eq(users.email, "nouveau@test.local"));
    expect(created).toBeDefined();
    expect(created.role).toBe("MANAGER");
    expect(created.teamOwnerId).toBe(manager.id);
    expect(created.resetPasswordTokenHash).not.toBeNull();
    expect(created.hasPassword).toBe(false);
  });

  it("refuse un email déjà utilisé par un autre compte", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const autreManager = await createManager({ email: "deja-pris@test.local" });

    const res = await request(app)
      .post("/api/team")
      .set(authHeader(tokenFor(manager)))
      .send({ email: autreManager.email });

    expect(res.status).toBe(409);
  });

  it("refuse à un collaborateur d'inviter un autre collaborateur", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const token = await tokenCollaborateur(manager);

    const res = await request(app)
      .post("/api/team")
      .set(authHeader(token))
      .send({ email: "intrus@test.local" });

    expect(res.status).toBe(403);
    const [created] = await testDb.select().from(users).where(eq(users.email, "intrus@test.local"));
    expect(created).toBeUndefined();
  });
});

describe("DELETE /api/team/:id — révoquer un collaborateur", () => {
  it("supprime le compte collaborateur", async () => {
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id);

    const res = await request(app).delete(`/api/team/${collaborateur.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    const [row] = await testDb.select().from(users).where(eq(users.id, collaborateur.id));
    expect(row).toBeUndefined();
  });

  it("refuse à un collaborateur de révoquer un autre collaborateur", async () => {
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id);
    const token = await tokenCollaborateur(manager);

    const res = await request(app).delete(`/api/team/${collaborateur.id}`).set(authHeader(token));

    expect(res.status).toBe(403);
    const [row] = await testDb.select().from(users).where(eq(users.id, collaborateur.id));
    expect(row).toBeDefined();
  });

  it("ne révoque jamais le collaborateur d'une autre agence", async () => {
    const managerA = await createManager();
    const managerB = await createManager();
    const collaborateurB = await createTeamMember(managerB.id);

    const res = await request(app).delete(`/api/team/${collaborateurB.id}`).set(authHeader(tokenFor(managerA)));

    expect(res.status).toBe(404);
    const [row] = await testDb.select().from(users).where(eq(users.id, collaborateurB.id));
    expect(row).toBeDefined();
  });
});

describe("Collaborateur : accès aux données de l'agence", () => {
  it("voit les biens du gestionnaire propriétaire, comme s'il était lui-même le propriétaire", async () => {
    const manager = await createManager();
    await createProperty(manager.id, { title: "Villa Ngor" });
    const token = await tokenCollaborateur(manager);

    const res = await request(app).get("/api/properties").set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.items.some((p: { title: string }) => p.title === "Villa Ngor")).toBe(true);
  });

  it("refuse à un collaborateur de supprimer le compte de l'agence", async () => {
    const manager = await createManager();
    const token = await tokenCollaborateur(manager);

    const res = await request(app).delete("/api/auth/account").set(authHeader(token)).send({ password: "peu importe" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("propriétaire");
  });

  it("refuse à un collaborateur de modifier l'abonnement de l'agence", async () => {
    const manager = await createManager();
    const token = await tokenCollaborateur(manager);

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(token))
      .send({ plan: "PRO", billingCycle: "MONTHLY", paymentMethod: "DEMO" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("propriétaire");
  });
});
