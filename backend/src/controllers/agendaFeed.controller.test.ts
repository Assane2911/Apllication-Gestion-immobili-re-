import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { agendaFeeds, users } from "../db/schema";
import { agendaFeedLimiterStore } from "../middleware/rateLimit";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 5, 15, 8, 0, 0));
  await agendaFeedLimiterStore.resetAll();
});
afterEach(() => vi.useRealTimers());

type Compte = Awaited<ReturnType<typeof createManager>>;

async function agenceAvecLoyer(titre = "Villa Baobab") {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: titre });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
  const contract = await createContract(property.id, tenant.id, { startDate: new Date(2026, 0, 1), endDate: new Date(2027, 0, 1) });
  await createInvoice(contract.id, { dueDate: new Date(2026, 5, 20), amount: 500, amountPaid: 200 });
  return { manager, property, tenant, contract };
}

const creerLien = (manager: Compte) => request(app).post("/api/agenda/feed").set(authHeader(tokenFor(manager)));
const lireEtat = (manager: Compte) => request(app).get("/api/agenda/feed").set(authHeader(tokenFor(manager)));
const lireFlux = (token: string) => request(app).get(`/api/agenda/ics/${token}.ics`);

describe("POST /api/agenda/feed", () => {
  it("crée le lien, renvoie le jeton une seule fois et n'en garde que l'empreinte", async () => {
    const { manager } = await agenceAvecLoyer();

    const res = await creerLien(manager);

    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.path).toBe(`/agenda/ics/${res.body.token}.ics`);
    const [ligne] = await testDb.select().from(agendaFeeds).where(eq(agendaFeeds.managerId, manager.id));
    expect(ligne.tokenHash).toBeTruthy();
    expect(ligne.tokenHash).not.toContain(res.body.token);
    expect(JSON.stringify(ligne)).not.toContain(res.body.token);

    // L'état, lui, ne redonne jamais le jeton.
    const etat = await lireEtat(manager);
    expect(etat.body).toMatchObject({ active: true, lastUsedAt: null });
    expect(JSON.stringify(etat.body)).not.toContain(res.body.token);
  });

  it("refuse sans session", async () => {
    expect((await request(app).post("/api/agenda/feed")).status).toBe(401);
    expect((await request(app).get("/api/agenda/feed")).status).toBe(401);
    expect((await request(app).delete("/api/agenda/feed")).status).toBe(401);
  });

  it("régénérer remplace le lien : l'ancien cesse de fonctionner, le nouveau fonctionne", async () => {
    const { manager } = await agenceAvecLoyer();
    const ancien = (await creerLien(manager)).body.token as string;
    expect((await lireFlux(ancien)).status).toBe(200);

    const nouveau = (await creerLien(manager)).body.token as string;

    expect(nouveau).not.toBe(ancien);
    expect((await lireFlux(ancien)).status).toBe(404);
    expect((await lireFlux(nouveau)).status).toBe(200);
    expect(await testDb.select().from(agendaFeeds)).toHaveLength(1);
  });
});

describe("DELETE /api/agenda/feed", () => {
  it("désactive le lien : le flux répond 404 et l'état redevient inactif", async () => {
    const { manager } = await agenceAvecLoyer();
    const token = (await creerLien(manager)).body.token as string;

    const res = await request(app).delete("/api/agenda/feed").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    expect((await lireFlux(token)).status).toBe(404);
    expect((await lireEtat(manager)).body).toMatchObject({ active: false, createdAt: null, lastUsedAt: null });
  });
});

describe("GET /api/agenda/ics/:jeton.ics", () => {
  it("sert le calendrier de l'agence au format iCal, sans session, avec ses échéances", async () => {
    const { manager } = await agenceAvecLoyer();
    const token = (await creerLien(manager)).body.token as string;

    const res = await lireFlux(token);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/calendar; charset=utf-8/);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.text).toContain("BEGIN:VCALENDAR");
    expect(res.text).toContain("SUMMARY:Loyer dû — Villa Baobab — Awa Sow");
    expect(res.text).toContain("DTSTART;VALUE=DATE:20260620");
    expect(res.text).toContain("DESCRIPTION:Reste dû : ");
  });

  it("n'expose rien d'une autre agence", async () => {
    const a = await agenceAvecLoyer("Bien de A");
    const b = await agenceAvecLoyer("Bien de B");
    const tokenA = (await creerLien(a.manager)).body.token as string;
    const tokenB = (await creerLien(b.manager)).body.token as string;

    const flux = (await lireFlux(tokenA)).text;
    expect(flux).toContain("Bien de A");
    expect(flux).not.toContain("Bien de B");
    expect((await lireFlux(tokenB)).text).not.toContain("Bien de A");
  });

  it("répond la même 404 à un jeton inconnu, mal formé ou sans extension .ics", async () => {
    const { manager } = await agenceAvecLoyer();
    const token = (await creerLien(manager)).body.token as string;
    const inconnu = "A".repeat(43);

    for (const chemin of [`/api/agenda/ics/${inconnu}.ics`, "/api/agenda/ics/trop-court.ics", `/api/agenda/ics/${token}`, "/api/agenda/ics/.ics"]) {
      const res = await request(app).get(chemin);
      expect(res.status).toBe(404);
      expect(res.text).toBe("Not found");
    }
  });

  it("répond 404 pour une agence suspendue, puis sert de nouveau le calendrier à la réactivation", async () => {
    const { manager } = await agenceAvecLoyer();
    const token = (await creerLien(manager)).body.token as string;

    await testDb.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, manager.id));
    expect((await lireFlux(token)).status).toBe(404);

    await testDb.update(users).set({ suspendedAt: null }).where(eq(users.id, manager.id));
    expect((await lireFlux(token)).status).toBe(200);
  });

  it("répond 404 quand l'essai ou l'abonnement est échu : le lien ne contourne pas l'accès payant", async () => {
    const { manager } = await agenceAvecLoyer();
    const token = (await creerLien(manager)).body.token as string;

    await testDb.update(users).set({ trialEndsAt: new Date(2026, 5, 1) }).where(eq(users.id, manager.id));

    expect((await lireFlux(token)).status).toBe(404);
  });

  it("note la dernière lecture, au plus une fois par heure", async () => {
    const { manager } = await agenceAvecLoyer();
    const token = (await creerLien(manager)).body.token as string;
    expect((await lireEtat(manager)).body.lastUsedAt).toBeNull();

    await lireFlux(token);
    const premiere = (await lireEtat(manager)).body.lastUsedAt as string;
    expect(premiere).toBeTruthy();

    vi.setSystemTime(new Date(2026, 5, 15, 8, 20, 0));
    await lireFlux(token);
    expect((await lireEtat(manager)).body.lastUsedAt).toBe(premiere);

    vi.setSystemTime(new Date(2026, 5, 15, 9, 30, 0));
    await lireFlux(token);
    expect((await lireEtat(manager)).body.lastUsedAt).not.toBe(premiere);
  });

  it("limite les essais ratés par adresse, sans jamais gêner un calendrier légitime", async () => {
    const { manager } = await agenceAvecLoyer();
    const token = (await creerLien(manager)).body.token as string;

    // Un calendrier légitime relit son lien autant de fois qu'il veut.
    for (let i = 0; i < 35; i++) expect((await lireFlux(token)).status).toBe(200);

    const inconnu = "B".repeat(43);
    for (let i = 0; i < 30; i++) expect((await lireFlux(inconnu)).status).toBe(404);
    expect((await lireFlux(inconnu)).status).toBe(429);
  });
});

describe("PUT /api/agenda/feed — sans noms de locataires", () => {
  const regler = (manager: Compte, corps: unknown) => request(app).put("/api/agenda/feed").set(authHeader(tokenFor(manager))).send(corps as object);

  it("retire le nom du locataire du calendrier, en gardant le bien et le type d'échéance, et le remet à la demande", async () => {
    const { manager } = await agenceAvecLoyer();
    const token = (await creerLien(manager)).body.token as string;
    expect((await lireFlux(token)).text).toContain("Awa Sow");

    const masque = await regler(manager, { hideTenantNames: true });
    expect(masque.status).toBe(200);
    expect(masque.body).toMatchObject({ active: true, hideTenantNames: true });
    const sans = (await lireFlux(token)).text;
    expect(sans).not.toContain("Awa");
    expect(sans).not.toContain("Sow");
    expect(sans).toContain("SUMMARY:Loyer dû — Villa Baobab");

    expect((await regler(manager, { hideTenantNames: false })).body.hideTenantNames).toBe(false);
    expect((await lireFlux(token)).text).toContain("Awa Sow");
  });

  it("garde le réglage quand on régénère le lien, et l'annonce dans la réponse et dans l'état", async () => {
    const { manager } = await agenceAvecLoyer();
    await creerLien(manager);
    await regler(manager, { hideTenantNames: true });

    const nouveau = await creerLien(manager);

    expect(nouveau.body.hideTenantNames).toBe(true);
    expect((await lireEtat(manager)).body.hideTenantNames).toBe(true);
    expect((await lireFlux(nouveau.body.token)).text).not.toContain("Awa Sow");
  });

  it("par défaut, les noms figurent au calendrier", async () => {
    const { manager } = await agenceAvecLoyer();
    const res = await creerLien(manager);
    expect(res.body.hideTenantNames).toBe(false);
    expect((await lireFlux(res.body.token)).text).toContain("Awa Sow");
  });

  it("ne crée aucun lien quand il n'y en a pas, et renvoie l'état inactif", async () => {
    const { manager } = await agenceAvecLoyer();

    const res = await regler(manager, { hideTenantNames: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ active: false, hideTenantNames: false });
    expect(await testDb.select().from(agendaFeeds)).toHaveLength(0);
  });

  it("refuse une valeur qui n'est pas un booléen, et l'absence de session", async () => {
    const { manager } = await agenceAvecLoyer();
    await creerLien(manager);
    expect((await regler(manager, { hideTenantNames: "oui" })).status).toBe(400);
    expect((await regler(manager, {})).status).toBe(400);
    expect((await request(app).put("/api/agenda/feed").send({ hideTenantNames: true })).status).toBe(401);
  });

  it("ne touche que le lien de sa propre agence", async () => {
    const a = await agenceAvecLoyer("Bien de A");
    const b = await agenceAvecLoyer("Bien de B");
    const tokenB = (await creerLien(b.manager)).body.token as string;
    await creerLien(a.manager);

    await regler(a.manager, { hideTenantNames: true });

    expect((await lireEtat(b.manager)).body.hideTenantNames).toBe(false);
    expect((await lireFlux(tokenB)).text).toContain("Awa Sow");
  });
});

