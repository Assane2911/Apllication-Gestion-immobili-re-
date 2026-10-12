/**
 * Rôles des collaborateurs d'une agence (formule Entreprise, voir team.controller.ts).
 *
 * Jusqu'ici un collaborateur avait TOUS les droits du propriétaire : modifier
 * l'IBAN affiché aux locataires, supprimer des biens, exporter les données
 * personnelles d'un locataire, marquer des factures payées. Quatre rôles
 * bornent désormais ce qu'il peut faire :
 *
 *  - FULL        : droits historiques (gestionnaire délégué) ;
 *  - AGENT       : exploitation courante — biens, locataires, propriétaires,
 *                  baux, états des lieux, annonces, incidents, prestataires,
 *                  messages. Ni suppression, ni encaissement, ni réglages ;
 *  - ACCOUNTANT  : finances — factures (encaissement, annulation, relances),
 *                  dépenses, exports comptables. Rien sur le parc locatif ;
 *  - READ_ONLY   : consultation uniquement.
 *
 * Le contrôle est CENTRAL (middleware/auth.ts::authenticate appelle
 * `verifierAutorisationEquipe`) plutôt que dispersé dans une trentaine de
 * fichiers de routes : une seule matrice à relire, et une route ajoutée plus
 * tard est refusée PAR DÉFAUT à un collaborateur restreint (liste blanche pour
 * les écritures). Les lectures restent ouvertes, hormis une courte liste de
 * lectures sensibles.
 *
 * Le propriétaire de l'agence (jeton sans collaboratorId) n'est jamais concerné.
 */
export const ROLES_EQUIPE = ["FULL", "AGENT", "ACCOUNTANT", "READ_ONLY"] as const;
export type RoleEquipe = (typeof ROLES_EQUIPE)[number];

/** Rôle appliqué à un collaborateur dont le rôle n'a jamais été choisi : ses droits d'avant. */
export const ROLE_EQUIPE_PAR_DEFAUT: RoleEquipe = "FULL";
/** Rôle proposé à l'invitation quand rien n'est précisé : le moins de droits utiles. */
export const ROLE_EQUIPE_INVITATION_PAR_DEFAUT: RoleEquipe = "AGENT";

export const LIBELLES_ROLES_EQUIPE: Record<RoleEquipe, string> = {
  FULL: "Gestionnaire (tous les droits)",
  AGENT: "Agent",
  ACCOUNTANT: "Comptable",
  READ_ONLY: "Lecture seule",
};

export function roleEquipeValide(valeur: unknown): valeur is RoleEquipe {
  return typeof valeur === "string" && (ROLES_EQUIPE as readonly string[]).includes(valeur);
}

/**
 * Rôle effectif d'un collaborateur d'après la valeur stockée : absente → droits
 * historiques ; inconnue (donnée corrompue) → lecture seule, on échoue fermé.
 */
export function roleEquipeEffectif(stocke: string | null | undefined): RoleEquipe {
  if (stocke === null || stocke === undefined) return ROLE_EQUIPE_PAR_DEFAUT;
  return roleEquipeValide(stocke) ? stocke : "READ_ONLY";
}

interface Regle {
  methodes: readonly string[];
  chemin: RegExp;
  roles: readonly RoleEquipe[];
}

const TOUS: readonly RoleEquipe[] = ["AGENT", "ACCOUNTANT", "READ_ONLY"];
const ID = "[^/]+";

/**
 * Écritures autorisées HORS rôle FULL (qui peut tout). Tout verbe d'écriture
 * (POST, PUT, PATCH, DELETE) qui ne correspond à aucune règle est refusé.
 * Chemins relatifs à /api, sans paramètre de requête ni barre finale.
 */
const ECRITURES_AUTORISEES: readonly Regle[] = [
  // Actions personnelles, ouvertes à tous : session, devise, double authentification.
  { methodes: ["POST", "PUT", "PATCH", "DELETE"], chemin: /^\/auth\//, roles: TOUS },
  { methodes: ["POST"], chemin: /^\/notifications\/(seen|read)$/, roles: TOUS },
  { methodes: ["POST"], chemin: /^\/suggestions$/, roles: TOUS },

  // Agent : exploitation courante, sans suppression ni encaissement.
  { methodes: ["POST"], chemin: /^\/properties$/, roles: ["AGENT"] },
  { methodes: ["PUT"], chemin: new RegExp(`^/properties/${ID}$`), roles: ["AGENT"] },
  { methodes: ["POST"], chemin: /^\/tenants$/, roles: ["AGENT"] },
  { methodes: ["PUT"], chemin: new RegExp(`^/tenants/${ID}$`), roles: ["AGENT"] },
  { methodes: ["POST"], chemin: new RegExp(`^/tenants/${ID}/portal-account$`), roles: ["AGENT"] },
  { methodes: ["POST"], chemin: /^\/owners$/, roles: ["AGENT"] },
  { methodes: ["PUT"], chemin: new RegExp(`^/owners/${ID}$`), roles: ["AGENT"] },
  { methodes: ["POST"], chemin: new RegExp(`^/owners/${ID}/invite$`), roles: ["AGENT"] },
  { methodes: ["POST"], chemin: /^\/contracts$/, roles: ["AGENT"] },
  { methodes: ["POST"], chemin: new RegExp(`^/contracts/${ID}/(scan|renew|rent-revisions|guarantors|cotenants)$`), roles: ["AGENT"] },
  { methodes: ["PUT"], chemin: new RegExp(`^/contracts/${ID}/guarantors/${ID}$`), roles: ["AGENT"] },
  { methodes: ["PUT"], chemin: new RegExp(`^/contracts/${ID}(/deposit-refund)?$`), roles: ["AGENT"] },
  { methodes: ["POST"], chemin: /^\/inspections$/, roles: ["AGENT"] },
  { methodes: ["PUT"], chemin: new RegExp(`^/inspections/${ID}$`), roles: ["AGENT"] },
  { methodes: ["POST"], chemin: /^\/listings$/, roles: ["AGENT"] },
  { methodes: ["PUT"], chemin: new RegExp(`^/listings/${ID}$`), roles: ["AGENT"] },
  { methodes: ["PATCH"], chemin: new RegExp(`^/listings/leads/${ID}$`), roles: ["AGENT"] },
  { methodes: ["PUT"], chemin: new RegExp(`^/issues/${ID}/status$`), roles: ["AGENT"] },
  { methodes: ["POST"], chemin: /^\/vendors$/, roles: ["AGENT"] },
  { methodes: ["PUT"], chemin: new RegExp(`^/vendors/${ID}$`), roles: ["AGENT"] },
  { methodes: ["POST"], chemin: /^\/insurance-policies$/, roles: ["AGENT"] },
  { methodes: ["PUT"], chemin: new RegExp(`^/insurance-policies/${ID}$`), roles: ["AGENT"] },
  { methodes: ["POST"], chemin: new RegExp(`^/messages/${ID}$`), roles: ["AGENT"] },

  // Import CSV de biens et de locataires : création en masse, donc réservée à l'agent
  // (qui peut créer un bien et un locataire un par un).
  { methodes: ["POST"], chemin: /^\/import(\/preview)?$/, roles: ["AGENT"] },

  // Relances de loyer : agent et comptable.
  { methodes: ["POST"], chemin: new RegExp(`^/invoices/(send-monthly-reminders|${ID}/send-reminder)$`), roles: ["AGENT", "ACCOUNTANT"] },

  // Comptable : encaissement, annulation, dépenses.
  { methodes: ["POST"], chemin: new RegExp(`^/invoices/${ID}/(mark-paid|cancel)$`), roles: ["ACCOUNTANT"] },
  { methodes: ["POST"], chemin: /^\/expenses$/, roles: ["ACCOUNTANT"] },
  { methodes: ["DELETE"], chemin: new RegExp(`^/expenses/${ID}$`), roles: ["ACCOUNTANT"] },
  // Reversements aux propriétaires : c'est de l'argent qui sort, donc la finance.
  { methodes: ["POST"], chemin: new RegExp(`^/crg/${ID}/payouts$`), roles: ["ACCOUNTANT"] },
  { methodes: ["DELETE"], chemin: new RegExp(`^/crg/${ID}/payouts/${ID}$`), roles: ["ACCOUNTANT"] },
];

/**
 * Lectures SENSIBLES : refusées sauf aux rôles listés (FULL y est toujours
 * admis). Toute autre lecture reste ouverte à tous les rôles.
 */
const LECTURES_SENSIBLES: ReadonlyArray<{ chemin: RegExp; roles: readonly RoleEquipe[] }> = [
  // Export des données personnelles d'un locataire, journal d'activité, échéances RGPD.
  { chemin: new RegExp(`^/tenants/${ID}/export$`), roles: [] },
  { chemin: /^\/activity-log(\/|$)/, roles: [] },
  { chemin: /^\/conservation(\/|$)/, roles: [] },
  // Pièce d'identité : exploitation courante seulement.
  { chemin: new RegExp(`^/tenants/${ID}/id-document-url$`), roles: ["AGENT"] },
  // Exports comptables.
  { chemin: /^\/fiscal\/(grand-livre|fec|syscohada)$/, roles: ["ACCOUNTANT"] },
  { chemin: /^\/expenses\/export$/, roles: ["ACCOUNTANT"] },
];

export type VerdictEquipe = { autorise: true } | { autorise: false; message: string };

/** Chemin relatif à /api, sans paramètre de requête ni barre finale. */
export function normaliserChemin(urlOriginale: string): string {
  let chemin = urlOriginale.split("?")[0].split("#")[0];
  if (chemin.startsWith("/api/")) chemin = chemin.slice("/api".length);
  chemin = chemin.replace(/\/+$/, "");
  return chemin === "" ? "/" : chemin;
}

function refus(role: RoleEquipe): VerdictEquipe {
  return {
    autorise: false,
    message: `Votre rôle dans l'équipe (${LIBELLES_ROLES_EQUIPE[role]}) ne permet pas cette action. Demandez au gestionnaire propriétaire de l'agence de modifier votre rôle.`,
  };
}

/** Le collaborateur de rôle `role` peut-il exécuter `methode` sur `urlOriginale` ? */
export function verifierAutorisationEquipe(role: RoleEquipe, methode: string, urlOriginale: string): VerdictEquipe {
  if (role === "FULL") return { autorise: true };

  const verbe = methode.toUpperCase();
  const chemin = normaliserChemin(urlOriginale);

  if (verbe === "GET" || verbe === "HEAD" || verbe === "OPTIONS") {
    const sensible = LECTURES_SENSIBLES.find((l) => l.chemin.test(chemin));
    return sensible && !sensible.roles.includes(role) ? refus(role) : { autorise: true };
  }

  const regle = ECRITURES_AUTORISEES.find((r) => r.methodes.includes(verbe) && r.chemin.test(chemin) && r.roles.includes(role));
  return regle ? { autorise: true } : refus(role);
}

