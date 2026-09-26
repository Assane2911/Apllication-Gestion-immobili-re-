/**
 * Envoi de messages WhatsApp via l'API Meta WhatsApp Cloud (intégration
 * directe, sans prestataire intermédiaire type Twilio), en complément de
 * l'email pour les rappels de loyer (voir reminder.service.ts) — WhatsApp est
 * le canal le plus consulté au quotidien sur ce marché, contrairement à
 * l'email.
 *
 * Comme sendEmail (email.service.ts), cette fonction NE LÈVE JAMAIS : un
 * échec d'envoi (API non configurée, modèle non configuré, numéro invalide,
 * erreur réseau) ne doit jamais interrompre la boucle de rappels ni empêcher
 * l'email — déjà envoyé séparément — d'avoir eu lieu.
 *
 * Important : un message envoyé à l'initiative de la plateforme (pas en
 * réponse à un message du locataire) DOIT passer par un modèle ("Message
 * Template") pré-approuvé par Meta — cette règle s'appliquait déjà du temps
 * de Twilio (qui n'est qu'un intermédiaire vers la même plateforme Meta) et
 * reste identique en intégration directe. Il n'y a donc pas de corps de
 * message libre possible ici — voir rentDueReminderWhatsappVariables /
 * rentDueSoonReminderWhatsappVariables ci-dessous, qui produisent les
 * variables `{{1}}`, `{{2}}`... attendues par les modèles créés dans le
 * WhatsApp Manager de Meta (voir env.whatsapp.templateNameRentDue /
 * templateNameRentDueSoon, et le README pour le texte exact de ces modèles).
 * Tant qu'un modèle n'est pas configuré, l'envoi retombe sur une simulation
 * plutôt que de tenter un appel voué à l'échec.
 */
import { env } from "../config/env";
import { formaterMontant } from "../utils/montant";
import { versE164 } from "../utils/phone";

/**
 * Version de l'API Graph de Meta utilisée pour l'envoi (WhatsApp Cloud API).
 *
 * À garder proche de la version courante, et pas seulement par hygiène : une
 * version expirée ne provoque AUCUNE erreur chez Meta. Les appels sont
 * silencieusement redirigés vers la plus ancienne version encore utilisable,
 * donc le code continuerait de « fonctionner » en parlant une version qu'il
 * n'a pas choisie, avec un comportement susceptible d'avoir changé et rien
 * pour le signaler. Un décalage se découvre alors des mois plus tard, par un
 * symptôme sans rapport apparent.
 *
 * La console Meta propose v25.0 (sept. 2026) ; le format de la requête
 * d'envoi de modèle est inchangé depuis la v21.
 */
const META_GRAPH_API_VERSION = "v25.0";

/** Masque un numéro destiné aux journaux — même principe que email.service.ts::masquer. */
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
 * @param templateName Nom du modèle de message ("Message Template") approuvé
 * par Meta à utiliser (ex: "avis_echeance_loyer") — voir
 * env.whatsapp.templateNameRentDue / templateNameRentDueSoon. Vide/non
 * configuré => simulation (voir plus haut).
 * @param variables Valeurs des variables `{{1}}`, `{{2}}`... du modèle,
 * indexées par leur numéro sous forme de chaîne (ex: `{ "1": "Jean Dupont" }`)
 * — converties ci-dessous en tableau ordonné de paramètres pour l'API Meta.
 */
export async function envoyerMessageWhatsapp(
  numeroBrut: string,
  templateName: string,
  variables: Record<string, string>
): Promise<ResultatEnvoiWhatsapp> {
  const { accessToken, phoneNumberId, templateLanguage } = env.whatsapp;

  if (!accessToken || !phoneNumberId) {
    console.warn(
      `[whatsapp] API Meta WhatsApp Cloud non configurée (META_WHATSAPP_ACCESS_TOKEN/META_WHATSAPP_PHONE_NUMBER_ID manquants) — message simulé.`
    );
    return { simulated: true, raison: "non_configure" };
  }

  if (!templateName) {
    console.warn(`[whatsapp] Modèle de message (Message Template Meta) non configuré — message simulé.`);
    return { simulated: true, raison: "modele_non_configure" };
  }

  const numero = versE164(numeroBrut);
  if (!numero) {
    console.warn(`[whatsapp] Numéro sans indicatif pays reconnaissable (${masquerNumero(numeroBrut)}) — message non envoyé.`);
    return { simulated: true, error: true, raison: "numero_invalide" };
  }

  // L'API Meta attend le numéro au format E.164 SANS le préfixe "+"
  // (ex: "221771234567"), contrairement au "whatsapp:+..." de Twilio.
  const numeroMeta = numero.replace(/^\+/, "");

  // Les variables {"1": ..., "2": ...} sont converties en un tableau ordonné
  // de paramètres "body" — l'API Meta est positionnelle (le 1er paramètre du
  // tableau remplit {{1}}, le 2e {{2}}, etc.), contrairement au JSON à clés
  // nommées de Twilio.
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

const MONTH_NAMES = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** Nom du mois en toutes lettres + année, tel qu'attendu par `{{2}}` dans les deux modèles ci-dessous. */
function moisEtAnnee(periodMonth: number, periodYear: number): string {
  const monthName = MONTH_NAMES[periodMonth - 1] || `${periodMonth}`;
  return `${monthName} ${periodYear}`;
}

/**
 * Préfixe `{{1}}`..`{{3}}` commun aux deux modèles de rappel de loyer
 * (identité du locataire, période, bien concerné) — seule la suite diffère
 * selon le modèle, voir chaque fonction ci-dessous.
 */
function prefixeCommunRappel(params: {
  tenantName: string;
  propertyTitle: string;
  periodMonth: number;
  periodYear: number;
}): Record<string, string> {
  return {
    "1": params.tenantName,
    "2": moisEtAnnee(params.periodMonth, params.periodYear),
    "3": params.propertyTitle,
  };
}

/**
 * Variables `{{1}}`..`{{5}}` du modèle Meta "avis_echeance_loyer" (voir
 * env.whatsapp.templateNameRentDue) :
 * "Bonjour {{1}}, votre avis d'échéance de loyer pour {{2}} ({{3}}) est
 * émis. Montant à régler : {{4}}, au plus tard le 5 {{2}}. Payer en ligne :
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
  const { amount, currency = "EUR", frontendUrl } = params;

  return {
    ...prefixeCommunRappel(params),
    "4": formaterMontant(amount, currency),
    "5": `${frontendUrl}/portail/paiements`,
  };
}

/**
 * Variables `{{1}}`..`{{6}}` du modèle Meta "rappel_avant_echeance_loyer"
 * (voir env.whatsapp.templateNameRentDueSoon) :
 * "Bonjour {{1}}, votre loyer de {{2}} ({{3}}) n'est pas encore réglé et
 * arrive à échéance dans {{4}} jour(s). Montant : {{5}}. Payer maintenant :
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
  const { amount, currency, daysLeft, frontendUrl } = params;

  return {
    ...prefixeCommunRappel(params),
    "4": `${daysLeft}`,
    "5": formaterMontant(amount, currency),
    "6": `${frontendUrl}/portail/paiements`,
  };
}
