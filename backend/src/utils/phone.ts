/**
 * Normalisation d'un numÃ©ro de tÃ©lÃ©phone vers le format E.164 (ex:
 * "+221771234567"), exigÃ© par l'API Meta WhatsApp Cloud (voir whatsapp.service.ts).
 *
 * Les numÃ©ros de locataires sont saisis en texte libre (tenants.phone) : on
 * y trouve des espaces, tirets, parenthÃ¨ses, un prÃ©fixe "00" au lieu de "+",
 * ou parfois aucun indicatif pays du tout (ex: la valeur par dÃ©faut des
 * comptes de test, "0600000000"). Ce dernier cas ne peut PAS Ãªtre devinÃ© sans
 * risque : un numÃ©ro local sans indicatif pourrait appartenir Ã  n'importe
 * quel pays, et lui inventer un indicatif enverrait le message Ã  quelqu'un
 * d'autre. On refuse donc (renvoie null) plutÃ´t que de deviner.
 */
export function versE164(brut: string): string | null {
  const nettoye = brut.replace(/[\s().-]/g, "");

  if (/^\+[1-9]\d{7,14}$/.test(nettoye)) return nettoye;
  if (/^00[1-9]\d{7,14}$/.test(nettoye)) return `+${nettoye.slice(2)}`;

  return null;
}