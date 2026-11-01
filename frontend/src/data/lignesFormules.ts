/**
 * Lignes affichées sur les cartes de formules, par clé de traduction (manager.subscription.features.<clé>).
 *
 * Source UNIQUE pour la page d'accueil et la page Abonnement du gestionnaire : l'accueil avait son propre texte,
 * resté en arrière de celui de la page Abonnement. Ces listes doivent rester identiques, dans le même ordre, à
 * celles du serveur (backend/src/controllers/subscription.controller.ts, LIGNES) : un test du serveur le vérifie.
 * « includesStarter » / « includesPro » nomment la formule reprise (voir FORMULE_REPRISE).
 */
export const LIGNES_FORMULES = {
  STARTER: ["maxProperties5", "receipts", "portal", "issues", "emailReminders", "standardSupport"],
  PRO: ["includesStarter", "maxProperties25", "expenses", "eSignature", "whiteLabel", "messaging", "leaseAlerts", "multiChannelReminders", "prioritySupport"],
  ENTERPRISE: ["includesPro", "unlimitedProperties", "team", "accountingExports", "onboardingGuide"],
} as const;

export type IdFormule = keyof typeof LIGNES_FORMULES;

/** Les lignes « Tout ce qui est inclus dans … » nomment la formule reprise, dans la langue de l'interface. */
export const FORMULE_REPRISE: Record<string, IdFormule> = { includesStarter: "STARTER", includesPro: "PRO" };

/**
 * Nombre de biens inclus par formule (`null` = illimité). Reprend les plafonds du serveur (`maxPropertiesForPlan`,
 * backend/src/controllers/subscription.controller.ts), qui reste l'autorité : cette table sert à situer un compte face à
 * sa formule (administration) et à conseiller une formule à un visiteur (accueil).
 */
export const PLAFOND_BIENS: Record<IdFormule, number | null> = {
  STARTER: 5,
  PRO: 25,
  ENTERPRISE: null,
};
