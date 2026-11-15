import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import * as emailService from "../services/email.service";
import { authHeader, createManager, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { MAX_COLLABORATEURS } from "../utils/rolesEquipe";

afterEach(() => vi.restoreAllMocks());

const JOUR = 24 * 3600 * 1000;

const entreprise = () => createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 30 * JOUR) });

async function remplirEquipe(proprietaireId: string, nombre: number) {
  for (let i = 0; i < nombre; i++) {
    // Un tiers d'invitations encore en attente : elles comptent aussi, ce sont des comptes déjà créés.
    await createTeamMember(proprietaireId, i % 3 === 0 ? { hasPassword: false, resetPasswordTokenHash: `en-attente-${i}` } : {});
  }
}

const inviter = (h: Record<string, string>, email: string) => request(app).post("/api/team").set(h).send({ email, role: "READ_ONLY" });

describe("Plafond de collaborateurs par agence", () => {
  it("le plafond est de 25", () => {
    expect(MAX_COLLABORATEURS).toBe(25);
  });

  it("accepte la 25e invitation (24 collaborateurs déjà, en attente comprises)", async () => {
    vi.spyOn(emailService, "sendEmail");
    const proprietaire = await entreprise();
    await remplirEquipe(proprietaire.id, MAX_COLLABORATEURS - 1);

    const res = await inviter(authHeader(tokenFor(proprietaire)), "dernier@test.local");

    expect(res.status).toBe(201);
  });

  it("refuse la 26e invitation, sans créer de compte ni envoyer d'e-mail", async () => {
    const envoi = vi.spyOn(emailService, "sendEmail");
    const proprietaire = await entreprise();
    await remplirEquipe(proprietaire.id, MAX_COLLABORATEURS);

    const res = await inviter(authHeader(tokenFor(proprietaire)), "de-trop@test.local");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TEAM_MEMBER_LIMIT_REACHED");
    expect(res.body.params).toEqual({ max: MAX_COLLABORATEURS });
    expect(envoi).not.toHaveBeenCalled();
    expect(await testDb.select().from(users).where(eq(users.email, "de-trop@test.local"))).toHaveLength(0);
  });

  it("deux invitations simultanées à une place de la limite n'en laissent passer qu'une", async () => {
    vi.spyOn(emailService, "sendEmail");
    const proprietaire = await entreprise();
    await remplirEquipe(proprietaire.id, MAX_COLLABORATEURS - 1);
    const h = authHeader(tokenFor(proprietaire));

    const [a, b] = await Promise.all([inviter(h, "a@test.local"), inviter(h, "b@test.local")]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await testDb.select().from(users).where(eq(users.teamOwnerId, proprietaire.id))).toHaveLength(MAX_COLLABORATEURS);
  });

  it("le plafond est propre à chaque agence", async () => {
    vi.spyOn(emailService, "sendEmail");
    const pleine = await entreprise();
    await remplirEquipe(pleine.id, MAX_COLLABORATEURS);
    const autre = await entreprise();

    const res = await inviter(authHeader(tokenFor(autre)), "ailleurs@test.local");

    expect(res.status).toBe(201);
  });
});

describe("Accès des collaborateurs sous la formule Entreprise", () => {
  async function agenceAvecCollaborateur(plan: "STARTER" | "PRO" | "ENTERPRISE") {
    const proprietaire = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: plan, subscriptionEndsAt: new Date(Date.now() + 30 * JOUR) });
    const collaborateur = await createTeamMember(proprietaire.id, { teamRole: "FULL" });
    // createTeamMember met l'agence en Entreprise : la formule voulue par le test est écrite APRÈS la création du collaborateur.
    await testDb.update(users).set({ subscriptionPlan: plan }).where(eq(users.id, proprietaire.id));
    const jeton = tokenFor({ id: proprietaire.id, role: "MANAGER" }, null, null, collaborateur.id);
    return { proprietaire, collaborateur, jeton };
  }

  it("un collaborateur d'une agence Entreprise travaille normalement", async () => {
    const { jeton } = await agenceAvecCollaborateur("ENTERPRISE");

    const res = await request(app).get("/api/properties").set(authHeader(jeton));

    expect(res.status).toBe(200);
  });

  it("l'agence repasse en Pro : chaque requête du collaborateur est refusée (401, session fermée côté site), sans rien effacer", async () => {
    const { proprietaire, collaborateur, jeton } = await agenceAvecCollaborateur("ENTERPRISE");
    await testDb.update(users).set({ subscriptionPlan: "PRO" }).where(eq(users.id, proprietaire.id));

    const res = await request(app).get("/api/properties").set(authHeader(jeton));

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("COLLABORATOR_PLAN_REQUIRED");
    const [conserve] = await testDb.select().from(users).where(eq(users.id, collaborateur.id));
    expect(conserve.teamOwnerId).toBe(proprietaire.id);
  });

  it("le propriétaire, lui, garde tout son accès, y compris à la liste de son équipe (pour la nettoyer)", async () => {
    const { proprietaire } = await agenceAvecCollaborateur("ENTERPRISE");
    await testDb.update(users).set({ subscriptionPlan: "PRO" }).where(eq(users.id, proprietaire.id));
    const h = authHeader(tokenFor(proprietaire));

    expect((await request(app).get("/api/properties").set(h)).status).toBe(200);
    expect((await request(app).get("/api/team").set(h)).status).toBe(200);
  });

  it("le retour en formule Entreprise rend l'accès au même collaborateur, avec le même jeton", async () => {
    const { proprietaire, jeton } = await agenceAvecCollaborateur("ENTERPRISE");
    await testDb.update(users).set({ subscriptionPlan: "PRO" }).where(eq(users.id, proprietaire.id));
    expect((await request(app).get("/api/properties").set(authHeader(jeton))).status).toBe(401);

    await testDb.update(users).set({ subscriptionPlan: "ENTERPRISE" }).where(eq(users.id, proprietaire.id));

    expect((await request(app).get("/api/properties").set(authHeader(jeton))).status).toBe(200);
  });

  it("à la connexion : refus (403) avec le même code tant que la formule est inférieure, accès sinon", async () => {
    const { proprietaire, collaborateur } = await agenceAvecCollaborateur("PRO");
    const connexion = () => request(app).post("/api/auth/login").send({ email: collaborateur.email, password: "Password123!" });

    const refuse = await connexion();
    expect(refuse.status).toBe(403);
    expect(refuse.body.code).toBe("COLLABORATOR_PLAN_REQUIRED");

    await testDb.update(users).set({ subscriptionPlan: "ENTERPRISE" }).where(eq(users.id, proprietaire.id));
    const accepte = await connexion();
    expect(accepte.status).toBe(200);
    expect(accepte.body.token).toBeTruthy();
  });

  it("un gestionnaire sans collaborateur n'est pas concerné, quelle que soit sa formule", async () => {
    const seul = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER", subscriptionEndsAt: new Date(Date.now() + 30 * JOUR) });

    const res = await request(app).get("/api/properties").set(authHeader(tokenFor(seul)));

    expect(res.status).toBe(200);
  });
});
