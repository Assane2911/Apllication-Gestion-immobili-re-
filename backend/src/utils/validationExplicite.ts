/**
 * Message de validation écrit à la main (celui d'un `.refine()`), accompagné du code que l'interface traduit.
 *
 * Le gestionnaire d'erreurs (errorHandler.ts) renvoie tel quel le message d'un `.refine()`, parce qu'il dit
 * quoi corriger. Sans code, un utilisateur en anglais, portugais ou espagnol le lirait en français ; avec lui,
 * l'interface affiche la traduction (clé `common.serverErrors.<CODE>`), le français restant en secours.
 *
 * `values` : ce que la traduction insère (ex. { min, max }).
 */
export function avecCode(message: string, code: string, values?: Record<string, string | number>) {
  return { message, params: { code, ...(values ? { values } : {}) } };
}
