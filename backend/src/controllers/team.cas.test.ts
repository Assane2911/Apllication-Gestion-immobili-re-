import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { activityLogs, agencySettings, users } from "../db/schema";
import * as emailService from "../services/email.service";
import { teamInvitationEmail } from "../services/email.service";
import { authHeader, createManager, createTeamMember, tokenCollaborateur, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { LIBELLES_ROLES_EQUIPE, MAX_COLLABORATEURS } from "../utils/rolesEquipe";
import { hashToken, INVITATION_TOKEN_TTL_MS } from "../utils/token";

/**
 * Gestion de l'équipe (team.controller.ts) : cas limites trouvés en sabotant le contrôleur, que les tests existants
 * laissaient passer. Accès réservé au propriétaire, contenu de la liste, invitation (jeton, e-mail exact, plafond,
 * journal), changement de rôle, retrait et renvoi d'invitation.
 */
let envois: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  envois = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Compte = Parameters<typeof tokenFor>[0];
const agence = () => createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
const proche = (date: Date | null, attendu: number, tolerance = 60_000) => date !== null && Math.abs(date.getTime() - attendu) < tolerance;
const ligne = async (id: string) => (await testDb.select().from(users).where(eq(users.id, id)))[0];
const journal = async (managerId: string, action: string) => (await testDb.select().from(activityLogs).where(and(eq(activityLogs.managerId, managerId), eq(activityLogs.action, action))))[0];
const dernierEmail = () => {
  const appel = envois.mock.calls.at(-1) as unknown as [string, string, string];
  return { a: appel[0], sujet: appel[1], html: appel[2] };
};
const jetonDuLien = (html: string) => /reinitialiser-mot-de-passe\?token=([^"&\s<]+)/.exec(html)![1];

describe("accès réservé au propriétaire", () => {
  it("un collaborateur « tous droits » ne peut pas gérer l'équipe : 403 OWNER_ONLY_TEAM avec son message", async () => {
    const manager = await agence();
    const jeton = await tokenCollaborateur(manager, { teamRole: "FULL" });

    const res = await request(app).post("/api/team").set(authHeader(jeton)).send({ email: "interdit@test.local" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OWNER_ONLY_TEAM");
    expect(res.body.error).toBe("Seul le gestionnaire propriétaire de l'agence peut gérer l'équipe.");
  });
});

describe("GET /api/team : contenu de la liste", () => {
  const lister = async (manager: Compte) => (await request(app).get("/api/team").set(authHeader(tokenFor(manager)))).body as Array<Record<string, unknown>>;

  it("chaque collaborateur est décrit par son identifiant, son e-mail, sa date de création et son rôle ; un rôle jamais choisi vaut « FULL »", async () => {
    const manager = await agence();
    const collaborateur = await createTeamMember(manager.id, { teamRole: null });

    const [item] = await lister(manager);

    expect(item.id).toBe(collaborateur.id);
    expect(item.email).toBe(collaborateur.email);
    expect(new Date(item.createdAt as string).getTime()).toBe(collaborateur.createdAt.getTime());
    expect(item.role).toBe("FULL");
  });

  it("un collaborateur actif (mot de passe posé) n'est ni en attente ni périmé, même avec un lien de réinitialisation en circulation", async () => {
    const manager = await agence();
    await createTeamMember(manager.id, { hasPassword: true, resetPasswordTokenHash: "lien", resetPasswordExpiresAt: new Date(Date.now() - 1000) });
    await createTeamMember(manager.id, { hasPassword: true, resetPasswordTokenHash: null, resetPasswordExpiresAt: null });

    const items = await lister(manager);

    expect(items.map((i) => [i.status, i.expired])).toEqual([["ACTIVE", false], ["ACTIVE", false]]);
  });

  it("sans mot de passe posé mais sans lien non plus, le collaborateur n'est pas en attente", async () => {
    const manager = await agence();
    await createTeamMember(manager.id, { hasPassword: false, resetPasswordTokenHash: null });

    const [item] = await lister(manager);

    expect(item).toMatchObject({ status: "ACTIVE", expired: false });
  });

  it("une invitation en attente est périmée sans échéance enregistrée, et ne l'est pas à l'instant exact de son échéance", async () => {
    const manager = await agence();
    await createTeamMember(manager.id, { email: "sans-echeance@test.local", hasPassword: false, resetPasswordTokenHash: "a", resetPasswordExpiresAt: null });
    const instant = new Date(Date.now() + 5000);
    await createTeamMember(manager.id, { email: "a-l-instant@test.local", hasPassword: false, resetPasswordTokenHash: "b", resetPasswordExpiresAt: instant });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(instant);

    const items = await lister(manager);

    const etat = (email: string) => items.find((i) => i.email === email)!;
    expect(etat("sans-echeance@test.local")).toMatchObject({ status: "PENDING", expired: true });
    expect(etat("a-l-instant@test.local")).toMatchObject({ status: "PENDING", expired: false });
  });
});

describe("POST /api/team : invitation", () => {
  const inviter = (manager: Compte, corps: object, langue = "fr") =>
    request(app).post("/api/team").set(authHeader(tokenFor(manager))).set("Accept-Language", langue).send(corps);

  it("l'adresse est enregistrée en minuscules, le compte est rattaché, confirmé, avec un mot de passe inutilisable de coût 10", async () => {
    const manager = await agence();

    const res = await inviter(manager, { email: "Nouveau.COLLAB@Test.Local", role: "ACCOUNTANT" });

    expect(res.status).toBe(201);
    const [compte] = await testDb.select().from(users).where(eq(users.email, "nouveau.collab@test.local"));
    expect(res.body).toEqual({ id: compte.id, email: "nouveau.collab@test.local", role: "ACCOUNTANT", status: "PENDING" });
    expect(compte.emailVerifiedAt).not.toBeNull();
    expect(bcrypt.getRounds(compte.passwordHash)).toBe(10);
  });

  it("l'e-mail d'invitation porte le nom de l'agence et du propriétaire, la langue de la requête, et un lien à jeton de 64 caractères valable 7 jours", async () => {
    const manager = await agence();
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence Teranga" });

    const res = await inviter(manager, { email: "invite@test.local" }, "en");

    const { a, sujet, html } = dernierEmail();
    const jeton = jetonDuLien(html);
    const compte = await ligne(res.body.id);
    expect(a).toBe("invite@test.local");
    expect(jeton).toHaveLength(64);
    expect(compte.resetPasswordTokenHash).toBe(hashToken(jeton));
    expect(proche(compte.resetPasswordExpiresAt, Date.now() + INVITATION_TOKEN_TTL_MS)).toBe(true);
    const attendu = teamInvitationEmail({ agencyName: "Agence Teranga", ownerName: manager.email, inviteUrl: `${env.frontendUrl}/reinitialiser-mot-de-passe?token=${jeton}`, langue: "en" });
    expect({ sujet, html }).toEqual({ sujet: attendu.subject, html: attendu.html });
  });

  it("une adresse déjà utilisée est refusée avec le code ACCOUNT_EMAIL_EXISTS", async () => {
    const manager = await agence();
    const autre = await createManager();

    const res = await inviter(manager, { email: autre.email });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACCOUNT_EMAIL_EXISTS");
  });

  it("au plafond de collaborateurs, le refus explique la limite et renvoie le support", async () => {
    const manager = await agence();
    for (let i = 0; i < MAX_COLLABORATEURS; i++) await createTeamMember(manager.id);

    const res = await inviter(manager, { email: "de-trop@test.local" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TEAM_MEMBER_LIMIT_REACHED");
    expect(res.body.error).toBe(`Limite de ${MAX_COLLABORATEURS} collaborateurs atteinte pour cette agence. Contactez le support pour en ajouter davantage.`);
  });

  it("un envoi d'e-mail qui échoue est journalisé sans faire échouer l'invitation", async () => {
    const manager = await agence();
    envois.mockRejectedValue(new Error("SMTP indisponible"));

    const res = await inviter(manager, { email: "smtp-en-panne@test.local" });

    expect(res.status).toBe(201);
    expect(console.error).toHaveBeenCalledWith("[team] Échec de l'envoi de l'email d'invitation:", expect.any(Error));
  });

  it("le journal d'activité décrit l'invitation : action, entité, identifiant, adresse et rôle", async () => {
    const manager = await agence();

    const res = await inviter(manager, { email: "journal@test.local", role: "ACCOUNTANT" });

    expect(await journal(manager.id, "team.invite")).toMatchObject({
      entityType: "team_member",
      entityId: res.body.id,
      entityLabel: "journal@test.local",
      details: `Invitation envoyée à journal@test.local pour rejoindre l'équipe (rôle : ${LIBELLES_ROLES_EQUIPE.ACCOUNTANT})`,
    });
  });
});

describe("PUT /api/team/:id : changement de rôle", () => {
  const changer = (manager: Compte, id: string, role: string) => request(app).patch(`/api/team/${id}/role`).set(authHeader(tokenFor(manager))).send({ role });

  it("un collaborateur inconnu : 404 « Collaborateur introuvable » avec le code COLLABORATOR_NOT_FOUND", async () => {
    const manager = await agence();

    const res = await changer(manager, "collaborateur-inconnu", "AGENT");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Collaborateur introuvable", code: "COLLABORATOR_NOT_FOUND" });
  });

  it("le journal décrit l'ancien rôle (un rôle jamais choisi vaut « tous les droits ») puis le nouveau", async () => {
    const manager = await agence();
    const collaborateur = await createTeamMember(manager.id, { teamRole: null });

    await changer(manager, collaborateur.id, "READ_ONLY");
    await changer(manager, collaborateur.id, "AGENT");

    const lignes = await testDb.select().from(activityLogs).where(and(eq(activityLogs.managerId, manager.id), eq(activityLogs.action, "team.role")));
    const details = lignes.map((l: { details: string | null }) => l.details).sort();
    expect(details).toEqual(
      [
        `Rôle de ${collaborateur.email} : ${LIBELLES_ROLES_EQUIPE.FULL} → ${LIBELLES_ROLES_EQUIPE.READ_ONLY}`,
        `Rôle de ${collaborateur.email} : ${LIBELLES_ROLES_EQUIPE.READ_ONLY} → ${LIBELLES_ROLES_EQUIPE.AGENT}`,
      ].sort()
    );
  });
});

describe("DELETE /api/team/:id : retrait", () => {
  it("le journal décrit la révocation d'accès", async () => {
    const manager = await agence();
    const collaborateur = await createTeamMember(manager.id);

    const res = await request(app).delete(`/api/team/${collaborateur.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    expect(await journal(manager.id, "team.remove")).toMatchObject({ entityType: "team_member", entityId: collaborateur.id, entityLabel: collaborateur.email, details: `Accès révoqué pour ${collaborateur.email}` });
  });
});

describe("POST /api/team/:id/resend : renvoi d'invitation", () => {
  const renvoyer = (manager: Compte, id: string, langue = "fr") => request(app).post(`/api/team/${id}/resend`).set(authHeader(tokenFor(manager))).set("Accept-Language", langue);

  it("une invitation déjà acceptée n'est pas renvoyée, que le mot de passe soit posé ou que le lien manque : 409 INVITATION_ALREADY_ACCEPTED", async () => {
    const manager = await agence();
    const actif = await createTeamMember(manager.id, { hasPassword: true, resetPasswordTokenHash: "lien-de-reinitialisation" });
    const sansLien = await createTeamMember(manager.id, { hasPassword: false, resetPasswordTokenHash: null });

    const a = await renvoyer(manager, actif.id);
    const b = await renvoyer(manager, sansLien.id);

    for (const res of [a, b]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("INVITATION_ALREADY_ACCEPTED");
      expect(res.body.error).toBe("Cette invitation a déjà été acceptée.");
    }
    expect(envois).not.toHaveBeenCalled();
  });

  it("le renvoi crée un nouveau jeton de 64 caractères (l'ancien cesse de fonctionner), envoie l'e-mail dans la langue de la requête, journalise et répond", async () => {
    const manager = await agence();
    const collaborateur = await createTeamMember(manager.id, { hasPassword: false, resetPasswordTokenHash: hashToken("ancien-jeton"), resetPasswordExpiresAt: new Date(Date.now() - 1000) });

    const res = await renvoyer(manager, collaborateur.id, "en");

    expect(res.body).toEqual({ id: collaborateur.id, email: collaborateur.email, status: "PENDING", expired: false });
    const { a, sujet, html } = dernierEmail();
    const jeton = jetonDuLien(html);
    const apres = await ligne(collaborateur.id);
    expect(a).toBe(collaborateur.email);
    expect(jeton).toHaveLength(64);
    expect(apres.resetPasswordTokenHash).toBe(hashToken(jeton));
    expect(apres.resetPasswordTokenHash).not.toBe(hashToken("ancien-jeton"));
    expect(proche(apres.resetPasswordExpiresAt, Date.now() + INVITATION_TOKEN_TTL_MS)).toBe(true);
    const attendu = teamInvitationEmail({ agencyName: undefined, ownerName: manager.email, inviteUrl: `${env.frontendUrl}/reinitialiser-mot-de-passe?token=${jeton}`, langue: "en" });
    expect({ sujet, html }).toEqual({ sujet: attendu.subject, html: attendu.html });
    expect(await journal(manager.id, "team.invite_resend")).toMatchObject({ entityType: "team_member", entityId: collaborateur.id, details: `Invitation renvoyée à ${collaborateur.email}` });
  });
});
