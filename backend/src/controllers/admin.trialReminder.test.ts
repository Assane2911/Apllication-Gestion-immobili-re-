import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { adminAuditLogs, users } from "../db/schema";
import * as emailService from "../services/email.service";
import { runSubscriptionExpiryNotices } from "../services/finAcces.service";
import { authHeader, createAdmin, createManager, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * « Essais se terminant bientôt » du tableau de bord : l'enveloppe était un lien « mailto: » qui n'ouvrait rien sur un poste sans
 * messagerie. Elle envoie maintenant le rappel de fin d'essai depuis la plateforme. Aucun e-mail réel : `sendEmail` est remplacé.
 */
const JOUR = 86_400_000;
const dans = (jours: number) => new Date(Date.now() + jours * JOUR);

let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, messageId: "m1" } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const relancer = (id: string, token: string) => request(app).post(`/api/admin/managers/${id}/trial-reminder`).set(authHeader(token));
const relire = async (id: string) => (await testDb.select().from(users).where(eq(users.id, id)))[0];
const messages = () => envoi.mock.calls.map((c: unknown[]) => ({ a: c[0] as string, sujet: c[1] as string, html: c[2] as string }));

describe("POST /api/admin/managers/:id/trial-reminder", () => {
  it("exige l'authentification et refuse un gestionnaire", async () => {
    const manager = await createManager();
    expect((await request(app).post(`/api/admin/managers/${manager.id}/trial-reminder`)).status).toBe(401);
    expect((await relancer(manager.id, tokenFor(manager))).status).toBe(403);
    expect(envoi).not.toHaveBeenCalled();
  });

  it("envoie le rappel de fin d'essai au gestionnaire, avec le lien vers l'abonnement, et le trace", async () => {
    const admin = await createAdmin();
    const manager = await createManager({ trialEndsAt: dans(5) });

    const res = await relancer(manager.id, tokenFor(admin));

    expect(res.status).toBe(200);
    const [msg] = messages();
    expect(messages()).toHaveLength(1);
    expect(msg.a).toBe(manager.email);
    expect(msg.sujet).toMatch(/^Votre essai gratuit se termine dans [45] jours$/);
    expect(msg.html).toContain("/subscription");

    const lignes = await testDb.select().from(adminAuditLogs);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ action: "manager.trial_reminder", adminId: admin.id, targetUserId: manager.id });
  });

  it("un deuxième clic, ou un double clic, n'envoie qu'un seul message", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ trialEndsAt: dans(5) });

    const [a, b] = await Promise.all([relancer(manager.id, token), relancer(manager.id, token)]);
    const c = await relancer(manager.id, token);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(c.status).toBe(409);
    expect(c.body.code).toBe("TRIAL_REMINDER_ALREADY_SENT");
    expect(messages()).toHaveLength(1);
  });

  it("l'envoi automatique ne doublonne pas un rappel déjà parti à la main", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ trialEndsAt: dans(2) });

    await relancer(manager.id, token);
    await runSubscriptionExpiryNotices();

    expect(messages()).toHaveLength(1);
  });

  it("si l'e-mail n'est pas accepté, répond 502 et rend la main : on peut réessayer", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ trialEndsAt: dans(5) });
    envoi.mockResolvedValueOnce({ simulated: false, error: true } as never);

    const echec = await relancer(manager.id, token);

    expect(echec.status).toBe(502);
    expect(echec.body.code).toBe("TRIAL_REMINDER_SEND_FAILED");
    expect((await relire(manager.id)).endingNoticeFor).toBeNull();
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);

    const reussite = await relancer(manager.id, token);
    expect(reussite.status).toBe(200);
  });

  it("un envoi simulé (messagerie non configurée) n'est pas annoncé comme envoyé", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ trialEndsAt: dans(5) });
    envoi.mockResolvedValueOnce({ simulated: true } as never);

    const res = await relancer(manager.id, token);

    expect(res.status).toBe(502);
    expect((await relire(manager.id)).endingNoticeFor).toBeNull();
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("refuse un compte suspendu, une adresse non confirmée, un abonné et un essai terminé", async () => {
    const token = tokenFor(await createAdmin());
    const cas: Array<[string, Partial<typeof users.$inferInsert>, string]> = [
      ["suspendu", { suspendedAt: new Date() }, "TRIAL_REMINDER_SUSPENDED"],
      ["adresse non confirmée", { emailVerifiedAt: null }, "TRIAL_REMINDER_EMAIL_UNVERIFIED"],
      ["abonné", { subscriptionStatus: "ACTIVE", subscriptionEndsAt: dans(20) }, "TRIAL_REMINDER_NOT_IN_TRIAL"],
      ["essai terminé", { trialEndsAt: dans(-1) }, "TRIAL_REMINDER_NOT_IN_TRIAL"],
    ];
    for (const [, surcharge, code] of cas) {
      const manager = await createManager({ trialEndsAt: dans(5), ...surcharge });
      const res = await relancer(manager.id, token);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(code);
    }
    expect(envoi).not.toHaveBeenCalled();
  });

  it("répond 404 pour un identifiant inconnu, un collaborateur ou l'administrateur lui-même", async () => {
    const admin = await createAdmin();
    const token = tokenFor(admin);
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id);
    for (const id of ["inconnu", collaborateur.id, admin.id]) {
      expect((await relancer(id, token)).status).toBe(404);
    }
    expect(envoi).not.toHaveBeenCalled();
  });
});
