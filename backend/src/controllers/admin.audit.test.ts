import { eq } from "drizzle-orm";
import request from "supertest";
import * as Sentry from "@sentry/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { db } from "../db/client";
import { adminAuditLogs, users } from "../db/schema";
import { logAdminAction } from "../services/adminAudit.service";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// Complète le stub global de setupTestDb avec captureException, pour pouvoir
// vérifier qu'un échec d'écriture du journal est bien remonté à Sentry.
vi.mock("@sentry/node", () => ({
  init: () => {},
  setupExpressErrorHandler: () => {},
  flush: async () => true,
  captureException: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

async function entries() {
  return testDb.select().from(adminAuditLogs);
}

describe("journalisation des actions admin", () => {
  it("suspendre un gestionnaire laisse une trace : qui, quoi, quel gestionnaire", async () => {
    const admin = await createAdmin();
    const manager = await createManager();

    const res = await request(app).post(`/api/admin/managers/${manager.id}/suspend`).set(authHeader(tokenFor(admin))).send({ reason: "Impayé répété" });
    expect(res.status).toBe(200);

    const lignes = await entries();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      adminId: admin.id,
      adminEmail: admin.email,
      action: "manager.suspend",
      targetUserId: manager.id,
      targetLabel: manager.email,
    });
    expect(lignes[0].details).toContain("Impayé répété");
  });

  it("lever la suspension laisse une trace", async () => {
    const admin = await createAdmin();
    const manager = await createManager({ suspendedAt: new Date(), suspensionReason: "Test" });

    const res = await request(app).post(`/api/admin/managers/${manager.id}/reactivate`).set(authHeader(tokenFor(admin))).send({});
    expect(res.status).toBe(200);

    const lignes = await entries();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ action: "manager.reactivate", targetUserId: manager.id });
  });

  it("une action refusée ne laisse aucune trace", async () => {
    const admin = await createAdmin();
    const res = await request(app).post("/api/admin/managers/inconnu/suspend").set(authHeader(tokenFor(admin))).send({ reason: "Test" });
    expect(res.status).toBe(404);
    expect(await entries()).toHaveLength(0);
  });

  it("un échec d'écriture du journal ne fait pas échouer l'action métier", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const insert = db.insert.bind(db);
    vi.spyOn(db, "insert").mockImplementation(((table: unknown) => {
      if (table === adminAuditLogs) throw new Error("panne journal");
      return insert(table as never);
    }) as never);

    const res = await request(app).post(`/api/admin/managers/${manager.id}/suspend`).set(authHeader(tokenFor(admin))).send({ reason: "Test" });

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.suspendedAt).not.toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("sans utilisateur authentifié, l'entrée est attribuée à « Administrateur »", async () => {
    await logAdminAction({ action: "manager.suspend" });
    const lignes = await entries();
    expect(lignes[0]).toMatchObject({ adminId: null, adminEmail: "Administrateur" });
  });
});

describe("GET /api/admin/audit-logs", () => {
  it("exige l'authentification et refuse un gestionnaire", async () => {
    expect((await request(app).get("/api/admin/audit-logs")).status).toBe(401);
    const manager = await createManager();
    const res = await request(app).get("/api/admin/audit-logs").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("liste du plus récent au plus ancien, paginé", async () => {
    const admin = await createAdmin();
    for (let i = 0; i < 5; i++) {
      await testDb.insert(adminAuditLogs).values({
        adminId: admin.id,
        adminEmail: admin.email,
        action: "manager.suspend",
        details: `entrée ${i}`,
        createdAt: new Date(2026, 5, 1 + i),
      });
    }

    const page1 = await request(app).get("/api/admin/audit-logs").query({ pageSize: 2 }).set(authHeader(tokenFor(admin)));
    expect(page1.body.total).toBe(5);
    expect(page1.body.totalPages).toBe(3);
    expect(page1.body.items.map((i: { details: string }) => i.details)).toEqual(["entrée 4", "entrée 3"]);

    const page3 = await request(app)
      .get("/api/admin/audit-logs")
      .query({ pageSize: 2, page: 3 })
      .set(authHeader(tokenFor(admin)));
    expect(page3.body.items.map((i: { details: string }) => i.details)).toEqual(["entrée 0"]);
  });

  it("filtre par action et par gestionnaire visé", async () => {
    const admin = await createAdmin();
    const base = { adminId: admin.id, adminEmail: admin.email };
    await testDb.insert(adminAuditLogs).values([
      { ...base, action: "manager.suspend", targetUserId: "m1" },
      { ...base, action: "manager.reactivate", targetUserId: "m1" },
      { ...base, action: "manager.suspend", targetUserId: "m2" },
    ]);
    const token = tokenFor(admin);

    const parAction = await request(app)
      .get("/api/admin/audit-logs")
      .query({ action: "manager.suspend" })
      .set(authHeader(token));
    expect(parAction.body.total).toBe(2);

    const parCible = await request(app).get("/api/admin/audit-logs").query({ targetUserId: "m1" }).set(authHeader(token));
    expect(parCible.body.total).toBe(2);

    const les2 = await request(app)
      .get("/api/admin/audit-logs")
      .query({ targetUserId: "m1", action: "manager.reactivate" })
      .set(authHeader(token));
    expect(les2.body.total).toBe(1);
  });

  it("rejette une action inconnue au lieu de l'ignorer", async () => {
    const admin = await createAdmin();
    const res = await request(app).get("/api/admin/audit-logs").query({ action: "n.importe.quoi" }).set(authHeader(tokenFor(admin)));
    expect(res.status).toBe(400);
  });

  it("n'expose pas l'identifiant interne du compte administrateur", async () => {
    const admin = await createAdmin();
    await testDb.insert(adminAuditLogs).values({ adminId: admin.id, adminEmail: admin.email, action: "manager.suspend" });
    const res = await request(app).get("/api/admin/audit-logs").set(authHeader(tokenFor(admin)));
    expect(res.body.items[0]).not.toHaveProperty("adminId");
  });
});
