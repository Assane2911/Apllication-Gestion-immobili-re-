export type Role = "MANAGER" | "TENANT";

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
  maxProperties: string | number;
  popular?: boolean;
  features: string[];
}

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  currency?: string;
  tenantId?: string | null;
  tenantName?: string | null;
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
  createdAt: string;
  updatedAt: string;
}

export interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  idDocument?: string | null;
  userId?: string | null;
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
  reminderSentAt?: string | null;
  signedByManagerAt?: string | null;
  managerSignatureUrl?: string | null;
  signedByTenantAt?: string | null;
  tenantSignatureUrl?: string | null;
  property?: Property;
  tenant?: Tenant;
  invoices?: Invoice[];
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
}

export type InvoiceStatus = "PENDING" | "PAID" | "LATE" | "CANCELLED";
export type PaymentMethod = "STRIPE" | "MOBILE_MONEY" | "BANK_TRANSFER" | "DEMO";

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
  monthlyRevenue: number;
  monthlyExpected: number;
  openIssues: number;
  lateInvoices: number;
  revenueByMonth: Record<string, number>;
  expensesByMonth: Record<string, number>;
}

