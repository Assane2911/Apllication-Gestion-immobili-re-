/**
 * Envoi de messages WhatsApp via l'API Meta WhatsApp Cloud (intÃ©gration
 * directe, sans prestataire intermÃ©diaire type Twilio), en complÃ©ment de
 * l'email pour les rappels de loyer (voir reminder.service.ts) â€” WhatsApp est
 * le canal le plus consultÃ© au quotidien sur ce marchÃ©, contrairement Ã 
 * l'email.
 *
 * Comme sendEmail (email.service.ts), cette fonction NE LÃˆVE JAMAIS : un
 * Ã©chec d'envoi (API non configurÃ©e, modÃ¨le non configurÃ©, numÃ©ro invalide,
 * erreur rÃ©seau) ne doit jamais interrompre la boucle de rappels ni empÃªcher
 * l'email â€” dÃ©jÃ  envoyÃ© sÃ©parÃ©ment â€” d'avoir eu lieu.
 *
 * Important : un message envoyÃ© Ã  l'initiative de la plateforme (pas en
 * rÃ©ponse Ã  un message du locataire) DOIT passer par un modÃ¨le ("Message
 * Template") prÃ©-approuvÃ© par Meta â€” cette rÃ¨gle s'appliquait dÃ©jÃ  du temps
 * de Twilio (qui n'est qu'un intermÃ©diaire vers la mÃªme plateforme Meta) et
 * reste identique en intÃ©gration directe. Il n'y a donc pas de corps de
 * message libre possible ici â€” voir rentDueReminderWhatsappVariables /
 * rentDueSoonReminderWhatsappVariables ci-dessous, qui produisent les
 * variables `{{1}}`, `{{2}}`... attendues par les modÃ¨les crÃ©Ã©s dans le
 * WhatsApp Manager de Meta (voir env.whatsapp.templateNameRentDue /
 * templateNameRentDueSoon, et le README pour le texte exact de ces modÃ¨les).
 * Tant qu'un modÃ¨le n'est pas configurÃ©, l'envoi retombe sur une simulation
 * plutÃ´t que de tenter un appel vouÃ© Ã  l'Ã©chec.
 */
import { env } from "../config/env";
import { versE164 } from "../utils/phone";

/** Version de l'API Graph de Meta utilisÃ©e pour l'envoi (WhatsApp Cloud API). */
const META_GRAPH_API_VERSION = "v21.0";

/** Masque un numÃ©ro destinÃ© aux journaux â€” mÃªme principe que email.service.ts::masquer. */
function masquerNumero(numero: string): string {
  if (numero.length <= 4) return "***";
  return `${numero.slice(0, 4)}***${numero.slice(-2)}`;
}

export interface ResultatEnvoiWhatsapp {
  simulated: boolean;
  error?: boolean;
  raison?: "non_configure" | "modele_non_configure" | "numero_invalide" | "erreur_api" | "erreur_reseau";
}

/**
 * @param templateName Nom du modÃ¨le de message ("Message Template") approuvÃ©
 * par Meta Ã  utiliser (ex: "avis_echeance_loyer") â€” voir
 * env.whatsapp.templateNameRentDue / templateNameRentDueSoon. Vide/non
 * configurÃ© => simulation (voir plus haut).
 * @param variables Valeurs des variables `{{1}}`, `{{2}}`... du modÃ¨le,
 * indexÃ©es par leur numÃ©ro sous forme de chaÃ®ne (ex: `{ "1": "Jean Dupont" }`)
 * â€” converties ci-dessous en tableau ordonnÃ© de paramÃ¨tres pour l'API Meta.
 */
export async function envoyerMessageWhatsapp(
  numeroBrut: string,
  templateName: string,
  variables: Record<string, string>
): Promise<ResultatEnvoiWhatsapp> {
  const { accessToken, phoneNumberId, templateLanguage } = env.whatsapp;

  if (!accessToken || !phoneNumberId) {
    console.warn(
      `[whatsapp] API Meta WhatsApp Cloud non configurÃ©e (META_WHATSAPP_ACCESS_TOKEN/META_WHATSAPP_PHONE_NUMBER_ID manquants) â€” message simulÃ©.`
    );
    return { simulated: true, raison: "non_configure" };
  }

  if (!templateName) {
    console.warn(`[whatsapp] ModÃ¨le de message (Message Template Meta) non configurÃ© â€” message simulÃ©.`);
    return { simulated: true, raison: "modele_non_configure" };
  }

  const numero = versE164(numeroBrut);
  if (!numero) {
    console.warn(`[whatsapp] NumÃ©ro sans indicatif pays reconnaissable (${masquerNumero(numeroBrut)}) â€” message non envoyÃ©.`);
    return { simulated: true, error: true, raison: "numero_invalide" };
  }

  // L'API Meta attend le numÃ©ro au format E.164 SANS le prÃ©fixe "+"
  // (ex: "221771234567"), contrairement au "whatsapp:+..." de Twilio.
  const numeroMeta = numero.replace(/^\+/, "");

  // Les variables {"1": ..., "2": ...} sont converties en un tableau ordonnÃ©
  // de paramÃ¨tres "body" â€” l'API Meta est positionnelle (le 1er paramÃ¨tre du
  // tableau remplit {{1}}, le 2e {{2}}, etc.), contrairement au JSON Ã  clÃ©s
  // nommÃ©es de Twilio.
  const parametres = Object.keys(variables)
    .sort((a, b) => Number(a) - Number(b))
    .map((cle) => ({ type: "text", text: variables[cle] }));

  const corps = {
    messaging_product: "whatsapp",
    to: numeroMeta,
    type: "template",
    template: {
      name: templateName,
      language: { code: templateLanguage },
      components: [{ type: "body", parameters: parametres }],
    },
  };

  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corps),
    });
  } catch (err) {
    console.error(`[whatsapp] Ã‰chec rÃ©seau lors de l'envoi vers ${masquerNumero(numero)}:`, err instanceof Error ? err.message : err);
    return { simulated: false, error: true, raison: "erreur_reseau" };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[whatsapp] Ã‰chec de l'envoi vers ${masquerNumero(numero)} (HTTP ${response.status}):`, detail);
    return { simulated: false, error: true, raison: "erreur_api" };
  }

  return { simulated: false };
}

function formaterMontant(amount: number, currency: string): string {
  const currencyDisplay = currency === "EUR" ? "â‚¬" : currency;
  return `${amount} ${currencyDisplay}`;
}

const MONTH_NAMES = [
  "janvier", "fÃ©vrier", "mars", "avril", "mai", "juin",
  "juillet", "aoÃ»t", "septembre", "octobre", "novembre", "dÃ©cembre",
];

/**
 * Variables `{{1}}`..`{{5}}` du modÃ¨le Meta "avis_echeance_loyer" (voir
 * env.whatsapp.templateNameRentDue) :
 * "Bonjour {{1}}, votre avis d'Ã©chÃ©ance de loyer pour {{2}} ({{3}}) est
 * Ã©mis. Montant Ã  rÃ©gler : {{4}}, au plus tard le 5 {{2}}. Payer en ligne :
 * {{5}}"
 */
export function rentDueReminderWhatsappVariables(params: {
  tenantName: string;
  propertyTitle: string;
  amount: number;
  currency?: string;
  periodMonth: number;
  periodYear: number;
  frontendUrl: string;
}): Record<string, string> {
  const { tenantName, propertyTitle, amount, currency = "EUR", periodMonth, periodYear, frontendUrl } = params;
  const monthName = MONTH_NAMES[periodMonth - 1] || `${periodMonth}`;

  return {
    "1": tenantName,
    "2": `${monthName} ${periodYear}`,
    "3": propertyTitle,
    "4": formaterMontant(amount, currency),
    "5": `${frontendUrl}/portail/paiements`,
  };
}

/**
 * Variables `{{1}}`..`{{6}}` du modÃ¨le Meta "rappel_avant_echeance_loyer"
 * (voir env.whatsapp.templateNameRentDueSoon) :
 * "Bonjour {{1}}, votre loyer de {{2}} ({{3}}) n'est pas encore rÃ©glÃ© et
 * arrive Ã  Ã©chÃ©ance dans {{4}} jour(s). Montant : {{5}}. Payer maintenant :
 * {{6}}"
 */
export function rentDueSoonReminderWhatsappVariables(params: {
  tenantName: string;
  propertyTitle: string;
  amount: number;
  currency: string;
  periodMonth: number;
  periodYear: number;
  daysLeft: number;
  frontendUrl: string;
}): Record<string, string> {
  const { tenantName, propertyTitle, amount, currency, periodMonth, periodYear, daysLeft, frontendUrl } = params;
  const monthName = MONTH_NAMES[periodMonth - 1] || `${periodMonth}`;

  return {
    "1": tenantName,
    "2": `${monthName} ${periodYear}`,
    "3": propertyTitle,
    "4": `${daysLeft}`,
    "5": formaterMontant(amount, currency),
    "6": `${frontendUrl}/portail/paiements`,
  };
}