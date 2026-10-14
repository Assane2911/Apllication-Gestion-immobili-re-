import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs } from "../db/schema";
import { authHeader, createManager, tokenFor,
  createPortalUser,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

async function createActivityLog(
  managerId: string,
  overrides: Partial<typeof activityLogs.$inferInsert> = {}
) {
  const [row] = await testDb
    .insert(activityLogs)
    .values({
      managerId,
      actorLabel: "Gestionnaire (test@test.local)",
      action: "property.create",
      entityType: "property",
      entityId: "prop-1",
      entityLabel: "Studio Centre-ville",
      ...overrides,
    })
    .returning();
  return row;
}

describe("GET /api/activity-log", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/activity-log");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app)
      .get("/api/activity-log")
      .set(authHeader(tokenFor(await createPortalUser("TENANT"), "tenant-1")));
    expect(res.status).toBe(403);
  });

  it("renvoie uniquement les entrées du gestionnaire connecté", async () => {
    const manager = await createManager();
    const otherManager = await createManager();
    await createActivityLog(manager.id, { entityLabel: "Mon bien" });
    await createActivityLog(otherManager.id, { entityLabel: "Bien d'un autre" });

    const res = await request(app).get("/api/activity-log").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].entityLabel).toBe("Mon bien");
  });

  it("filtre par entityType", async () => {
    const manager = await createManager();
    await createActivityLog(manager.id, { entityType: "property", entityLabel: "Un bien" });
    await createActivityLog(manager.id, { entityType: "tenant", entityLabel: "Un locataire" });

    const res = await request(app)
      .get("/api/activity-log")
      .query({ entityType: "tenant" })
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].entityType).toBe("tenant");
  });

  it("filtre par entityId", async () => {
    const manager = await createManager();
    await createActivityLog(manager.id, { entityId: "prop-1", entityLabel: "Bien A" });
    await createActivityLog(manager.id, { entityId: "prop-2", entityLabel: "Bien B" });

    const res = await request(app)
      .get("/api/activity-log")
      .query({ entityId: "prop-2" })
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].entityLabel).toBe("Bien B");
  });

  it("trie les entrées de la plus récente à la plus ancienne", async () => {
    const manager = await createManager();
    const older = await createActivityLog(manager.id, { entityLabel: "Ancienne action" });
    await testDb
      .update(activityLogs)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(activityLogs.id, older.id));
    await createActivityLog(manager.id, { entityLabel: "Action récente" });

    const res = await request(app).get("/api/activity-log").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items[0].entityLabel).toBe("Action récente");
    expect(res.body.items[1].entityLabel).toBe("Ancienne action");
  });

  it("pagine le journal au lieu de s'arrêter aux 200 dernières entrées", async () => {
    const manager = await createManager();
    const autre = await createManager();
    const base = Date.now();
    await testDb.insert(activityLogs).values(
      Array.from({ length: 250 }, (_, i) => ({
        managerId: manager.id,
        actorLabel: "Gestionnaire",
        action: "property.create",
        entityType: "property",
        entityId: "prop-1",
        entityLabel: `Action ${i}`,
        createdAt: new Date(base - i * 1000),
      }))
    );
    await createActivityLog(autre.id, { entityLabel: "Bien d'un autre" });

    const page1 = await request(app).get("/api/activity-log").query({ pageSize: 100 }).set(authHeader(tokenFor(manager)));
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(100);
    expect(page1.body.total).toBe(250);
    expect(page1.body.totalPages).toBe(3);
    expect(page1.body.items[0].entityLabel).toBe("Action 0");

    const page3 = await request(app).get("/api/activity-log").query({ pageSize: 100, page: 3 }).set(authHeader(tokenFor(manager)));
    expect(page3.body.items).toHaveLength(50);
    // La plus ancienne entrée, qu'aucune limite de 200 ne laissait atteindre.
    expect(page3.body.items[49].entityLabel).toBe("Action 249");
  });

  it("garde un ordre stable entre les pages quand des entrées partagent le même instant", async () => {
    const manager = await createManager();
    const instant = new Date();
    await testDb.insert(activityLogs).values(
      Array.from({ length: 5 }, (_, i) => ({
        managerId: manager.id,
        actorLabel: "Gestionnaire",
        action: "property.create",
        entityType: "property",
        entityId: "prop-1",
        entityLabel: `Simultanée ${i}`,
        createdAt: instant,
      }))
    );

    const vus = new Set<string>();
    for (const page of [1, 2, 3]) {
      const res = await request(app).get("/api/activity-log").query({ pageSize: 2, page }).set(authHeader(tokenFor(manager)));
      for (const e of res.body.items) vus.add(e.id);
    }
    expect(vus.size).toBe(5);
  });
});
