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

  smtp: {
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT ?? "465", 10),
    secure: (process.env.SMTP_SECURE ?? "true") === "true",
    user: process.env.SMTP_USER ?? "",
    appPassword: process.env.SMTP_APP_PASSWORD ?? "",
    from: process.env.EMAIL_FROM ?? "Gestion Immobilière <no-reply@example.com>",
  },

  reminder: {
    daysBefore: parseInt(process.env.CONTRACT_REMINDER_DAYS ?? "14", 10),
    cron: process.env.REMINDER_CRON ?? "0 8 * * *",
    // Nombre de jours avant l'échéance d'une facture pour envoyer le rappel
    // complémentaire "dernière minute" au locataire (voir runUpcomingRentDueReminders).
    rentDueSoonDays: parseInt(process.env.RENT_DUE_SOON_DAYS ?? "3", 10),
  },

  // Secret partagé avec Vercel (variable d'env CRON_SECRET sur le projet)
  // pour authentifier les appels à /api/cron/contract-reminders.
  cronSecret: process.env.CRON_SECRET ?? "",

  // En local/dev, le scheduler node-cron interne tourne automatiquement.
  // Sur Vercel (serverless, pas de processus persistant), il est désactivé :
  // c'est le Vercel Cron Job (vercel.json) qui appelle la route /api/cron/... .
  enableInternalCron: (process.env.ENABLE_INTERNAL_CRON ?? "true") === "true",

  payments: {
    demoMode: (process.env.PAYMENTS_DEMO_MODE ?? "true") === "true",
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
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
      storeName: process.env.PAYDUNYA_STORE_NAME ?? "ImmoPlatform Pro",
    },
  },
};
