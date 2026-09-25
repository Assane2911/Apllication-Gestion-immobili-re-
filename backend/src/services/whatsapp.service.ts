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
 * Envoie un message WhatsApp via la Cloud API officielle de Meta, à partir
 * d'un template pré-approuvé (WhatsApp Manager → Modèles de message) — un
 * message texte libre est rejeté par l'API dès que le locataire n'a pas
 * écrit au numéro Business dans les 24 dernières heures (erreur 131047),
 * ce qui est le cas normal pour un rappel envoyé à l'initiative de l'agence.
 *
 * `parameters` remplace dans l'ordre les `{{1}}`, `{{2}}`... du CORPS du
 * template : l'ordre et le nombre doivent correspondre EXACTEMENT à la
 * version approuvée, sinon Meta rejette l'envoi.
 *
 * Retombe sur un envoi simulé (journalisé, pas de vraie requête) tant que le
 * token d'accès ou le Phone Number ID ne sont pas configurés, pour ne jamais
 * bloquer le job de rappel en dev/avant configuration.
 */
export async function sendWhatsAppTemplate(to: string, templateName: string, parameters: string[]) {
  const { accessToken, phoneNumberId, apiVersion, templateLanguage } = env.whatsapp;
  if (!accessToken || !phoneNumberId) {
    console.warn(`[whatsapp] Cloud API non configurée — template "${templateName}" simulé vers ${masquer(to)}`);
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
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [
            {
              type: "body",
              parameters: parameters.map((text) => ({ type: "text", text })),
            },
          ],
        },
      }),
    });

    const data = (await response.json().catch(() => null)) as { messages?: { id?: string }[]; error?: unknown };

    if (!response.ok) {
      console.error(`[whatsapp] Échec de l'envoi du template "${templateName}" vers ${masquer(to)}:`, data?.error ?? data);
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

function formatAmount(amount: number, currency: string): string {
  const currencyDisplay = currency === "EUR" ? "€" : currency;
  return `${amount} ${currencyDisplay}`;
}

/**
 * Paramètres du template Meta "avis_echeance_loyer" (avis du 1er du mois),
 * dans l'ordre exact de son corps approuvé :
 * "Bonjour {{1}}, votre avis d'échéance de loyer pour {{2}} ({{3}}) est émis.
 *  Montant à régler : {{4}}, au plus tard le 5 du mois.
 *  Payer en ligne : {{5}}
 *  Merci de votre confiance."
 */
export function rentDueTemplateParams(params: {
  tenantName: string;
  propertyTitle: string;
  amount: number;
  currency?: string;
  periodMonth: number;
  periodYear: number;
  paymentUrl: string;
}): string[] {
  const { tenantName, propertyTitle, amount, currency = "EUR", periodMonth, periodYear, paymentUrl } = params;
  const monthName = monthNames[periodMonth - 1] || `${periodMonth}`;
  return [tenantName, `${monthName} ${periodYear}`, propertyTitle, formatAmount(amount, currency), paymentUrl];
}

/**
 * Paramètres du template Meta "rappel_avant_echeance_loyer" (rappel J-3),
 * dans l'ordre exact de son corps approuvé :
 * "Bonjour {{1}}, votre loyer de {{2}} ({{3}}) n'est pas encore réglé et
 *  arrive à échéance dans {{4}} jour(s). Montant : {{5}}.
 *  Payer maintenant : {{6}}
 *  Merci de votre confiance."
 */
export function rentDueSoonTemplateParams(params: {
  tenantName: string;
  propertyTitle: string;
  amount: number;
  currency: string;
  periodMonth: number;
  periodYear: number;
  daysLeft: number;
  paymentUrl: string;
}): string[] {
  const { tenantName, propertyTitle, amount, currency, periodMonth, periodYear, daysLeft, paymentUrl } = params;
  const monthName = monthNames[periodMonth - 1] || `${periodMonth}`;
  return [
    tenantName,
    `${monthName} ${periodYear}`,
    propertyTitle,
    `${daysLeft}`,
    formatAmount(amount, currency),
    paymentUrl,
  ];
}
