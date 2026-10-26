import * as Sentry from "@sentry/node";
import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { reinitialiserAlertesEmailPourTests, sendEmail } from "./email.service";

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));

/**
 * `sendEmail` avale volontairement ses échecs (un SMTP en panne ne doit jamais faire échouer l'action métier :
 * encaissement, création de bail...) et se contentait d'une ligne de journal. Un serveur d'envoi mal configuré — mot de
 * passe expiré, hôte qui ne correspond pas aux identifiants, expéditeur refusé — passait donc inaperçu : plus aucune
 * confirmation d'adresse, plus aucune quittance, sans que personne ne soit prévenu.
 *
 * L'échec est maintenant signalé à Sentry, au plus une fois par cause et par tranche de dix minutes (une panne
 * ferait sinon une alerte par e-mail), sans l'adresse du destinataire ni le sujet.
 */
describe("alerte Sentry quand l'envoi d'e-mails échoue", () => {
  const originalSmtp = { ...env.smtp };
  // Le transporteur est mémorisé au premier appel : un seul `sendMail` partagé, reconfiguré à chaque test.
  const sendMail = vi.fn();
  const capturer = vi.mocked(Sentry.captureException);
  const erreurSmtp = (code: string, message: string, responseCode?: number) =>
    Object.assign(new Error(message), { code, responseCode, command: "AUTH PLAIN" });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0));
    reinitialiserAlertesEmailPourTests();
    capturer.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as never);
    env.smtp.user = "agence@test.local";
    env.smtp.appPassword = "un-mot-de-passe-app";
    env.smtp.host = "smtp.exemple.test";
    env.smtp.from = "Gestion Immobilière <contact@immoplatformpro.test>";
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.assign(env.smtp, originalSmtp);
    sendMail.mockReset();
    vi.restoreAllMocks();
  });

  it("signale l'échec à Sentry, avec la cause, l'hôte et le domaine de l'expéditeur de quoi diagnostiquer", async () => {
    sendMail.mockRejectedValueOnce(erreurSmtp("EAUTH", "Invalid login: 535 5.7.8 Username and Password not accepted", 535));

    const resultat = await sendEmail("locataire@exemple.sn", "Votre quittance", "<p>Bonjour</p>");

    expect(resultat).toEqual({ simulated: false, error: true }); // le comportement de l'envoi ne change pas
    expect(capturer).toHaveBeenCalledTimes(1);
    const [erreur, contexte] = capturer.mock.calls[0] as [Error, Record<string, any>];
    expect(erreur.message).toContain("EAUTH");
    expect(contexte.tags).toMatchObject({ source: "email.sendEmail", smtp_code: "EAUTH" });
    expect(contexte.extra).toMatchObject({ responseCode: 535, hote: "smtp.exemple.test", domaine_expediteur: "immoplatformpro.test" });
    // Une même cause, un même groupe dans Sentry.
    expect(contexte.fingerprint).toEqual(["email-send-failure", "EAUTH", "535"]);
  });

  it("n'envoie à Sentry ni l'adresse du destinataire, ni le sujet, ni le message d'origine du serveur", async () => {
    sendMail.mockRejectedValueOnce(erreurSmtp("EENVELOPE", "Can't send mail - all recipients were rejected: 550 <amadou.diallo@exemple.sn> no such user", 550));

    await sendEmail("amadou.diallo@exemple.sn", "Quittance de loyer — Villa Ngor", "<p>Bonjour</p>");

    expect(capturer).toHaveBeenCalledTimes(1);
    const transmis = JSON.stringify(capturer.mock.calls[0], (_cle, valeur) => (valeur instanceof Error ? { name: valeur.name, message: valeur.message } : valeur));
    expect(transmis).not.toContain("amadou.diallo");
    expect(transmis).not.toContain("exemple.sn");
    expect(transmis).not.toContain("Quittance de loyer");
    expect(transmis).not.toContain("no such user");
  });

  it("ne signale qu'une fois par cause et par tranche de dix minutes, mais journalise chaque échec", async () => {
    sendMail.mockRejectedValue(erreurSmtp("ECONNECTION", "connect ECONNREFUSED 127.0.0.1:465"));

    for (let i = 0; i < 5; i++) await sendEmail(`locataire${i}@exemple.sn`, "Sujet", "<p>x</p>");

    expect(capturer).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(5);

    vi.setSystemTime(new Date(2026, 9, 26, 12, 9, 59));
    await sendEmail("a@exemple.sn", "Sujet", "<p>x</p>");
    expect(capturer).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(2026, 9, 26, 12, 10, 1));
    await sendEmail("a@exemple.sn", "Sujet", "<p>x</p>");
    expect(capturer).toHaveBeenCalledTimes(2);
  });

  it("une autre cause est signalée tout de suite, même si la première vient de l'être", async () => {
    sendMail.mockRejectedValueOnce(erreurSmtp("EAUTH", "Invalid login", 535));
    sendMail.mockRejectedValueOnce(erreurSmtp("EENVELOPE", "Sender not allowed", 553));
    sendMail.mockRejectedValueOnce(erreurSmtp("EENVELOPE", "No such user", 550));

    await sendEmail("a@exemple.sn", "S", "<p>x</p>");
    await sendEmail("b@exemple.sn", "S", "<p>x</p>");
    await sendEmail("c@exemple.sn", "S", "<p>x</p>");

    const empreintes = capturer.mock.calls.map((appel) => (appel[1] as { fingerprint: string[] }).fingerprint.join("|"));
    expect(empreintes).toEqual(["email-send-failure|EAUTH|535", "email-send-failure|EENVELOPE|553", "email-send-failure|EENVELOPE|550"]);
  });

  it("une erreur sans code (rare) est signalée sous « INCONNU », sans faire échouer l'envoi", async () => {
    sendMail.mockRejectedValueOnce(new Error("quelque chose d'inattendu"));
    const resultat = await sendEmail("a@exemple.sn", "S", "<p>x</p>");
    expect(resultat).toEqual({ simulated: false, error: true });
    expect((capturer.mock.calls[0][1] as { tags: Record<string, string> }).tags.smtp_code).toBe("INCONNU");
  });

  it("ne signale rien quand l'envoi réussit, ni en mode simulé", async () => {
    sendMail.mockResolvedValueOnce({ messageId: "msg-1" });
    await sendEmail("a@exemple.sn", "S", "<p>x</p>");

    env.smtp.user = "";
    env.smtp.appPassword = "";
    await sendEmail("a@exemple.sn", "S", "<p>x</p>");

    expect(capturer).not.toHaveBeenCalled();
  });

  it("ne fait jamais échouer l'envoi si Sentry lui-même lève une erreur", async () => {
    sendMail.mockRejectedValueOnce(erreurSmtp("EAUTH", "Invalid login", 535));
    capturer.mockImplementationOnce(() => {
      throw new Error("Sentry indisponible");
    });
    await expect(sendEmail("a@exemple.sn", "S", "<p>x</p>")).resolves.toEqual({ simulated: false, error: true });
  });
});
