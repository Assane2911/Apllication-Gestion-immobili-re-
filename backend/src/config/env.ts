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

  // URL publique de CE backend, nÃ©cessaire pour construire le callback_url
  // (webhook IPN) que l'on transmet aux prestataires de paiement externes
  // (PayDunya, etc.) â€” ils ne peuvent pas appeler "localhost". En
  // production sur Vercel, VERCEL_PROJECT_PRODUCTION_URL est injectÃ©
  // automatiquement ; sinon on utilise PUBLIC_BACKEND_URL si fourni.
  // "||" et non "??" : PUBLIC_BACKEND_URL="" (vide) dans .env.example doit
  // aussi retomber sur la valeur par dÃ©faut, pas rester une chaÃ®ne vide.
  publicBackendUrl:
    process.env.PUBLIC_BACKEND_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : `http://localhost:${process.env.PORT ?? "4000"}`),

  // Pas de valeur par dÃ©faut : si JWT_SECRET est absent, l'application doit
  // refuser de dÃ©marrer plutÃ´t que d'utiliser un secret public et prÃ©visible.
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",

  // Identifiant client OAuth Google (public, PAS le secret â€” voir
  // loginWithGoogle dans auth.controller.ts, qui vÃ©rifie le jeton d'identitÃ©
  // renvoyÃ© par Google Identity Services sans jamais avoir besoin du Client
  // Secret). Vide par dÃ©faut : le bouton "Se connecter avec Google" reste
  // simplement masquÃ© cÃ´tÃ© frontend tant que cette variable n'est pas
  // renseignÃ©e, comme pour Stripe/PayDunya/Meta WhatsApp ci-dessous.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",

  smtp: {
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT ?? "465", 10),
    secure: (process.env.SMTP_SECURE ?? "true") === "true",
    user: process.env.SMTP_USER ?? "",
    appPassword: process.env.SMTP_APP_PASSWORD ?? "",
    from: process.env.EMAIL_FROM ?? "Gestion ImmobiliÃ¨re <no-reply@example.com>",
  },

  // WhatsApp (API Meta WhatsApp Cloud, intÃ©gration directe sans prestataire
  // intermÃ©diaire) : rappels de loyer envoyÃ©s en complÃ©ment de l'email â€” voir
  // whatsapp.service.ts pour les prÃ©requis (Meta Business Manager, numÃ©ro
  // WhatsApp Business, System User avec jeton permanent, modÃ¨les de message
  // approuvÃ©s par Meta). Tant que accessToken/phoneNumberId ne sont pas
  // renseignÃ©s, l'envoi retombe sur une simulation (comme sendEmail quand
  // SMTP n'est pas configurÃ©) ; idem si l'un des deux noms de modÃ¨le
  // ci-dessous est vide.
  whatsapp: {
    // Jeton d'accÃ¨s permanent d'un "System User" du Meta Business Manager
    // (Business Settings â†’ System Users), avec la permission
    // whatsapp_business_messaging sur la WhatsApp Business Account (WABA).
    accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN ?? "",
    // Identifiant technique du numÃ©ro WhatsApp Business expÃ©diteur (WhatsApp
    // Manager â†’ le numÃ©ro â†’ "Phone number ID"), PAS le numÃ©ro de tÃ©lÃ©phone
    // lui-mÃªme.
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? "",
    // Noms des modÃ¨les ("Message Templates") crÃ©Ã©s et approuvÃ©s dans le Meta
    // WhatsApp Manager â€” voir whatsapp.service.ts pour le texte exact et les
    // variables attendues par chacun.
    templateNameRentDue: process.env.META_WHATSAPP_TEMPLATE_RENT_DUE ?? "",
    templateNameRentDueSoon: process.env.META_WHATSAPP_TEMPLATE_RENT_DUE_SOON ?? "",
    // Code langue du modÃ¨le tel que dÃ©clarÃ© dans le WhatsApp Manager (ex:
    // "fr" pour un modÃ¨le rÃ©digÃ© et approuvÃ© en franÃ§ais).
    templateLanguage: process.env.META_WHATSAPP_TEMPLATE_LANGUAGE ?? "fr",
  },

  reminder: {
    daysBefore: parseInt(process.env.CONTRACT_REMINDER_DAYS ?? "14", 10),
    cron: process.env.REMINDER_CRON ?? "0 8 * * *",
    // Nombre de jours avant l'Ã©chÃ©ance d'une facture pour envoyer le rappel
    // complÃ©mentaire "derniÃ¨re minute" au locataire (voir runUpcomingRentDueReminders).
    rentDueSoonDays: parseInt(process.env.RENT_DUE_SOON_DAYS ?? "3", 10),
  },

  // Secret partagÃ© avec Vercel (variable d'env CRON_SECRET sur le projet)
  // pour authentifier les appels Ã  /api/cron/contract-reminders.
  cronSecret: process.env.CRON_SECRET ?? "",

  // En local/dev, le scheduler node-cron interne tourne automatiquement.
  // Sur Vercel (serverless, pas de processus persistant), il est dÃ©sactivÃ© :
  // c'est le Vercel Cron Job (vercel.json) qui appelle la route /api/cron/... .
  enableInternalCron: (process.env.ENABLE_INTERNAL_CRON ?? "true") === "true",

  payments: {
    // Fail-closed, comme pour CRON_SECRET (voir cron.controller.ts) : en
    // production, le mode dÃ©mo doit Ãªtre demandÃ© EXPLICITEMENT.
    //
    // Ce drapeau ne se contente pas d'activer le moyen de paiement "DEMO" : il
    // court-circuite aussi Stripe et PayDunya, qui renvoient alors un paiement
    // simulÃ© au statut PAID (voir payment.service.ts). Un dÃ©faut Ã  "true"
    // rendait donc toute la barriÃ¨re payante dÃ©corative dÃ¨s que la variable
    // n'Ã©tait pas renseignÃ©e sur l'hÃ©bergeur â€” un abonnement pouvait Ãªtre
    // activÃ© sans qu'un centime ne soit encaissÃ©, quel que soit le moyen
    // choisi. On ne conserve ce dÃ©faut permissif qu'en local/dev.
    demoMode:
      (process.env.PAYMENTS_DEMO_MODE ??
        (process.env.NODE_ENV === "production" || process.env.VERCEL ? "false" : "true")) === "true",
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    // Devises que ton compte Stripe accepte rÃ©ellement. DÃ©clarÃ©es plutÃ´t que
    // devinÃ©es : prÃ©senter un paiement dans une devise que le compte ne sait
    // pas encaisser Ã©choue au moment du rÃ¨glement, devant le client.
    stripeCurrencies: (process.env.STRIPE_CURRENCIES ?? "EUR")
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
    // Nom affichÃ© au payeur, sur la page Stripe comme sur la page PayDunya.
    // Une seule valeur pour les deux : deux rÃ©glages pour un mÃªme nom
    // finiraient par se contredire d'un prestataire Ã  l'autre.
    storeName: process.env.PAYMENTS_STORE_NAME ?? process.env.PAYDUNYA_STORE_NAME ?? "ImmoPlatform Pro",
    // PayDunya (https://paydunya.com) : agrÃ©gateur de paiement ouest-africain
    // (Orange Money, Wave, Free Money, MTN Money, cartes bancaires...). Tant
    // que masterKey/privateKey/token ne sont pas renseignÃ©s (ou que
    // PAYMENTS_DEMO_MODE=true), le paiement retombe sur une simulation â€” voir
    // payment.service.ts.
    paydunya: {
      masterKey: process.env.PAYDUNYA_MASTER_KEY ?? "",
      privateKey: process.env.PAYDUNYA_PRIVATE_KEY ?? "",
      publicKey: process.env.PAYDUNYA_PUBLIC_KEY ?? "",
      token: process.env.PAYDUNYA_TOKEN ?? "",
      // "test" utilise le bac Ã  sable PayDunya (sandbox-api), "live" la prod.
      mode: (process.env.PAYDUNYA_MODE ?? "test") as "test" | "live",
      // L'API PayDunya n'a AUCUN champ de devise : `total_amount` est lu dans
      // la devise du compte marchand, fixÃ©e par le pays de celui-ci. Sur un
      // compte sÃ©nÃ©galais (XOF), envoyer 29 pour un prix de 29 â‚¬ facture donc
      // 29 FCFA, soit environ quatre centimes d'euro. Cette valeur dÃ©clare la
      // devise du compte afin de pouvoir refuser tout paiement libellÃ© dans
      // une autre, au lieu d'encaisser un centiÃ¨me du prix.
      currency: process.env.PAYDUNYA_CURRENCY ?? "XOF",
    },
  },
};