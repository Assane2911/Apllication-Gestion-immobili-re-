import nodemailer from "nodemailer";
import { env } from "../config/env";
import { formaterMontant } from "../utils/montant";

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

/**
 * Masque une adresse email destinee aux journaux.
 *
 * L'application ecrivait l'adresse complete du destinataire dans la sortie
 * standard, a chaque echec SMTP et a chaque email simule. Ces lignes sont
 * conservees par l'hebergeur, lisibles par toute personne ayant acces au
 * tableau de bord, et exportables : les journaux devenaient un second fichier
 * de donnees personnelles, non declare, alimente sans qu'on le decide. Or
 * pour diagnostiquer un envoi il suffit de reconnaitre une adresse, pas de
 * la lire en entier.
 *
 * Le domaine est conserve : c'est lui qui porte l'information utile au
 * diagnostic (un seul fournisseur qui refuse, un domaine mal orthographie).
 */
function masquer(email: string): string {
  const arobase = email.lastIndexOf("@");
  if (arobase < 1) return "***";
  return `${email[0]}***${email.slice(arobase)}`;
}

/**
 * Neutralise toute tentative d'injection d'en-tête (CRLF) dans un champ qui
 * finit dans un en-tête SMTP (destinataire, sujet) et qui peut contenir du
 * texte saisi par un utilisateur (nom d'agence, de locataire, de
 * collaborateur...) — un `\r\nBcc: ...` glissé dans un nom ajouterait sinon
 * un destinataire ou un en-tête arbitraire au message.
 *
 * nodemailer neutralise déjà lui-même les retours à la ligne dans ces
 * champs ; cette défense ne doit toutefois pas reposer uniquement sur un
 * comportement interne d'une dépendance de transport, qui pourrait changer
 * silencieusement. `escapeHtml` ci-dessous protège le corps HTML, pas les
 * en-têtes : les deux sont nécessaires, aucun ne remplace l'autre.
 */
function neutraliserEnTete(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function sendEmail(to: string, subject: string, html: string, attachments?: EmailAttachment[]) {
  const destinataire = neutraliserEnTete(to);
  const sujet = neutraliserEnTete(subject);

  const t = getTransporter();
  if (!t) {
    console.warn(
      `[email] SMTP non configuré (SMTP_USER/SMTP_APP_PASSWORD manquants) — email simulé vers ${masquer(destinataire)}: "${sujet}"` +
        (attachments?.length ? ` (avec ${attachments.length} pièce(s) jointe(s))` : "")
    );
    return { simulated: true };
  }
  try {
    const info = await t.sendMail({
      from: env.smtp.from,
      to: destinataire,
      subject: sujet,
      html,
      attachments,
    });
    return { simulated: false, messageId: info.messageId };
  } catch (err) {
    console.error(`[email] Échec de l'envoi vers ${masquer(destinataire)}:`, err instanceof Error ? err.message : err);
    return { simulated: false, error: true };
  }
}

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

/**
 * Email d'invitation envoyé à un propriétaire par son gestionnaire pour lui
 * ouvrir l'accès à son espace propriétaire (résumé financier en lecture
 * seule). Réutilise le même lien/mécanisme que la réinitialisation de mot de
 * passe (token à usage unique, valable 1 heure) : cliquer dessus laisse le
 * propriétaire choisir lui-même son mot de passe — voir owner.controller.ts
 * (inviteOwnerPortalAccount) et auth.controller.ts (resetPassword).
 */
/** Invitation d'un collaborateur à rejoindre l'agence (formule Entreprise, voir team.controller.ts). */
export function teamInvitationEmail(params: { agencyName: string; ownerName: string; inviteUrl: string }) {
  const { agencyName, ownerName, inviteUrl } = params;
  return {
    subject: `🔑 ${escapeHtml(ownerName)} vous invite à rejoindre ${escapeHtml(agencyName)}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">🔑 Invitation à rejoindre l'agence</h2>
        <p>Bonjour,</p>
        <p>
          <strong>${escapeHtml(ownerName)}</strong> vous invite à rejoindre <strong>${escapeHtml(agencyName)}</strong>
          en tant que collaborateur : vous aurez accès aux mêmes biens, locataires et contrats que le reste de
          l'agence. Cliquez sur le bouton ci-dessous pour choisir votre mot de passe et activer votre accès.
          Ce lien est valable <strong>1 heure</strong>.
        </p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${inviteUrl}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            Activer mon accès →
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">
          Si vous ne vous attendiez pas à cette invitation, vous pouvez ignorer cet email sans risque :
          aucun accès ne sera créé sans confirmation de votre part.
        </p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          Cet email a été envoyé automatiquement par votre application de gestion immobilière.
        </p>
      </div>
    `,
  };
}

export function ownerInvitationEmail(params: { ownerName: string; agencyName: string; inviteUrl: string }) {
  const { ownerName, agencyName, inviteUrl } = params;
  return {
    subject: `🔑 ${escapeHtml(agencyName)} vous invite à votre espace propriétaire`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">🔑 Votre espace propriétaire</h2>
        <p>Bonjour ${escapeHtml(ownerName)},</p>
        <p>
          <strong>${escapeHtml(agencyName)}</strong> vous invite à accéder à votre espace propriétaire :
          vous pourrez y suivre le loyer perçu et en attente pour vos biens.
          Cliquez sur le bouton ci-dessous pour choisir votre mot de passe et activer votre accès.
          Ce lien est valable <strong>1 heure</strong>.
        </p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${inviteUrl}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            Activer mon accès →
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">
          Si vous ne vous attendiez pas à cette invitation, vous pouvez ignorer cet email sans risque :
          aucun accès ne sera créé sans confirmation de votre part.
        </p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          Cet email a été envoyé automatiquement par votre application de gestion immobilière.
        </p>
      </div>
    `,
  };
}

/**
 * Email envoyé à l'inscription pour confirmer la propriété de l'adresse
 * email avant d'activer le compte. Le lien contient un token à usage unique,
 * valable 24 heures — voir auth.controller.ts (registerManager / verifyEmail).
 */
export function emailVerificationEmail(params: { verifyUrl: string }) {
  const { verifyUrl } = params;
  return {
    subject: "✅ Confirme ton adresse email",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">✅ Confirme ton adresse email</h2>
        <p>Bonjour,</p>
        <p>
          Merci de ton inscription ! Il ne reste qu'une étape avant de pouvoir
          te connecter : confirme ton adresse email en cliquant sur le bouton
          ci-dessous. Ce lien est valable <strong>24 heures</strong>.
        </p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${verifyUrl}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            Confirmer mon email →
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">
          Si tu n'es pas à l'origine de cette inscription, tu peux ignorer cet email sans risque :
          aucun compte ne sera activé sans confirmation.
        </p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          Cet email a été envoyé automatiquement par votre application de gestion immobilière.
        </p>
      </div>
    `,
  };
}

/**
 * Envoyé quand quelqu'un tente de s'inscrire avec une adresse DÉJÀ prise.
 *
 * L'inscription répond désormais la même chose que l'adresse soit libre ou
 * non, pour ne pas laisser tester de l'extérieur quelles adresses ont un
 * compte. Sans cet email, le titulaire légitime qui a simplement oublié qu'il
 * était déjà inscrit attendrait une confirmation qui n'arriverait jamais :
 * c'est ici qu'on lui dit quoi faire.
 *
 * Le message ne révèle rien à un tiers : il part vers une adresse dont le
 * propriétaire sait déjà qu'il a un compte.
 */
export function accountAlreadyExistsEmail(params: { loginUrl: string; resetUrl: string }) {
  const { loginUrl, resetUrl } = params;
  return {
    subject: "Tu as déjà un compte chez nous",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">Tu as déjà un compte</h2>
        <p>Bonjour,</p>
        <p>
          Une inscription vient d'être tentée avec cette adresse email, mais un
          compte existe déjà. Pas besoin d'en créer un second : connecte-toi
          directement.
        </p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${escapeHtml(loginUrl)}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            Me connecter →
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">
          Mot de passe oublié ? <a href="${escapeHtml(resetUrl)}">Réinitialise-le ici</a>.
        </p>
        <p style="color:#6b7280; font-size:12px;">
          Si tu n'es pas à l'origine de cette tentative, tu peux ignorer cet
          email : ton compte n'a pas été modifié et personne n'y a eu accès.
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
          Le contrat de location de <strong>${escapeHtml(tenantName)}</strong> pour le bien
          <strong>${escapeHtml(propertyTitle)}</strong> arrive à échéance le
          <strong>${escapeHtml(formattedDate)}</strong> (dans ${daysLeft} jours).
        </p>
        <p>Pensez à contacter le locataire pour discuter d'un renouvellement, d'un état des lieux de sortie ou de la libération du bien.</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          Cet email a été envoyé automatiquement par votre application de gestion immobilière.
        </p>
      </div>
    `,
  };
}

export function insurancePolicyExpiryReminderEmail(params: {
  propertyTitle: string;
  insurerName: string;
  policyNumber: string;
  expiryDate: Date;
  daysLeft: number;
}) {
  const { propertyTitle, insurerName, policyNumber, expiryDate, daysLeft } = params;
  const formattedDate = expiryDate.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
  return {
    subject: `Rappel : police d'assurance à renouveler dans ${daysLeft} jours — ${propertyTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#1f2937;">Rappel d'échéance d'assurance</h2>
        <p>Bonjour,</p>
        <p>
          La police d'assurance <strong>${escapeHtml(policyNumber)}</strong> souscrite auprès de
          <strong>${escapeHtml(insurerName)}</strong> pour le bien <strong>${escapeHtml(propertyTitle)}</strong>
          arrive à échéance le <strong>${escapeHtml(formattedDate)}</strong> (dans ${daysLeft} jours).
        </p>
        <p>Pensez à contacter votre assureur pour renouveler le contrat ou en souscrire un nouveau avant cette date.</p>
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
  // Rendez-vous d'intervention pris avec le prestataire, s'il y en a un —
  // voir updateIssueStatus (issue.controller.ts). Simple Date, pas une
  // chaîne : c'est la colonne telle que Drizzle la renvoie, à formater ici
  // comme partout ailleurs dans ce service (voir toLocaleDateString plus bas).
  scheduledAt?: Date | null;
  frontendUrl: string;
}) {
  const { tenantName, issueTitle, propertyTitle, status, managerNote, scheduledAt, frontendUrl } = params;
  const meta = issueStatusLabels[status] ?? { label: status, color: "#334155", emoji: "ℹ️" };

  return {
    subject: `${meta.emoji} Mise à jour de votre signalement — ${issueTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${meta.emoji} Mise à jour de votre incident signalé</h2>
        <p>Bonjour ${escapeHtml(tenantName)},</p>
        <p>
          Le statut de votre signalement <strong>« ${escapeHtml(issueTitle)} »</strong> concernant le logement
          <strong>${escapeHtml(propertyTitle)}</strong> a été mis à jour :
        </p>
        <div style="display:inline-block; background:${meta.color}1a; color:${meta.color}; font-weight:bold; padding:8px 16px; border-radius:20px; border:1px solid ${meta.color}40; margin: 8px 0 16px 0;">
          ${escapeHtml(meta.label)}
        </div>
        ${scheduledAt ? `<p style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:12px 16px; color:#1e3a8a;"><strong>📅 Intervention prévue le ${escapeHtml(new Date(scheduledAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }))}</strong><br/>Merci de vous assurer d'être présent ou de prévoir un accès au logement.</p>` : ""}
        ${managerNote ? `<p style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px; color:#334155;"><strong>Message de votre agence :</strong><br/>${escapeHtml(managerNote)}</p>` : ""}
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

/**
 * Email envoyé au locataire lorsque le gestionnaire enregistre la
 * restitution de son dépôt de garantie (voir recordDepositRefund,
 * contract.controller.ts). `deductions` est la même liste que celle
 * persistée : vide pour une restitution intégrale.
 */
export function depositRefundEmail(params: {
  tenantName: string;
  propertyTitle: string;
  deposit: number;
  deductions: Array<{ label: string; amount: number }>;
  refundedAmount: number;
  currency?: string | null;
  frontendUrl: string;
}) {
  const { tenantName, propertyTitle, deposit, deductions, refundedAmount, currency, frontendUrl } = params;
  const lignesDeductions = deductions
    .map(
      (d) =>
        `<tr><td style="padding:4px 0; color:#334155;">${escapeHtml(d.label)}</td><td style="padding:4px 0; text-align:right; color:#dc2626;">- ${escapeHtml(formaterMontant(d.amount, currency))}</td></tr>`
    )
    .join("");

  return {
    subject: `💰 Restitution de votre dépôt de garantie — ${propertyTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">💰 Restitution de votre dépôt de garantie</h2>
        <p>Bonjour ${escapeHtml(tenantName)},</p>
        <p>
          La restitution de votre dépôt de garantie pour le logement <strong>${escapeHtml(propertyTitle)}</strong>
          (déposé initialement : ${escapeHtml(formaterMontant(deposit, currency))}) vient d'être enregistrée par votre agence.
        </p>
        ${
          deductions.length > 0
            ? `<table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:13px;"><tbody>${lignesDeductions}</tbody></table>`
            : `<p style="color:#059669;">Aucune retenue : le dépôt vous est restitué intégralement.</p>`
        }
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:16px; text-align:center; margin: 8px 0 16px 0;">
          <span style="font-size:11px; color:#166534; text-transform:uppercase; letter-spacing:1px; font-weight:bold;">Montant restitué</span>
          <div style="font-size:26px; font-weight:900; color:#166534; margin-top:4px;">${escapeHtml(formaterMontant(refundedAmount, currency))}</div>
        </div>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${frontendUrl}/portail/contrats" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            Voir mon contrat →
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
 * Email envoyé au PARRAIN quand son filleul confirme son adresse email et
 * déclenche sa récompense (voir accorderRecompenseParrainage,
 * referral.service.ts).
 */
export function referralRewardEmail(params: { days: number; newEndDate: Date; frontendUrl: string }) {
  const { days, newEndDate, frontendUrl } = params;
  const dateAffichee = escapeHtml(newEndDate.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" }));

  return {
    subject: `🎁 +${days} jours offerts — votre filleul a rejoint ImmoPlatform Pro`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">🎁 Merci pour votre parrainage !</h2>
        <p>Bonjour,</p>
        <p>
          La personne que vous avez parrainée vient de confirmer son compte. En remerciement,
          <strong>${days} jours</strong> ont été ajoutés à votre accès.
        </p>
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:16px; text-align:center; margin: 16px 0;">
          <span style="font-size:11px; color:#166534; text-transform:uppercase; letter-spacing:1px; font-weight:bold;">Nouvelle échéance</span>
          <div style="font-size:20px; font-weight:900; color:#166534; margin-top:4px;">${dateAffichee}</div>
        </div>
        <p>Continuez à partager votre code de parrainage pour prolonger votre accès à chaque nouveau filleul confirmé.</p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${frontendUrl}/parrainage" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            Voir mon programme de parrainage →
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
        <p>Bonjour ${escapeHtml(tenantName)},</p>
        <p>Vous avez reçu un nouveau message concernant le logement <strong>${escapeHtml(propertyTitle)}</strong> :</p>
        <p style="background:#f8fafc; border-left:3px solid #2563eb; border-radius:4px; padding:12px 16px; color:#334155; font-style:italic;">
          « ${escapeHtml(preview)} »
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
  currency?: string;
  periodMonth: number;
  periodYear: number;
  dueDate: Date;
  frontendUrl: string;
}) {
  const { tenantName, propertyTitle, amount, currency = "EUR", periodMonth, periodYear, frontendUrl } = params;
  const monthNames = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre"
  ];
  const monthName = monthNames[periodMonth - 1] || `${periodMonth}`;
  // Le montant est mis en forme comme au portail (séparateur de milliers,
  // symbole local) : le locataire ne doit pas lire deux écritures de la même
  // somme selon qu'il regarde son espace ou sa boîte aux lettres.
  const montantAffiche = escapeHtml(formaterMontant(amount, currency));

  return {
    subject: `📢 Échéance de loyer ${monthName} ${periodYear} — Règlement attendu avant le 5`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #0f172a; padding: 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700;">Avis d'Échéance de Loyer</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">${monthName} ${periodYear} • ${escapeHtml(propertyTitle)}</p>
        </div>
        <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
          <p style="font-size: 15px; margin-top: 0;">Bonjour <strong>${escapeHtml(tenantName)}</strong>,</p>
          <p>
            Votre avis d'échéance de loyer pour le mois de <strong>${monthName} ${periodYear}</strong> concernant le bien <strong>${escapeHtml(propertyTitle)}</strong> est désormais émis.
          </p>
          
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
            <span style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">Montant à régler</span>
            <div style="font-size: 32px; font-weight: 900; color: #0f172a; margin: 8px 0;">${montantAffiche}</div>
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
          <p>Bonjour <strong>${escapeHtml(tenantName)}</strong>,</p>
          <p>
            Votre loyer de <strong>${monthName} ${periodYear}</strong> pour le logement
            <strong>${escapeHtml(propertyTitle)}</strong> n'a pas encore été réglé et arrive à échéance le
            <strong>${escapeHtml(formattedDueDate)}</strong> (dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}).
          </p>
          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 16px; margin: 16px 0; text-align: center;">
            <span style="font-size: 24px; font-weight: 900; color: #92400e;">${escapeHtml(formaterMontant(amount, currency))}</span>
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

