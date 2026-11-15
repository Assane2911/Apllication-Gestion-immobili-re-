import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import * as emailService from "../services/email.service";
import { authHeader, createManager, createOwner, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { INVITATION_TOKEN_TTL_MS } from "../utils/token";

afterEach(() => vi.restoreAllMocks());

const inviter = (managerToken: Record<string, string>, ownerId: string) => request(app).post(`/api/owners/${ownerId}/invite`).set(managerToken);

/** Fait « dater » l'invitation en attente d'il y a `minutes` minutes (le lien vit 7 jours : sa date d'envoi se lit sur son échéance). */
async function invitationEnvoyeeIlYA(email: string, minutes: number) {
  await testDb
    .update(users)
    .set({ resetPasswordExpiresAt: new Date(Date.now() - minutes * 60_000 + INVITATION_TOKEN_TTL_MS) })
    .where(eq(users.email, email));
}

/**
 * Renvoyer l'invitation d'un propriétaire envoie un e-mail, depuis le serveur de la plateforme, à une adresse que le gestionnaire
 * saisit librement. Sans délai, répéter l'appel inondait une boîte de réception et abîmait la réputation d'envoi (les invitations
 * d'équipe et les rappels de loyer ont leur garde-fou : celle-ci n'en avait pas). Cinq minutes entre deux envois à une même personne.
 */
describe("POST /api/owners/:id/invite — délai entre deux invitations", () => {
  it("refuse un renvoi immédiat (429) : un seul e-mail part, et le premier lien reste valable", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { email: "spam@test.local" });
    const h = authHeader(tokenFor(manager));
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);

    const premiere = await inviter(h, owner.id);
    const [apresPremiere] = await testDb.select().from(users).where(eq(users.email, "spam@test.local"));
    const seconde = await inviter(h, owner.id);

    expect(premiere.status).toBe(200);
    expect(seconde.status).toBe(429);
    expect(seconde.body.code).toBe("OWNER_INVITE_TOO_SOON");
    expect(seconde.body.params).toEqual({ minutes: 5 });
    expect(envoi).toHaveBeenCalledTimes(1);
    const [apresSeconde] = await testDb.select().from(users).where(eq(users.email, "spam@test.local"));
    expect(apresSeconde.resetPasswordTokenHash).toBe(apresPremiere.resetPasswordTokenHash);
  });

  it("autorise le renvoi une fois le délai passé : nouveau lien, nouvel e-mail", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { email: "relance-ok@test.local" });
    const h = authHeader(tokenFor(manager));
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);

    await inviter(h, owner.id);
    const [avant] = await testDb.select().from(users).where(eq(users.email, "relance-ok@test.local"));
    await invitationEnvoyeeIlYA("relance-ok@test.local", 6);
    const renvoi = await inviter(h, owner.id);

    expect(renvoi.status).toBe(200);
    expect(envoi).toHaveBeenCalledTimes(2);
    const [apres] = await testDb.select().from(users).where(eq(users.email, "relance-ok@test.local"));
    expect(apres.resetPasswordTokenHash).not.toBe(avant.resetPasswordTokenHash);
  });

  it("refuse encore à 4 minutes, accepte à 5 minutes et demie", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { email: "borne@test.local" });
    const h = authHeader(tokenFor(manager));
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);

    await inviter(h, owner.id);
    await invitationEnvoyeeIlYA("borne@test.local", 4);
    expect((await inviter(h, owner.id)).status).toBe(429);
    await invitationEnvoyeeIlYA("borne@test.local", 5.5);
    expect((await inviter(h, owner.id)).status).toBe(200);
  });

  it("deux renvois simultanés ne laissent partir qu'un seul e-mail", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { email: "course@test.local" });
    const h = authHeader(tokenFor(manager));
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
    await inviter(h, owner.id);
    await invitationEnvoyeeIlYA("course@test.local", 10);
    envoi.mockClear();

    const [a, b] = await Promise.all([inviter(h, owner.id), inviter(h, owner.id)]);

    expect([a.status, b.status].sort()).toEqual([200, 429]);
    expect(envoi).toHaveBeenCalledTimes(1);
  });

  it("le délai est propre à chaque propriétaire : en inviter un autre n'est pas gêné", async () => {
    const manager = await createManager();
    const premier = await createOwner(manager.id, { email: "premier@test.local" });
    const second = await createOwner(manager.id, { email: "second@test.local" });
    const h = authHeader(tokenFor(manager));
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);

    expect((await inviter(h, premier.id)).status).toBe(200);
    expect((await inviter(h, second.id)).status).toBe(200);
  });
});
