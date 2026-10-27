import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { agencySettings, users } from "../db/schema";
import * as emailService from "../services/email.service";
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
    await createTeamMember(manager.id, { email: "awa@test.local", resetPasswordTokenHash: "en-attente", hasPassword: false });
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
    expect(res.body.error).toContain("Agence & Multi-Comptes");
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

  // Régression : sendEmail() n'était pas attendu avant la réponse — sur
  // Vercel (serverless), l'exécution peut s'arrêter juste après l'envoi de la
  // réponse, avant qu'un envoi non attendu ait eu le temps de partir. Ce test
  // ne peut pas prouver l'ordre d'exécution réel côté Vercel, mais garantit
  // au moins qu'un futur retrait accidentel de cet envoi soit détecté.
  it("envoie l'email d'invitation au collaborateur", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const sendEmailSpy = vi.spyOn(emailService, "sendEmail");

    const res = await request(app)
      .post("/api/team")
      .set(authHeader(tokenFor(manager)))
      .send({ email: "nouveau-collaborateur@test.local" });

    expect(res.status).toBe(201);
    expect(sendEmailSpy).toHaveBeenCalledWith(
      "nouveau-collaborateur@test.local",
      expect.any(String),
      expect.any(String)
    );

    sendEmailSpy.mockRestore();
  });

  it("refuse un email de plus de 254 caractères, sans créer de compte ni envoyer d'email", async () => {
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });

    const res = await request(app)
      .post("/api/team")
      .set(authHeader(tokenFor(manager)))
      .send({ email: `${"a".repeat(250)}@exemple.com`, role: "AGENT" });

    expect(res.status).toBe(400);
    expect(envoi).not.toHaveBeenCalled();
    expect(await testDb.select().from(users).where(eq(users.teamOwnerId, manager.id))).toHaveLength(0);
    envoi.mockRestore();
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

  it("l'invitation reste valable 7 jours, et l'email le dit (et non « 1 heure »)", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const envoi = vi.spyOn(emailService, "sendEmail");

    const avant = Date.now();
    const res = await request(app).post("/api/team").set(authHeader(tokenFor(manager))).send({ email: "sept-jours@test.local" });

    expect(res.status).toBe(201);
    const [created] = await testDb.select().from(users).where(eq(users.email, "sept-jours@test.local"));
    const restant = new Date(created.resetPasswordExpiresAt as Date).getTime() - avant;
    expect(restant).toBeGreaterThan(7 * 24 * 3_600_000 - 60_000);
    expect(restant).toBeLessThan(7 * 24 * 3_600_000 + 60_000);
    const html = String(envoi.mock.calls.find((c) => c[0] === "sept-jours@test.local")![2]);
    expect(html).toContain("<strong>7 jours</strong>");
    expect(html).not.toContain("1 heure");
    envoi.mockRestore();
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

describe("invitations d'équipe : statut, renvoi, sujet", () => {
  const entreprise = () => createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const demain = () => new Date(Date.now() + 24 * 3_600_000);
  const hier = () => new Date(Date.now() - 24 * 3_600_000);

  it("un collaborateur actif qui demande « mot de passe oublié » n'est pas de nouveau « en attente »", async () => {
    const manager = await entreprise();
    await createTeamMember(manager.id, { email: "actif@test.local", hasPassword: true, resetPasswordTokenHash: "reinit-en-cours", resetPasswordExpiresAt: demain() });

    const res = await request(app).get("/api/team").set(authHeader(tokenFor(manager)));

    expect(res.body[0].status).toBe("ACTIVE");
  });

  it("signale une invitation expirée, sans changer son statut « en attente »", async () => {
    const manager = await entreprise();
    await createTeamMember(manager.id, { email: "expire@test.local", hasPassword: false, resetPasswordTokenHash: "vieux", resetPasswordExpiresAt: hier() });
    await createTeamMember(manager.id, { email: "valide@test.local", hasPassword: false, resetPasswordTokenHash: "frais", resetPasswordExpiresAt: demain() });

    const res = await request(app).get("/api/team").set(authHeader(tokenFor(manager)));

    const expire = res.body.find((c: { email: string }) => c.email === "expire@test.local");
    const valide = res.body.find((c: { email: string }) => c.email === "valide@test.local");
    expect(expire).toMatchObject({ status: "PENDING", expired: true });
    expect(valide).toMatchObject({ status: "PENDING", expired: false });
  });

  it("le sujet de l'invitation montre le nom de l'agence tel quel : « & » ne devient pas « &amp; »", async () => {
    const manager = await entreprise();
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Martin & Fils" });
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);

    await request(app).post("/api/team").set(authHeader(tokenFor(manager))).send({ email: "sujet@test.local" });

    const [, sujet, html] = envoi.mock.calls[0];
    expect(sujet).toContain("Martin & Fils");
    expect(sujet).not.toContain("&amp;");
    expect(html).toContain("Martin &amp; Fils");
    envoi.mockRestore();
  });

  it("renvoie l'invitation : nouveau lien valable 7 jours, ancien lien invalidé, email envoyé", async () => {
    const manager = await entreprise();
    const membre = await createTeamMember(manager.id, { email: "renvoi@test.local", hasPassword: false, resetPasswordTokenHash: "ancien-hash", resetPasswordExpiresAt: hier() });
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);

    const res = await request(app).post(`/api/team/${membre.id}/resend`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(users).where(eq(users.id, membre.id));
    expect(apres.resetPasswordTokenHash).not.toBe("ancien-hash");
    expect(new Date(apres.resetPasswordExpiresAt as Date).getTime() - Date.now()).toBeGreaterThan(7 * 24 * 3_600_000 - 60_000);
    expect(envoi).toHaveBeenCalledTimes(1);
    expect(envoi.mock.calls[0][0]).toBe("renvoi@test.local");
    expect(String(envoi.mock.calls[0][2])).toContain("/reinitialiser-mot-de-passe?token=");
    envoi.mockRestore();
  });

  it("refuse de renvoyer une invitation déjà acceptée, celle d'une autre agence, et à un collaborateur", async () => {
    const manager = await entreprise();
    const autre = await entreprise();
    const accepte = await createTeamMember(manager.id, { hasPassword: true, resetPasswordTokenHash: null });
    const etranger = await createTeamMember(autre.id, { hasPassword: false, resetPasswordTokenHash: "x", resetPasswordExpiresAt: demain() });
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);

    expect((await request(app).post(`/api/team/${accepte.id}/resend`).set(authHeader(tokenFor(manager)))).status).toBe(409);
    expect((await request(app).post(`/api/team/${etranger.id}/resend`).set(authHeader(tokenFor(manager)))).status).toBe(404);
    const jeton = await tokenCollaborateur(manager);
    expect((await request(app).post(`/api/team/${accepte.id}/resend`).set(authHeader(jeton))).status).toBe(403);
    expect(envoi).not.toHaveBeenCalled();
    envoi.mockRestore();
  });
});

describe("PATCH /api/auth/currency par un collaborateur", () => {
  it("la devise est celle de l'agence : seul un collaborateur « tous droits » peut la changer, jamais un lecteur ou un agent", async () => {
    const manager = await createManager({ currency: "EUR" });
    for (const roleEquipe of ["READ_ONLY", "AGENT", "ACCOUNTANT"] as const) {
      const jeton = await tokenCollaborateur(manager, { teamRole: roleEquipe });
      const res = await request(app).patch("/api/auth/currency").set(authHeader(jeton)).send({ currency: "XOF" });
      expect(res.status).toBe(403);
    }
    const [intacte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(intacte.currency).toBe("EUR");

    const complet = await tokenCollaborateur(manager, { teamRole: "FULL" });
    expect((await request(app).patch("/api/auth/currency").set(authHeader(complet)).send({ currency: "XOF" })).status).toBe(200);
    expect((await request(app).patch("/api/auth/currency").set(authHeader(tokenFor(manager))).send({ currency: "EUR" })).status).toBe(200);
  });
});
