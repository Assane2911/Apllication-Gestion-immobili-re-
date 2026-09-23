export type Role = "MANAGER" | "TENANT" | "ADMIN" | "OWNER";

export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELLED";
export type SubscriptionPlan = "STARTER" | "PRO" | "ENTERPRISE";

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  plan: SubscriptionPlan;
  trialEndsAt?: string | null;
  subscriptionEndsAt?: string | null;
  trialDaysRemaining: number;
  isTrialActive: boolean;
  isSubscriptionActive: boolean;
  isExpired: boolean;
}

export interface SubscriptionPlanDetail {
  id: SubscriptionPlan;
  name: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  /** Devise dans laquelle les deux prix ci-dessus sont libellés (renvoyée par le backend). */
  currency: string;
  maxProperties: string | number;
  popular?: boolean;
  features: string[];
}

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  currency?: string;
  /**
   * false uniquement pour un compte gestionnaire créé directement via "Se
   * connecter avec Google" (jamais de vrai mot de passe défini) — voir
   * DeleteAccountModal, qui adapte sa confirmation en conséquence. Absent
   * (undefined) sur les réponses plus anciennes : à traiter comme true.
   */
  hasPassword?: boolean;
  tenantId?: string | null;
  tenantName?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  subscription?: SubscriptionInfo | null;
}

export type PropertyStatus = "AVAILABLE" | "OCCUPIED" | "MAINTENANCE";

export interface Property {
  id: string;
  title: string;
  address: string;
  surface: number;
  rent: number;
  currency?: string;
  status: PropertyStatus;
  description?: string | null;
  imageUrl?: string | null;
  ownerId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OwnerPortalStatus = "NONE" | "PENDING" | "ACTIVE";

/** Fiche propriétaire (Espace propriétaire) — voir owner.controller.ts. */
export interface Owner {
  id: string;
  firstName: string;
  lastName: string;
  companyName?: string | null;
  email: string;
  phone: string;
  address?: string | null;
  iban?: string | null;
  bic?: string | null;
  managementFeeRate: number;
  notes?: string | null;
  userId?: string | null;
  /** NONE = aucun accès créé, PENDING = invité mais mot de passe pas encore posé, ACTIVE = accès utilisable. */
  portalStatus: OwnerPortalStatus;
  createdAt: string;
}

/** Résumé financier d'un bien tel que renvoyé par GET /api/owners/mine/dashboard. */
export interface OwnerDashboardProperty {
  propertyId: string;
  title: string;
  address: string;
  currency: string;
  collected: number;
  pending: number;
}

/** Réponse de GET /api/owners/mine/dashboard — voir getOwnerDashboard côté serveur. */
export interface OwnerDashboard {
  ownerName: string;
  managementFeeRate: number;
  properties: OwnerDashboardProperty[];
  collectedThisMonthByCurrency: Record<string, number>;
  pendingThisMonthByCurrency: Record<string, number>;
  revenueByMonth: Record<string, Record<string, number>>;
}

export interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  idDocument?: string | null;
  userId?: string | null;
  /** Date d'exercice du droit à l'effacement — voir anonymiserTenant côté API. */
  anonymizedAt?: string | null;
  createdAt: string;
}

export type ContractStatus = "ACTIVE" | "ENDED" | "TERMINATED";

export interface Contract {
  id: string;
  propertyId: string;
  tenantId: string;
  rent: number;
  deposit: number;
  currency?: string;
  startDate: string;
  endDate: string;
  status: ContractStatus;
  scannedContractUrl?: string | null;
  terms?: string | null;
  reminderSentAt?: string | null;
  signedByManagerAt?: string | null;
  managerSignatureUrl?: string | null;
  signedByTenantAt?: string | null;
  tenantSignatureUrl?: string | null;
  property?: Property;
  tenant?: Tenant;
  invoices?: Invoice[];
}

export type InspectionType = "ENTRY" | "EXIT";
export type InspectionStatus = "DRAFT" | "COMPLETED";
export type RoomCondition = "BON" | "MOYEN" | "MAUVAIS";

export interface InspectionRoom {
  name: string;
  condition: RoomCondition;
  notes: string;
}

export interface InspectionMeters {
  electricity: string;
  water: string;
  gas: string;
}

export interface InspectionKeyEntry {
  label: string;
  quantity: number;
}

/** État des lieux (EDL) — voir inspection.controller.ts. */
export interface Inspection {
  id: string;
  contractId: string;
  propertyId: string;
  tenantId: string;
  managerId: string;
  type: InspectionType;
  status: InspectionStatus;
  inspectionDate: string;
  rooms: InspectionRoom[];
  meters: InspectionMeters;
  keys: InspectionKeyEntry[];
  generalComments?: string | null;
  managerSignatureUrl?: string | null;
  signedByManagerAt?: string | null;
  tenantSignatureUrl?: string | null;
  signedByTenantAt?: string | null;
  createdAt: string;
  updatedAt: string;
  property?: Property;
  tenant?: Tenant;
}

export type ExpenseCategory = "MAINTENANCE" | "TAX" | "INSURANCE" | "SYNDIC" | "OTHER";

export interface Expense {
  id: string;
  propertyId: string;
  category: ExpenseCategory;
  title: string;
  amount: number;
  currency: string;
  expenseDate: string;
  receiptUrl?: string | null;
  notes?: string | null;
  property?: Property;
  createdAt: string;
}

export interface Message {
  id: string;
  contractId: string;
  senderId: string;
  senderRole: Role;
  content: string;
  isRead: string;
  createdAt: string;
  sender?: {
    id: string;
    email: string;
    role: Role;
  };
}

export interface Conversation {
  contractId: string;
  property: Property;
  tenant: Tenant;
  lastMessage?: Message | null;
}

export interface AgencySettings {
  id: string;
  userId: string;
  agencyName: string;
  logoUrl?: string | null;
  siretOrId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  legalNotice?: string | null;
  stampOrSignatureUrl?: string | null;
  iban?: string | null;
  bic?: string | null;
}

/** Coordonnées bancaires vues par le locataire (voir GET /api/agency/mine) — un sous-ensemble minimal, pas les paramètres complets de l'agence. */
export interface AgencyBankInfo {
  agencyName: string | null;
  iban: string | null;
  bic: string | null;
}

/** Paramètres bancaires de LA PLATEFORME (un seul compte, celui de l'exploitant) — voir GET/PUT /api/admin/settings. */
export interface PlatformSettings {
  id: string;
  iban?: string | null;
  bic?: string | null;
}

/** Coordonnées bancaires de la plateforme vues par un gestionnaire qui règle son abonnement (voir GET /api/subscription/bank-details). */
export interface PlatformBankInfo {
  iban: string | null;
  bic: string | null;
}

export type InvoiceStatus = "PENDING" | "PAID" | "LATE" | "CANCELLED";
export type PaymentMethod = "STRIPE" | "PAYDUNYA" | "BANK_TRANSFER" | "DEMO";

export interface Invoice {
  id: string;
  contractId: string;
  periodMonth: number;
  periodYear: number;
  amount: number;
  currency?: string;
  dueDate: string;
  status: InvoiceStatus;
  paidAt?: string | null;
  paymentMethod?: PaymentMethod | null;
  paymentRef?: string | null;
  contract?: Contract;
}

export type IssueStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";

export interface IssueReport {
  id: string;
  contractId: string;
  tenantId: string;
  title: string;
  description: string;
  photoUrl: string;
  additionalPhotos?: string | null;
  status: IssueStatus;
  managerNote?: string | null;
  createdAt: string;
  tenant?: Tenant;
  contract?: Contract;
}

export type NotificationType = "message" | "invoice" | "issue" | "contract_ending";
export type NotificationSeverity = "info" | "warning" | "danger";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  description: string;
  link: string;
  createdAt: string;
}

export type SearchResultType = "tenant" | "property" | "contract" | "invoice";

export interface SearchResultItem {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  link: string;
}

export type ActorRole = "MANAGER" | "TENANT";

export interface ActivityLogEntry {
  id: string;
  actorId?: string | null;
  actorRole?: ActorRole | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel: string;
  details?: string | null;
  createdAt: string;
}

export interface DashboardStats {
  totalProperties: number;
  propertiesByStatus: Record<PropertyStatus, number>;
  totalTenants: number;
  activeContracts: number;
  occupancyRate: number;
  // Regroupé par devise (code devise -> montant) : la plateforme est
  // multi-devises (EUR/XOF/...), additionner à travers des devises
  // différentes produirait un nombre sans signification.
  monthlyRevenueByCurrency: Record<string, number>;
  monthlyExpectedByCurrency: Record<string, number>;
  openIssues: number;
  lateInvoices: number;
  // Mois (YYYY-MM) -> devise -> montant, même raison.
  revenueByMonth: Record<string, Record<string, number>>;
  expensesByMonth: Record<string, Record<string, number>>;
}

/** Une ligne du bilan foncier par bien (voir GET /api/fiscal/synthese) — ventilée par devise, pas seulement par bien. */
export interface PropertyFiscalBalance {
  propertyId: string;
  propertyTitle: string;
  currency: string;
  revenue: number;
  expense: number;
  net: number;
}

/**
 * Synthèse annuelle du module "Bilan Fiscal & Comptabilité" (GET
 * /api/fiscal/synthese?year=YYYY). Contrairement à DashboardStats (fenêtre
 * glissante des 6 derniers mois), ceci couvre une année civile complète et
 * sert de base à la déclaration de revenus fonciers du gestionnaire.
 */
export interface AnnualFiscalSynthesis {
  year: number;
  availableYears: number[];
  totalRevenueByCurrency: Record<string, number>;
  totalExpensesByCurrency: Record<string, number>;
  netResultByCurrency: Record<string, number>;
  revenueByMonth: Record<string, Record<string, number>>;
  expensesByMonth: Record<string, Record<string, number>>;
  expensesByCategory: Record<string, Record<string, number>>;
  bilanParBien: PropertyFiscalBalance[];
}

/** Une ligne bien du CRG (voir GET /api/crg/:ownerId ou /api/crg/mine). */
export interface CrgPropertyLine {
  propertyId: string;
  propertyTitle: string;
  currency: string;
  loyersEncaisses: number;
  chargesDeduites: number;
  commission: number;
  netAReverser: number;
}

/**
 * Compte-Rendu de Gestion (CRG) mensuel d'un propriétaire (GET
 * /api/crg/:ownerId?month=&year= côté gestionnaire, GET /api/crg/mine côté
 * propriétaire). Contrairement au Bilan Fiscal (toute l'agence, annuel, point
 * de vue du gestionnaire), le CRG couvre UN SEUL propriétaire, est mensuel,
 * et ajoute la commission d'agence + le net à reverser.
 */
export interface CrgSynthesis {
  ownerId: string;
  ownerName: string;
  ownerCompanyName?: string | null;
  iban?: string | null;
  bic?: string | null;
  managementFeeRate: number;
  month: number;
  year: number;
  properties: CrgPropertyLine[];
  totalLoyersByCurrency: Record<string, number>;
  totalChargesByCurrency: Record<string, number>;
  totalCommissionByCurrency: Record<string, number>;
  totalNetByCurrency: Record<string, number>;
}

export type ListingType = "RENT" | "SALE" | "PROMOTION" | "LAND" | "OTHER";
export type ListingStatus = "PUBLISHED" | "DRAFT" | "ARCHIVED";
export type PricePeriod = "MONTH" | "ONE_TIME";
export type LeadRequestType = "VISIT" | "INFO";
export type LeadStatus = "NEW" | "CONTACTED" | "VISITED" | "CONVERTED" | "ARCHIVED";

/**
 * Annonce de la vitrine publique (voir listing.controller.ts). `managerId`
 * n'est présent que côté CRM gestionnaire (GET /api/listings...) — les
 * réponses publiques (GET /api/listings/public...) l'omettent
 * (toPublicListing), d'où son caractère optionnel ici.
 */
export interface Listing {
  id: string;
  managerId?: string;
  type: ListingType;
  title: string;
  description: string;
  price: number;
  currency: string;
  pricePeriod: PricePeriod;
  surface?: number | null;
  rooms?: number | null;
  location: string;
  imageUrl?: string | null;
  contactPhone?: string | null;
  contactWhatsapp?: string | null;
  contactEmail?: string | null;
  status: ListingStatus;
  featured: boolean;
  country?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Demande de visite/information soumise (sans authentification) depuis la
 * vitrine publique sur une annonce (voir listing.controller.ts). `listingTitle`
 * n'est présent que sur GET /api/listings/leads côté gestionnaire (jointure
 * avec l'annonce), jamais renvoyé par le backend à la création.
 */
export interface ListingLead {
  id: string;
  listingId: string;
  listingTitle?: string;
  managerId: string;
  prospectName: string;
  prospectEmail: string;
  prospectPhone: string;
  requestType: LeadRequestType;
  preferredDate?: string | null;
  message?: string | null;
  status: LeadStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminDashboardStats {
  managers: {
    total: number;
    trialActive: number;
    subscriptionActive: number;
    expired: number;
  };
  trialsEndingSoon: {
    userId: string;
    email: string;
    agencyName: string | null;
    trialEndsAt: string | null;
    daysRemaining: number;
  }[];
  mrr: {
    /**
     * Un bloc par devise facturée, jamais un total unique : les formules sont
     * tarifées séparément dans chaque devise et aucun taux de change n'est
     * appliqué, donc additionner FCFA et euros ne voudrait rien dire.
     */
    byCurrency: {
      currency: string;
      total: number;
      byPlan: Record<string, number>;
      contributors: number;
    }[];
    contributors: number;
  };
  usage: {
    totalProperties: number;
    totalTenants: number;
    activeContracts: number;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Données dont la durée de conservation est atteinte, telles que le Service
 * les SIGNALE au gestionnaire — il ne les efface jamais de lui-même (voir
 * conservation.service.ts côté API).
 */
export interface RetentionEcheances {
  calculeLe: string;
  durees: { journauxJours: number; ficheSansBailJours: number; apresFinDeBailJours: number };
  fichesSansBail: Tenant[];
  bauxClosDepuisLongtemps: Tenant[];
  total: number;
}
