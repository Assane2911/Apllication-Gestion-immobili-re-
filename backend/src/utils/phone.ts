/**
 * Normalisation d'un numéro de téléphone vers le format E.164 (ex:
 * "+221771234567"), exigé par l'API Meta WhatsApp Cloud (voir whatsapp.service.ts).
 *
 * Les numéros de locataires sont saisis en texte libre (tenants.phone) : on
 * y trouve des espaces, tirets, parenthèses, un préfixe "00" au lieu de "+",
 * ou parfois aucun indicatif pays du tout (ex: la valeur par défaut des
 * comptes de test, "0600000000"). Ce dernier cas ne peut PAS être deviné sans
 * risque : un numéro local sans indicatif pourrait appartenir à n'importe
 * quel pays, et lui inventer un indicatif enverrait le message à quelqu'un
 * d'autre. On refuse donc (renvoie null) plutôt que de deviner.
 */
/**
 * Message unique pour un numéro que `versE164` ne sait pas lire. Il nomme la
 * cause (l'indicatif manquant) et montre la forme attendue : « invalide » tout
 * court laisserait chercher, alors que l'oubli est presque toujours le même.
 */
export const MESSAGE_TELEPHONE_INVALIDE =
  "Numéro de téléphone invalide : indiquez l'indicatif du pays, par exemple +221 77 123 45 67.";

export function versE164(brut: string): string | null {
  const nettoye = brut.replace(/[\s().-]/g, "");

  if (/^\+[1-9]\d{7,14}$/.test(nettoye)) return nettoye;
  if (/^00[1-9]\d{7,14}$/.test(nettoye)) return `+${nettoye.slice(2)}`;

  return null;
}
