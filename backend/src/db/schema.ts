import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import { doublePrecision, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => createId());
const timestamps = {
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const roleEnum = pgEnum("role", ["MANAGER", "TENANT"]);
export const propertyStatusEnum = pgEnum("property_status", ["AVAILABLE", "OCCUPIED", "MAINTENANCE"]);
export const contractStatusEnum = pgEnum("contract_status", ["ACTIVE", "ENDED", "TERMINATED"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["PENDING", "PAID", "LATE", "CANCELLED"]);
export const paymentMethodEnum = pgEnum("payment_method", ["STRIPE", "MOBILE_MONEY", "BANK_TRANSFER", "DEMO"]);
export const issueStatusEnum = pgEnum("issue_status", ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["TRIAL", "ACTIVE", "EXPIRED", "CANCELLED"]);
export const subscriptionPlanEnum = pgEnum("subscription_plan", ["STARTER", "PRO", "ENTERPRISE"]);

// --- Users (comptes de connexion: gestionnaire ou locataire) ---
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  currency: text("currency").notNull().default("EUR"),
  // SaaS & Période d'essai (15 jours offerts à l'inscription pour les gestionnaires)
  subscriptionStatus: subscriptionStatusEnum("subscription_status").notNull().default("TRIAL"),
  subscriptionPlan: subscriptionPlanEnum("subscription_plan").notNull().default("PRO"),
  trialEndsAt: timestamp("trial_ends_at", { mode: "date" }),
  subscriptionEndsAt: timestamp("subscription_ends_at", { mode: "date" }),
  subscriptionPaymentMethod: paymentMethodEnum("subscription_payment_method"),
  ...timestamps,
});

// --- Platform Subscriptions (Historique des paiements d'abonnements SaaS de la plateforme) ---
export const platformSubscriptions = pgTable("platform_subscriptions", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  plan: subscriptionPlanEnum("plan").notNull(),
  amount: doublePrecision("amount").notNull(),
  billingCycle: text("billing_cycle").notNull().default("MONTHLY"), // "MONTHLY" | "ANNUAL"
  status: text("status").notNull().default("PAID"),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  paymentRef: text("payment_ref"),
  startDate: timestamp("start_date", { mode: "date" }).notNull(),
  endDate: timestamp("end_date", { mode: "date" }).notNull(),
  ...timestamps,
});

// --- Properties (biens immobiliers) ---
export const properties = pgTable("properties", {
  id: id(),
  title: text("title").notNull(),
  address: text("address").notNull(),
  surface: doublePrecision("surface").notNull(),
  rent: doublePrecision("rent").notNull(),
  currency: text("currency").notNull().default("EUR"),
  status: propertyStatusEnum("status").notNull().default("AVAILABLE"),
  description: text("description"),
  imageUrl: text("image_url"),
  ...timestamps,
});

// --- Tenants (locataires) ---
export const tenants = pgTable("tenants", {
  id: id(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull().unique(),
  // Chemin (storage path) du document d'identité dans le bucket privé Supabase Storage,
  // jamais une URL publique — voir storage.service.ts pour la génération d'URL signée.
  idDocument: text("id_document"),
  userId: text("user_id").unique().references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

// --- Contracts (contrats de location) ---
export const contracts = pgTable("contracts", {
  id: id(),
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  rent: doublePrecision("rent").notNull(),
  deposit: doublePrecision("deposit").notNull(),
  currency: text("currency").notNull().default("EUR"),
  startDate: timestamp("start_date", { mode: "date" }).notNull(),
  endDate: timestamp("end_date", { mode: "date" }).notNull(),
  status: contractStatusEnum("status").notNull().default("ACTIVE"),
  reminderSentAt: timestamp("reminder_sent_at", { mode: "date" }),
  ...timestamps,
});

// --- Invoices (factures / échéances de loyer) ---
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id),
    periodMonth: integer("period_month").notNull(),
    periodYear: integer("period_year").notNull(),
    amount: doublePrecision("amount").notNull(),
    currency: text("currency").notNull().default("EUR"),
    dueDate: timestamp("due_date", { mode: "date" }).notNull(),
    status: invoiceStatusEnum("status").notNull().default("PENDING"),
    paidAt: timestamp("paid_at", { mode: "date" }),
    paymentMethod: paymentMethodEnum("payment_method"),
    paymentRef: text("payment_ref"),
    reminderSentAt: timestamp("reminder_sent_at", { mode: "date" }),
    ...timestamps,
  },
  (table) => ({
    contractPeriodUnique: uniqueIndex("invoices_contract_period_unique").on(
      table.contractId,
      table.periodMonth,
      table.periodYear
    ),
  })
);

// --- Issue reports (signalements d'incidents avec photo) ---
export const issueReports = pgTable("issue_reports", {
  id: id(),
  contractId: text("contract_id")
    .notNull()
    .references(() => contracts.id),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  photoUrl: text("photo_url").notNull(),
  status: issueStatusEnum("status").notNull().default("OPEN"),
  managerNote: text("manager_note"),
  ...timestamps,
});

// --- Relations (pour les requêtes imbriquées via db.query.*) ---
export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, { fields: [users.id], references: [tenants.userId] }),
}));

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  user: one(users, { fields: [tenants.userId], references: [users.id] }),
  contracts: many(contracts),
  issues: many(issueReports),
}));

export const propertiesRelations = relations(properties, ({ many }) => ({
  contracts: many(contracts),
}));

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  property: one(properties, { fields: [contracts.propertyId], references: [properties.id] }),
  tenant: one(tenants, { fields: [contracts.tenantId], references: [tenants.id] }),
  invoices: many(invoices),
  issues: many(issueReports),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  contract: one(contracts, { fields: [invoices.contractId], references: [contracts.id] }),
}));

export const issueReportsRelations = relations(issueReports, ({ one }) => ({
  contract: one(contracts, { fields: [issueReports.contractId], references: [contracts.id] }),
  tenant: one(tenants, { fields: [issueReports.tenantId], references: [tenants.id] }),
}));
