import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { adminAuditLogs } from "../db/schema";
import * as emailService from "../services/email.service";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit par sabotage de adminMessage.controller.ts : ce que les tests du message de l'administration ne vérifiaient pas.
 * Les bornes exactes de l'objet (3 à 150 caractères) et du message (5 à 5000), le rognage des espaces, le destinataire précis
 * quand la plateforme compte plusieurs comptes, et le corps des réponses (refus, échec d'envoi, succès).
 */
let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, messageId: "m1" } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const ecrire = (id: string, token: string, corps: Record<string, unknown>) => request(app).post(`/api/admin/users/${id}/message`).set(authHeader(token)).send(corps);

describe("bornes de l'objet et du message", () => {
  it("accepte un objet de 3 à 150 caractères et un message de 5 à 5000 caractères, aux bornes exactes", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager();
    const acceptes = [
      { subject: "abc", message: "Un message" },
      { subject: "x".repeat(150), message: "Un message" },
      { subject: "Bonjour", message: "abcde" },
      { subject: "Bonjour", message: "x".repeat(5000) },
    ];

    for (const corps of acceptes) {
      expect((await ecrire(manager.id, token, corps)).status, JSON.stringify(corps).slice(0, 40)).toBe(200);
    }
  });

  it("compte les caractères APRÈS avoir rogné les espaces : un objet ou un message trop court entouré d'espaces est refusé", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager();

    const objet = await ecrire(manager.id, token, { subject: "  ab  ", message: "Un message" });
    const message = await ecrire(manager.id, token, { subject: "Bonjour", message: "  abcd  " });

    expect(objet.status).toBe(400);
    expect(message.status).toBe(400);
    expect(envoi).not.toHaveBeenCalled();
  });
});

describe("destinataire et réponses", () => {
  it("écrit au compte demandé, même quand la plateforme en compte plusieurs", async () => {
    const token = tokenFor(await createAdmin());
    await createManager();
    const visé = await createManager();
    await createManager();

    await ecrire(visé.id, token, { subject: "Bonjour", message: "Un message" });

    expect(envoi).toHaveBeenCalledTimes(1);
    expect(envoi.mock.calls[0][0]).toBe(visé.email);
  });

  it("un compte inconnu : 404 avec son code et son message ; un envoi refusé : 502 avec son message ; un envoi réussi : { success: true }", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager();

    const inconnu = await ecrire("inconnu", token, { subject: "Bonjour", message: "Un message" });
    envoi.mockResolvedValueOnce({ simulated: false, error: true } as never);
    const echec = await ecrire(manager.id, token, { subject: "Bonjour", message: "Un message" });
    const ok = await ecrire(manager.id, token, { subject: "Bonjour", message: "Un message" });

    expect([inconnu.status, inconnu.body.code, inconnu.body.error]).toEqual([404, "USER_NOT_FOUND", "Compte introuvable"]);
    expect([echec.status, echec.body.code, echec.body.error]).toEqual([502, "ADMIN_MESSAGE_SEND_FAILED", "Le message n'a pas pu être envoyé : le service d'e-mail n'a pas accepté le message."]);
    expect(ok.body).toEqual({ success: true });
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(1);
  });
});
