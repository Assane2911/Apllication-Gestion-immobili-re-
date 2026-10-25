import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { owners, users } from "../db/schema";
import * as emailService from "../services/email.service";
import { authHeader, createManager, createOwner, createOwnerPortalUser, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Les e-mails destinés à un propriétaire (reversement) ou à un gestionnaire (fin de contrat, assurance, parrainage)
 * partent sans requête de leur part : la langue est enregistrée — sur la fiche du propriétaire, sur le compte du
 * gestionnaire. Pour le gestionnaire, elle vient de la langue de son interface à l'inscription puis à chaque connexion.
 */
const corpsProprietaire = (email: string, extra: Record<string, unknown> = {}) => ({
  firstName: "Marta",
  lastName: "Neto",
  phone: "+33699887766",
  email,
  managementFeeRate: 8,
  ...extra,
});
const langueDuProprietaire = async (id: string) => (await testDb.select().from(owners).where(eq(owners.id, id)))[0].language;
const langueDuCompte = async (id: string) => (await testDb.select().from(users).where(eq(users.id, id)))[0].language;
const connexion = (email: string, langue: string | null, mdp = "Password123!") => {
  const r = request(app).post("/api/auth/login");
  return (langue ? r.set("Accept-Language", langue) : r).send({ email, password: mdp });
};

describe("langue d'un propriétaire — fiche", () => {
  it("prend la langue choisie par le gestionnaire", async () => {
    const manager = await createManager({});
    const res = await request(app).post("/api/owners").set(authHeader(tokenFor(manager))).send(corpsProprietaire("o-en@test.local", { language: "en" }));
    expect(res.status).toBe(201);
    expect(res.body.language).toBe("en");
    expect(await langueDuProprietaire(res.body.id)).toBe("en");
  });

  it("à défaut, la langue de l'interface du gestionnaire", async () => {
    const manager = await createManager({});
    const res = await request(app).post("/api/owners").set(authHeader(tokenFor(manager))).set("Accept-Language", "pt-BR").send(corpsProprietaire("o-pt@test.local"));
    expect(await langueDuProprietaire(res.body.id)).toBe("pt");
  });

  it("sans rien, le français ; une langue inconnue est refusée", async () => {
    const manager = await createManager({});
    const h = authHeader(tokenFor(manager));
    const defaut = await request(app).post("/api/owners").set(h).send(corpsProprietaire("o-fr@test.local"));
    expect(await langueDuProprietaire(defaut.body.id)).toBe("fr");
    const inconnue = await request(app).post("/api/owners").set(h).send(corpsProprietaire("o-de@test.local", { language: "de" }));
    expect(inconnue.status).toBe(400);
  });

  it("le gestionnaire peut la changer ; une modification sans langue la laisse telle quelle", async () => {
    const manager = await createManager({});
    const h = authHeader(tokenFor(manager));
    const owner = await createOwner(manager.id, {});
    await request(app).put(`/api/owners/${owner.id}`).set(h).send({ language: "es" });
    expect(await langueDuProprietaire(owner.id)).toBe("es");
    await request(app).put(`/api/owners/${owner.id}`).set(h).set("Accept-Language", "en").send({ firstName: "Autre" });
    expect(await langueDuProprietaire(owner.id)).toBe("es");
  });

  it("la liste des propriétaires la renvoie", async () => {
    const manager = await createManager({});
    const owner = await createOwner(manager.id, {});
    await testDb.update(owners).set({ language: "pt" }).where(eq(owners.id, owner.id));
    const res = await request(app).get("/api/owners").set(authHeader(tokenFor(manager)));
    expect(res.body.items.find((o: { id: string }) => o.id === owner.id).language).toBe("pt");
  });
});

describe("langue d'un propriétaire — connexion à son espace", () => {
  async function proprietaireAvecCompte(langue: string | null) {
    const manager = await createManager({});
    const owner = await createOwner(manager.id, {});
    await testDb.update(owners).set({ language: langue }).where(eq(owners.id, owner.id));
    const user = await createOwnerPortalUser(owner);
    return { owner, user };
  }

  it("la fiche prend la langue dans laquelle le propriétaire utilise l'application", async () => {
    const { owner, user } = await proprietaireAvecCompte("fr");
    const res = await connexion(user.email, "es");
    expect(res.status).toBe(200);
    expect(await langueDuProprietaire(owner.id)).toBe("es");
  });

  it("une connexion refusée, ou sans langue demandée, ne change rien", async () => {
    const { owner, user } = await proprietaireAvecCompte("pt");
    expect((await connexion(user.email, "en", "mauvais")).status).toBe(401);
    expect(await langueDuProprietaire(owner.id)).toBe("pt");
    await connexion(user.email, null);
    expect(await langueDuProprietaire(owner.id)).toBe("pt");
  });
});

describe("langue d'un gestionnaire — compte", () => {
  it("l'inscription l'enregistre, d'après la langue de l'interface", async () => {
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true });
    const res = await request(app).post("/api/auth/register").set("Accept-Language", "en").send({ email: "nouveau-en@test.local", password: "Password123!" });
    expect(res.status).toBe(201);
    const [compte] = await testDb.select().from(users).where(eq(users.email, "nouveau-en@test.local"));
    expect(compte.language).toBe("en");
    vi.restoreAllMocks();
  });

  it("la connexion la met à jour quand le gestionnaire change de langue", async () => {
    const manager = await createManager({ language: "fr" });
    const res = await connexion(manager.email, "pt");
    expect(res.status).toBe(200);
    expect(await langueDuCompte(manager.id)).toBe("pt");
  });

  it("un compte d'avant (sans langue) prend celle de sa première connexion", async () => {
    const manager = await createManager({});
    await connexion(manager.email, "es");
    expect(await langueDuCompte(manager.id)).toBe("es");
  });

  it("une connexion refusée, ou sans langue demandée, ne change rien", async () => {
    const manager = await createManager({ language: "en" });
    expect((await connexion(manager.email, "pt", "mauvais")).status).toBe(401);
    expect(await langueDuCompte(manager.id)).toBe("en");
    await connexion(manager.email, null);
    expect(await langueDuCompte(manager.id)).toBe("en");
  });

  it("la connexion d'un collaborateur n'est enregistrée que sur sa propre ligne, jamais sur celle de l'agence", async () => {
    const manager = await createManager({ language: "fr" });
    const collaborateur = await createTeamMember(manager.id, {});

    const res = await connexion(collaborateur.email, "en");

    expect(res.status).toBe(200);
    expect(await langueDuCompte(manager.id)).toBe("fr");
    expect(await langueDuCompte(collaborateur.id)).toBe("en");
  });
});
