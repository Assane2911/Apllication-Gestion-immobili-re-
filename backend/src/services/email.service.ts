import nodemailer from "nodemailer";
import { env } from "../config/env";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!env.smtp.user || !env.smtp.appPassword) {
    return null; // pas configuré: on log au lieu d'envoyer (dev / avant configuration)
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: {
        user: env.smtp.user,
        pass: env.smtp.appPassword,
      },
      // Évite qu'un SMTP mal configuré ou injoignable ne bloque le job de rappel indéfiniment.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string) {
  const t = getTransporter();
  if (!t) {
    console.warn(
      `[email] SMTP non configuré (SMTP_USER/SMTP_APP_PASSWORD manquants) — email simulé vers ${to}: "${subject}"`
    );
    return { simulated: true };
  }
  try {
    const info = await t.sendMail({
      from: env.smtp.from,
      to,
      subject,
      html,
    });
    return { simulated: false, messageId: info.messageId };
  } catch (err) {
    console.error(`[email] Échec de l'envoi vers ${to}:`, err instanceof Error ? err.message : err);
    return { simulated: false, error: true };
  }
}

export function contractEndingReminderEmail(params: {
  tenantName: string;
  propertyTitle: string;
  endDate: Date;
  daysLeft: number;
}) {
  const { tenantName, propertyTitle, endDate, daysLeft } = params;
  const formattedDate = endDate.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
  return {
    subject: `Rappel : fin de contrat dans ${daysLeft} jours — ${propertyTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#1f2937;">Rappel de fin de contrat de location</h2>
        <p>Bonjour,</p>
        <p>
          Le contrat de location de <strong>${tenantName}</strong> pour le bien
          <strong>${propertyTitle}</strong> arrive à échéance le
          <strong>${formattedDate}</strong> (dans ${daysLeft} jours).
        </p>
        <p>Pensez à contacter le locataire pour discuter d'un renouvellement, d'un état des lieux de sortie ou de la libération du bien.</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          Cet email a été envoyé automatiquement par votre application de gestion immobilière.
        </p>
      </div>
    `,
  };
}
