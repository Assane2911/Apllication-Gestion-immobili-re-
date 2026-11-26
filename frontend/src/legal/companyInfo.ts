/**
 * Informations juridiques de l'éditeur d'ImmoPlatform Pro.
 *
 * Le service est édité par ImmoPlatform Pro LLC, société à responsabilité limitée
 * de droit américain immatriculée dans l'État du Wyoming. L'adresse est celle qui
 * figure sur la lettre de l'IRS (adresse du registered agent). Le dirigeant est son
 * membre unique.
 *
 * Son numéro d'identification fiscale (EIN) n'est volontairement PAS publié : aucune
 * obligation de l'afficher, et c'est un identifiant fiscal que des fraudeurs exploitent.
 * Il se communique directement aux organismes qui le demandent (Stripe, banque, IRS).
 *
 * La date d'immatriculation de la LLC n'est pas affichée : elle ne figure pas sur
 * la lettre de l'IRS, et on n'affiche pas une date que l'on n'a pas vérifiée.
 *
 * Ce fichier est la seule source à modifier : les 3 pages légales (mentions-legales,
 * cgu, confidentialite) l'importent toutes.
 */
export const COMPANY = {
  /** Dénomination sociale de l'éditeur. */
  fullName: "ImmoPlatform Pro LLC",
  /** Représentant légal (membre unique) ; aussi directeur de la publication. */
  representative: "Imame Assane Thiam",
  /** Nom commercial utilisé pour le service. */
  tradeName: "ImmoPlatform Pro",
  /** Statut juridique. */
  legalStatus: "Société à responsabilité limitée de droit américain (LLC), immatriculée dans l'État du Wyoming (États-Unis)",
  /** Numéro SIRET (14 chiffres) — non applicable : société de droit américain. */
  siret: "Non applicable (société de droit américain)",
  /** Adresse professionnelle (celle de la lettre de l'IRS). */
  address: "30 N Gould St, Ste R, Sheridan, WY 82801, États-Unis",
  /** Email de contact pour les questions légales, contractuelles et RGPD. */
  contactEmail: "contact@immoplatformpro.com",
  /** Pays de l'éditeur : celui de son siège (la LLC est américaine ; elle n'a pas d'établissement en France). */
  country: "États-Unis",
  /**
   * Droit applicable aux CGU/CGV : un CHOIX contractuel, distinct du pays de l'éditeur (les clients sont des
   * professionnels, donc le choix est libre). Valeur à faire valider par un juriste avant toute modification.
   */
  governingLaw: "droit français",
  /** Date de dernière mise à jour des documents légaux (à mettre à jour à chaque révision). */
  lastUpdated: "26 novembre 2026",
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
  // Les quatre destinataires ci-dessous reçoivent eux aussi des données
  // personnelles et doivent donc figurer dans la liste : les omettre rendait
  // l'information incomplète, alors que le code les appelle réellement
  // (email.service.ts, whatsapp.service.ts, auth.controller.ts::loginWithGoogle,
  // instrument.ts).
  email: {
    name: "Fournisseur d'envoi d'emails (SMTP)",
    role: "Acheminement des emails transactionnels : confirmation d'adresse, réinitialisation de mot de passe, rappels de loyer et quittances. Reçoit l'adresse du destinataire, le contenu du message et ses pièces jointes (la quittance porte le nom du locataire, l'adresse du logement et le montant réglé).",
  },
  whatsapp: {
    name: "Meta Platforms (WhatsApp Cloud API)",
    role: "Envoi facultatif des rappels de loyer par WhatsApp, lorsque le Gestionnaire active ce canal. Reçoit alors le numéro de téléphone et le nom du locataire, l'intitulé du bien, la période concernée et le montant dû.",
  },
  googleSignIn: {
    name: "Google (Sign-In)",
    role: "Connexion facultative « Se connecter avec Google », réservée aux comptes Gestionnaire. Google transmet au Service l'adresse email, le nom et l'identifiant de compte Google du Gestionnaire qui choisit ce mode de connexion.",
  },
  /**
   * Le workflow « Sauvegarde de la base » (.github/workflows/sauvegarde.yml) dépose chaque nuit sur GitHub une copie de TOUTE la base,
   * chiffrée avant dépôt. La durée est celle de `retention-days` dans ce workflow : un test (PolitiqueConfidentialitePage.test.tsx)
   * vérifie que la politique annonce la même.
   */
  sauvegardes: {
    name: "GitHub (GitHub, Inc., société du groupe Microsoft)",
    role: "Conservation des copies de sauvegarde chiffrées de la base de données (une par nuit). Les copies sont chiffrées (AES-256) avant leur dépôt : GitHub ne détient que des fichiers illisibles, dont la phrase de passe n'est connue que de l'éditeur. Voir la section 6 pour leur durée de conservation.",
  },
  errorMonitoring: {
    name: "Sentry",
    role: "Détection et diagnostic des erreurs techniques. Configuré pour ne pas transmettre de données personnelles par défaut ; un rapport d'erreur peut néanmoins contenir des éléments techniques de contexte (adresse IP, identifiants internes).",
  },
  /**
   * N'est chargé qu'après consentement explicite via la bannière cookies
   * (CookieConsentBanner.tsx), jamais par défaut — voir utils/analytics.ts.
   * Tant qu'aucun ID de mesure n'est configuré (VITE_GA_MEASUREMENT_ID), la
   * bannière elle-même ne s'affiche pas et ce sous-traitant reste inactif.
   */
  analytics: {
    name: "Google Analytics (Google LLC)",
    role: "Mesure d'audience du site public (pages visitées, provenance du trafic), uniquement avec le consentement préalable du visiteur. Aucune collecte si le consentement est refusé ou non donné.",
  },
  /**
   * N'est chargé qu'après consentement explicite via la bannière cookies
   * (CookieConsentBanner.tsx), jamais par défaut — voir utils/metaPixel.ts.
   * Distinct de l'entrée "whatsapp" ci-dessus : même entreprise (Meta), mais
   * un produit différent (pixel de reciblage publicitaire, pas l'envoi de
   * messages WhatsApp).
   */
  metaPixel: {
    name: "Meta Platforms (Pixel Meta)",
    role: "Mesure et reciblage publicitaire sur Facebook/Instagram (ex. revisiter le site après avoir vu une publicité), uniquement sur les pages du site public (jamais dans l'application) et avec le consentement préalable du visiteur. Aucune collecte si le consentement est refusé ou non donné.",
  },
  /**
   * N'est chargé qu'après consentement explicite via la bannière cookies
   * (CookieConsentBanner.tsx), jamais par défaut — voir utils/linkedinInsight.ts.
   */
  linkedinInsight: {
    name: "LinkedIn (LinkedIn Corporation)",
    role: "Mesure et reciblage publicitaire sur LinkedIn, uniquement sur les pages du site public (jamais dans l'application) et avec le consentement préalable du visiteur. Aucune collecte si le consentement est refusé ou non donné.",
  },
};
