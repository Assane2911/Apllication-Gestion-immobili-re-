/**
 * Informations juridiques de l'éditeur d'ImmoPlatform Pro.
 *
 * ⚠️ À COMPLÉTER : les valeurs marquées "[À COMPLÉTER]" sont des placeholders.
 * Elles doivent être remplacées par les informations réelles de l'auto-entrepreneur
 * avant la mise en production (les mentions légales sont obligatoires en France —
 * loi n°2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique).
 *
 * Une fois complétées, ce fichier est la seule source à modifier : les 3 pages
 * légales (mentions-legales, cgu, confidentialite) l'importent toutes.
 */
export const COMPANY = {
  /** Nom et prénom de l'auto-entrepreneur, tel qu'il figure sur l'immatriculation. */
  fullName: "[À COMPLÉTER — nom complet de l'auto-entrepreneur]",
  /** Nom commercial utilisé pour le service. */
  tradeName: "ImmoPlatform Pro",
  /** Statut juridique. */
  legalStatus: "Entreprise Individuelle (Auto-entrepreneur / Micro-entreprise)",
  /** Numéro SIRET (14 chiffres). */
  siret: "[À COMPLÉTER — numéro SIRET]",
  /** Adresse professionnelle ou, à défaut, personnelle. */
  address: "[À COMPLÉTER — adresse]",
  /** Email de contact pour les questions légales, contractuelles et RGPD. */
  contactEmail: "[À COMPLÉTER — email de contact]",
  /** Pays et droit applicable. */
  country: "France",
  /** Date de dernière mise à jour des documents légaux (à mettre à jour à chaque révision). */
  lastUpdated: "30 août 2026",
};

/** Sous-traitants techniques mentionnés dans la politique de confidentialité. */
export const SUBPROCESSORS = {
  hostingFrontendBackend: {
    name: "Vercel Inc.",
    address: "440 N Barranca Ave #4133, Covina, CA 91723, États-Unis",
    role: "Hébergement du frontend et des fonctions serverless du backend (CDN et exécution du code applicatif).",
  },
  database: {
    name: "Supabase (Supabase Inc.)",
    address: "Base de données et stockage de fichiers hébergés dans la région eu-west-3 (Paris, France).",
    role: "Base de données (informations sur les biens, locataires, contrats, paiements) et stockage des fichiers (photos, pièces d'identité, documents).",
  },
  paymentStripe: {
    name: "Stripe",
    role: "Traitement des paiements par carte bancaire. ImmoPlatform Pro ne stocke aucune donnée de carte bancaire — celles-ci transitent directement et exclusivement via Stripe.",
  },
  paymentPaydunya: {
    name: "PayDunya",
    role: "Traitement des paiements par mobile money (Orange Money, Wave, Free Money, MTN...) et carte bancaire pour les utilisateurs d'Afrique francophone. ImmoPlatform Pro ne stocke aucune donnée de paiement — celles-ci transitent directement via PayDunya.",
  },
};
