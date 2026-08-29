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
  startDate: string;
  endDate: string;
  status: ContractStatus;
  reminderSentAt?: string | null;
  property?: Property;
  tenant?: Tenant;
  invoices?: Invoice[];
}

export type InvoiceStatus = "PENDING" | "PAID" | "LATE" | "CANCELLED";
export type PaymentMethod = "STRIPE" | "MOBILE_MONEY" | "BANK_TRANSFER" | "DEMO";

export interface Invoice {
  id: string;
  contractId: string;
  periodMonth: number;
  periodYear: number;
  amount: number;
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
  status: IssueStatus;
  managerNote?: string | null;
  createdAt: string;
  tenant?: Tenant;
  contract?: Contract;
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
}
