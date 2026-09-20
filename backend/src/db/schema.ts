import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => createId());
const timestamps = {
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const roleEnum = pgEnum("role", ["MANAGER", "TENANT", "ADMIN", "OWNER"]);
export const propertyStatusEnum = pgEnum("property_status", ["AVAILABLE", "OCCUPIED", "MAINTENANCE"]);
export const contractStatusEnum = pgEnum("contract_status", ["ACTIVE", "ENDED", "TERMINATED"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["PENDING", "PAID", "LATE", "CANCELLED"]);
export const paymentMethodEnum = pgEnum("payment_method", ["STRIPE", "PAYDUNYA", "BANK_TRANSFER", "DEMO"]);
export const issueStatusEnum = pgEnum("issue_status", ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["TRIAL", "ACTIVE", "EXPIRED", "CANCELLED"]);
export const subscriptionPlanEnum = pgEnum("subscription_plan", ["STARTER", "PRO", "ENTERPRISE"]);

// --- Users (comptes de connexion: gestionnaire ou locataire) ---
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Identifiant Google (claim "sub" du jeton d'identité) pour la connexion
  // "Se connecter avec Google", réservée aux gestionnaires — voir
  // auth.controller.ts::loginWithGoogle. Nullable : la grande majorité des
  // comptes restent créés par email/mot de passe. passwordHash reste
  // NOT NULL même pour un compte Google : on y stocke le hash bcrypt d'une
  // valeur aléatoire inatteignable par un mot de passe (voir loginWithGoogle),
  // pour éviter une migration de colonne nullable rien que pour ce cas.
  googleId: text("google_id").unique(),
  role: roleEnum("role").notNull(),
  currency: text("currency").notNull().default("EUR"),
  // SaaS & Période d'essai (15 jours offerts à l'inscription pour les gestionnaires)
  subscriptionStatus: subscriptionStatusEnum("subscription_status").notNull().default("TRIAL"),
  subscriptionPlan: subscriptionPlanEnum("subscription_plan").notNull().default("STARTER"),
  trialEndsAt: timestamp("trial_ends_at", { mode: "date" }),
  subscriptionEndsAt: timestamp("subscription_ends_at", { mode: "date" }),
  subscriptionPaymentMethod: paymentMethodEnum("subscription_payment_method"),
  // Réclamation atomique anti-double-paiement pour subscribe() (voir
  // subscription.controller.ts) — même principe que invoices.paymentAttemptStartedAt :
  // sans elle, un double clic ou deux onglets envoyaient chacun leur propre
  // appel au prestataire de paiement pour le même abonnement.
  subscriptionPaymentAttemptStartedAt: timestamp("subscription_payment_attempt_started_at", { mode: "date" }),
  // Réinitialisation de mot de passe : on ne stocke jamais le token en clair,
  // seulement son empreinte SHA-256 (comme un token à usage unique classique,
  // distinct du hash bcrypt du mot de passe lui-même). expiresAt limite sa
  // validité à 1h — voir auth.controller.ts (forgotPassword / resetPassword).
  resetPasswordTokenHash: text("reset_password_token_hash"),
  resetPasswordExpiresAt: timestamp("reset_password_expires_at", { mode: "date" }),
  // Confirmation d'adresse email à l'inscription : le compte reste bloqué à
  // la connexion tant qu'emailVerifiedAt est vide. Même logique de token à
  // usage unique (empreinte SHA-256 uniquement) que pour resetPassword —
  // voir auth.controller.ts (registerManager / verifyEmail / resendVerification).
  emailVerifiedAt: timestamp("email_verified_at", { mode: "date" }),
  emailVerificationTokenHash: text("email_verification_token_hash"),
  emailVerificationExpiresAt: timestamp("email_verification_expires_at", { mode: "date" }),
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
  // Un montant sans devise n'est pas un montant : les tarifs existent en
  // plusieurs devises (voir TARIFS dans subscription.controller.ts), et sans
  // cette colonne l'historique comme l'écran d'administration affichaient des
  // euros par défaut, y compris pour un abonnement réglé en FCFA. Les lignes
  // antérieures sont bien en euros, d'où ce défaut.
  currency: text("currency").notNull().default("EUR"),
  billingCycle: text("billing_cycle").notNull().default("MONTHLY"), // "MONTHLY" | "ANNUAL"
  status: text("status").notNull().default("PAID"),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  paymentRef: text("payment_ref"),
  startDate: timestamp("start_date", { mode: "date" }).notNull(),
  endDate: timestamp("end_date", { mode: "date" }).notNull(),
  ...timestamps,
});

// --- Properties (biens immobiliers) ---
export const properties = pgTable(
  "properties",
  {
    id: id(),
    // Gestionnaire propriétaire du bien — isole les données d'une agence à l'autre.
    managerId: text("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Propriétaire réel du bien (Espace propriétaire, lecture seule) —
    // distinct du gestionnaire ci-dessus, qui gère le bien pour son compte.
    // Nullable : un bien peut ne pas (encore) avoir de propriétaire renseigné.
    // onDelete "set null" : si la fiche propriétaire est supprimée, le bien
    // reste (comme tenants.userId), il perd seulement son association.
    ownerId: text("owner_id").references(() => owners.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    address: text("address").notNull(),
    surface: doublePrecision("surface").notNull(),
    rent: doublePrecision("rent").notNull(),
    currency: text("currency").notNull().default("EUR"),
    status: propertyStatusEnum("status").notNull().default("AVAILABLE"),
    description: text("description"),
    imageUrl: text("image_url"),
    ...timestamps,
  },
  (table) => ({
    managerIdIdx: index("properties_manager_id_idx").on(table.managerId),
    ownerIdIdx: index("properties_owner_id_idx").on(table.ownerId),
  })
);

// --- Owners (propriétaires des biens — Espace propriétaire + reversement) ---
// NOTE : cette table (et properties.ownerId, listings, listing_leads,
// inspections plus bas) a été créée directement en base par une session
// Claude Code sur la machine de l'utilisateur, en parallèle de ce chantier —
// ce fichier ne fait donc que refléter fidèlement ce qui existe déjà en
// production (colonnes, index, FK, valeurs par défaut), sans rien inventer.
// Contrairement à tenants.userId, owners.userId n'a PAS de contrainte unique
// en base (un même compte utilisateur pourrait donc être lié à plusieurs
// fiches propriétaire) et sa FK vers users n'a pas de ON DELETE (par défaut
// NO ACTION, donc RESTRICT implicite) — à la différence de tenants.userId
// (onDelete: "set null"). Idem, il n'existe pas ici de contrainte unique
// (managerId, email) comme sur tenants : deux propriétaires de la même
// agence peuvent donc partager le même email sans être bloqués.
export const owners = pgTable(
  "owners",
  {
    id: id(),
    // Gestionnaire qui a créé la fiche propriétaire — isole les données d'une agence à l'autre.
    managerId: text("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    // Raison sociale, si le propriétaire est une société (ex: SCI) plutôt qu'un particulier.
    companyName: text("company_name"),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    address: text("address"),
    // Coordonnées bancaires du propriétaire, pour lui reverser les loyers
    // encaissés (moins la commission — voir managementFeeRate) — même
    // logique que agencySettings.iban/bic.
    iban: text("iban"),
    bic: text("bic"),
    // Taux de commission de l'agence sur les loyers de ce propriétaire (en %).
    managementFeeRate: doublePrecision("management_fee_rate").notNull().default(8.0),
    notes: text("notes"),
    userId: text("user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => ({
    managerIdIdx: index("owners_manager_id_idx").on(table.managerId),
    userIdIdx: index("owners_user_id_idx").on(table.userId),
  })
);

// --- Listings (vitrine publique de biens à louer/vendre) ---
export const listings = pgTable(
  "listings",
  {
    id: id(),
    managerId: text("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // "RENT" | "SALE" | "PROMOTION" | "LAND" | "OTHER" (contrainte CHECK en base, non modélisée ici)
    type: text("type").notNull().default("RENT"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    price: doublePrecision("price").notNull(),
    currency: text("currency").notNull().default("EUR"),
    pricePeriod: text("price_period").notNull().default("MONTH"),
    surface: doublePrecision("surface"),
    rooms: integer("rooms"),
    location: text("location").notNull(),
    imageUrl: text("image_url"),
    contactPhone: text("contact_phone"),
    contactWhatsapp: text("contact_whatsapp"),
    contactEmail: text("contact_email"),
    // "PUBLISHED" | "DRAFT" | "ARCHIVED" (contrainte CHECK en base, non modélisée ici)
    status: text("status").notNull().default("PUBLISHED"),
    featured: boolean("featured").notNull().default(false),
    country: text("country"),
    ...timestamps,
  },
  (table) => ({
    managerIdIdx: index("listings_manager_id_idx").on(table.managerId),
    statusIdx: index("listings_status_idx").on(table.status),
    typeIdx: index("listings_type_idx").on(table.type),
    countryIdx: index("listings_country_idx").on(table.country),
  })
);

// --- Listing leads (demandes de visite/info reçues sur une annonce vitrine) ---
export const listingLeads = pgTable(
  "listing_leads",
  {
    id: id(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    managerId: text("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    prospectName: text("prospect_name").notNull(),
    prospectEmail: text("prospect_email").notNull(),
    prospectPhone: text("prospect_phone").notNull(),
    // "VISIT" | "INFO" (contrainte CHECK en base, non modélisée ici)
    requestType: text("request_type").notNull().default("VISIT"),
    preferredDate: timestamp("preferred_date", { mode: "date" }),
    message: text("message"),
    // "NEW" | "CONTACTED" | "VISITED" | "CONVERTED" | "ARCHIVED" (contrainte CHECK en base, non modélisée ici)
    status: text("status").notNull().default("NEW"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => ({
    listingIdIdx: index("listing_leads_listing_id_idx").on(table.listingId),
    managerIdIdx: index("listing_leads_manager_id_idx").on(table.managerId),
    statusIdx: index("listing_leads_status_idx").on(table.status),
  })
);

// --- Inspections (états des lieux d'entrée/sortie) ---
export const inspections = pgTable(
  "inspections",
  {
    id: id(),
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    managerId: text("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // "ENTRY" | "EXIT" (contrainte CHECK en base, non modélisée ici)
    type: text("type").notNull().default("ENTRY"),
    // "DRAFT" | "COMPLETED" (contrainte CHECK en base, non modélisée ici)
    status: text("status").notNull().default("DRAFT"),
    inspectionDate: timestamp("inspection_date", { mode: "date" }).notNull().defaultNow(),
    roomsData: text("rooms_data"), // JSON string
    metersData: text("meters_data"), // JSON string
    keysData: text("keys_data"), // JSON string
    generalComments: text("general_comments"),
    managerSignatureUrl: text("manager_signature_url"),
    signedByManagerAt: timestamp("signed_by_manager_at", { mode: "date" }),
    tenantSignatureUrl: text("tenant_signature_url"),
    signedByTenantAt: timestamp("signed_by_tenant_at", { mode: "date" }),
    ...timestamps,
  },
  (table) => ({
    contractIdIdx: index("inspections_contract_id_idx").on(table.contractId),
    propertyIdIdx: index("inspections_property_id_idx").on(table.propertyId),
    managerIdIdx: index("inspections_manager_id_idx").on(table.managerId),
    tenantIdIdx: index("inspections_tenant_id_idx").on(table.tenantId),
  })
);

// --- Tenants (locataires) ---
export const tenants = pgTable(
  "tenants",
  {
    id: id(),
    // Gestionnaire qui a créé la fiche locataire — isole les données d'une agence à l'autre.
    managerId: text("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone").notNull(),
    // Unique par agence uniquement (et non globalement) : deux gestionnaires
    // différents doivent pouvoir chacun enregistrer un locataire partageant
    // le même email sans se bloquer ni se révéler mutuellement l'existence
    // de leurs fiches (voir contrainte composite ci-dessous).
    email: text("email").notNull(),
    // Chemin (storage path) du document d'identité dans le bucket privé Supabase Storage,
    // jamais une URL publique — voir storage.service.ts pour la génération d'URL signée.
    idDocument: text("id_document"),
    userId: text("user_id").unique().references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => ({
    managerEmailUnique: uniqueIndex("tenants_manager_email_unique").on(table.managerId, table.email),
    managerIdIdx: index("tenants_manager_id_idx").on(table.managerId),
  })
);

// --- Contracts (contrats de location) ---
export const contracts = pgTable(
  "contracts",
  {
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
    scannedContractUrl: text("scanned_contract_url"),
    terms: text("terms"),
    reminderSentAt: timestamp("reminder_sent_at", { mode: "date" }),
    // Signature électronique
    signedByManagerAt: timestamp("signed_by_manager_at", { mode: "date" }),
    managerSignatureUrl: text("manager_signature_url"),
    signedByTenantAt: timestamp("signed_by_tenant_at", { mode: "date" }),
    tenantSignatureUrl: text("tenant_signature_url"),
    ...timestamps,
  },
  (table) => ({
    propertyIdIdx: index("contracts_property_id_idx").on(table.propertyId),
    tenantIdIdx: index("contracts_tenant_id_idx").on(table.tenantId),
    statusIdx: index("contracts_status_idx").on(table.status),
  })
);

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
    // Rappel distinct envoyé quelques jours AVANT l'échéance (voir reminder.service.ts),
    // différent du rappel/avis du 1er du mois qui alimente `reminderSentAt`.
    dueSoonReminderSentAt: timestamp("due_soon_reminder_sent_at", { mode: "date" }),
    // Réclamation en cours d'un appel à un prestataire de paiement (voir
    // payInvoice, invoice.controller.ts). Stripe protège son propre appel via
    // un Idempotency-Key ; PayDunya n'offre aucun mécanisme équivalent, donc
    // deux clics simultanés sur "Payer" créeraient deux factures PayDunya
    // distinctes pour un même loyer sans cette marque. Posée juste avant
    // d'appeler le prestataire, effacée juste après (succès ou échec) : une
    // valeur non nulle signifie "un appel est en cours", pas "verrouillé".
    paymentAttemptStartedAt: timestamp("payment_attempt_started_at", { mode: "date" }),
    ...timestamps,
  },
  (table) => ({
    contractPeriodUnique: uniqueIndex("invoices_contract_period_unique").on(
      table.contractId,
      table.periodMonth,
      table.periodYear
    ),
    contractIdIdx: index("invoices_contract_id_idx").on(table.contractId),
    statusIdx: index("invoices_status_idx").on(table.status),
    dueDateIdx: index("invoices_due_date_idx").on(table.dueDate),
  })
);

// --- Issue reports (signalements d'incidents avec photo) ---
export const issueReports = pgTable(
  "issue_reports",
  {
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
    additionalPhotos: text("additional_photos"), // JSON string array of photo URLs
    status: issueStatusEnum("status").notNull().default("OPEN"),
    managerNote: text("manager_note"),
    ...timestamps,
  },
  (table) => ({
    contractIdIdx: index("issue_reports_contract_id_idx").on(table.contractId),
    tenantIdIdx: index("issue_reports_tenant_id_idx").on(table.tenantId),
    statusIdx: index("issue_reports_status_idx").on(table.status),
  })
);

// --- Expenses (Dépenses, Travaux, Charges & Taxe foncière) ---
export const expenseCategoryEnum = pgEnum("expense_category", ["MAINTENANCE", "TAX", "INSURANCE", "SYNDIC", "OTHER"]);

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("MAINTENANCE"),
    title: text("title").notNull(),
    amount: doublePrecision("amount").notNull(),
    currency: text("currency").notNull().default("EUR"),
    expenseDate: timestamp("expense_date", { mode: "date" }).notNull().defaultNow(),
    receiptUrl: text("receipt_url"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => ({
    propertyIdIdx: index("expenses_property_id_idx").on(table.propertyId),
  })
);

// --- Messages (Messagerie directe Agence - Locataire) ---
export const messages = pgTable(
  "messages",
  {
    id: id(),
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    senderRole: roleEnum("sender_role").notNull(),
    content: text("content").notNull(),
    isRead: text("is_read").notNull().default("false"),
    ...timestamps,
  },
  (table) => ({
    contractIdIdx: index("messages_contract_id_idx").on(table.contractId),
    senderIdIdx: index("messages_sender_id_idx").on(table.senderId),
  })
);

// --- Activity Log (Journal d'activité / audit — qui a fait quoi, quand) ---
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: id(),
    // Gestionnaire "propriétaire" du journal — nécessaire car actorId peut être
    // un locataire (ex: signalement d'incident) : on doit quand même savoir
    // quelle agence doit voir cette entrée dans son journal d'activité.
    managerId: text("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: roleEnum("actor_role"),
    actorLabel: text("actor_label").notNull(), // ex: email du gestionnaire au moment de l'action
    action: text("action").notNull(), // ex: "property.create", "contract.renew"
    entityType: text("entity_type").notNull(), // ex: "property", "tenant", "contract", "invoice", "issue"
    entityId: text("entity_id"),
    entityLabel: text("entity_label").notNull(), // libellé lisible, ex: le titre du bien
    details: text("details"), // description courte lisible en français
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    managerIdIdx: index("activity_logs_manager_id_idx").on(table.managerId),
    createdAtIdx: index("activity_logs_created_at_idx").on(table.createdAt),
  })
);

// --- Agency Settings (Paramètres & Marque Blanche de l'Agence) ---
export const agencySettings = pgTable("agency_settings", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  agencyName: text("agency_name").notNull().default("Agence Immobilière"),
  logoUrl: text("logo_url"),
  siretOrId: text("siret_or_id"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  legalNotice: text("legal_notice"),
  stampOrSignatureUrl: text("stamp_or_signature_url"),
  // Coordonnées bancaires affichées au locataire qui choisit "Virement
  // bancaire" (voir agency.controller.ts pour la validation IBAN/BIC et
  // TenantInvoicesPage.tsx pour l'affichage). Sans elles, un locataire qui
  // déclare un virement n'a aucun moyen de savoir où l'envoyer — la
  // déclaration ne fait alors que masquer l'absence réelle de paiement.
  iban: text("iban"),
  bic: text("bic"),
  ...timestamps,
});

// --- Platform Settings (coordonnées bancaires de LA PLATEFORME elle-même) ---
// Table volontairement à une seule ligne (id fixe "platform", voir
// platformSettings.controller.ts) : contrairement à agencySettings — un
// compte par agence, pour encaisser SES loyers — il n'existe qu'un seul
// compte destinataire des abonnements SaaS, celui de l'exploitant de la
// plateforme, montré à tout gestionnaire qui règle son abonnement par
// virement (voir subscription.routes.ts /bank-details).
export const platformSettings = pgTable("platform_settings", {
  id: text("id").primaryKey(),
  iban: text("iban"),
  bic: text("bic"),
  ...timestamps,
});

// --- Relations (pour les requêtes imbriquées via db.query.*) ---
export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.id], references: [tenants.userId] }),
  owner: one(owners, { fields: [users.id], references: [owners.userId] }),
  agencySettings: one(agencySettings, { fields: [users.id], references: [agencySettings.userId] }),
  messages: many(messages),
  managedProperties: many(properties),
  managedTenants: many(tenants),
  managedOwners: many(owners),
}));

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  user: one(users, { fields: [tenants.userId], references: [users.id] }),
  manager: one(users, { fields: [tenants.managerId], references: [users.id] }),
  contracts: many(contracts),
  issues: many(issueReports),
}));

export const ownersRelations = relations(owners, ({ one, many }) => ({
  user: one(users, { fields: [owners.userId], references: [users.id] }),
  manager: one(users, { fields: [owners.managerId], references: [users.id] }),
  properties: many(properties),
}));

export const propertiesRelations = relations(properties, ({ one, many }) => ({
  manager: one(users, { fields: [properties.managerId], references: [users.id] }),
  owner: one(owners, { fields: [properties.ownerId], references: [owners.id] }),
  contracts: many(contracts),
  expenses: many(expenses),
}));

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  property: one(properties, { fields: [contracts.propertyId], references: [properties.id] }),
  tenant: one(tenants, { fields: [contracts.tenantId], references: [tenants.id] }),
  invoices: many(invoices),
  issues: many(issueReports),
  messages: many(messages),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  contract: one(contracts, { fields: [invoices.contractId], references: [contracts.id] }),
}));

export const issueReportsRelations = relations(issueReports, ({ one }) => ({
  contract: one(contracts, { fields: [issueReports.contractId], references: [contracts.id] }),
  tenant: one(tenants, { fields: [issueReports.tenantId], references: [tenants.id] }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  property: one(properties, { fields: [expenses.propertyId], references: [properties.id] }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  contract: one(contracts, { fields: [messages.contractId], references: [contracts.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}));

export const agencySettingsRelations = relations(agencySettings, ({ one }) => ({
  user: one(users, { fields: [agencySettings.userId], references: [users.id] }),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  manager: one(users, { fields: [listings.managerId], references: [users.id] }),
  leads: many(listingLeads),
}));

export const listingLeadsRelations = relations(listingLeads, ({ one }) => ({
  listing: one(listings, { fields: [listingLeads.listingId], references: [listings.id] }),
  manager: one(users, { fields: [listingLeads.managerId], references: [users.id] }),
}));

export const inspectionsRelations = relations(inspections, ({ one }) => ({
  contract: one(contracts, { fields: [inspections.contractId], references: [contracts.id] }),
  property: one(properties, { fields: [inspections.propertyId], references: [properties.id] }),
  manager: one(users, { fields: [inspections.managerId], references: [users.id] }),
  tenant: one(tenants, { fields: [inspections.tenantId], references: [tenants.id] }),
}));

