import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { adminAuditLogs } from "../db/schema";
import * as emailService from "../services/email.service";
import { authHeader, createAdmin, createManager, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Les boutons « Écrire à… » de l'administration étaient des liens « mailto: » qui n'ouvraient rien sur un poste sans messagerie
 * configurée. Le message part maintenant de la plateforme. Aucun e-mail réel : `sendEmail` est remplacé.
 */
let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, messageId: "m1" } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const ecrire = (id: string, token: string, corps: Record<string, unknown> = { subject: "Votre annonce", message: "Pouvez-vous ajouter une photo ?" }) =>
  request(app).post(`/api/admin/users/${id}/message`).set(authHeader(token)).send(corps);

describe("POST /api/admin/users/:id/message", () => {
  it("exige l'authentification et refuse un gestionnaire", async () => {
    const manager = await createManager();
    expect((await request(app).post(`/api/admin/users/${manager.id}/message`).send({ subject: "Bonjour", message: "Un message" })).status).toBe(401);
    expect((await ecrire(manager.id, tokenFor(manager))).status).toBe(403);
    expect(envoi).not.toHaveBeenCalled();
  });

  it("envoie le message depuis la plateforme, avec les réponses vers l'administrateur, et le trace sans recopier le texte", async () => {
    const admin = await createAdmin();
    const manager = await createManager();

    const res = await ecrire(manager.id, tokenFor(admin), { subject: "Votre annonce", message: "Ligne un\nLigne <b>deux</b>" });

    expect(res.status).toBe(200);
    expect(envoi).toHaveBeenCalledTimes(1);
    const [a, sujet, html, pieces, options] = envoi.mock.calls[0] as [string, string, string, unknown, { replyTo?: string }];
    expect(a).toBe(manager.email);
    expect(sujet).toBe("Votre annonce");
    expect(html).toContain("Bonjour,");
    expect(html).toContain("Ligne un<br/>Ligne &lt;b&gt;deux&lt;/b&gt;");
    expect(html).not.toContain("<b>deux</b>");
    expect(pieces).toBeUndefined();
    expect(options).toEqual({ replyTo: admin.email });

    const lignes = await testDb.select().from(adminAuditLogs);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ action: "user.message", adminId: admin.id, targetUserId: manager.id, targetLabel: manager.email });
    expect(lignes[0].details).toContain("Votre annonce");
    expect(lignes[0].details).not.toContain("deux");
  });

  it("écrit dans la langue du destinataire (salutation et signature)", async () => {
    const admin = await createAdmin();
    const manager = await createManager({ language: "en" });

    await ecrire(manager.id, tokenFor(admin));

    const html = envoi.mock.calls[0][2] as string;
    expect(html).toContain("Hello,");
    expect(html).toContain("The ImmoPlatform Pro team");
  });

  it("peut écrire à un compte suspendu, à un collaborateur et à une adresse non confirmée", async () => {
    const token = tokenFor(await createAdmin());
    const suspendu = await createManager({ suspendedAt: new Date() });
    const proprietaire = await createManager();
    const collaborateur = await createTeamMember(proprietaire.id);
    const nonConfirme = await createManager({ emailVerifiedAt: null });

    for (const compte of [suspendu, collaborateur, nonConfirme]) {
      expect((await ecrire(compte.id, token)).status).toBe(200);
    }
    expect(envoi).toHaveBeenCalledTimes(3);
  });

  it("répond 404 pour un identifiant inconnu ou un administrateur, sans rien envoyer", async () => {
    const admin = await createAdmin();
    const autreAdmin = await createAdmin();
    const token = tokenFor(admin);

    for (const id of ["inconnu", autreAdmin.id, admin.id]) {
      expect((await ecrire(id, token)).status).toBe(404);
    }
    expect(envoi).not.toHaveBeenCalled();
  });

  it("refuse un objet ou un message vide, trop court ou trop long", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager();
    const refuses = [
      { subject: "", message: "Un message" },
      { subject: "Ab", message: "Un message" },
      { subject: "Bonjour", message: "" },
      { subject: "Bonjour", message: "Ok" },
      { subject: "x".repeat(151), message: "Un message" },
      { subject: "Bonjour", message: "x".repeat(5001) },
      {},
    ];
    for (const corps of refuses) {
      expect((await ecrire(manager.id, token, corps)).status, JSON.stringify(corps).slice(0, 40)).toBe(400);
    }
    expect(envoi).not.toHaveBeenCalled();
  });

  it("si l'e-mail n'est pas accepté, ou n'est que simulé, répond 502 et ne trace rien", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager();

    envoi.mockResolvedValueOnce({ simulated: false, error: true } as never);
    const echec = await ecrire(manager.id, token);
    envoi.mockResolvedValueOnce({ simulated: true } as never);
    const simule = await ecrire(manager.id, token);

    expect(echec.status).toBe(502);
    expect(echec.body.code).toBe("ADMIN_MESSAGE_SEND_FAILED");
    expect(simule.status).toBe(502);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("plafonne les messages d'un administrateur : 30 par heure", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager();
    for (let i = 0; i < 30; i++) expect((await ecrire(manager.id, token)).status, `message ${i + 1}`).toBe(200);
    envoi.mockClear();

    const refuse = await ecrire(manager.id, token);

    expect(refuse.status).toBe(429);
    expect(refuse.body.code).toBe("ADMIN_MESSAGE_RATE_LIMITED");
    expect(envoi).not.toHaveBeenCalled();
  }, 60_000);
});
