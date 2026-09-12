import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import {
  contractEndingReminderEmail,
  emailVerificationEmail,
  issueStatusUpdateEmail,
  newMessageFromManagerEmail,
  passwordResetEmail,
  rentDueReminderEmail,
  rentDueSoonReminderEmail,
  sendEmail,
} from "./email.service";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(),
  },
}));

// sendEmail() est le point de sortie réel de tous les emails de l'application
// (mots de passe, rappels de loyer, notifications d'incidents...). En test,
// SMTP_USER est renseigné mais SMTP_APP_PASSWORD reste vide (voir
// setupTestDb.ts) : toutes les AUTRES suites de test l'exercent donc
// uniquement en mode "simulé", jamais la branche SMTP réelle (succès ou
// échec) ni la transmission des pièces jointes.
describe("sendEmail", () => {
  const originalSmtp = { ...env.smtp };

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    env.smtp.user = originalSmtp.user;
    env.smtp.appPassword = originalSmtp.appPassword;
    vi.restoreAllMocks();
  });

  it("simule l'envoi (ne throw pas, ne contacte aucun SMTP) quand SMTP n'est pas configuré", async () => {
    env.smtp.user = "";
    env.smtp.appPassword = "";
    const result = await sendEmail("locataire@test.local", "Sujet de test", "<p>Contenu</p>");
    expect(result).toEqual({ simulated: true });
    expect(console.warn).toHaveBeenCalled();
  });

  it("envoie réellement l'email (et les pièces jointes) quand SMTP est configuré", async () => {
    env.smtp.user = "agence@test.local";
    env.smtp.appPassword = "un-mot-de-passe-app";
    const sendMail = vi.fn().mockResolvedValue({ messageId: "msg-123" });
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as any);

    const attachments = [{ filename: "quittance.pdf", content: Buffer.from("pdf"), contentType: "application/pdf" }];
    const result = await sendEmail("locataire@test.local", "Sujet réel", "<p>Contenu réel</p>", attachments);

    expect(result).toEqual({ simulated: false, messageId: "msg-123" });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "locataire@test.local",
        subject: "Sujet réel",
        html: "<p>Contenu réel</p>",
        attachments,
      })
    );
  });

  it("renvoie simulated:false et error:true (sans jeter) si l'envoi SMTP échoue", async () => {
    env.smtp.user = "agence@test.local";
    env.smtp.appPassword = "un-mot-de-passe-app";
    const sendMail = vi.fn().mockRejectedValue(new Error("Connexion SMTP refusée"));
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as any);

    const result = await sendEmail("locataire@test.local", "Sujet", "<p>Contenu</p>");

    expect(result).toEqual({ simulated: false, error: true });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("templates d'emails", () => {
  it("passwordResetEmail : intègre l'URL de réinitialisation fournie", () => {
    const { subject, html } = passwordResetEmail({ resetUrl: "https://app.test/reset?token=abc123" });
    expect(subject).toMatch(/mot de passe/);
    expect(html).toContain("https://app.test/reset?token=abc123");
  });

  it("emailVerificationEmail : intègre l'URL de vérification fournie", () => {
    const { subject, html } = emailVerificationEmail({ verifyUrl: "https://app.test/verify?token=xyz789" });
    expect(subject).toMatch(/email/i);
    expect(html).toContain("https://app.test/verify?token=xyz789");
  });

  it("contractEndingReminderEmail : formate la date en français et inclut le nombre de jours restants", () => {
    const { subject, html } = contractEndingReminderEmail({
      tenantName: "Fatou Ndiaye",
      propertyTitle: "Appartement Plateau",
      endDate: new Date(2026, 8, 15), // 15 septembre 2026
      daysLeft: 14,
    });
    expect(subject).toContain("14 jours");
    expect(subject).toContain("Appartement Plateau");
    expect(html).toContain("Fatou Ndiaye");
    expect(html).toContain("15 septembre 2026");
  });

  it("issueStatusUpdateEmail : traduit un statut connu (RESOLVED) en libellé et couleur", () => {
    const { subject, html } = issueStatusUpdateEmail({
      tenantName: "Moussa Fall",
      issueTitle: "Fuite d'eau",
      propertyTitle: "Villa Almadies",
      status: "RESOLVED",
      managerNote: null,
      frontendUrl: "https://app.test",
    });
    expect(subject).toContain("Fuite d'eau");
    expect(html).toContain("Résolu");
    expect(html).not.toContain("Message de votre agence"); // pas de note affichée si managerNote est null
  });

  it("issueStatusUpdateEmail : retombe sur le statut brut si inconnu, et affiche la note du gestionnaire fournie", () => {
    const { html } = issueStatusUpdateEmail({
      tenantName: "Moussa Fall",
      issueTitle: "Fuite d'eau",
      propertyTitle: "Villa Almadies",
      status: "STATUT_INCONNU",
      managerNote: "Un plombier passera demain matin.",
      frontendUrl: "https://app.test",
    });
    expect(html).toContain("STATUT_INCONNU");
    expect(html).toContain("Un plombier passera demain matin.");
  });

  it("newMessageFromManagerEmail : affiche le contenu intégral s'il est court", () => {
    const { html } = newMessageFromManagerEmail({
      tenantName: "Aïda Sow",
      propertyTitle: "Studio Mermoz",
      content: "Merci de penser à régler votre loyer avant vendredi.",
      frontendUrl: "https://app.test",
    });
    expect(html).toContain("Merci de penser à régler votre loyer avant vendredi.");
    expect(html).not.toContain("…");
  });

  it("newMessageFromManagerEmail : tronque le contenu à 220 caractères avec une ellipse s'il est trop long", () => {
    const longContent = "A".repeat(300);
    const { html } = newMessageFromManagerEmail({
      tenantName: "Aïda Sow",
      propertyTitle: "Studio Mermoz",
      content: longContent,
      frontendUrl: "https://app.test",
    });
    expect(html).toContain(`${"A".repeat(220)}…`);
    expect(html).not.toContain("A".repeat(221));
  });

  it("rentDueReminderEmail : traduit le mois et affiche le montant", () => {
    const { subject, html } = rentDueReminderEmail({
      tenantName: "Ibrahima Diop",
      propertyTitle: "Résidence Ouakam",
      amount: 150000,
      periodMonth: 3,
      periodYear: 2026,
      dueDate: new Date(2026, 2, 5),
      frontendUrl: "https://app.test",
    });
    expect(subject).toContain("mars 2026");
    expect(html).toContain("Ibrahima Diop");
    expect(html).toContain("150000 €");
  });

  it("rentDueReminderEmail : affiche la devise personnalisée et assainit le HTML", () => {
    const { html } = rentDueReminderEmail({
      tenantName: "<script>alert('xss')</script>Amadou",
      propertyTitle: "Villa <b>Almadies</b>",
      amount: 450000,
      currency: "XOF",
      periodMonth: 4,
      periodYear: 2026,
      dueDate: new Date(2026, 3, 5),
      frontendUrl: "https://app.test",
    });
    expect(html).toContain("450000 XOF");
    expect(html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;Amadou");
    expect(html).not.toContain("<script>");
  });

  it("rentDueSoonReminderEmail : accorde 'jour' au singulier et inclut la devise fournie", () => {
    const { subject, html } = rentDueSoonReminderEmail({
      tenantName: "Ibrahima Diop",
      propertyTitle: "Résidence Ouakam",
      amount: 150000,
      currency: "XOF",
      periodMonth: 3,
      periodYear: 2026,
      daysLeft: 1,
      dueDate: new Date(2026, 2, 5),
      frontendUrl: "https://app.test",
    });
    expect(subject).toContain("dans 1 jour(s)");
    expect(html).toContain("(dans 1 jour)"); // singulier, pas "1 jours"
    expect(html).toContain("150000 XOF");
  });

  it("rentDueSoonReminderEmail : accorde 'jours' au pluriel quand daysLeft > 1", () => {
    const { html } = rentDueSoonReminderEmail({
      tenantName: "Ibrahima Diop",
      propertyTitle: "Résidence Ouakam",
      amount: 150000,
      currency: "XOF",
      periodMonth: 3,
      periodYear: 2026,
      daysLeft: 3,
      dueDate: new Date(2026, 2, 5),
      frontendUrl: "https://app.test",
    });
    expect(html).toContain("(dans 3 jours)");
  });
});
