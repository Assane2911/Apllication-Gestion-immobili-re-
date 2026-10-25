import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import * as emailService from "../services/email.service";
import { authHeader, createManager, createOwner, tokenFor } from "../test/authHelpers";

/**
 * La langue de l'e-mail suit la langue de l'interface, que le frontend envoie dans l'en-tête Accept-Language de chaque
 * requête. Ces tests vérifient que la langue arrive bien jusqu'au message envoyé, pour chaque route qui en envoie un.
 */
afterEach(() => vi.restoreAllMocks());

const espionner = () => vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
const dernier = (envoi: ReturnType<typeof espionner>) => {
  const [destinataire, sujet, html] = envoi.mock.calls.at(-1)!;
  return { destinataire: destinataire as string, sujet: sujet as string, html: html as string };
};

describe("mot de passe oublié", () => {
  it.each([
    ["en", "Reset your password"],
    ["es", "Restablece tu contraseña"],
    ["pt", "Redefina sua senha"],
    ["fr", "Réinitialisation de votre mot de passe"],
  ])("Accept-Language « %s » → e-mail dans cette langue", async (langue, extrait) => {
    const envoi = espionner();
    await createManager({ email: `oubli-${langue}@test.local` });

    const res = await request(app).post("/api/auth/forgot-password").set("Accept-Language", langue).send({ email: `oubli-${langue}@test.local` });

    expect(res.status).toBe(200);
    expect(dernier(envoi).sujet).toContain(extrait);
  });

  it("sans en-tête, ou avec une langue inconnue, le français", async () => {
    const envoi = espionner();
    await createManager({ email: "oubli-defaut@test.local" });
    await request(app).post("/api/auth/forgot-password").send({ email: "oubli-defaut@test.local" });
    expect(dernier(envoi).sujet).toContain("Réinitialisation");

    await request(app).post("/api/auth/forgot-password").set("Accept-Language", "de-DE,de;q=0.9").send({ email: "oubli-defaut@test.local" });
    expect(dernier(envoi).sujet).toContain("Réinitialisation");
  });
});

describe("inscription", () => {
  const corps = (email: string) => ({ email, password: "Password123!" });

  it("l'e-mail de confirmation suit la langue de la requête", async () => {
    const envoi = espionner();
    const res = await request(app).post("/api/auth/register").set("Accept-Language", "es-ES").send(corps("inscrit-es@test.local"));

    expect(res.status).toBe(201);
    expect(dernier(envoi).destinataire).toBe("inscrit-es@test.local");
    expect(dernier(envoi).sujet).toContain("Confirma tu correo");
  });

  it("l'e-mail « vous avez déjà un compte » aussi", async () => {
    const envoi = espionner();
    await createManager({ email: "deja-pt@test.local" });

    const res = await request(app).post("/api/auth/register").set("Accept-Language", "pt-BR").send(corps("deja-pt@test.local"));

    expect(res.status).toBe(201);
    expect(dernier(envoi).sujet).toContain("Você já tem uma conta");
  });

  it("le renvoi du lien de confirmation aussi", async () => {
    const envoi = espionner();
    await createManager({ email: "renvoi-en@test.local", emailVerifiedAt: null });

    const res = await request(app).post("/api/auth/resend-verification").set("Accept-Language", "en").send({ email: "renvoi-en@test.local" });

    expect(res.status).toBe(200);
    expect(dernier(envoi).sujet).toContain("Confirm your email");
  });
});

describe("invitations", () => {
  it("le gestionnaire qui invite un propriétaire : l'e-mail suit la langue de sa session", async () => {
    const envoi = espionner();
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
    const owner = await createOwner(manager.id, { email: "proprio-en@test.local" });

    const res = await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager))).set("Accept-Language", "en").send({});

    expect(res.status).toBeLessThan(300);
    expect(dernier(envoi).destinataire).toBe("proprio-en@test.local");
    expect(dernier(envoi).sujet).toContain("invites you to your owner portal");
  });

  it("le propriétaire d'une agence qui invite un collaborateur : l'e-mail suit la langue de sa session", async () => {
    const envoi = espionner();
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });

    const res = await request(app).post("/api/team").set(authHeader(tokenFor(manager))).set("Accept-Language", "es").send({ email: "collab-es@test.local" });

    expect(res.status).toBeLessThan(300);
    expect(dernier(envoi).destinataire).toBe("collab-es@test.local");
    expect(dernier(envoi).sujet).toContain("te invita a unirte a");
  });
});
