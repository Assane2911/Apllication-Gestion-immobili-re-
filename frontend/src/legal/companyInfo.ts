/**
 * Informations juridiques de l'éditeur d'ImmoPlatform Pro.
 *
 * Statut actuel (21 sept. 2026) : le service est édité par une personne physique,
 * en cours de constitution d'une société (LLC américaine, Wyoming — dossier Doola,
 * EIN attendu ~nov. 2026). Ces informations seront mises à jour dès que la LLC sera
 * juridiquement finalisée (nom social, EIN, adresse officielle).
 *
 * ⚠️ À COMPLÉTER : "address" reste un placeholder tant que la société n'est pas
 * finalisée (voir ci-dessus) — les autres champs sont à jour.
 *
 * Une fois complétées, ce fichier est la seule source à modifier : les 3 pages
 * légales (mentions-legales, cgu, confidentialite) l'importent toutes.
 */
export const COMPANY = {
  /** Nom et prénom de l'éditeur, personne physique (société en cours de formation). */
  fullName: "Imame Assane Thiam",
  /** Nom commercial utilisé pour le service. */
  tradeName: "ImmoPlatform Pro",
  /** Statut juridique. */
  legalStatus:
    "Personne physique, société en cours de formation (future entité américaine ImmoPlatform Pro LLC, Wyoming, en cours d'immatriculation)",
  /** Numéro SIRET (14 chiffres) — non applicable, la structure en formation est une LLC américaine. */
  siret: "Non applicable (entité en cours de formation aux États-Unis)",
  /** Adresse professionnelle ou, à défaut, personnelle. */
  address:
    "[À COMPLÉTER — adresse à définir une fois la société finalisée (LLC en cours d'immatriculation, EIN attendu ~nov. 2026)]",
  /** Email de contact pour les questions légales, contractuelles et RGPD. */
  contactEmail: "assane@immoplatformpro.com",
  /** Pays et droit applicable. */
  country: "France",
  /** Date de dernière mise à jour des documents légaux (à mettre à jour à chaque révision). */
  lastUpdated: "21 septembre 2026",
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
