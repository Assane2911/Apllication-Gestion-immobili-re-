import { env } from "../config/env";

export type TextChannel = "sms" | "whatsapp";

/**
 * Masque un numéro de téléphone destiné aux journaux — même logique que
 * masquer() dans email.service.ts : on ne garde que de quoi reconnaître un
 * indicatif ou une suite de chiffres mal saisie, jamais le numéro complet.
 */
function masquer(phone: string): string {
  const digits = phone.replace(/\s+/g, "");
  if (digits.length <= 4) return "***";
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

function fromNumberFor(channel: TextChannel): string {
  return channel === "whatsapp" ? env.twilio.whatsappFrom : env.twilio.smsFrom;
}

/**
 * Envoie un SMS ou un message WhatsApp via l'API REST Twilio (appel `fetch`
 * direct, sans SDK — même approche que payment.service.ts pour Stripe/PayDunya).
 * Retombe sur un envoi simulé (journalisé, pas de vraie requête) tant que les
 * identifiants Twilio ou le numéro "from" du canal choisi ne sont pas
 * configurés, pour ne jamais bloquer le job de rappel en dev/avant configuration.
 */
export async function sendTextMessage(to: string, body: string, channel: TextChannel) {
  const from = fromNumberFor(channel);
  if (!env.twilio.accountSid || !env.twilio.authToken || !from) {
    console.warn(`[${channel}] Twilio non configuré — message simulé vers ${masquer(to)}`);
    return { simulated: true };
  }

  const destinataire = channel === "whatsapp" ? `whatsapp:${to}` : to;
  const expediteur = channel === "whatsapp" ? `whatsapp:${from}` : from;

  try {
    const auth = Buffer.from(`${env.twilio.accountSid}:${env.twilio.authToken}`).toString("base64");
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilio.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: destinataire, From: expediteur, Body: body }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      console.error(`[${channel}] Échec de l'envoi vers ${masquer(to)}:`, data);
      return { simulated: false, error: true };
    }

    const data = (await response.json()) as { sid?: string };
    return { simulated: false, sid: data.sid };
  } catch (err) {
    console.error(`[${channel}] Échec réseau vers ${masquer(to)}:`, err instanceof Error ? err.message : err);
    return { simulated: false, error: true };
  }
}

const monthNames = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** Version texte courte de rentDueReminderEmail (email.service.ts), pour SMS/WhatsApp. */
export function rentDueReminderText(params: {
  tenantName: string;
  propertyTitle: string;
  amount: number;
  currency?: string;
  periodMonth: number;
  periodYear: number;
}): string {
  const { tenantName, propertyTitle, amount, currency = "EUR", periodMonth, periodYear } = params;
  const monthName = monthNames[periodMonth - 1] || `${periodMonth}`;
  const currencyDisplay = currency === "EUR" ? "€" : currency;
  return (
    `Bonjour ${tenantName}, votre loyer de ${monthName} ${periodYear} (${amount} ${currencyDisplay}) ` +
    `pour le logement ${propertyTitle} est à régler au plus tard le 5. Merci.`
  );
}

/** Version texte courte de rentDueSoonReminderEmail (email.service.ts), pour SMS/WhatsApp. */
export function rentDueSoonReminderText(params: {
  tenantName: string;
  propertyTitle: string;
  amount: number;
  currency: string;
  periodMonth: number;
  periodYear: number;
  daysLeft: number;
  dueDate: Date;
}): string {
  const { tenantName, propertyTitle, amount, currency, periodMonth, periodYear, daysLeft, dueDate } = params;
  const monthName = monthNames[periodMonth - 1] || `${periodMonth}`;
  const formattedDueDate = dueDate.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
  return (
    `⏰ Rappel : votre loyer de ${monthName} ${periodYear} (${amount} ${currency}) pour ${propertyTitle} ` +
    `n'a pas encore été réglé. Échéance le ${formattedDueDate} (dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}).`
  );
}
