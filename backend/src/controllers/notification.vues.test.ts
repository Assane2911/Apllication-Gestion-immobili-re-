import request from "supertest";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { invoices, messages, notificationVues, users } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  createTenantPortalUser,
  tokenCollaborateur,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

type Notif = { id: string; key: string; seen: boolean; type: string };

/** Gestionnaire avec une facture en retard : une notification « à traiter ». */
async function gestionnaireAvecFactureEnRetard() {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  const invoice = await createInvoice(contract.id, { status: "LATE" });
  return { manager, property, tenant, contract, invoice, header: authHeader(tokenFor(manager)) };
}

/** Un autre bail de la même agence, lui aussi en retard : une seconde notification, indépendante de la première. */
async function autreBailEnRetard(managerId: string) {
  const property = await createProperty(managerId);
  const tenant = await createTenant(managerId);
  const contract = await createContract(property.id, tenant.id);
  await createInvoice(contract.id, { status: "LATE", periodMonth: 1, dueDate: new Date("2026-01-05T00:00:00Z") });
}

const lire = (header: Record<string, string>) => request(app).get("/api/notifications").set(header);
const marquerVues = (header: Record<string, string>, body?: object) =>
  request(app).post("/api/notifications/seen").set(header).send(body);

describe("état « vu » des notifications du gestionnaire", () => {
  it("expose une clé et un état « vu » par notification, et le nombre de nouveautés", async () => {
    const { header, invoice } = await gestionnaireAvecFactureEnRetard();

    const res = await lire(header);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.unseenCount).toBe(1);
    expect(res.body.notifications[0]).toMatchObject({ id: `invoice-${invoice.id}`, seen: false });
    expect(res.body.notifications[0].key).toContain(`invoice-${invoice.id}`);
  });

  it("ramène les nouveautés à 0 une fois vues, sans retirer l'élément encore à traiter de la liste", async () => {
    const { header } = await gestionnaireAvecFactureEnRetard();

    const vue = await marquerVues(header);
    expect(vue.status).toBe(200);

    const res = await lire(header);
    expect(res.body.unseenCount).toBe(0);
    // Une facture impayée reste un vrai sujet : elle est toujours listée, simplement plus « nouvelle ».
    expect(res.body.count).toBe(1);
    expect(res.body.notifications[0].seen).toBe(true);
  });

  it("garde l'état d'une session à l'autre (persisté en base, pas dans le navigateur)", async () => {
    const { manager, header } = await gestionnaireAvecFactureEnRetard();
    await marquerVues(header);

    // Autre appareil : nouveau jeton du même compte.
    const res = await lire(authHeader(tokenFor(manager)));

    expect(res.body.unseenCount).toBe(0);
  });

  it("redevient une nouveauté quand un nouvel événement arrive, et seulement celui-là", async () => {
    const { header, manager } = await gestionnaireAvecFactureEnRetard();
    await marquerVues(header);

    await autreBailEnRetard(manager.id);

    const res = await lire(header);
    expect(res.body.count).toBe(2);
    expect(res.body.unseenCount).toBe(1);
    expect(res.body.notifications.filter((n: Notif) => !n.seen)).toHaveLength(1);
  });

  it("un nouveau message d'un locataire déjà signalé et vu redevient une nouveauté", async () => {
    const { manager, tenant, contract, header } = await gestionnaireAvecFactureEnRetard();
    const portail = await createTenantPortalUser(tenant);
    await testDb.insert(messages).values({
      contractId: contract.id,
      senderId: portail.id,
      senderRole: "TENANT",
      content: "Premier message",
      isRead: false,
      createdAt: new Date("2026-10-01T10:00:00Z"),
    });
    await marquerVues(header);
    expect((await lire(header)).body.unseenCount).toBe(0);

    await testDb.insert(messages).values({
      contractId: contract.id,
      senderId: portail.id,
      senderRole: "TENANT",
      content: "Deuxième message",
      isRead: false,
      createdAt: new Date("2026-10-02T10:00:00Z"),
    });

    const res = await lire(header);
    const message = res.body.notifications.find((n: Notif) => n.type === "message");
    expect(message.seen).toBe(false);
    expect(res.body.unseenCount).toBe(1);
    expect(manager.id).toBeTruthy();
  });

  it("ne marque que les notifications dont la clé est fournie (celles que la personne avait sous les yeux)", async () => {
    const { header, manager } = await gestionnaireAvecFactureEnRetard();
    await autreBailEnRetard(manager.id);
    const avant = await lire(header);
    const [premiere] = avant.body.notifications as Notif[];

    await marquerVues(header, { keys: [premiere.key] });

    const res = await lire(header);
    expect(res.body.unseenCount).toBe(1);
    expect(res.body.notifications.find((n: Notif) => n.key === premiere.key).seen).toBe(true);
  });

  it("ignore une clé inventée : le client ne peut rien inscrire d'autre que des notifications réelles", async () => {
    const { manager, header } = await gestionnaireAvecFactureEnRetard();

    const res = await marquerVues(header, { keys: ["invoice-inexistante|2026-01-01T00:00:00.000Z", "n'importe quoi"] });

    expect(res.status).toBe(200);
    expect(await testDb.select().from(notificationVues).where(eq(notificationVues.userId, manager.id))).toHaveLength(0);
    expect((await lire(header)).body.unseenCount).toBe(1);
  });

  it("rejette un corps invalide (400)", async () => {
    const { header } = await gestionnaireAvecFactureEnRetard();
    expect((await marquerVues(header, { keys: "pas-une-liste" })).status).toBe(400);
    expect((await marquerVues(header, { keys: Array.from({ length: 5001 }, (_, i) => `k${i}`) })).status).toBe(400);
  });

  it("purge les lignes devenues sans objet (facture payée) pour que la table ne grossisse pas", async () => {
    const { manager, header, invoice } = await gestionnaireAvecFactureEnRetard();
    await marquerVues(header);
    expect(await testDb.select().from(notificationVues).where(eq(notificationVues.userId, manager.id))).toHaveLength(1);

    await testDb.update(invoices).set({ status: "PAID" }).where(eq(invoices.id, invoice.id));
    await marquerVues(header);

    expect(await testDb.select().from(notificationVues).where(eq(notificationVues.userId, manager.id))).toHaveLength(0);
  });

  it("marquer deux fois de suite est sans effet (idempotent)", async () => {
    const { manager, header } = await gestionnaireAvecFactureEnRetard();
    expect((await marquerVues(header)).status).toBe(200);
    expect((await marquerVues(header)).status).toBe(200);
    expect(await testDb.select().from(notificationVues).where(eq(notificationVues.userId, manager.id))).toHaveLength(1);
  });

  it("isole l'état par gestionnaire", async () => {
    const { header } = await gestionnaireAvecFactureEnRetard();
    const autre = await gestionnaireAvecFactureEnRetard();
    await marquerVues(header);

    expect((await lire(autre.header)).body.unseenCount).toBe(1);
  });

  it("donne à un collaborateur son propre état, distinct de celui du propriétaire", async () => {
    const { manager, header } = await gestionnaireAvecFactureEnRetard();
    const collaborateur = authHeader(await tokenCollaborateur(manager));
    expect((await lire(collaborateur)).body.unseenCount).toBe(1);

    // Le propriétaire ouvre la cloche : le collaborateur a toujours la nouveauté devant lui.
    await marquerVues(header);
    expect((await lire(header)).body.unseenCount).toBe(0);
    expect((await lire(collaborateur)).body.unseenCount).toBe(1);

    // Et réciproquement.
    await marquerVues(collaborateur);
    expect((await lire(collaborateur)).body.unseenCount).toBe(0);
    expect(await testDb.select().from(notificationVues)).toHaveLength(2);
  });

  it("supprime l'état avec le compte (clé étrangère en cascade)", async () => {
    const manager = await createManager();
    await testDb.insert(notificationVues).values({ userId: manager.id, cle: "invoice-x|2026-01-01T00:00:00.000Z" });
    expect(await testDb.select().from(notificationVues)).toHaveLength(1);

    await testDb.delete(users).where(eq(users.id, manager.id));

    expect(await testDb.select().from(notificationVues)).toHaveLength(0);
  });

  it("exige l'authentification et le rôle gestionnaire", async () => {
    const { tenant } = await gestionnaireAvecFactureEnRetard();
    const portail = await createTenantPortalUser(tenant);

    expect((await request(app).post("/api/notifications/seen")).status).toBe(401);
    const locataire = authHeader(tokenFor(portail, tenant.id));
    expect((await marquerVues(locataire)).status).toBe(403);
  });
});

describe("état « vu » des notifications du locataire (/mine)", () => {
  async function locataireEnRetard() {
    const { tenant, manager } = await gestionnaireAvecFactureEnRetard();
    const portail = await createTenantPortalUser(tenant);
    return { manager, tenant, header: authHeader(tokenFor(portail, tenant.id)) };
  }
  const lireMine = (header: Record<string, string>) => request(app).get("/api/notifications/mine").set(header);

  it("fonctionne comme côté gestionnaire : vu → plus de nouveauté, élément toujours listé", async () => {
    const { header } = await locataireEnRetard();
    const avant = await lireMine(header);
    expect(avant.body.unseenCount).toBe(1);

    const vue = await request(app).post("/api/notifications/mine/seen").set(header).send({});
    expect(vue.status).toBe(200);

    const apres = await lireMine(header);
    expect(apres.body.unseenCount).toBe(0);
    expect(apres.body.count).toBe(1);
    expect(apres.body.notifications[0].seen).toBe(true);
  });

  it("refuse un gestionnaire et un compte sans fiche locataire", async () => {
    const { manager } = await locataireEnRetard();
    expect((await request(app).post("/api/notifications/mine/seen").set(authHeader(tokenFor(manager)))).status).toBe(403);
  });
});

describe("« Tout marquer comme lu » (gestionnaire)", () => {
  const marquerLues = (header: Record<string, string>, body?: object) =>
    request(app).post("/api/notifications/read").set(header).send(body);

  it("expose l'état « lu » et le nombre d'éléments non lus", async () => {
    const { header } = await gestionnaireAvecFactureEnRetard();

    const res = await lire(header);

    expect(res.body.notifications[0].read).toBe(false);
    expect(res.body.unreadCount).toBe(1);
  });

  it("écarte les notifications du panneau (lues) et éteint le badge, sans changer le total", async () => {
    const { header } = await gestionnaireAvecFactureEnRetard();

    expect((await marquerLues(header)).status).toBe(200);

    const res = await lire(header);
    expect(res.body.count).toBe(1);
    expect(res.body.notifications[0]).toMatchObject({ read: true, seen: true });
    expect(res.body.unreadCount).toBe(0);
    expect(res.body.unseenCount).toBe(0);
  });

  it("garde l'état d'un appareil à l'autre, et un nouvel événement reste non lu", async () => {
    const { manager, header } = await gestionnaireAvecFactureEnRetard();
    await marquerLues(header);

    await autreBailEnRetard(manager.id);

    const res = await lire(authHeader(tokenFor(manager)));
    expect(res.body.count).toBe(2);
    expect(res.body.unreadCount).toBe(1);
    expect(res.body.notifications.filter((n: { read: boolean }) => n.read)).toHaveLength(1);
  });

  it("n'efface pas une lecture quand l'ouverture de la cloche marque « vue » ensuite", async () => {
    const { header } = await gestionnaireAvecFactureEnRetard();
    await marquerLues(header);

    await marquerVues(header);

    expect((await lire(header)).body.unreadCount).toBe(0);
  });

  it("complète une ligne déjà vue sans la dupliquer, et garde la première date de lecture", async () => {
    const { manager, header } = await gestionnaireAvecFactureEnRetard();
    await marquerVues(header);
    await marquerLues(header);
    const [premiere] = await testDb.select().from(notificationVues).where(eq(notificationVues.userId, manager.id));
    expect(premiere.readAt).toBeInstanceOf(Date);

    await new Promise((r) => setTimeout(r, 15));
    await marquerLues(header);

    const lignes = await testDb.select().from(notificationVues).where(eq(notificationVues.userId, manager.id));
    expect(lignes).toHaveLength(1);
    expect(lignes[0].readAt!.getTime()).toBe(premiere.readAt!.getTime());
  });

  it("ne marque lues que les clés fournies et ignore une clé inventée", async () => {
    const { manager, header } = await gestionnaireAvecFactureEnRetard();
    await autreBailEnRetard(manager.id);
    const [premiere] = (await lire(header)).body.notifications as Notif[];

    await marquerLues(header, { keys: [premiere.key, "invoice-inexistante|2026-01-01T00:00:00.000Z"] });

    const res = await lire(header);
    expect(res.body.unreadCount).toBe(1);
    expect(res.body.notifications.find((n: Notif) => n.key === premiere.key).read).toBe(true);
    expect(await testDb.select().from(notificationVues).where(eq(notificationVues.userId, manager.id))).toHaveLength(1);
  });

  it("rejette un corps invalide (400)", async () => {
    const { header } = await gestionnaireAvecFactureEnRetard();
    expect((await marquerLues(header, { keys: "pas-une-liste" })).status).toBe(400);
  });

  it("purge la ligne d'une notification devenue sans objet (facture payée)", async () => {
    const { manager, header, invoice } = await gestionnaireAvecFactureEnRetard();
    await marquerLues(header);
    await testDb.update(invoices).set({ status: "PAID" }).where(eq(invoices.id, invoice.id));

    await marquerLues(header);

    expect(await testDb.select().from(notificationVues).where(eq(notificationVues.userId, manager.id))).toHaveLength(0);
  });

  it("donne à un collaborateur son propre état « lu »", async () => {
    const { manager, header } = await gestionnaireAvecFactureEnRetard();
    const collaborateur = authHeader(await tokenCollaborateur(manager));

    await marquerLues(header);

    expect((await lire(header)).body.unreadCount).toBe(0);
    expect((await lire(collaborateur)).body.unreadCount).toBe(1);
  });

  it("exige l'authentification et le rôle gestionnaire", async () => {
    const { tenant } = await gestionnaireAvecFactureEnRetard();
    const portail = await createTenantPortalUser(tenant);

    expect((await request(app).post("/api/notifications/read")).status).toBe(401);
    expect((await marquerLues(authHeader(tokenFor(portail, tenant.id)))).status).toBe(403);
  });
});

describe("« Tout marquer comme lu » (locataire, /mine)", () => {
  it("écarte les notifications du panneau du locataire, sans toucher à celles du gestionnaire", async () => {
    const { tenant, manager, header: gestionnaire } = await gestionnaireAvecFactureEnRetard();
    const portail = await createTenantPortalUser(tenant);
    const locataire = authHeader(tokenFor(portail, tenant.id));

    const res = await request(app).post("/api/notifications/mine/read").set(locataire).send({});
    expect(res.status).toBe(200);

    const mine = await request(app).get("/api/notifications/mine").set(locataire);
    expect(mine.body.unreadCount).toBe(0);
    expect(mine.body.count).toBe(1);
    expect((await lire(gestionnaire)).body.unreadCount).toBe(1);
    expect(manager.id).toBeTruthy();
  });

  it("refuse un gestionnaire", async () => {
    const { header } = await gestionnaireAvecFactureEnRetard();
    expect((await request(app).post("/api/notifications/mine/read").set(header).send({})).status).toBe(403);
  });
});
