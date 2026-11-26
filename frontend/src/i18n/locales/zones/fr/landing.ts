/** Textes de la page d'accueil publique, chargés avec elle. */
const zone = {
  landing: {
      reminders: {
        title: "Simulateur · Relances automatiques",
        subtitle: "Réglez le délai et l'intervalle, comme dans les paramètres de votre agence.",
        grace: "Délai avant la première relance",
        interval: "Intervalle entre deux relances",
        days_one: "{{count}} jour",
        days_other: "{{count}} jours",
        day: "J+{{day}}",
        timeline: "Calendrier des relances d'un loyer impayé",
        steps: { due: "Échéance du loyer", first: "Relance amiable", second: "Deuxième relance", third: "Dernière relance", end: "Fin des relances automatiques : la suite vous revient" },
        summary: "Relance amiable à J+{{first}}, deuxième relance à J+{{second}}, dernière relance à J+{{third}}.",
        note: "Chaque relance part par e-mail au titulaire et aux colocataires ; WhatsApp avec la formule Professionnel. Vous pouvez aussi prévenir les garants.",
        cta: "Activer les relances pendant l'essai",
      },
    stickyCta: "Essayer gratuitement",
    steps: {
      title: "De l'inscription à la première quittance",
      create: { title: "Créez votre compte", desc: "Quelques minutes suffisent : une adresse e-mail, le pays de votre agence, et l'essai de 15 jours démarre." },
      add: { title: "Ajoutez vos biens et locataires", desc: "Saisissez vos biens, vos locataires et leurs baux, ou importez-les depuis un fichier." },
      automate: { title: "Laissez la plateforme travailler", desc: "Quittances, rappels de loyer et suivi de rentabilité se font sans ressaisie." },
    },
    nav: {
      features: "Fonctionnalités",
      vitrine: "Nos biens",
      receipts: "Quittances & Signature",
      compare: "Comparatif",
      pricing: "Tarifs",
      currencies: "Multi-Devises",
      security: "Sécurité",
      faq: "FAQ",
      goToSpace: "Accéder à mon espace →",
      login: "Se connecter",
      trial: "Essai 15j gratuit →",
      trialShort: "Essai gratuit →",
      top: "Haut de page",
      menu: "Menu",
    },
    badge: "Nouvelle Version 2.0 • 15 jours d'essai gratuit offert sans engagement",
    hero: {
      titleLine1: "La gestion locative",
      titleLine2: "réinventée & automatisée.",
      subtitle:
        "Générez vos quittances en PDF, faites signer vos baux en ligne, envoyez vos relances automatiques du 1er du mois et suivez votre rentabilité nette en temps réel.",
      ctaTrial: "Démarrer l'essai 15 jours gratuit →",
      ctaPricing: "Voir les tarifs",
    },
    features: {
      receipts: {
        title: "Quittances & Baux en PDF",
        desc: "Téléchargement instantané des quittances de loyer avec cachet de l'agence, numéro de série et mentions légales dès confirmation du paiement.",
      },
      signature: {
        title: "Signature Tactile Électronique",
        desc: "Faites signer vos contrats de location directement sur smartphone ou tablette. Horodatage et archivage numérique sécurisé.",
      },
      reminders: {
        title: "Alertes Automatiques du 1er du Mois",
        desc: "Rappels programmés au 1er de chaque mois rappelant à chaque locataire la date limite de paiement de son loyer, avec lien de règlement sécurisé.",
      },
      dashboard: {
        title: "Tableau de Bord & Statistiques en Temps Réel",
        desc: "Suivez en un coup d'œil votre taux d'occupation, vos revenus encaissés, vos impayés et l'état de votre parc immobilier grâce à des graphiques clairs et actualisés en direct.",
      },
      expenses: {
        title: "Suivi des Dépenses & Rentabilité Nette",
        desc: "Enregistrez vos frais d'entretien, taxes et charges, et visualisez automatiquement votre flux de trésorerie réel — revenus moins dépenses — mois après mois.",
      },
      tenantPortal: {
        title: "Portail Locataire Dédié",
        desc: "Vos locataires paient leur loyer, consultent leurs quittances, signalent un incident avec photo et vous écrivent directement, sans appel ni papier.",
      },
      security: {
        title: "Sécurité & Conformité RGPD",
        desc: "Isolation stricte des données entre agences, mots de passe chiffrés, connexions sécurisées et hébergement en France — conforme au RGPD dès la conception.",
      },
      multiCurrency: {
        title: "Multi-Devises",
        desc: "Affichez et encaissez vos loyers dans la devise de votre choix, adaptée à votre marché et à celui de vos locataires.",
      },
      multiLanguage: {
        title: "Interface Multilingue",
        desc: "Français, anglais, portugais et espagnol : chaque utilisateur choisit sa langue d'affichage en un clic, sans configuration.",
      },
    },
    featuresSection: {
      title: "Tout ce qu'il faut pour gérer vos locations sereinement",
      subtitle: "Une seule plateforme, du bail à l'encaissement, pour les indépendants comme pour les agences.",
    },
    extras: [
      "Messagerie intégrée",
      "Recherche globale instantanée",
      "Journal d'activité complet",
      "Export comptable CSV",
      "Marque blanche pour votre agence",
    ],
    productTour: {
      title: "Découvrez la plateforme en images",
      subtitle: "Une interface pensée pour aller vite, aussi bien pour vous que pour vos locataires.",
      dashboard: {
        title: "Tableau de bord clair et actionnable",
        desc: "Revenus, occupation, impayés et incidents : toutes vos priorités du jour, réunies sur un seul écran.",
      },
      contracts: {
        title: "Des baux signés en quelques clics",
        desc: "Génération du contrat, signature tactile du locataire, archivage automatique — sans imprimante ni scanner.",
      },
      expenses: {
        title: "Une rentabilité toujours à jour",
        desc: "Chaque dépense enregistrée recalcule instantanément votre flux de trésorerie net, bien par bien.",
      },
      tenant: {
        title: "Une expérience locataire fluide",
        desc: "Quittances, documents à signer et messagerie directe : vos locataires ne vous appellent plus pour un oui ou un non.",
      },
    },
    forWho: {
      title: "Conçu pour tous les profils de gestion locative",
      subtitle: "Que vous gériez un studio ou plusieurs centaines de lots, une formule est faite pour vous.",
      independent: {
        title: "Propriétaire indépendant",
        desc: "Gérez vos quelques biens en toute simplicité : quittances automatiques, rappels de paiement et portail locataire, sans complexité inutile.",
      },
      agency: {
        title: "Agence immobilière",
        desc: "Signature électronique, suivi de rentabilité et marque blanche pour présenter une image professionnelle à vos clients propriétaires et locataires.",
      },
      enterprise: {
        title: "Gestionnaire de grand portefeuille",
        desc: "Multi-utilisateurs, export comptable automatisé et support prioritaire pour piloter des centaines de biens sans perdre en visibilité.",
      },
    },
    trust: {
      title: "Vos données, protégées sérieusement",
      subtitle: "La sécurité n'est pas une option ajoutée après coup : elle fait partie de l'architecture du service.",
      items: [
        "Hébergement des données en France (Paris), sur une infrastructure dédiée.",
        "Isolation stricte des données entre agences : aucun gestionnaire ne peut voir les biens, locataires ou paiements d'un autre.",
        "Mots de passe chiffrés et connexions intégralement sécurisées en HTTPS.",
        "Politique de confidentialité conforme au RGPD, consultable à tout moment.",
      ],
      linkLabel: "Consulter notre politique de confidentialité →",
    },
    faq: {
      searchLabel: "Rechercher dans la FAQ",
      searchPlaceholder: "Rechercher une question…",
      noResult: "Aucune question ne correspond à votre recherche.",
      clearSearch: "Effacer la recherche",
      title: "Questions fréquentes",
      items: [
        {
          q: "Combien de temps pour commencer ?",
          a: "Quelques minutes : créez votre compte, ajoutez votre premier bien et profitez immédiatement de 15 jours d'essai gratuit, sans carte bancaire requise.",
        },
        {
          q: "Mes données sont-elles en sécurité ?",
          a: "Oui : vos données sont hébergées en France, chiffrées et strictement isolées des autres agences utilisant la plateforme. Voir notre politique de confidentialité pour le détail.",
        },
        {
          q: "Quels moyens de paiement mes locataires peuvent-ils utiliser ?",
          a: "Vos locataires règlent leur loyer en ligne (Mobile Money ou carte bancaire) directement sur le compte PayDunya de votre agence, que vous branchez dans vos réglages : l'argent ne passe pas par la plateforme. Un loyer reçu autrement (espèces, chèque, Mobile Money) s'enregistre à la main, en un clic.",
        },
        {
          q: "Puis-je annuler mon abonnement à tout moment ?",
          a: "Oui, sans engagement. Vous pouvez résilier depuis votre espace gestionnaire à tout moment ; l'accès reste actif jusqu'à la fin de la période déjà payée.",
        },
        {
          q: "Le service fonctionne-t-il en dehors de la France ?",
          a: "Oui : devise d'affichage personnalisable, interface en 4 langues et moyens de paiement adaptés à l'Afrique francophone comme à l'international.",
        },
      ],
    },
    finalCta: {
      title: "Prêt à moderniser votre gestion locative ?",
      subtitle: "Rejoignez les gestionnaires qui ont déjà simplifié leurs quittances, leurs relances et leur suivi financier.",
      cta: "Démarrer mon essai gratuit de 15 jours →",
    },
    pricing: {
      perYear: "/ an",
      monthlyEquivalent: "soit {{price}} / mois",
      currencyLabel: "Devise",
      cycleLabel: "Période de facturation",
      monthly: "Mensuel",
      annual: "Annuel",
      annualSaving: "Payez à l'année : {{pct}} % d'économie",
      advisor: {
        title: "Trouver ma formule",
        label: "Combien de biens gérez-vous ?",
        result_one: "Pour {{count}} bien, nous vous conseillons",
        result_other: "Pour {{count}} biens, nous vous conseillons",
        upTo: "Jusqu'à {{max}} biens inclus",
        unlimited: "Biens illimités",
        perProperty: "soit {{price}} par bien et par mois",
        forYou_one: "Pour vos {{count}} bien",
        forYou_other: "Pour vos {{count}} biens",
      },
      title: "Des formules simples et transparentes",
      subtitle: "Toutes les formules incluent 15 jours d'essai gratuit sans carte bancaire requise, avec le guide de démarrage pas à pas.",
      perMonth: "/ mois",
      starter: {
        name: "Starter",
        cta: "Démarrer l'essai 15j",
      },
      pro: {
        name: "Professionnel",
        badge: "Recommandé",
        cta: "Démarrer l'essai 15j gratuit",
      },
      enterprise: {
        name: "Agence & Multi-Comptes",
        cta: "Démarrer l'essai 15j",
      },
    },
    compare: {
      badge: "Comparatif & Valeur Ajoutée",
      titlePrefix: "Gestion Traditionnelle vs",
      subtitle:
        "Découvrez pourquoi les agences et propriétaires modernes abandonnent les tableurs Excel, les échanges WhatsApp éparpillés et la paperasse pour une gestion locative 100% automatisée.",
      roi: {
        adminTime: "Temps administratif",
        unpaidRent: "Loyer impayé oublié",
        certified: "Baux & quittances automatisés",
      },
      headers: {
        feature: "Fonctionnalité & Processus",
        traditional: "Gestion Traditionnelle (Excel / Papier)",
        recommended: "Recommandé",
      },
      rows: {
        reminders: {
          title: "Avis d'échéance & Relances de loyer",
          description: "Anticipation des paiements et réduction des impayés",
          traditional: "Oublis fréquents, appels gênants, messages WhatsApp éparpillés, retards de paiement réguliers.",
          immoplatform: "Avis d'échéance automatique chaque 1er du mois, rappel avant la date d'échéance fixée dans le bail. Factures instantanées avec statut en direct.",
        },
        receipts: {
          title: "Quittances de loyer automatiques",
          description: "Génération et délivrance légale aux locataires",
          traditional: "Création manuelle sur Word/Excel, conversion PDF fastidieuse, envois par email souvent oubliés.",
          immoplatform: "Génération automatique en 1 clic, en PDF, avec cachet agence, numéro unique et mentions légales.",
        },
        signature: {
          title: "Signature des contrats de bail",
          description: "Validation juridique et conclusion des baux",
          traditional: "Impression papier, paraphage page par page, déplacements physiques obligatoires, baux égarés.",
          immoplatform: "Signature tactile électronique (ordinateur, tablette, mobile) avec horodatage en 2 minutes.",
        },
        incidents: {
          title: "Signalement des pannes & Incidents",
          description: "Suivi des réparations et de la maintenance",
          traditional: "Appels téléphoniques d'urgence, descriptions vagues, photos non datées, historique inexistant.",
          immoplatform: "Prise de photo directe par le locataire, galerie haute résolution pour l'agence et suivi d'intervention en temps réel.",
        },
        expenses: {
          title: "Suivi des dépenses & Cash-Flow Net",
          description: "Calcul de rentabilité réelle et comptabilité",
          traditional: "Factures d'artisans dispersées, calculs manuels de fin d'année, aucune visibilité sur le rendement net.",
          immoplatform: "Enregistrement des dépenses par catégorie, calcul automatique du Cash-Flow net et export comptable CSV en 1 clic.",
        },
        branding: {
          title: "Image de marque & Multi-devises",
          description: "Professionnalisme et dimension internationale",
          traditional: "Documents neutres ou non professionnels, conversion manuelle sujette aux erreurs de change.",
          immoplatform: "Marque blanche agence (logo, identifiants légaux, en-tête) et prise en charge de l'euro et du franc CFA (FCFA).",
        },
      },
      cta: {
        text: "Prêt à moderniser la gestion de votre parc immobilier dès aujourd'hui ?",
        button: "Démarrer 15 jours d'essai gratuit →",
      },
    },
    mock: {
      netFlow: "Flux net",
      rentMonth: "Loyer de septembre",
      pay: "Payer",
      tenantMessage: "Bonjour, le chauffe-eau fait du bruit 🙈",
      managerReply: "Merci, j'envoie un plombier demain !",
      signed: "Signé",
    },
    footer: {
      rights: "© 2026 ImmoPlatform Pro. Tous droits réservés.",
      tagline: "Logiciel de gestion locative immobilière sécurisé.",
      legal: "Mentions légales",
      terms: "CGU & CGV",
      privacy: "Confidentialité",
    },
  },

};

export default zone;
export type ZoneLanding = typeof zone;
