import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { tenants } from "../db/schema";
import { authHeader, createManager, createTenant, createTenantPortalUser, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Les e-mails destinés à un locataire (avis d'échéance, rappels, relances, quittance) partent sans qu'il fasse de
 * requête : la langue doit donc être enregistrée sur sa fiche. Elle vient du gestionnaire qui la crée (par défaut la
 * langue de son interface), puis suit le locataire quand il se connecte à son portail.
 */
const corps = (email: string, extra: Record<string, unknown> = {}) => ({
  firstName: "Zorglub",
  lastName: "Quenotte",
  phone: "+33699887766",
  email,
  ...extra,
});

const langueEnBase = async (id: string) => (await testDb.select().from(tenants).where(eq(tenants.id, id)))[0].language;

describe("langue d'un locataire — création de la fiche", () => {
  it("prend la langue choisie par le gestionnaire", async () => {
    const manager = await createManager({});
    const res = await request(app).post("/api/tenants").set(authHeader(tokenFor(manager))).send(corps("a-en@test.local", { language: "en" }));

    expect(res.status).toBe(201);
    expect(res.body.language).toBe("en");
    expect(await langueEnBase(res.body.id)).toBe("en");
  });

  it("à défaut, la langue de l'interface du gestionnaire (Accept-Language)", async () => {
    const manager = await createManager({});
    const res = await request(app).post("/api/tenants").set(authHeader(tokenFor(manager))).set("Accept-Language", "pt-BR").send(corps("a-pt@test.local"));

    expect(res.status).toBe(201);
    expect(await langueEnBase(res.body.id)).toBe("pt");
  });

  it("le choix explicite l'emporte sur la langue de l'interface", async () => {
    const manager = await createManager({});
    const res = await request(app).post("/api/tenants").set(authHeader(tokenFor(manager))).set("Accept-Language", "pt").send(corps("a-es@test.local", { language: "es" }));

    expect(await langueEnBase(res.body.id)).toBe("es");
  });

  it("sans rien, le français", async () => {
    const manager = await createManager({});
    const res = await request(app).post("/api/tenants").set(authHeader(tokenFor(manager))).send(corps("a-fr@test.local"));

    expect(await langueEnBase(res.body.id)).toBe("fr");
  });

  it("refuse une langue que l'application ne gère pas", async () => {
    const manager = await createManager({});
    const res = await request(app).post("/api/tenants").set(authHeader(tokenFor(manager))).send(corps("a-de@test.local", { language: "de" }));

    expect(res.status).toBe(400);
  });
});

describe("langue d'un locataire — modification de la fiche", () => {
  it("le gestionnaire peut la changer", async () => {
    const manager = await createManager({});
    const tenant = await createTenant(manager.id, {});

    const res = await request(app).put(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(manager))).send({ language: "es" });

    expect(res.status).toBe(200);
    expect(await langueEnBase(tenant.id)).toBe("es");
  });

  it("une modification sans langue la laisse telle quelle", async () => {
    const manager = await createManager({});
    const tenant = await createTenant(manager.id, {});
    await testDb.update(tenants).set({ language: "pt" }).where(eq(tenants.id, tenant.id));

    const res = await request(app).put(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(manager))).set("Accept-Language", "en").send({ firstName: "Nouveau" });

    expect(res.status).toBe(200);
    expect(await langueEnBase(tenant.id)).toBe("pt");
  });

  it("la liste des locataires la renvoie", async () => {
    const manager = await createManager({});
    const tenant = await createTenant(manager.id, {});
    await testDb.update(tenants).set({ language: "en" }).where(eq(tenants.id, tenant.id));

    const res = await request(app).get("/api/tenants").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items.find((t: { id: string }) => t.id === tenant.id).language).toBe("en");
  });
});

describe("langue d'un locataire — connexion au portail", () => {
  async function locataireAvecCompte(language: string | null) {
    const manager = await createManager({});
    const tenant = await createTenant(manager.id, {});
    await testDb.update(tenants).set({ language }).where(eq(tenants.id, tenant.id));
    const user = await createTenantPortalUser(tenant);
    return { tenant, user };
  }
  const connexion = (email: string, langue: string | null, mdp = "Password123!") => {
    const r = request(app).post("/api/auth/login");
    return (langue ? r.set("Accept-Language", langue) : r).send({ email, password: mdp });
  };

  it("la fiche prend la langue dans laquelle le locataire utilise l'application", async () => {
    const { tenant, user } = await locataireAvecCompte("fr");

    const res = await connexion(user.email, "en");

    expect(res.status).toBe(200);
    expect(await langueEnBase(tenant.id)).toBe("en");
  });

  it("ça vaut aussi pour une fiche encore sans langue (locataires d'avant)", async () => {
    const { tenant, user } = await locataireAvecCompte(null);

    await connexion(user.email, "es");

    expect(await langueEnBase(tenant.id)).toBe("es");
  });

  it("une connexion refusée ne change rien", async () => {
    const { tenant, user } = await locataireAvecCompte("fr");

    const res = await connexion(user.email, "en", "mauvais-mot-de-passe");

    expect(res.status).toBe(401);
    expect(await langueEnBase(tenant.id)).toBe("fr");
  });

  it("sans langue dans la requête, la fiche garde la sienne", async () => {
    const { tenant, user } = await locataireAvecCompte("pt");

    await connexion(user.email, null);

    // Sans en-tête le serveur lit « français » : il ne l'enregistre que pour une fiche sans langue.
    expect(await langueEnBase(tenant.id)).toBe("pt");
  });
});
