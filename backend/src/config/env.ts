import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}

export const env = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",

  // Sentry (suivi d'erreurs) : DSN vide => Sentry.init() ne fait rien
  // (voir instrument.ts), donc aucune config requise en local/dev.
  sentryDsn: process.env.SENTRY_DSN ?? "",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",

  // URL publique de CE backend, nécessaire pour construire le callback_url
  // (webhook IPN) que l'on transmet aux prestataires de paiement externes
  // (PayDunya, etc.) — ils ne peuvent pas appeler "localhost". En
  // production sur Vercel, VERCEL_PROJECT_PRODUCTION_URL est injecté
  // automatiquement ; sinon on utilise PUBLIC_BACKEND_URL si fourni.
  // "||" et non "??" : PUBLIC_BACKEND_URL="" (vide) dans .env.example doit
  // aussi retomber sur la valeur par défaut, pas rester une chaîne vide.
  publicBackendUrl:
    process.env.PUBLIC_BACKEND_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : `http://localhost:${process.env.PORT ?? "4000"}`),

  // Pas de valeur par défaut : si JWT_SECRET est absent, l'application doit
  // refuser de démarrer plutôt que d'utiliser un secret public et prévisible.
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",

  // Identifiant client OAuth Google (public, PAS le secret — voir
  // loginWithGoogle dans auth.controller.ts, qui vérifie le jeton d'identité
  // renvoyé par Google Identity Services sans jamais avoir besoin du Client
  // Secret). Vide par défaut : le bouton "Se connecter avec Google" reste
  // simplement masqué côté frontend tant que cette variable n'est pas
  // renseignée, comme pour Stripe/PayDunya/Meta WhatsApp ci-dessous.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",

  smtp: {
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT ?? "465", 10),
    secure: (process.env.SMTP_SECURE ?? "true") === "true",
    user: process.env.SMTP_USER ?? "",
    appPassword: process.env.SMTP_APP_PASSWORD ?? "",
    from: process.env.EMAIL_FROM ?? "Gestion Immobilière <no-reply@example.com>",
  },

  // WhatsApp (API Meta WhatsApp Cloud, intégration directe sans prestataire
  // intermédiaire) : rappels de loyer envoyés en complément de l'email — voir
  // whatsapp.service.ts pour les prérequis (Meta Business Manager, numéro
  // WhatsApp Business, System User avec jeton permanent, modèles de message
  // approuvés par Meta). Tant que accessToken/phoneNumberId ne sont pas
  // renseignés, l'envoi retombe sur une simulation (comme sendEmail quand
  // SMTP n'est pas configuré) ; idem si l'un des deux noms de modèle
  // ci-dessous est vide.
  whatsapp: {
    // Jeton d'accès permanent d'un "System User" du Meta Business Manager
    // (Business Settings → System Users), avec la permission
    // whatsapp_business_messaging sur la WhatsApp Business Account (WABA).
    accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN ?? "",
    // Identifiant technique du numéro WhatsApp Business expéditeur (WhatsApp
    // Manager → le numéro → "Phone number ID"), PAS le numéro de téléphone
    // lui-même.
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? "",
    // Noms des modèles ("Message Templates") créés et approuvés dans le Meta
    // WhatsApp Manager — voir whatsapp.service.ts pour le texte exact et les
    // variables attendues par chacun.
    templateNameRentDue: process.env.META_WHATSAPP_TEMPLATE_RENT_DUE ?? "",
    templateNameRentDueSoon: process.env.META_WHATSAPP_TEMPLATE_RENT_DUE_SOON ?? "",
    // Code langue du modèle tel que déclaré dans le WhatsApp Manager (ex:
    // "fr" pour un modèle rédigé et approuvé en français).
    templateLanguage: process.env.META_WHATSAPP_TEMPLATE_LANGUAGE ?? "fr",
  },

  reminder: {
    daysBefore: parseInt(process.env.CONTRACT_REMINDER_DAYS ?? "14", 10),
    cron: process.env.REMINDER_CRON ?? "0 8 * * *",
    // Nombre de jours avant l'échéance d'une facture pour envoyer le rappel
    // complémentaire "dernière minute" au locataire (voir runUpcomingRentDueReminders).
    rentDueSoonDays: parseInt(process.env.RENT_DUE_SOON_DAYS ?? "3", 10),
  },

  // Secret partagé avec Vercel (variable d'env CRON_SECRET sur le projet)
  // pour authentifier les appels aux routes /api/cron/*.
  cronSecret: process.env.CRON_SECRET ?? "",

  // Temps qu'une route cron s'autorise à consommer avant de s'arrêter d'elle-
  // même (voir utils/budgetTemps.ts). Vercel tue une fonction au-delà de sa
  // durée maximale — 300 s par défaut, plan Hobby compris — et une exécution
  // tuée l'est au milieu d'un envoi, sans rien en conserver. On s'arrête donc
  // avant, en gardant de la marge pour rendre la réponse HTTP : le reste est
  // repris par l'exécution suivante, puisqu'aucune ligne non traitée n'a été
  // réclamée. À ajuster de pair avec `maxDuration` si elle est un jour
  // configurée dans vercel.json.
  cronBudgetMs: parseInt(process.env.CRON_BUDGET_SECONDS ?? "240", 10) * 1000,

  // En local/dev, le scheduler node-cron interne tourne automatiquement.
  // Sur Vercel (serverless, pas de processus persistant), il est désactivé :
  // c'est le Vercel Cron Job (vercel.json) qui appelle la route /api/cron/... .
  enableInternalCron: (process.env.ENABLE_INTERNAL_CRON ?? "true") === "true",

  payments: {
    // Fail-closed, comme pour CRON_SECRET (voir cron.controller.ts) : en
    // production, le mode démo doit être demandé EXPLICITEMENT.
    //
    // Ce drapeau ne se contente pas d'activer le moyen de paiement "DEMO" : il
    // court-circuite aussi Stripe et PayDunya, qui renvoient alors un paiement
    // simulé au statut PAID (voir payment.service.ts). Un défaut à "true"
    // rendait donc toute la barrière payante décorative dès que la variable
    // n'était pas renseignée sur l'hébergeur — un abonnement pouvait être
    // activé sans qu'un centime ne soit encaissé, quel que soit le moyen
    // choisi. On ne conserve ce défaut permissif qu'en local/dev.
    demoMode:
      (process.env.PAYMENTS_DEMO_MODE ??
        (process.env.NODE_ENV === "production" || process.env.VERCEL ? "false" : "true")) === "true",
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    // Devises que ton compte Stripe accepte réellement. Déclarées plutôt que
    // devinées : présenter un paiement dans une devise que le compte ne sait
    // pas encaisser échoue au moment du règlement, devant le client.
    stripeCurrencies: (process.env.STRIPE_CURRENCIES ?? "EUR")
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
    // Nom affiché au payeur, sur la page Stripe comme sur la page PayDunya.
    // Une seule valeur pour les deux : deux réglages pour un même nom
    // finiraient par se contredire d'un prestataire à l'autre.
    storeName: process.env.PAYMENTS_STORE_NAME ?? process.env.PAYDUNYA_STORE_NAME ?? "ImmoPlatform Pro",
    // PayDunya (https://paydunya.com) : agrégateur de paiement ouest-africain
    // (Orange Money, Wave, Free Money, MTN Money, cartes bancaires...). Tant
    // que masterKey/privateKey/token ne sont pas renseignés (ou que
    // PAYMENTS_DEMO_MODE=true), le paiement retombe sur une simulation — voir
    // payment.service.ts.
    paydunya: {
      masterKey: process.env.PAYDUNYA_MASTER_KEY ?? "",
      privateKey: process.env.PAYDUNYA_PRIVATE_KEY ?? "",
      publicKey: process.env.PAYDUNYA_PUBLIC_KEY ?? "",
      token: process.env.PAYDUNYA_TOKEN ?? "",
      // "test" utilise le bac à sable PayDunya (sandbox-api), "live" la prod.
      mode: (process.env.PAYDUNYA_MODE ?? "test") as "test" | "live",
      // L'API PayDunya n'a AUCUN champ de devise : `total_amount` est lu dans
      // la devise du compte marchand, fixée par le pays de celui-ci. Sur un
      // compte sénégalais (XOF), envoyer 29 pour un prix de 29 € facture donc
      // 29 FCFA, soit environ quatre centimes d'euro. Cette valeur déclare la
      // devise du compte afin de pouvoir refuser tout paiement libellé dans
      // une autre, au lieu d'encaisser un centième du prix.
      currency: process.env.PAYDUNYA_CURRENCY ?? "XOF",
    },
  },
};
