import * as Sentry from "@sentry/node";
import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { formalNoticeEmail, guarantorFormalNoticeEmail, newMessageForOwnerEmail, newMessageFromManagerEmail, reglagesEnvoi, reinitialiserAlertesEmailPourTests, sendEmail, settlementEmail } from "./email.service";

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));

/**
 * Cas limites des e-mails : aperçu tronqué d'un message, « 1 jour » au singulier dans les mises en demeure, les trois
 * formulations du solde de tout compte (somme à restituer, reste à régler, compte soldé), et un échec d'envoi dont
 * l'erreur n'en est pas une (rien, une chaîne) — l'envoi répond « échec » sans jamais lever d'exception.
 */

const sansEspaces = (s: string) => s.split(" ").join("").split(" ").join("").split(" ").join("");
const texte = (html: string) => html.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).join(" ");

describe("newMessageForOwnerEmail : aperçu du message", () => {
  const apercu = (content: string) => {
    const { html } = newMessageForOwnerEmail({ ownerName: "Fatou", content, frontendUrl: "https://app.test" });
    return html;
  };

  it("un message de 220 caractères ou moins est rendu en entier, sans points de suspension", () => {
    const court = "a".repeat(220);

    const html = apercu(court);

    expect(html).toContain(court);
    expect(html).not.toContain("…");
  });

  it("au-delà de 220 caractères, l'aperçu est coupé à 220 et se termine par des points de suspension", () => {
    const html = apercu("a".repeat(221));

    expect(html).toContain(`${"a".repeat(220)}…`);
    expect(html).not.toContain("a".repeat(221));
  });

  it("le contenu du message est échappé : aucune balise ne passe dans le courriel", () => {
    const html = apercu('<script>alert("x")</script> bonjour');

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("le lien mène à la discussion de l'espace propriétaire", () => {
    expect(apercu("Bonjour")).toContain('href="https://app.test/proprietaire/messages"');
  });
});

describe("newMessageFromManagerEmail : aperçu du message reçu par le locataire", () => {
  const apercu = (content: string) => newMessageFromManagerEmail({ tenantName: "Awa <Sow>", propertyTitle: "Villa Ngor", content, frontendUrl: "https://app.test" }).html;

  it("un message de 220 caractères ou moins est rendu en entier, sans points de suspension", () => {
    const html = apercu("b".repeat(220));

    expect(html).toContain("b".repeat(220));
    expect(html).not.toContain("…");
  });

  it("au-delà de 220 caractères, l'aperçu est coupé à 220 et se termine par des points de suspension", () => {
    const html = apercu("b".repeat(221));

    expect(html).toContain(`${"b".repeat(220)}…`);
    expect(html).not.toContain("b".repeat(221));
  });

  it("le contenu, le nom du locataire et le titre du bien sont échappés ; le lien mène au portail locataire", () => {
    const html = newMessageFromManagerEmail({ tenantName: "Awa <Sow>", propertyTitle: "Villa <Ngor>", content: '<img src=x onerror="alert(1)">', frontendUrl: "https://app.test" }).html;

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("Awa <Sow>");
    expect(html).not.toContain("Villa <Ngor>");
    expect(html).toContain('href="https://app.test/portail/messages"');
  });
});

describe("mises en demeure : « jour » au singulier ou au pluriel", () => {
  const demeure = (deadlineDays: number) =>
    formalNoticeEmail({ tenantName: "Awa <Sow>", propertyTitle: "Villa Ngor", totalDue: 1500, currency: "EUR", deadlineDays, agencyName: "Agence Dakar", reference: "MED-2026-01" });
  const copieGarant = (deadlineDays: number, maxAmount?: number | null) =>
    guarantorFormalNoticeEmail({ guarantorName: "Moussa", tenantName: "Awa Sow", propertyTitle: "Villa Ngor", totalDue: 1500, currency: "EUR", deadlineDays, agencyName: "Agence Dakar", reference: "MED-2026-01", maxAmount });

  it("à l'intention du locataire : « 1 jour » puis « 8 jours », avec le total, la référence et le sujet", () => {
    const un = demeure(1);
    const huit = demeure(8);

    expect(texte(un.html)).toContain("sous 1 jour à compter de la réception");
    expect(texte(un.html)).not.toContain("1 jours");
    expect(texte(huit.html)).toContain("sous 8 jours à compter de la réception");
    expect(sansEspaces(un.html)).toContain("1500");
    expect(un.html).toContain("MED-2026-01");
    expect(un.subject).toBe("Mise en demeure de payer — Villa Ngor (réf. MED-2026-01)");
  });

  it("deux jours s'écrit déjà au pluriel (frontière du singulier)", () => {
    expect(texte(demeure(2).html)).toContain("sous 2 jours à compter de la réception");
    expect(texte(copieGarant(2).html)).toContain("à régler sous 2 jours.");
  });

  it("le nom du locataire est échappé", () => {
    const { html } = demeure(8);

    expect(html).not.toContain("Awa <Sow>");
    expect(html).toContain("Awa &lt;Sow&gt;");
  });

  it("à l'intention du garant : « 1 jour » puis « 15 jours »", () => {
    expect(texte(copieGarant(1).html)).toContain("à régler sous 1 jour.");
    expect(texte(copieGarant(15).html)).toContain("à régler sous 15 jours.");
    expect(copieGarant(1).subject).toBe("Copie : mise en demeure de payer adressée à Awa Sow (réf. MED-2026-01)");
  });

  it("le plafond du garant n'est rappelé que s'il est connu", () => {
    const sans = copieGarant(8);
    const avec = copieGarant(8, 3000);

    expect(sansEspaces(avec.html)).toContain("3000");
    expect(sansEspaces(sans.html)).not.toContain("3000");
    expect(avec.html.length).toBeGreaterThan(sans.html.length);
  });
});

describe("settlementEmail : solde de tout compte", () => {
  const solde = (balance: number) => settlementEmail({ tenantName: "Awa Sow", propertyTitle: "Villa Ngor", balance, currency: "EUR", agencyName: "Agence Dakar", reference: "SOL-2026-01" });

  it("somme à restituer au locataire (solde positif), montant en valeur absolue", () => {
    const { html } = solde(450);

    expect(html).toContain("Somme à vous restituer");
    expect(html).toContain("Après déduction de ce qui était dû, une somme vous revient.");
    expect(html).not.toContain("Reste à régler");
    expect(html).not.toContain("Compte soldé");
    expect(sansEspaces(html)).toContain("450");
  });

  it("reste à régler par le locataire (solde négatif), montant affiché sans signe", () => {
    const { html } = solde(-450);

    expect(html).toContain("Reste à régler");
    expect(html).toContain("Après imputation du dépôt de garantie, il reste une somme à régler à l'agence.");
    expect(html).not.toContain("Somme à vous restituer");
    expect(sansEspaces(html)).toContain("450");
    expect(sansEspaces(html)).not.toContain("-450");
  });

  it("compte soldé (solde nul)", () => {
    const { html } = solde(0);

    expect(html).toContain("Compte soldé");
    expect(html).toContain("Aucune somme n'est due de part ni d'autre.");
    expect(html).not.toContain("Somme à vous restituer");
    expect(html).not.toContain("Reste à régler");
  });

  it("le sujet porte le bien et la référence", () => {
    expect(solde(1).subject).toBe("Solde de tout compte — Villa Ngor (réf. SOL-2026-01)");
  });
});

describe("sendEmail : un échec dont l'erreur n'en est pas une", () => {
  const originalSmtp = { ...env.smtp };
  const originalReglages = { ...reglagesEnvoi };
  const sendMail = vi.fn();
  const capturer = vi.mocked(Sentry.captureException);

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

  it("un rejet sans valeur (null) : l'envoi répond « échec » sans lever, l'alerte part avec le code INCONNU, pas de second essai", async () => {
    sendMail.mockRejectedValue(null);

    const resultat = await sendEmail("locataire@exemple.sn", "Sujet", "<p>x</p>");

    expect(resultat).toEqual({ simulated: false, error: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(capturer).toHaveBeenCalledTimes(1);
    expect(capturer.mock.calls[0][0]).toEqual(new Error("Échec d'envoi d'e-mail (SMTP) : INCONNU"));
    expect((capturer.mock.calls[0][1] as { tags: { smtp_code: string } }).tags.smtp_code).toBe("INCONNU");
  });

  it("un rejet par une simple chaîne : la valeur brute est consignée, l'alerte part, aucune exception", async () => {
    sendMail.mockRejectedValue("connexion coupée");

    const resultat = await sendEmail("locataire@exemple.sn", "Sujet", "<p>x</p>");

    expect(resultat).toEqual({ simulated: false, error: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Échec de l'envoi vers"), "connexion coupée");
    expect(capturer).toHaveBeenCalledTimes(1);
  });

  it("un échec porteur d'une vraie erreur consigne son message, pas l'objet", async () => {
    sendMail.mockRejectedValue(Object.assign(new Error("535 Authentication failed"), { code: "EAUTH", responseCode: 535 }));

    await sendEmail("locataire@exemple.sn", "Sujet", "<p>x</p>");

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Échec de l'envoi vers"), "535 Authentication failed");
    expect((capturer.mock.calls[0][1] as { tags: { smtp_code: string } }).tags.smtp_code).toBe("EAUTH");
  });

  it("un code d'erreur vide ou qui n'est pas du texte est classé INCONNU", async () => {
    for (const code of ["", 535, null]) {
      capturer.mockReset();
      reinitialiserAlertesEmailPourTests();
      sendMail.mockRejectedValue({ code });

      await sendEmail("locataire@exemple.sn", "Sujet", "<p>x</p>");

      expect((capturer.mock.calls[0][1] as { tags: { smtp_code: string } }).tags.smtp_code, String(code)).toBe("INCONNU");
    }
  });

  it("une erreur sans code (objet vide) est classée INCONNU, sans second essai", async () => {
    sendMail.mockRejectedValue({});

    const resultat = await sendEmail("locataire@exemple.sn", "Sujet", "<p>x</p>");

    expect(resultat).toEqual({ simulated: false, error: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect((capturer.mock.calls[0][1] as { tags: { smtp_code: string } }).tags.smtp_code).toBe("INCONNU");
  });
});
