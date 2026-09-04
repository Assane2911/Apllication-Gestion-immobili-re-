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

/**
 * Email envoyé lors d'une demande de réinitialisation de mot de passe
 * (page "Mot de passe oublié"). Le lien contient un token à usage unique,
 * valable 1 heure — voir auth.controller.ts (forgotPassword / resetPassword).
 */
export function passwordResetEmail(params: { resetUrl: string }) {
  const { resetUrl } = params;
  return {
    subject: "🔒 Réinitialisation de votre mot de passe",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">🔒 Réinitialisation de votre mot de passe</h2>
        <p>Bonjour,</p>
        <p>
          Vous avez demandé la réinitialisation du mot de passe de votre compte.
          Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
          Ce lien est valable <strong>1 heure</strong>.
        </p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${resetUrl}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            Réinitialiser mon mot de passe →
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">
          Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email sans risque :
          votre mot de passe actuel reste inchangé.
        </p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          Cet email a été envoyé automatiquement par votre application de gestion immobilière.
        </p>
      </div>
    `,
  };
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

const issueStatusLabels: Record<string, { label: string; color: string; emoji: string }> = {
  OPEN: { label: "Ouvert", color: "#2563eb", emoji: "📋" },
  IN_PROGRESS: { label: "En cours de traitement", color: "#d97706", emoji: "🔧" },
  RESOLVED: { label: "Résolu", color: "#059669", emoji: "✅" },
  REJECTED: { label: "Rejeté", color: "#dc2626", emoji: "✖️" },
};

/**
 * Email envoyé au locataire lorsque le gestionnaire met à jour le statut
 * d'un incident qu'il a signalé (pris en compte, en cours, résolu, rejeté).
 */
export function issueStatusUpdateEmail(params: {
  tenantName: string;
  issueTitle: string;
  propertyTitle: string;
  status: string;
  managerNote?: string | null;
  frontendUrl: string;
}) {
  const { tenantName, issueTitle, propertyTitle, status, managerNote, frontendUrl } = params;
  const meta = issueStatusLabels[status] ?? { label: status, color: "#334155", emoji: "ℹ️" };

  return {
    subject: `${meta.emoji} Mise à jour de votre signalement — ${issueTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${meta.emoji} Mise à jour de votre incident signalé</h2>
        <p>Bonjour ${tenantName},</p>
        <p>
          Le statut de votre signalement <strong>« ${issueTitle} »</strong> concernant le logement
          <strong>${propertyTitle}</strong> a été mis à jour :
        </p>
        <div style="display:inline-block; background:${meta.color}1a; color:${meta.color}; font-weight:bold; padding:8px 16px; border-radius:20px; border:1px solid ${meta.color}40; margin: 8px 0 16px 0;">
          ${meta.label}
        </div>
        ${managerNote ? `<p style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px; color:#334155;"><strong>Message de votre agence :</strong><br/>${managerNote}</p>` : ""}
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${frontendUrl}/portail/incidents" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            Voir mes signalements →
          </a>
        </div>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          Cet email a été envoyé automatiquement par votre application de gestion immobilière.
        </p>
      </div>
    `,
  };
}

/** Email envoyé au locataire lorsqu'il reçoit un nouveau message de son agence. */
export function newMessageFromManagerEmail(params: {
  tenantName: string;
  propertyTitle: string;
  content: string;
  frontendUrl: string;
}) {
  const { tenantName, propertyTitle, content, frontendUrl } = params;
  const preview = content.length > 220 ? `${content.slice(0, 220)}…` : content;

  return {
    subject: `💬 Nouveau message de votre agence — ${propertyTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">💬 Nouveau message de votre agence</h2>
        <p>Bonjour ${tenantName},</p>
        <p>Vous avez reçu un nouveau message concernant le logement <strong>${propertyTitle}</strong> :</p>
        <p style="background:#f8fafc; border-left:3px solid #2563eb; border-radius:4px; padding:12px 16px; color:#334155; font-style:italic;">
          « ${preview} »
        </p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${frontendUrl}/portail/messages" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            Répondre au message →
          </a>
        </div>
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
            Moyens acceptés : Carte bancaire, PayDunya (Orange Money, Wave, MTN...), virement bancaire.
          </p>
        </div>
        <div style="background: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
          Cet email vous a été envoyé automatiquement par votre agence de gestion immobilière.
        </div>
      </div>
    `,
  };
}

/**
 * Rappel complémentaire envoyé quelques jours AVANT la date d'échéance d'une
 * facture encore impayée (en plus de l'avis du 1er du mois) — pense-bête de
 * dernière minute pour réduire les retards de paiement.
 */
export function rentDueSoonReminderEmail(params: {
  tenantName: string;
  propertyTitle: string;
  amount: number;
  currency: string;
  periodMonth: number;
  periodYear: number;
  daysLeft: number;
  dueDate: Date;
  frontendUrl: string;
}) {
  const { tenantName, propertyTitle, amount, currency, periodMonth, periodYear, daysLeft, dueDate, frontendUrl } = params;
  const monthNames = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre"
  ];
  const monthName = monthNames[periodMonth - 1] || `${periodMonth}`;
  const formattedDueDate = dueDate.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });

  return {
    subject: `⏰ Rappel : votre loyer de ${monthName} arrive à échéance dans ${daysLeft} jour(s)`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #92400e; padding: 20px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 18px; font-weight: 700;">⏰ Rappel avant échéance</h1>
        </div>
        <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
          <p>Bonjour <strong>${tenantName}</strong>,</p>
          <p>
            Votre loyer de <strong>${monthName} ${periodYear}</strong> pour le logement
            <strong>${propertyTitle}</strong> n'a pas encore été réglé et arrive à échéance le
            <strong>${formattedDueDate}</strong> (dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}).
          </p>
          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 16px; margin: 16px 0; text-align: center;">
            <span style="font-size: 24px; font-weight: 900; color: #92400e;">${amount} ${currency}</span>
          </div>
          <div style="text-align: center; margin: 20px 0;">
            <a href="${frontendUrl}/portail/paiements" style="background: #2563eb; color: #ffffff; padding: 12px 28px; text-decoration: none; font-weight: bold; font-size: 14px; border-radius: 8px; display: inline-block;">
              Régler mon loyer maintenant →
            </a>
          </div>
        </div>
        <div style="background: #f8fafc; padding: 14px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
          Cet email vous a été envoyé automatiquement par votre agence de gestion immobilière.
        </div>
      </div>
    `,
  };
}

