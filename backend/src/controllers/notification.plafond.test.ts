import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { contracts, invoices, properties, tenants } from "../db/schema";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { NOTIFICATIONS_MAX } from "./notification.controller";

/**
 * La liste de la cloche est plafonnée (NOTIFICATIONS_MAX) : sur un grand portefeuille elle dépassait 360 Ko, relus toutes les
 * 30 s par chaque onglet ouvert. Les compteurs (badge, « à traiter ») restent EXACTS, les éléments à traiter passent avant les
 * éléments lus, et « tout marquer comme vu / lu » sans liste de clés couvre aussi ce que le panneau ne montre pas.
 */
const TOTAL = NOTIFICATIONS_MAX + 20;

async function agenceEnRetard(nombre: number) {
  const manager = await createManager();
  const ids = Array.from({ length: nombre }, (_, i) => i);
  await testDb.insert(properties).values(ids.map((i) => ({ id: `${manager.id}-p${i}`, managerId: manager.id, title: `Bien ${i}`, address: "1 rue du Test", surface: 40, rent: 500 })));
  await testDb.insert(tenants).values(ids.map((i) => ({ id: `${manager.id}-t${i}`, managerId: manager.id, firstName: "Jean", lastName: `Nom${i}`, phone: "060000", email: `${manager.id}-t${i}@x.test` })));
  await testDb.insert(contracts).values(
    ids.map((i) => ({ id: `${manager.id}-c${i}`, propertyId: `${manager.id}-p${i}`, tenantId: `${manager.id}-t${i}`, rent: 500, deposit: 0, startDate: new Date(Date.UTC(2020, 0, 1)), endDate: new Date(Date.UTC(2090, 0, 1)), status: "ACTIVE" as const }))
  );
  // Une échéance en retard par bail, de plus en plus récente : l'ordre attendu est connu.
  await testDb.insert(invoices).values(
    ids.map((i) => ({ contractId: `${manager.id}-c${i}`, periodMonth: 1, periodYear: 2024, amount: 500, dueDate: new Date(Date.UTC(2024, 0, 1) + i * 86400000), status: "LATE" as const }))
  );
  return { manager, auth: authHeader(tokenFor(manager)) };
}

describe("GET /api/notifications : plafond de la liste", () => {
  it("plafonne la liste mais garde les compteurs exacts, les plus récentes en tête", async () => {
    const { auth } = await agenceEnRetard(TOTAL);

    const res = await request(app).get("/api/notifications").set(auth);

    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(NOTIFICATIONS_MAX);
    expect(res.body.count).toBe(TOTAL);
    expect(res.body.unseenCount).toBe(TOTAL);
    expect(res.body.unreadCount).toBe(TOTAL);
    const dates = res.body.notifications.map((n: { createdAt: string }) => n.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);
    // La plus récente (dernier bail créé) est bien dans la liste, la plus ancienne non.
    expect(res.body.notifications[0].title).toContain(`Nom${TOTAL - 1}`);
    expect(JSON.stringify(res.body.notifications)).not.toContain("Nom0 ");
  });

  it("« tout marquer comme lu » sans clés couvre aussi les notifications non affichées", async () => {
    const { auth } = await agenceEnRetard(TOTAL);

    expect((await request(app).post("/api/notifications/read").set(auth).send({})).status).toBe(200);
    const apres = await request(app).get("/api/notifications").set(auth);

    expect(apres.body.count).toBe(TOTAL);
    expect(apres.body.unreadCount).toBe(0);
    expect(apres.body.unseenCount).toBe(0);
    // Tout est lu : la liste est toujours plafonnée, et ne contient que des éléments lus.
    expect(apres.body.notifications).toHaveLength(NOTIFICATIONS_MAX);
    expect(apres.body.notifications.every((n: { read: boolean }) => n.read)).toBe(true);
  });

  it("les éléments à traiter passent avant les éléments lus", async () => {
    const { auth } = await agenceEnRetard(TOTAL);
    // Lit les 30 plus récentes seulement (clés envoyées par la cloche).
    const premiere = await request(app).get("/api/notifications").set(auth);
    const cles = premiere.body.notifications.slice(0, 30).map((n: { key: string }) => n.key);
    await request(app).post("/api/notifications/read").set(auth).send({ keys: cles });

    const res = await request(app).get("/api/notifications").set(auth);

    expect(res.body.unreadCount).toBe(TOTAL - 30);
    const aTraiter = res.body.notifications.filter((n: { read: boolean }) => !n.read);
    // Les 90 à traiter sont toutes là ; les éléments lus ne comblent que les 10 places restantes.
    expect(aTraiter).toHaveLength(TOTAL - 30);
    expect(res.body.notifications).toHaveLength(NOTIFICATIONS_MAX);
  });
});
