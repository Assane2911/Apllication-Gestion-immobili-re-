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

  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
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
    mobileMoney: {
      baseUrl: process.env.MOBILE_MONEY_API_BASE_URL ?? "",
      apiKey: process.env.MOBILE_MONEY_API_KEY ?? "",
      apiSecret: process.env.MOBILE_MONEY_API_SECRET ?? "",
    },
  },
};
