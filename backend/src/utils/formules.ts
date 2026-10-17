/**
 * Noms des formules d'abonnement — LA source des noms que le serveur écrit : liste des formules, messages
 * d'erreur « réservée à la formule … », journal d'administration, exports. Une formule n'a qu'un nom :
 * « Pro Agence » ici, « Pro » là et « Entreprise » ailleurs faisaient croire à plusieurs offres. Les noms
 * traduits de l'interface sont dans les fichiers de langue (common.plans).
 */
export const NOM_FORMULE = {
  STARTER: "Starter",
  PRO: "Professionnel",
  ENTERPRISE: "Agence & Multi-Comptes",
} as const;

export type IdFormule = keyof typeof NOM_FORMULE;
