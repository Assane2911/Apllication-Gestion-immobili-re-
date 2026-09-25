import { env } from "../config/env";

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

/**
 * Envoie un message WhatsApp via la Cloud API officielle de Meta (appel
 * `fetch` direct, sans SDK — même approche que payment.service.ts pour
 * Stripe/PayDunya). Retombe sur un envoi simulé (journalisé, pas de vraie
 * requête) tant que le token d'accès ou le Phone Number ID ne sont pas
 * configurés, pour ne jamais bloquer le job de rappel en dev/avant
 * configuration.
 *
 * Important : la Cloud API n'autorise un message texte libre que si le
 * locataire a lui-même écrit à ce numéro WhatsApp Business dans les 24
 * dernières heures ("fenêtre de service"). Passé ce délai, Meta exige un
 * modèle de message (template) pré-approuvé — un envoi hors fenêtre sans
 * template échoue côté API (erreur 24/131047). Ce point est à valider avec
 * le compte WhatsApp Business Manager déjà configuré.
 */
export async function sendWhatsAppMessage(to: string, body: string) {
  const { accessToken, phoneNumberId, apiVersion } = env.whatsapp;
  if (!accessToken || !phoneNumberId) {
    console.warn(`[whatsapp] Cloud API non configurée — message simulé vers ${masquer(to)}`);
    return { simulated: true };
  }

  // La Cloud API attend le numéro au format E.164 SANS le "+".
  const destinataire = to.replace(/[^\d]/g, "");

  try {
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: destinataire,
        type: "text",
        text: { body },
      }),
    });

    const data = (await response.json().catch(() => null)) as { messages?: { id?: string }[]; error?: unknown };

    if (!response.ok) {
      console.error(`[whatsapp] Échec de l'envoi vers ${masquer(to)}:`, data?.error ?? data);
      return { simulated: false, error: true };
    }

    return { simulated: false, messageId: data?.messages?.[0]?.id };
  } catch (err) {
    console.error(`[whatsapp] Échec réseau vers ${masquer(to)}:`, err instanceof Error ? err.message : err);
    return { simulated: false, error: true };
  }
}

const monthNames = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** Version texte courte de rentDueReminderEmail (email.service.ts), pour WhatsApp. */
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

/** Version texte courte de rentDueSoonReminderEmail (email.service.ts), pour WhatsApp. */
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
