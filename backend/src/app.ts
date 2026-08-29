import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth.routes";
import contractRoutes from "./routes/contract.routes";
import cronRoutes from "./routes/cron.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import invoiceRoutes from "./routes/invoice.routes";
import issueRoutes from "./routes/issue.routes";
import propertyRoutes from "./routes/property.routes";
import subscriptionRoutes from "./routes/subscription.routes";
import tenantRoutes from "./routes/tenant.routes";

export const app = express();

app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
app.use("/api/issues", issueRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/cron", cronRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
