import "./instrument";
import * as Sentry from "@sentry/node";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import activityLogRoutes from "./routes/activityLog.routes";
import adminRoutes from "./routes/admin.routes";
import agencyRoutes from "./routes/agency.routes";
import authRoutes from "./routes/auth.routes";
import contractRoutes from "./routes/contract.routes";
import cronRoutes from "./routes/cron.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import documentRoutes from "./routes/document.routes";
import expenseRoutes from "./routes/expense.routes";
import invoiceRoutes from "./routes/invoice.routes";
import issueRoutes from "./routes/issue.routes";
import messageRoutes from "./routes/message.routes";
import notificationRoutes from "./routes/notification.routes";
import paydunyaRoutes from "./routes/paydunya.routes";
import propertyRoutes from "./routes/property.routes";
import searchRoutes from "./routes/search.routes";
import subscriptionRoutes from "./routes/subscription.routes";
import tenantRoutes from "./routes/tenant.routes";

export const app = express();

// En-têtes de sécurité HTTP standards (anti-sniffing MIME, anti-clickjacking,
// HSTS, suppression de "X-Powered-By"...). La Content-Security-Policy par
// défaut de helmet est désactivée : les quittances et baux générés par
// /api/documents (voir document.controller.ts + pdf.service.ts) sont du HTML
// brut avec des styles en ligne, qu'une CSP par défaut ('self' uniquement)
// bloquerait. Une CSP adaptée à ces documents pourra être ajoutée plus tard
// si besoin — en attendant, toutes les autres protections de helmet
// s'appliquent normalement.
app.use(helmet({ contentSecurityPolicy: false }));

// En plus du site web (env.frontendUrl), on autorise les origines des
// builds mobiles Capacitor : "https://localhost" (Android, androidScheme:
// "https") et "capacitor://localhost" (iOS, scheme par défaut). Sans
// origine (ex: appel serveur à serveur, cron) on laisse passer.
const allowedOrigins = [env.frontendUrl, "https://localhost", "capacitor://localhost"];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Non autorisé par CORS"));
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Les fichiers (images des biens, pièces d'identité, photos d'incidents) sont
// stockés sur Supabase Storage, pas sur disque local (nécessaire sur Vercel,
// dont les fonctions serverless n'ont pas de disque persistant) — voir
// src/services/storage.service.ts.

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/contracts", contractRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/agency", agencyRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/issues", issueRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/activity-log", activityLogRoutes);
app.use("/api/cron", cronRoutes);
app.use("/api/payments/paydunya", paydunyaRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFoundHandler);

// Capture les erreurs non gerees par les routes et les envoie a Sentry, tout
// en laissant errorHandler ci-dessous produire la reponse JSON habituelle
// (Sentry.setupExpressErrorHandler appelle next(err) en interne).
Sentry.setupExpressErrorHandler(app);

app.use(errorHandler);

// Vercel détecte automatiquement ce fichier (src/app.ts) comme point d'entrée
// Express, car c'est le seul fichier candidat (parmi app/index/server.ts à la
// racine ou dans src/) qui importe directement le package "express" — voir
// https://vercel.com/docs/frameworks/backend/express. Vercel exige que ce
// fichier exporte l'application par défaut pour l'envelopper en fonction
// serverless : sans cet export, chaque requête échoue avec
// FUNCTION_INVOCATION_FAILED (c'est la cause du 500 rencontré après le premier
// déploiement). L'export nommé ci-dessus reste utilisé par src/index.ts pour
// le mode développement local (app.listen).
export default app;

