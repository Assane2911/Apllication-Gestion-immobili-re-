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

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export async function sendEmail(to: string, subject: string, html: string, attachments?: EmailAttachment[]) {
  const t = getTransporter();
  if (!t) {
    console.warn(
      `[email] SMTP non configuré (SMTP_USER/SMTP_APP_PASSWORD manquants) — email simulé vers ${to}: "${subject}"` +
        (attachments?.length ? ` (avec ${attachments.length} pièce(s) jointe(s))` : "")
    );
    return { simulated: true };
  }
  try {
    const info = await t.sendMail({
      from: env.smtp.from,
      to,
      subject,
      html,
      attachments,
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

/**
 * Template d'email de rappel de loyer envoyé automatiquement au locataire
 * au 1er de chaque mois, rappelant l'échéance à régler au plus tard le 5.
 */
export function rentDueReminderEmail(params: {
  tenantName: string;
  propertyTitle: string;
  amount: number;
  periodMonth: number;
  periodYear: number;
  dueDate: Date;
  frontendUrl: string;
}) {
  const { tenantName, propertyTitle, amount, periodMonth, periodYear, frontendUrl } = params;
  const monthNames = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre"
  ];
  const monthName = monthNames[periodMonth - 1] || `${periodMonth}`;

  return {
    subject: `📢 Échéance de loyer ${monthName} ${periodYear} — Règlement attendu avant le 5`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #0f172a; padding: 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700;">Avis d'Échéance de Loyer</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">${monthName} ${periodYear} • ${propertyTitle}</p>
        </div>
        <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
          <p style="font-size: 15px; margin-top: 0;">Bonjour <strong>${tenantName}</strong>,</p>
          <p>
            Votre avis d'échéance de loyer pour le mois de <strong>${monthName} ${periodYear}</strong> concernant le bien <strong>${propertyTitle}</strong> est désormais émis.
          </p>
          
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
            <span style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">Montant à régler</span>
            <div style="font-size: 32px; font-weight: 900; color: #0f172a; margin: 8px 0;">${amount} €</div>
            <div style="display: inline-block; background: #fef3c7; color: #92400e; font-size: 12px; font-weight: bold; padding: 6px 14px; border-radius: 20px; border: 1px solid #fde68a;">
              ⏰ Date limite de règlement : au plus tard le 5 ${monthName} ${periodYear}
            </div>
          </div>

          <p style="font-size: 13px; color: #475569;">
            Conformément à votre bail de location, nous vous remercions de procéder au paiement de votre loyer dans les délais impartis.
          </p>

          <div style="text-align: center; margin: 28px 0 20px 0;">
            <a href="${frontendUrl}/portail/paiements" style="background: #2563eb; color: #ffffff; padding: 12px 28px; text-decoration: none; font-weight: bold; font-size: 14px; border-radius: 8px; display: inline-block; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
              Régler mon loyer en ligne →
            </a>
          </div>
          <p style="font-size: 12px; color: #94a3b8; text-align: center;">
            Moyens acceptés : Carte bancaire, Mobile Money (Orange/MTN), virement bancaire.
          </p>
        </div>
        <div style="background: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
          Cet email vous a été envoyé automatiquement par votre agence de gestion immobilière.
        </div>
      </div>
    `,
  };
}

