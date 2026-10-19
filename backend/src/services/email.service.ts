import nodemailer from "nodemailer";
import { env } from "../config/env";
import { escapeHtml } from "../utils/html";
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
 * passe (token à usage unique, valable 7 jours) : cliquer dessus laisse le
 * propriétaire choisir lui-même son mot de passe — voir owner.controller.ts
 * (inviteOwnerPortalAccount) et auth.controller.ts (resetPassword).
 */
/** Invitation d'un collaborateur à rejoindre l'agence (formule Entreprise, voir team.controller.ts). */
export function teamInvitationEmail(params: { agencyName: string; ownerName: string; inviteUrl: string }) {
  const { agencyName, ownerName, inviteUrl } = params;
  return {
    // Sujet en texte brut : l'échapper HTML affichait « Martin &amp; Fils » dans la boîte de réception.
    subject: `🔑 ${ownerName} vous invite à rejoindre ${agencyName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">🔑 Invitation à rejoindre l'agence</h2>
        <p>Bonjour,</p>
        <p>
          <strong>${escapeHtml(ownerName)}</strong> vous invite à rejoindre <strong>${escapeHtml(agencyName)}</strong>
          en tant que collaborateur : vous aurez accès aux mêmes biens, locataires et contrats que le reste de
          l'agence. Cliquez sur le bouton ci-dessous pour choisir votre mot de passe et activer votre accès.
          Ce lien est valable <strong>7 jours</strong>.
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
    subject: `🔑 ${agencyName} vous invite à votre espace propriétaire`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">🔑 Votre espace propriétaire</h2>
        <p>Bonjour ${escapeHtml(ownerName)},</p>
        <p>
          <strong>${escapeHtml(agencyName)}</strong> vous invite à accéder à votre espace propriétaire :
          vous pourrez y suivre le loyer perçu et en attente pour vos biens.
          Cliquez sur le bouton ci-dessous pour choisir votre mot de passe et activer votre accès.
          Ce lien est valable <strong>7 jours</strong>.
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
    subject: "✅ Confirmez votre adresse email",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">✅ Confirmez votre adresse email</h2>
        <p>Bonjour,</p>
        <p>
          Merci de votre inscription ! Il ne reste qu'une étape avant de pouvoir
          vous connecter : confirmez votre adresse email en cliquant sur le bouton
          ci-dessous. Ce lien est valable <strong>24 heures</strong>.
        </p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${verifyUrl}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            Confirmer mon email →
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">
          Si vous n'êtes pas à l'origine de cette inscription, vous pouvez ignorer cet email sans risque :
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
 * Email de bienvenue d'un compte créé par « Se connecter avec Google » (voir loginWithGoogle,
 * auth.controller.ts). Google certifiant l'adresse, ce compte ne reçoit aucun mail de confirmation : ce
 * message lui dit que son compte existe, ce que comprend l'essai et par où commencer. Il ne contient
 * aucun lien à usage unique ni aucune donnée saisie par l'utilisateur.
 */
export function googleWelcomeEmail(params: { appUrl: string; trialDays: number }) {
  const { appUrl, trialDays } = params;
  return {
    subject: "👋 Bienvenue sur ImmoPlatform Pro",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">👋 Bienvenue sur ImmoPlatform Pro !</h2>
        <p>Bonjour,</p>
        <p>
          Votre compte vient d'être créé avec votre compte Google : votre adresse est déjà confirmée,
          vous n'avez rien d'autre à valider. Votre <strong>essai gratuit de ${trialDays} jours</strong>
          a commencé, avec les fonctionnalités de la formule Professionnel.
        </p>
        <p><strong>Pour bien démarrer :</strong></p>
        <ol style="padding-left:20px; line-height:1.6;">
          <li>Ajoutez votre premier bien immobilier.</li>
          <li>Enregistrez votre locataire.</li>
          <li>Créez le contrat de bail : les loyers et les quittances se génèrent ensuite automatiquement.</li>
        </ol>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${appUrl}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            Accéder à mon espace →
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">
          Vous vous connectez avec Google. Si vous souhaitez aussi pouvoir vous connecter avec un mot de passe,
          utilisez « Mot de passe oublié » sur la page de connexion.
        </p>
        <p style="color:#6b7280; font-size:12px;">
          Si vous n'êtes pas à l'origine de cette inscription, répondez simplement à ce message ou ignorez-le.
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
    subject: "Vous avez déjà un compte chez nous",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">Vous avez déjà un compte</h2>
        <p>Bonjour,</p>
        <p>
          Une inscription vient d'être tentée avec cette adresse email, mais un
          compte existe déjà. Pas besoin d'en créer un second : connectez-vous
          directement.
        </p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${escapeHtml(loginUrl)}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            Me connecter →
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">
          Mot de passe oublié ? <a href="${escapeHtml(resetUrl)}">Réinitialisez-le ici</a>.
        </p>
        <p style="color:#6b7280; font-size:12px;">
          Si vous n'êtes pas à l'origine de cette tentative, vous pouvez ignorer cet
          email : votre compte n'a pas été modifié et personne n'y a eu accès.
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
        ${scheduledAt ? `<p style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:12px 16px; color:#1e3a8a;"><strong>📅 Intervention prévue le ${escapeHtml(new Date(scheduledAt).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }))}</strong><br/>Merci de vous assurer d'être présent ou de prévoir un accès au logement.</p>` : ""}
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
 * au 1er de chaque mois, rappelant la date limite de règlement de CE loyer
 * (l'échéance de la facture : voir utils/jourEcheance.ts).
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
  const { tenantName, propertyTitle, amount, currency = "EUR", periodMonth, periodYear, dueDate, frontendUrl } = params;
  const monthNames = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre"
  ];
  const monthName = monthNames[periodMonth - 1] || `${periodMonth}`;
  // Le montant est mis en forme comme au portail (séparateur de milliers,
  // symbole local) : le locataire ne doit pas lire deux écritures de la même
  // somme selon qu'il regarde son espace ou sa boîte aux lettres.
  const montantAffiche = escapeHtml(formaterMontant(amount, currency));
  // La date limite est CELLE DE LA FACTURE. Elle était écrite « le 5 » en dur,
  // alors que la facture est due le jour du début du bail : un locataire dont
  // le bail démarre le 24 lisait « avant le 5 » pour un loyer dû le 24.
  const dateLimite = new Date(dueDate).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });

  return {
    subject: `📢 Échéance de loyer ${monthName} ${periodYear} — Règlement attendu au plus tard le ${dateLimite}`,
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
              ⏰ Date limite de règlement : au plus tard le ${escapeHtml(dateLimite)}
            </div>
          </div>

          <p style="font-size: 13px; color: #475569;">
            Conformément à votre bail de location, nous vous remercions de procéder au paiement de votre loyer dans les délais impartis.
          </p>

          <div style="text-align: center; margin: 28px 0 20px 0;">
            <a href="${frontendUrl}/portail/paiements" style="background: #2563eb; color: #ffffff; padding: 12px 28px; text-decoration: none; font-weight: bold; font-size: 14px; border-radius: 8px; display: inline-block; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
              Régler mon loyer →
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


/** Avis au locataire : le loyer de son bail change à partir d'une date donnée. */
export function rentRevisionEmail(params: {
  tenantName: string;
  propertyTitle: string;
  previousRent: number;
  newRent: number;
  currency?: string;
  effectiveDate: Date;
  /** Motif lisible (« indexation IRL : 142,06 → 145,47 », « +3 % »…), vide si aucun. */
  motif?: string | null;
  note?: string | null;
}) {
  const { tenantName, propertyTitle, previousRent, newRent, currency = "EUR", effectiveDate, motif, note } = params;
  const date = new Date(effectiveDate).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const ancien = escapeHtml(formaterMontant(previousRent, currency));
  const nouveau = escapeHtml(formaterMontant(newRent, currency));
  return {
    subject: `Révision de votre loyer à compter du ${date}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #0f172a; padding: 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700;">Révision du loyer</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">${escapeHtml(propertyTitle)}</p>
        </div>
        <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
          <p style="font-size: 15px; margin-top: 0;">Bonjour <strong>${escapeHtml(tenantName)}</strong>,</p>
          <p>Votre loyer pour le bien <strong>${escapeHtml(propertyTitle)}</strong> est révisé à compter du <strong>${escapeHtml(date)}</strong>.</p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
            <span style="font-size: 13px; color: #64748b;">Loyer actuel : <s>${ancien}</s></span><br>
            <span style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">Nouveau loyer mensuel</span><br>
            <span style="font-size: 26px; font-weight: 800; color: #0f172a;">${nouveau}</span>
          </div>
          ${motif ? `<p style="font-size: 13px; color: #475569;"><strong>Base de calcul :</strong> ${escapeHtml(motif)}</p>` : ""}
          ${note ? `<p style="font-size: 13px; color: #475569;">${escapeHtml(note)}</p>` : ""}
          <p style="font-size: 13px; color: #475569;">Les avis d'échéance émis à partir de cette date porteront ce nouveau montant. Pour toute question, répondez à votre gestionnaire.</p>
        </div>
      </div>`,
  };
}

/** Avis au propriétaire : l'agence lui a versé le net d'un mois de gestion. */
export function ownerPayoutEmail(params: {
  ownerName: string;
  agencyName: string;
  amount: number;
  currency: string;
  periodMonth: number;
  periodYear: number;
  paidAt: Date;
  methodLabel: string;
  reference?: string | null;
}) {
  const mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const periode = `${mois[params.periodMonth - 1] ?? params.periodMonth} ${params.periodYear}`;
  const date = new Date(params.paidAt).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
  const montant = escapeHtml(formaterMontant(params.amount, params.currency));
  return {
    subject: `Reversement de vos loyers — ${periode}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #0f172a; padding: 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700;">Reversement effectué</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">${escapeHtml(params.agencyName)} • ${escapeHtml(periode)}</p>
        </div>
        <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
          <p style="font-size: 15px; margin-top: 0;">Bonjour <strong>${escapeHtml(params.ownerName)}</strong>,</p>
          <p>Votre agence vous a versé le ${escapeHtml(date)} (${escapeHtml(params.methodLabel)}) la somme suivante, au titre de la gestion de <strong>${escapeHtml(periode)}</strong> :</p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
            <span style="font-size: 26px; font-weight: 800; color: #0f172a;">${montant}</span>
            ${params.reference ? `<br><span style="font-size: 12px; color: #64748b;">Référence : ${escapeHtml(params.reference)}</span>` : ""}
          </div>
          <p style="font-size: 13px; color: #475569;">Le détail (loyers encaissés, charges, commission) figure dans votre compte-rendu de gestion, disponible dans votre espace propriétaire.</p>
        </div>
      </div>`,
  };
}

const MOIS_RELANCE = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/**
 * Relance d'un loyer impayé, niveau 1 (rappel amiable) à 3 (dernière relance). Le ton monte, le
 * contenu reste factuel : montant restant dû, période, échéance dépassée depuis N jours. Aucune
 * menace juridique : la dernière relance dit seulement que l'agence pourra donner les suites prévues
 * au bail.
 */
export function overdueReminderEmail(params: {
  tenantName: string;
  propertyTitle: string;
  amount: number;
  currency?: string;
  periodMonth: number;
  periodYear: number;
  dueDate: Date;
  daysLate: number;
  niveau: 1 | 2 | 3;
  agencyName: string;
}) {
  const periode = `${MOIS_RELANCE[params.periodMonth - 1] ?? params.periodMonth} ${params.periodYear}`;
  const echeance = new Date(params.dueDate).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
  const montant = escapeHtml(formaterMontant(params.amount, params.currency ?? "EUR"));
  const titres = { 1: "Rappel : loyer non réglé", 2: "Deuxième relance : loyer impayé", 3: "Dernière relance : loyer impayé" } as const;
  const corps = {
    1: `Sauf erreur de notre part, le loyer de <strong>${escapeHtml(periode)}</strong> n'a pas encore été réglé. S'il s'agit d'un oubli, merci de procéder au règlement dès que possible. Si vous avez déjà payé, vous pouvez ignorer ce message.`,
    2: `Malgré notre précédent rappel, le loyer de <strong>${escapeHtml(periode)}</strong> reste impayé. Merci de le régler sans attendre, ou de contacter votre agence si vous rencontrez une difficulté.`,
    3: `Le loyer de <strong>${escapeHtml(periode)}</strong> reste impayé malgré nos relances. Sans règlement ou prise de contact rapide de votre part, votre agence pourra donner à cet impayé les suites prévues par votre bail.`,
  } as const;
  return {
    subject: `${titres[params.niveau]} — ${periode}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: ${params.niveau === 3 ? "#7f1d1d" : "#0f172a"}; padding: 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700;">${titres[params.niveau]}</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #cbd5e1;">${escapeHtml(params.agencyName)} • ${escapeHtml(params.propertyTitle)}</p>
        </div>
        <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
          <p style="font-size: 15px; margin-top: 0;">Bonjour <strong>${escapeHtml(params.tenantName)}</strong>,</p>
          <p>${corps[params.niveau]}</p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
            <span style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">Reste à payer</span><br>
            <span style="font-size: 26px; font-weight: 800; color: #0f172a;">${montant}</span><br>
            <span style="font-size: 12px; color: #64748b;">Échéance du ${escapeHtml(echeance)} — dépassée de ${params.daysLate} jour(s)</span>
          </div>
          <p style="font-size: 13px; color: #475569;">Vous pouvez régler ce loyer depuis votre espace locataire.</p>
        </div>
      </div>`,
  };
}

/** Rappel du plafond de l'engagement d'un garant, quand il en a un : sans lui, le montant total dû paraît être le sien. */
function rappelPlafondGarant(maxAmount: number | null | undefined, currency: string): string {
  if (maxAmount === null || maxAmount === undefined) return "";
  return `<p>Pour mémoire, le montant maximal que vous avez garanti est de <strong>${escapeHtml(formaterMontant(maxAmount, currency))}</strong>.</p>`;
}

/** Information du garant : le locataire qu'il garantit a un loyer impayé, relancé sans succès. */
export function guarantorUnpaidNoticeEmail(params: {
  guarantorName: string;
  maxAmount?: number | null;
  tenantName: string;
  propertyTitle: string;
  amount: number;
  currency?: string;
  periodMonth: number;
  periodYear: number;
  agencyName: string;
}) {
  const periode = `${MOIS_RELANCE[params.periodMonth - 1] ?? params.periodMonth} ${params.periodYear}`;
  return {
    subject: `Information : loyer impayé de ${params.tenantName} — ${periode}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; color: #334155; line-height: 1.6;">
        <p>Bonjour <strong>${escapeHtml(params.guarantorName)}</strong>,</p>
        <p>
          Vous êtes garant du bail de <strong>${escapeHtml(params.tenantName)}</strong> pour le logement
          <strong>${escapeHtml(params.propertyTitle)}</strong>. Nous vous informons que le loyer de
          <strong>${escapeHtml(periode)}</strong> reste impayé malgré nos relances, pour un montant de
          <strong>${escapeHtml(formaterMontant(params.amount, params.currency ?? "EUR"))}</strong>.
        </p>
        ${rappelPlafondGarant(params.maxAmount, params.currency ?? "EUR")}
        <p>Pour toute question, vous pouvez contacter ${escapeHtml(params.agencyName)}.</p>
      </div>`,
  };
}

/** Mise en demeure de payer (le courrier est joint en PDF). Voir miseEnDemeure.service.ts. */
export function formalNoticeEmail(params: {
  tenantName: string;
  propertyTitle: string;
  totalDue: number;
  currency: string;
  deadlineDays: number;
  agencyName: string;
  reference: string;
}) {
  const montant = escapeHtml(formaterMontant(params.totalDue, params.currency));
  return {
    subject: `Mise en demeure de payer — ${params.propertyTitle} (réf. ${params.reference})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #7f1d1d; padding: 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700;">Mise en demeure de payer</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #fecaca;">${escapeHtml(params.agencyName)} • ${escapeHtml(params.propertyTitle)}</p>
        </div>
        <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
          <p style="font-size: 15px; margin-top: 0;">Bonjour <strong>${escapeHtml(params.tenantName)}</strong>,</p>
          <p>Malgré nos rappels, des loyers restent impayés. Vous trouverez en pièce jointe notre mise en demeure de payer (réf. ${escapeHtml(params.reference)}), qui détaille les sommes dues.</p>
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
            <span style="font-size: 11px; color: #7f1d1d; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">Total à régler</span><br>
            <span style="font-size: 26px; font-weight: 800; color: #0f172a;">${montant}</span><br>
            <span style="font-size: 12px; color: #64748b;">sous ${params.deadlineDays} jour(s) à compter de la réception de ce courrier</span>
          </div>
          <p style="font-size: 13px; color: #475569;">Vous pouvez régler depuis votre espace locataire. En cas de difficulté, contactez votre agence sans attendre ; si vous avez déjà payé, ne tenez pas compte de ce message.</p>
        </div>
      </div>`,
  };
}

/** Copie de la mise en demeure adressée au garant du locataire. */
export function guarantorFormalNoticeEmail(params: {
  guarantorName: string;
  maxAmount?: number | null;
  tenantName: string;
  propertyTitle: string;
  totalDue: number;
  currency: string;
  deadlineDays: number;
  agencyName: string;
  reference: string;
}) {
  return {
    subject: `Copie : mise en demeure de payer adressée à ${params.tenantName} (réf. ${params.reference})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; color: #334155; line-height: 1.6;">
        <p>Bonjour <strong>${escapeHtml(params.guarantorName)}</strong>,</p>
        <p>
          En votre qualité de garant de <strong>${escapeHtml(params.tenantName)}</strong> pour le logement
          « ${escapeHtml(params.propertyTitle)} », nous vous adressons copie de la mise en demeure de payer
          qui lui a été notifiée : <strong>${escapeHtml(formaterMontant(params.totalDue, params.currency))}</strong>
          restent dus, à régler sous ${params.deadlineDays} jour(s). Le courrier est joint à cet email.
        </p>
        ${rappelPlafondGarant(params.maxAmount, params.currency)}
        <p style="font-size: 13px; color: #64748b;">${escapeHtml(params.agencyName)}</p>
      </div>`,
  };
}
