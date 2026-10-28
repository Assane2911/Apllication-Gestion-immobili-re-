import * as Sentry from "@sentry/node";
import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { reglagesEnvoi, reinitialiserAlertesEmailPourTests, sendEmail } from "./email.service";

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));

/**
 * Un seul délai DNS (smtp.zoho.com, le 26 octobre) a suffi à perdre un e-mail : l'envoi n'était tenté qu'une fois.
 * Un échec AVANT que le serveur n'accepte le message (adresse du serveur introuvable, connexion refusée ou trop lente,
 * refus temporaire 4xx) est maintenant réessayé une fois. Rien d'autre ne l'est : une coupure en cours d'envoi, un délai
 * après DATA ou une erreur d'identifiants pourraient sinon envoyer le même e-mail deux fois, ou échouer à l'identique.
 */
describe("sendEmail — un second essai pour un échec passager", () => {
  const originalSmtp = { ...env.smtp };
  const originalReglages = { ...reglagesEnvoi };
  const sendMail = vi.fn();
  const capturer = vi.mocked(Sentry.captureException);
  const erreur = (code: string, command: string, responseCode?: number) => Object.assign(new Error(`${code} (${command})`), { code, command, responseCode });

  beforeEach(() => {
    reinitialiserAlertesEmailPourTests();
    capturer.mockReset();
    reglagesEnvoi.pauseEntreEssaisMs = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as never);
    env.smtp.user = "agence@test.local";
    env.smtp.appPassword = "un-mot-de-passe-app";
  });

  afterEach(() => {
    Object.assign(env.smtp, originalSmtp);
    Object.assign(reglagesEnvoi, originalReglages);
    sendMail.mockReset();
    vi.restoreAllMocks();
  });

  it("un délai DNS isolé : le second essai part, sans alerte ni message d'erreur", async () => {
    sendMail.mockRejectedValueOnce(erreur("EDNS", "CONN")).mockResolvedValueOnce({ messageId: "msg-1" });

    const resultat = await sendEmail("locataire@exemple.sn", "Votre quittance", "<p>Bonjour</p>");

    expect(resultat).toEqual({ simulated: false, messageId: "msg-1" });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(capturer).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("connexion refusée puis réussie : réessayé ; refus temporaire 4xx : réessayé", async () => {
    sendMail.mockRejectedValueOnce(erreur("ECONNECTION", "CONN")).mockResolvedValueOnce({ messageId: "a" });
    expect(await sendEmail("a@exemple.sn", "S", "<p>x</p>")).toEqual({ simulated: false, messageId: "a" });

    sendMail.mockRejectedValueOnce(erreur("EENVELOPE", "RCPT TO", 451)).mockResolvedValueOnce({ messageId: "b" });
    expect(await sendEmail("b@exemple.sn", "S", "<p>x</p>")).toEqual({ simulated: false, messageId: "b" });
    expect(sendMail).toHaveBeenCalledTimes(4);
  });

  it("deux échecs de suite : un seul essai de plus, une seule erreur journalisée, une seule alerte", async () => {
    sendMail.mockRejectedValue(erreur("EDNS", "CONN"));

    const resultat = await sendEmail("a@exemple.sn", "S", "<p>x</p>");

    expect(resultat).toEqual({ simulated: false, error: true });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(capturer).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["des identifiants refusés", erreur("EAUTH", "AUTH PLAIN", 535)],
    ["une adresse refusée définitivement", erreur("EENVELOPE", "RCPT TO", 550)],
    ["une coupure pendant l'envoi du message", erreur("ECONNECTION", "DATA")],
    ["un délai après l'envoi du message", erreur("ETIMEDOUT", "DATA")],
    ["une erreur sans détail", new Error("inattendu")],
  ])("%s : jamais réessayé, le message a pu partir ou échouerait à l'identique", async (_cas, err) => {
    sendMail.mockRejectedValue(err);

    const resultat = await sendEmail("a@exemple.sn", "S", "<p>x</p>");

    expect(resultat).toEqual({ simulated: false, error: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("un envoi réussi du premier coup n'appelle le serveur qu'une fois", async () => {
    sendMail.mockResolvedValueOnce({ messageId: "msg-1" });
    await sendEmail("a@exemple.sn", "S", "<p>x</p>");
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
