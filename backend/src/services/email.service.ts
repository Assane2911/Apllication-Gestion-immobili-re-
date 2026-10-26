import * as Sentry from "@sentry/node";
import nodemailer from "nodemailer";
import { env } from "../config/env";
import { escapeHtml } from "../utils/html";
import { formaterMontant } from "../utils/montant";
import { formaterDate, formaterDateHeure, LANGUE_PAR_DEFAUT, nomDuMois, type Langue } from "../utils/langue";
import { libelleMoyenPaiement } from "../utils/moyenPaiement";
import { TEXTES_COMPTE } from "./email.comptes.textes";
import { TEXTES_LOCATAIRE } from "./email.locataire.textes";
import { TEXTES_SUITE } from "./email.suite.textes";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

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

/** Une même cause d'échec n'est signalée à Sentry qu'une fois par tranche de ce délai (une panne ferait sinon une alerte par e-mail). */
const DELAI_ALERTE_MS = 10 * 60_000;
const dernieresAlertes = new Map<string, number>();

/** Remet les alertes à zéro entre deux tests. */
export function reinitialiserAlertesEmailPourTests(): void {
  dernieresAlertes.clear();
}

/**
 * Signale à Sentry l'échec d'un envoi. `sendEmail` avale volontairement ses échecs (un SMTP en panne ne doit jamais
 * faire échouer l'action métier), ce qui les rendait invisibles hors lecture des journaux : serveur d'envoi mal
 * configuré, mot de passe expiré, expéditeur refusé... plus aucun e-mail ne partait sans que personne ne le sache.
 *
 * Rien de personnel n'est transmis : ni destinataire, ni sujet, ni le message du serveur (qui cite parfois l'adresse
 * refusée) — seulement le code d'erreur, l'hôte SMTP et le domaine de l'expéditeur, de quoi voir si l'hôte et
 * l'expéditeur correspondent au domaine authentifié (SPF, DKIM). Une alerte par cause et par tranche de dix minutes.
 */
function signalerEchecEnvoi(err: unknown): void {
  try {
    const { code, responseCode, command } = (err ?? {}) as { code?: unknown; responseCode?: unknown; command?: unknown };
    const codeErreur = typeof code === "string" && code ? code : "INCONNU";
    const reponse = typeof responseCode === "number" ? responseCode : undefined;
    const cause = [codeErreur, reponse ?? ""].join("|");

    const maintenant = Date.now();
    const derniere = dernieresAlertes.get(cause);
    if (derniere !== undefined && maintenant - derniere < DELAI_ALERTE_MS) return;
    dernieresAlertes.set(cause, maintenant);

    Sentry.captureException(new Error(`Échec d'envoi d'e-mail (SMTP) : ${codeErreur}${reponse ? ` ${reponse}` : ""}`), {
      tags: { source: "email.sendEmail", smtp_code: codeErreur },
      extra: {
        responseCode: reponse,
        command: typeof command === "string" ? command : undefined,
        hote: env.smtp.host,
        port: env.smtp.port,
        domaine_expediteur: env.smtp.from.match(/@([^>\s]+)/)?.[1],
      },
      fingerprint: ["email-send-failure", codeErreur, String(reponse ?? "")],
    });
  } catch {
    // L'alerte ne doit jamais faire échouer l'envoi, ni le masquer davantage.
  }
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
    signalerEchecEnvoi(err);
    return { simulated: false, error: true };
  }
}

/**
 * Email envoyé lors d'une demande de réinitialisation de mot de passe
 * (page "Mot de passe oublié"). Le lien contient un token à usage unique,
 * valable 1 heure — voir auth.controller.ts (forgotPassword / resetPassword).
 */
export function passwordResetEmail(params: { resetUrl: string; langue?: Langue }) {
  const { resetUrl, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_COMPTE[langue];
  const m = t.motDePasseOublie;
  return {
    subject: m.sujet,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${m.titre}</h2>
        <p>${t.bonjour}</p>
        <p>${m.intro}</p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${resetUrl}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            ${m.bouton}
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">${m.ignorer}</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">${t.pied}</p>
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
export function teamInvitationEmail(params: { agencyName?: string | null; ownerName?: string | null; inviteUrl: string; langue?: Langue }) {
  const { inviteUrl, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_COMPTE[langue];
  const m = t.invitationEquipe;
  const agencyName = params.agencyName || m.agenceParDefaut;
  const ownerName = params.ownerName || m.gestionnaireParDefaut;
  return {
    // Sujet en texte brut : l'échapper HTML affichait « Martin &amp; Fils » dans la boîte de réception.
    subject: m.sujet(ownerName, agencyName),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${m.titre}</h2>
        <p>${t.bonjour}</p>
        <p>${m.intro(escapeHtml(ownerName), escapeHtml(agencyName))}</p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${inviteUrl}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            ${m.bouton}
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">${m.ignorer}</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">${t.pied}</p>
      </div>
    `,
  };
}

export function ownerInvitationEmail(params: { ownerName: string; agencyName?: string | null; inviteUrl: string; langue?: Langue }) {
  const { ownerName, inviteUrl, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_COMPTE[langue];
  const m = t.invitationProprietaire;
  const agencyName = params.agencyName || m.agenceParDefaut;
  return {
    subject: m.sujet(agencyName),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${m.titre}</h2>
        <p>${t.bonjourNom(escapeHtml(ownerName))}</p>
        <p>${m.intro(escapeHtml(agencyName))}</p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${inviteUrl}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            ${m.bouton}
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">${m.ignorer}</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">${t.pied}</p>
      </div>
    `,
  };
}

/**
 * Email envoyé à l'inscription pour confirmer la propriété de l'adresse
 * email avant d'activer le compte. Le lien contient un token à usage unique,
 * valable 24 heures — voir auth.controller.ts (registerManager / verifyEmail).
 */
export function emailVerificationEmail(params: { verifyUrl: string; langue?: Langue }) {
  const { verifyUrl, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_COMPTE[langue];
  const m = t.confirmationAdresse;
  return {
    subject: m.sujet,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${m.titre}</h2>
        <p>${t.bonjour}</p>
        <p>${m.intro}</p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${verifyUrl}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            ${m.bouton}
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">${m.ignorer}</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">${t.pied}</p>
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
export function googleWelcomeEmail(params: { appUrl: string; trialDays: number; langue?: Langue }) {
  const { appUrl, trialDays, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_COMPTE[langue];
  const m = t.bienvenueGoogle;
  return {
    subject: m.sujet,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${m.titre}</h2>
        <p>${t.bonjour}</p>
        <p>${m.intro(trialDays)}</p>
        <p><strong>${m.pourDemarrer}</strong></p>
        <ol style="padding-left:20px; line-height:1.6;">
          ${m.etapes.map((etape) => `<li>${etape}</li>`).join("\n          ")}
        </ol>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${appUrl}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            ${m.bouton}
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">${m.noteMotDePasse}</p>
        <p style="color:#6b7280; font-size:12px;">${m.noteIgnorer}</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">${t.pied}</p>
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
export function accountAlreadyExistsEmail(params: { loginUrl: string; resetUrl: string; langue?: Langue }) {
  const { loginUrl, resetUrl, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_COMPTE[langue];
  const m = t.compteDejaExistant;
  return {
    subject: m.sujet,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${m.titre}</h2>
        <p>${t.bonjour}</p>
        <p>${m.intro}</p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${escapeHtml(loginUrl)}" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            ${m.bouton}
          </a>
        </div>
        <p style="color:#6b7280; font-size:12px;">${m.motDePasseOublie(escapeHtml(resetUrl))}</p>
        <p style="color:#6b7280; font-size:12px;">${m.ignorer}</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">${t.pied}</p>
      </div>
    `,
  };
}

export function contractEndingReminderEmail(params: {
  tenantName: string;
  propertyTitle: string;
  endDate: Date;
  daysLeft: number;
  langue?: Langue;
}) {
  const { tenantName, propertyTitle, endDate, daysLeft, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_SUITE[langue].finDeContrat;
  const formattedDate = formaterDate(endDate, langue);
  return {
    subject: t.sujet(propertyTitle, daysLeft),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#1f2937;">${t.titre}</h2>
        <p>${TEXTES_COMPTE[langue].bonjour}</p>
        <p>
          ${t.intro(escapeHtml(tenantName), escapeHtml(propertyTitle), escapeHtml(formattedDate), daysLeft)}
        </p>
        <p>${t.conseil}</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          ${TEXTES_COMPTE[langue].pied}
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
  langue?: Langue;
}) {
  const { propertyTitle, insurerName, policyNumber, expiryDate, daysLeft, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_SUITE[langue].assurance;
  const formattedDate = formaterDate(expiryDate, langue);
  return {
    subject: t.sujet(propertyTitle, daysLeft),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#1f2937;">${t.titre}</h2>
        <p>${TEXTES_COMPTE[langue].bonjour}</p>
        <p>
          ${t.intro(escapeHtml(policyNumber), escapeHtml(insurerName), escapeHtml(propertyTitle), escapeHtml(formattedDate), daysLeft)}
        </p>
        <p>${t.conseil}</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          ${TEXTES_COMPTE[langue].pied}
        </p>
      </div>
    `,
  };
}

/** Couleur et pictogramme de chaque statut (le libellé, lui, est traduit : voir TEXTES_SUITE). */
const issueStatusStyles: Record<string, { color: string; emoji: string }> = {
  OPEN: { color: "#2563eb", emoji: "📋" },
  IN_PROGRESS: { color: "#d97706", emoji: "🔧" },
  RESOLVED: { color: "#059669", emoji: "✅" },
  REJECTED: { color: "#dc2626", emoji: "✖️" },
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
  // comme partout ailleurs dans ce service.
  scheduledAt?: Date | null;
  frontendUrl: string;
  langue?: Langue;
}) {
  const { tenantName, issueTitle, propertyTitle, status, managerNote, scheduledAt, frontendUrl, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_SUITE[langue].signalement;
  const style = issueStatusStyles[status] ?? { color: "#334155", emoji: "ℹ️" };
  // Un statut inconnu s'affiche tel quel, comme avant.
  const libelle = (t.statuts as Record<string, string>)[status] ?? status;

  return {
    subject: t.sujet(style.emoji, issueTitle),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${t.titre(style.emoji)}</h2>
        <p>${t.bonjour(escapeHtml(tenantName))}</p>
        <p>
          ${t.intro(escapeHtml(issueTitle), escapeHtml(propertyTitle))}
        </p>
        <div style="display:inline-block; background:${style.color}1a; color:${style.color}; font-weight:bold; padding:8px 16px; border-radius:20px; border:1px solid ${style.color}40; margin: 8px 0 16px 0;">
          ${escapeHtml(libelle)}
        </div>
        ${scheduledAt ? `<p style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:12px 16px; color:#1e3a8a;">${t.intervention(escapeHtml(formaterDateHeure(scheduledAt, langue)))}</p>` : ""}
        ${managerNote ? `<p style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px; color:#334155;"><strong>${t.note}</strong><br/>${escapeHtml(managerNote)}</p>` : ""}
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${frontendUrl}/portail/incidents" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            ${t.bouton}
          </a>
        </div>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          ${TEXTES_COMPTE[langue].pied}
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
export function referralRewardEmail(params: { days: number; newEndDate: Date; frontendUrl: string; langue?: Langue }) {
  const { days, newEndDate, frontendUrl, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_SUITE[langue].parrainage;
  const dateAffichee = escapeHtml(formaterDate(newEndDate, langue));

  return {
    subject: t.sujet(days),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${t.titre}</h2>
        <p>${TEXTES_COMPTE[langue].bonjour}</p>
        <p>
          ${t.intro(days)}
        </p>
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:16px; text-align:center; margin: 16px 0;">
          <span style="font-size:11px; color:#166534; text-transform:uppercase; letter-spacing:1px; font-weight:bold;">${t.nouvelleEcheance}</span>
          <div style="font-size:20px; font-weight:900; color:#166534; margin-top:4px;">${dateAffichee}</div>
        </div>
        <p>${t.suite}</p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${frontendUrl}/parrainage" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            ${t.bouton}
          </a>
        </div>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          ${TEXTES_COMPTE[langue].pied}
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
  langue?: Langue;
}) {
  const { tenantName, propertyTitle, content, frontendUrl, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_SUITE[langue].message;
  const [ouvrant, fermant] = TEXTES_SUITE[langue].guillemets;
  const preview = content.length > 220 ? `${content.slice(0, 220)}…` : content;

  return {
    subject: t.sujet(propertyTitle),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${t.titre}</h2>
        <p>${t.bonjour(escapeHtml(tenantName))}</p>
        <p>${t.intro(escapeHtml(propertyTitle))}</p>
        <p style="background:#f8fafc; border-left:3px solid #2563eb; border-radius:4px; padding:12px 16px; color:#334155; font-style:italic;">
          ${ouvrant}${escapeHtml(preview)}${fermant}
        </p>
        <div style="text-align:center; margin: 24px 0 12px 0;">
          <a href="${frontendUrl}/portail/messages" style="background:#2563eb; color:#ffffff; padding:10px 22px; text-decoration:none; font-weight:bold; font-size:13px; border-radius:8px; display:inline-block;">
            ${t.bouton}
          </a>
        </div>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          ${TEXTES_COMPTE[langue].pied}
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
  langue?: Langue;
}) {
  const { tenantName, propertyTitle, amount, currency = "EUR", periodMonth, periodYear, dueDate, frontendUrl, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_LOCATAIRE[langue].avisEcheance;
  const monthName = nomDuMois(periodMonth, langue);
  // Le montant est mis en forme comme au portail (séparateur de milliers,
  // symbole local) : le locataire ne doit pas lire deux écritures de la même
  // somme selon qu'il regarde son espace ou sa boîte aux lettres.
  const montantAffiche = escapeHtml(formaterMontant(amount, currency, langue));
  // La date limite est CELLE DE LA FACTURE. Elle était écrite « le 5 » en dur,
  // alors que la facture est due le jour du début du bail : un locataire dont
  // le bail démarre le 24 lisait « avant le 5 » pour un loyer dû le 24.
  const dateLimite = formaterDate(dueDate, langue);

  return {
    subject: t.sujet(monthName, periodYear, dateLimite),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #0f172a; padding: 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700;">${t.bandeau}</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">${t.sousTitre(monthName, periodYear, escapeHtml(propertyTitle))}</p>
        </div>
        <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
          <p style="font-size: 15px; margin-top: 0;">${t.bonjour(escapeHtml(tenantName))}</p>
          <p>
            ${t.intro(monthName, periodYear, escapeHtml(propertyTitle))}
          </p>
          
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
            <span style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">${t.montantLabel}</span>
            <div style="font-size: 32px; font-weight: 900; color: #0f172a; margin: 8px 0;">${montantAffiche}</div>
            <div style="display: inline-block; background: #fef3c7; color: #92400e; font-size: 12px; font-weight: bold; padding: 6px 14px; border-radius: 20px; border: 1px solid #fde68a;">
              ${t.delai(escapeHtml(dateLimite))}
            </div>
          </div>

          <p style="font-size: 13px; color: #475569;">
            ${t.conformite}
          </p>

          <div style="text-align: center; margin: 28px 0 20px 0;">
            <a href="${frontendUrl}/portail/paiements" style="background: #2563eb; color: #ffffff; padding: 12px 28px; text-decoration: none; font-weight: bold; font-size: 14px; border-radius: 8px; display: inline-block; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
              ${t.bouton}
            </a>
          </div>
          <p style="font-size: 12px; color: #94a3b8; text-align: center;">
            ${t.moyens}
          </p>
        </div>
        <div style="background: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
          ${t.pied}
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
  langue?: Langue;
}) {
  const { tenantName, propertyTitle, amount, currency, periodMonth, periodYear, daysLeft, dueDate, frontendUrl, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_LOCATAIRE[langue].rappelAvantEcheance;
  const monthName = nomDuMois(periodMonth, langue);
  const formattedDueDate = formaterDate(dueDate, langue);

  return {
    subject: t.sujet(monthName, daysLeft),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #92400e; padding: 20px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 18px; font-weight: 700;">${t.bandeau}</h1>
        </div>
        <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
          <p>${t.bonjour(escapeHtml(tenantName))}</p>
          <p>
            ${t.intro(monthName, periodYear, escapeHtml(propertyTitle), escapeHtml(formattedDueDate), daysLeft)}
          </p>
          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 16px; margin: 16px 0; text-align: center;">
            <span style="font-size: 24px; font-weight: 900; color: #92400e;">${escapeHtml(formaterMontant(amount, currency, langue))}</span>
          </div>
          <div style="text-align: center; margin: 20px 0;">
            <a href="${frontendUrl}/portail/paiements" style="background: #2563eb; color: #ffffff; padding: 12px 28px; text-decoration: none; font-weight: bold; font-size: 14px; border-radius: 8px; display: inline-block;">
              ${t.bouton}
            </a>
          </div>
        </div>
        <div style="background: #f8fafc; padding: 14px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
          ${t.pied}
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
  langue?: Langue;
}) {
  const { tenantName, propertyTitle, previousRent, newRent, currency = "EUR", effectiveDate, motif, note, langue = LANGUE_PAR_DEFAUT } = params;
  const t = TEXTES_SUITE[langue].revision;
  const date = formaterDate(effectiveDate, langue, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const ancien = escapeHtml(formaterMontant(previousRent, currency, langue));
  const nouveau = escapeHtml(formaterMontant(newRent, currency, langue));
  return {
    subject: t.sujet(date),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #0f172a; padding: 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700;">${t.bandeau}</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">${escapeHtml(propertyTitle)}</p>
        </div>
        <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
          <p style="font-size: 15px; margin-top: 0;">${t.bonjour(escapeHtml(tenantName))}</p>
          <p>${t.intro(escapeHtml(propertyTitle), escapeHtml(date))}</p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
            <span style="font-size: 13px; color: #64748b;">${t.loyerActuel} <s>${ancien}</s></span><br>
            <span style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">${t.nouveauLoyer}</span><br>
            <span style="font-size: 26px; font-weight: 800; color: #0f172a;">${nouveau}</span>
          </div>
          ${motif ? `<p style="font-size: 13px; color: #475569;"><strong>${t.base}</strong> ${escapeHtml(motif)}</p>` : ""}
          ${note ? `<p style="font-size: 13px; color: #475569;">${escapeHtml(note)}</p>` : ""}
          <p style="font-size: 13px; color: #475569;">${t.suite}</p>
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
  langue?: Langue;
}) {
  const langue = params.langue ?? LANGUE_PAR_DEFAUT;
  const t = TEXTES_SUITE[langue].reversement;
  const periode = `${nomDuMois(params.periodMonth, langue)} ${params.periodYear}`;
  const date = formaterDate(params.paidAt, langue);
  const montant = escapeHtml(formaterMontant(params.amount, params.currency, langue));
  return {
    subject: t.sujet(periode),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #0f172a; padding: 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700;">${t.bandeau}</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">${escapeHtml(params.agencyName)} • ${escapeHtml(periode)}</p>
        </div>
        <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
          <p style="font-size: 15px; margin-top: 0;">${t.bonjour(escapeHtml(params.ownerName))}</p>
          <p>${t.intro(escapeHtml(date), escapeHtml(params.methodLabel), escapeHtml(periode))}</p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
            <span style="font-size: 26px; font-weight: 800; color: #0f172a;">${montant}</span>
            ${params.reference ? `<br><span style="font-size: 12px; color: #64748b;">${t.reference(escapeHtml(params.reference))}</span>` : ""}
          </div>
          <p style="font-size: 13px; color: #475569;">${t.detail}</p>
        </div>
      </div>`,
  };
}

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
  langue?: Langue;
}) {
  const langue = params.langue ?? LANGUE_PAR_DEFAUT;
  const t = TEXTES_LOCATAIRE[langue].relance;
  const periode = `${nomDuMois(params.periodMonth, langue)} ${params.periodYear}`;
  const echeance = formaterDate(params.dueDate, langue);
  const montant = escapeHtml(formaterMontant(params.amount, params.currency ?? "EUR", langue));
  const titre = t.titres[params.niveau];
  const corps = t.corps[params.niveau](escapeHtml(periode));
  return {
    subject: `${titre} — ${periode}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: ${params.niveau === 3 ? "#7f1d1d" : "#0f172a"}; padding: 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700;">${titre}</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #cbd5e1;">${escapeHtml(params.agencyName)} • ${escapeHtml(params.propertyTitle)}</p>
        </div>
        <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
          <p style="font-size: 15px; margin-top: 0;">${t.bonjour(escapeHtml(params.tenantName))}</p>
          <p>${corps}</p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
            <span style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">${t.resteAPayer}</span><br>
            <span style="font-size: 26px; font-weight: 800; color: #0f172a;">${montant}</span><br>
            <span style="font-size: 12px; color: #64748b;">${t.echeance(escapeHtml(echeance), params.daysLate)}</span>
          </div>
          <p style="font-size: 13px; color: #475569;">${t.instruction}</p>
        </div>
      </div>`,
  };
}

/** Rappel du plafond de l'engagement d'un garant, quand il en a un : sans lui, le montant total dû paraît être le sien. */
function rappelPlafondGarant(maxAmount: number | null | undefined, currency: string, langue: Langue = LANGUE_PAR_DEFAUT): string {
  if (maxAmount === null || maxAmount === undefined) return "";
  return `<p>${TEXTES_SUITE[langue].garant.plafond(escapeHtml(formaterMontant(maxAmount, currency, langue)))}</p>`;
}

/** Information du garant : le locataire qu'il garantit a un loyer impayé, relancé sans succès. Dans la langue du locataire. */
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
  langue?: Langue;
}) {
  const langue = params.langue ?? LANGUE_PAR_DEFAUT;
  const t = TEXTES_SUITE[langue].garant;
  const periode = `${nomDuMois(params.periodMonth, langue)} ${params.periodYear}`;
  return {
    subject: t.sujet(params.tenantName, periode),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: auto; color: #334155; line-height: 1.6;">
        <p>${t.bonjour(escapeHtml(params.guarantorName))}</p>
        <p>
          ${t.corps(escapeHtml(params.tenantName), escapeHtml(params.propertyTitle), escapeHtml(periode), escapeHtml(formaterMontant(params.amount, params.currency ?? "EUR", langue)))}
        </p>
        ${rappelPlafondGarant(params.maxAmount, params.currency ?? "EUR", langue)}
        <p>${t.contact(escapeHtml(params.agencyName))}</p>
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

/**
 * Message qui accompagne la quittance de loyer (PDF en pièce jointe) quand une facture est soldée. Le PDF lui-même
 * reste émis en français : le message le dit dans les autres langues, pour que le locataire ne soit pas surpris.
 * `tenantName` nomme tous les locataires du bail en cas de colocation (la quittance les nomme tous).
 */
export function paymentReceiptEmail(params: {
  tenantName: string;
  propertyTitle: string;
  periodMonth: number;
  periodYear: number;
  amount: number;
  currency: string;
  langue?: Langue;
}) {
  const langue = params.langue ?? LANGUE_PAR_DEFAUT;
  const t = TEXTES_LOCATAIRE[langue].quittance;
  const mois = nomDuMois(params.periodMonth, langue);
  return {
    subject: t.sujet(mois, params.periodYear),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${t.titre}</h2>
        <p>${t.bonjour(escapeHtml(params.tenantName))}</p>
        <p>
          ${t.corps(mois, params.periodYear, escapeHtml(params.propertyTitle), escapeHtml(formaterMontant(params.amount, params.currency, langue)))}
        </p>
        <p>${t.jointe}</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          ${TEXTES_COMPTE[langue].pied}
        </p>
      </div>
    `,
  };
}

/**
 * Reçu d'un paiement PARTIEL : ce qui vient d'être encaissé, ce qui a déjà été réglé, ce qui reste dû. Ce n'est pas
 * une quittance, et le message le dit (la quittance n'est délivrée qu'une fois le loyer intégralement réglé).
 */
export function partialPaymentReceiptEmail(params: {
  tenantName: string;
  propertyTitle: string;
  periodMonth: number;
  periodYear: number;
  currency: string;
  paymentAmount: number;
  paymentDate: Date;
  paymentMethod: string | null | undefined;
  rent: number;
  alreadyPaid: number;
  remaining: number;
  agencyName?: string | null;
  langue?: Langue;
}) {
  const langue = params.langue ?? LANGUE_PAR_DEFAUT;
  const t = TEXTES_LOCATAIRE[langue].recuPartiel;
  const mois = nomDuMois(params.periodMonth, langue);
  const montant = (valeur: number) => escapeHtml(formaterMontant(valeur, params.currency, langue));
  return {
    subject: t.sujet(mois, params.periodYear),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${t.titre}</h2>
        <p>${t.bonjour(escapeHtml(params.tenantName))}</p>
        <p>
          ${t.corps(
            montant(params.paymentAmount),
            escapeHtml(formaterDate(params.paymentDate, langue, {})),
            escapeHtml(libelleMoyenPaiement(params.paymentMethod, langue)),
            mois,
            params.periodYear,
            escapeHtml(params.propertyTitle)
          )}
        </p>
        <table style="border-collapse:collapse; margin:16px 0; font-size:14px;">
          <tr><td style="padding:4px 16px 4px 0; color:#334155;">${t.loyer}</td><td style="text-align:right;">${montant(params.rent)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0; color:#334155;">${t.dejaRegle}</td><td style="text-align:right;">${montant(params.alreadyPaid)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;"><strong>${t.reste}</strong></td><td style="text-align:right;"><strong>${montant(params.remaining)}</strong></td></tr>
        </table>
        <p style="color:#475569; font-size:13px;">
          ${t.note}
        </p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          ${params.agencyName ? `${escapeHtml(params.agencyName)} — ` : ""}${TEXTES_COMPTE[langue].pied}
        </p>
      </div>
    `,
  };
}
