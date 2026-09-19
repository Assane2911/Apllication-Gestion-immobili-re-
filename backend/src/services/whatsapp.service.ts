/**
 * Envoi de messages WhatsApp via l'API Twilio, en complément de l'email pour
 * les rappels de loyer (voir reminder.service.ts) — WhatsApp est le canal le
 * plus consulté au quotidien sur ce marché, contrairement à l'email.
 *
 * Comme sendEmail (email.service.ts), cette fonction NE LÈVE JAMAIS : un
 * échec d'envoi (Twilio non configuré, numéro invalide, erreur réseau) ne
 * doit jamais interrompre la boucle de rappels ni empêcher l'email — déjà
 * envoyé séparément — d'avoir eu lieu.
 *
 * Important, à savoir avant la mise en production : un message envoyé à
 * l'initiative de la plateforme (pas en réponse à un message du locataire)
 * doit passer par un modèle ("template") pré-approuvé par Meta via Twilio en
 * dehors du bac à sable de développement — un texte libre comme corps de
 * message sera refusé par l'API pour un premier contact. Voir la Content API
 * de Twilio (TWILIO_WHATSAPP_CONTENT_SID, non géré ici pour l'instant) une
 * fois le modèle approuvé.
 */
import { env } from "../config/env";
import { versE164 } from "../utils/phone";

/** Masque un numéro destiné aux journaux — même principe que email.service.ts::masquer. */
function masquerNumero(numero: string): string {
  if (numero.length <= 4) return "***";
  return `${numero.slice(0, 4)}***${numero.slice(-2)}`;
}

export interface ResultatEnvoiWhatsapp {
  simulated: boolean;
  error?: boolean;
  raison?: "non_configure" | "numero_invalide" | "erreur_api" | "erreur_reseau";
}

export async function envoyerMessageWhatsapp(numeroBrut: string, message: string): Promise<ResultatEnvoiWhatsapp> {
  const { accountSid, authToken, from } = env.whatsapp;

  if (!accountSid || !authToken || !from) {
    console.warn(`[whatsapp] Twilio non configuré (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_FROM manquants) — message simulé.`);
    return { simulated: true, raison: "non_configure" };
  }

  const numero = versE164(numeroBrut);
  if (!numero) {
    console.warn(`[whatsapp] Numéro sans indicatif pays reconnaissable (${masquerNumero(numeroBrut)}) — message non envoyé.`);
    return { simulated: true, error: true, raison: "numero_invalide" };
  }

  const corps = new URLSearchParams({
    From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    To: `whatsapp:${numero}`,
    Body: message,
  });

  let response: Response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: corps.toString(),
    });
  } catch (err) {
    console.error(`[whatsapp] Échec réseau lors de l'envoi vers ${masquerNumero(numero)}:`, err instanceof Error ? err.message : err);
    return { simulated: false, error: true, raison: "erreur_reseau" };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[whatsapp] Échec de l'envoi vers ${masquerNumero(numero)} (HTTP ${response.status}):`, detail);
    return { simulated: false, error: true, raison: "erreur_api" };
  }

  return { simulated: false };
}

function formaterMontant(amount: number, currency: string): string {
  const currencyDisplay = currency === "EUR" ? "€" : currency;
  return `${amount} ${currencyDisplay}`;
}

const MONTH_NAMES = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** Version WhatsApp (texte simple) de rentDueReminderEmail (email.service.ts). */
export function rentDueReminderWhatsapp(params: {
  tenantName: string;
  propertyTitle: string;
  amount: number;
  currency?: string;
  periodMonth: number;
  periodYear: number;
  frontendUrl: string;
}): string {
  const { tenantName, propertyTitle, amount, currency = "EUR", periodMonth, periodYear, frontendUrl } = params;
  const monthName = MONTH_NAMES[periodMonth - 1] || `${periodMonth}`;

  return (
    `📢 Bonjour ${tenantName},\n\n` +
    `Votre avis d'échéance de loyer pour *${monthName} ${periodYear}* (${propertyTitle}) est émis :\n` +
    `💰 Montant à régler : *${formaterMontant(amount, currency)}*\n` +
    `⏰ À régler au plus tard le 5 ${monthName} ${periodYear}\n\n` +
    `Payer en ligne : ${frontendUrl}/portail/paiements`
  );
}

/** Version WhatsApp (texte simple) de rentDueSoonReminderEmail (email.service.ts). */
export function rentDueSoonReminderWhatsapp(params: {
  tenantName: string;
  propertyTitle: string;
  amount: number;
  currency: string;
  periodMonth: number;
  periodYear: number;
  daysLeft: number;
  frontendUrl: string;
}): string {
  const { tenantName, propertyTitle, amount, currency, periodMonth, periodYear, daysLeft, frontendUrl } = params;
  const monthName = MONTH_NAMES[periodMonth - 1] || `${periodMonth}`;

  return (
    `⏰ Bonjour ${tenantName},\n\n` +
    `Votre loyer de *${monthName} ${periodYear}* (${propertyTitle}) n'est pas encore réglé et arrive à échéance dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}.\n` +
    `💰 Montant : *${formaterMontant(amount, currency)}*\n\n` +
    `Payer maintenant : ${frontendUrl}/portail/paiements`
  );
}
