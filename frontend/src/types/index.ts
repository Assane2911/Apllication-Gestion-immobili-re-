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
  /** Clé de traduction de chaque ligne de `features`, dans le même ordre (absente d'un serveur plus ancien). */
  featureKeys?: string[];
}

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  currency?: string;
  /**
   * Pays de l'agence (ISO 3166-1 alpha-2, dans la zone couverte : France et UEMOA). `null` tant qu'il n'est pas choisi
   * (compte créé par Google, ou d'avant ce champ) : le gestionnaire est alors envoyé le choisir (voir ProtectedRoute).
   * Absent (undefined) sur un profil gardé en mémoire avant ce champ : inconnu, pas « non choisi ».
   */
  country?: string | null;
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
  /**
   * Multi-utilisateurs (formule Entreprise) : id du compte quand il s'agit
   * d'un collaborateur invité par un gestionnaire propriétaire — `id`
   * ci-dessus reste alors celui du PROPRIÉTAIRE (voir
   * identiteJetonPourManager côté backend), pour que les données affichées
   * soient celles de l'agence. `null`/absent pour un gestionnaire
   * propriétaire ordinaire.
   */
  collaboratorId?: string | null;
  /** Rôle du collaborateur dans l'équipe ; `null` pour le gestionnaire propriétaire. */
  teamRole?: TeamRole | null;
  subscription?: SubscriptionInfo | null;
  /** Double authentification (TOTP) activée sur CE compte — voir /auth/me. */
  twoFactorEnabled?: boolean;
}

/** Réponse de POST /auth/login ou /auth/google quand le compte exige un second facteur. */
export interface TwoFactorRequired {
  twoFactorRequired: true;
  pendingToken: string;
}

/** Rôles des collaborateurs — voir backend/src/utils/rolesEquipe.ts. */
export type TeamRole = "FULL" | "AGENT" | "ACCOUNTANT" | "READ_ONLY";

export interface TeamMember {
  id: string;
  email: string;
  createdAt: string;
  role: TeamRole;
  status: "PENDING" | "ACTIVE";
  /** Invitation en attente dont le lien est périmé (elle peut être renvoyée). */
  expired?: boolean;
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
  /**
   * Civilité (« M » ou « MME »), facultative : elle sert aux documents
   * officiels — bail, quittance — qui s'adressent à la personne. Distincte du
   * sexe, qui n'aurait aucune finalité ici.
   */
  civility?: "M" | "MME" | null;
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
  /** Langue des e-mails de ce propriétaire (« fr », « en », « es », « pt »). Absente sur une fiche d'avant : le français. */
  language?: string | null;
  /** NONE = aucun accès créé, PENDING = invité mais mot de passe pas encore posé, ACTIVE = accès utilisable. */
  portalStatus: OwnerPortalStatus;
  /** Date d'exercice du droit à l'effacement (RGPD art. 17) — non nulle une fois anonymisé, voir anonymiserOwner. */
  anonymizedAt?: string | null;
  createdAt: string;
}

/** Prestataire/artisan du carnet du gestionnaire, assignable à un incident — voir vendor.controller.ts. */
export interface Vendor {
  id: string;
  name: string;
  trade?: string | null;
  phone: string;
  email?: string | null;
  notes?: string | null;
  createdAt: string;
}

/** Réponse de GET /api/referral (programme de parrainage). */
export interface ReferralInfo {
  referralCode: string;
  referralUrl: string;
  rewardDays: number;
  totalReferred: number;
  /** Plafond de filleuls récompensés par parrain, et nombre déjà utilisé. */
  maxRewardedReferrals: number;
  rewardedReferrals: number;
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
  /**
   * Civilité (« M » ou « MME »), facultative : elle sert aux documents
   * officiels — bail, quittance — qui s'adressent à la personne. Distincte du
   * sexe, qui n'aurait aucune finalité ici.
   */
  civility?: "M" | "MME" | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  idDocument?: string | null;
  userId?: string | null;
  /** Langue des e-mails de ce locataire (« fr », « en », « es », « pt »). Absente sur une fiche d'avant : le français. */
  language?: string | null;
  /** Date d'exercice du droit à l'effacement — voir anonymiserTenant côté API. */
  anonymizedAt?: string | null;
  createdAt: string;
  fiabilite?: TenantReliability;
}

export type ReliabilityLevel = "excellent" | "bon" | "moyen" | "risque" | "insuffisant";

/**
 * Score interne de ponctualité de paiement (0-100, ou null si pas assez de
 * factures échues pour être significatif) — voir reliability.service.ts
 * côté API pour la formule exacte. Un indicateur pour le gestionnaire, pas un
 * score de solvabilité.
 */
export interface TenantReliability {
  score: number | null;
  niveau: ReliabilityLevel;
  payeATemps: number;
  payeEnRetard: number;
  enRetardActuel: number;
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
  /** Jour d'échéance du loyer (1 à 31, 31 = dernier jour du mois) ; absent : le jour de la date de début. */
  paymentDay?: number | null;
  /** Type de bail ; adapte le titre du document. */
  leaseType?: "HABITATION" | "MEUBLE" | "COMMERCIAL" | "PROFESSIONNEL";
  /** Droit applicable saisi par le gestionnaire, imprimé sur le bail. */
  applicableLaw?: string | null;
  /** Mentions du logement du contrat type français (DPE, identifiant fiscal, période de construction, chauffage, loyers de référence) ; absent ou `null` : aucune. */
  housingMentions?: {
    dpe?: "A" | "B" | "C" | "D" | "E" | "F" | "G";
    identifiantFiscal?: string;
    periodeConstruction?: string;
    chauffage?: string;
    loyerReference?: number;
    loyerReferenceMajore?: number;
    dernierLoyer?: number;
  } | null;
  /** Frais d'agence à la charge du locataire, dans la devise du bail ; imprimés sur le bail, jamais facturés ; absent ou `null` : aucun. */
  agencyFee?: number | null;
  reminderSentAt?: string | null;
  signedByManagerAt?: string | null;
  managerSignatureUrl?: string | null;
  signedByTenantAt?: string | null;
  tenantSignatureUrl?: string | null;
  /** Retenues ligne à ligne sur le dépôt de garantie, ou `null`/absent si pas encore restitué. */
  depositDeductions?: DepositDeduction[] | null;
  /** Date à laquelle la restitution du dépôt a été enregistrée, ou `null`/absent. */
  depositRefundedAt?: string | null;
  property?: Property;
  tenant?: Tenant;
  invoices?: Invoice[];
  /** Portail locataire : titulaire du bail, ou colocataire (pas de signature électronique). */
  qualite?: "TITULAIRE" | "COLOCATAIRE";
  /** Noms des colocataires (liste des contrats). */
  cotenantNames?: string[];
  /** Nombre de garants (liste des contrats). */
  guarantorsCount?: number;
  guarantors?: Guarantor[];
}

/** Colocataire d'un bail : lien vers une fiche locataire de l'agence. */
export interface Cotenant {
  id: string;
  tenant: Tenant;
}

/** Garant d'un bail : figure sur le bail, figé une fois le bail signé par le locataire. */
export interface Guarantor {
  id: string;
  contractId: string;
  civility: "M" | "MME" | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  address: string | null;
  maxAmount: number | null;
  notes: string | null;
}

export interface DepositDeduction {
  label: string;
  amount: number;
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

export type ExpenseRecurrence = "MONTHLY" | "ANNUAL";

export interface Expense {
  id: string;
  propertyId: string;
  category: ExpenseCategory;
  title: string;
  amount: number;
  currency: string;
  expenseDate: string;
  notes?: string | null;
  /** Renseigné uniquement sur le modèle d'une dépense récurrente. */
  recurrence?: ExpenseRecurrence | null;
  recurrenceEndDate?: string | null;
  /** Renseigné uniquement sur une occurrence générée automatiquement depuis un modèle. */
  templateId?: string | null;
  periodIndex?: number | null;
  property?: Property;
  createdAt: string;
}

/** Police d'assurance d'un bien (voir insurance.controller.ts côté API). */
export interface InsurancePolicy {
  id: string;
  propertyId: string;
  insurerName: string;
  policyNumber: string;
  premiumAmount?: number | null;
  currency: string;
  startDate?: string | null;
  expiryDate: string;
  notes?: string | null;
  reminderSentAt?: string | null;
  property?: Property;
  createdAt: string;
}

export interface Message {
  id: string;
  contractId: string;
  senderId: string;
  senderRole: Role;
  content: string;
  isRead: boolean;
  createdAt: string;
  sender?: {
    id: string;
    email: string;
    role: Role;
  };
}

export interface Conversation {
  /** Identifiant du fil : « bail:locataire ». Un bail en colocation a un fil par locataire. */
  id?: string;
  contractId: string;
  /** Le locataire de ce fil (titulaire ou colocataire). */
  tenantId?: string;
  qualite?: "TITULAIRE" | "COLOCATAIRE";
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
  /** Relances graduées des impayés. */
  overdueRemindersEnabled?: boolean;
  overdueGraceDays?: number;
  overdueIntervalDays?: number;
  overdueNotifyGuarantors?: boolean;
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
export type PaymentMethod = "STRIPE" | "PAYDUNYA" | "BANK_TRANSFER" | "DEMO" | "CASH" | "CHEQUE" | "MOBILE_MONEY";

/** Moyens que le gestionnaire peut saisir à la main en marquant un loyer réglé. */
export type MoyenSaisiAlaMain = "BANK_TRANSFER" | "CASH" | "CHEQUE" | "MOBILE_MONEY";

export interface Invoice {
  id: string;
  contractId: string;
  /** Relances graduées : dernier niveau envoyé (0 à 3) et sa date. */
  overdueReminderLevel?: number;
  overdueReminderSentAt?: string | null;
  periodMonth: number;
  periodYear: number;
  amount: number;
  currency?: string;
  dueDate: string;
  status: InvoiceStatus;
  paidAt?: string | null;
  paymentMethod?: PaymentMethod | null;
  paymentRef?: string | null;
  /** Cumul des paiements partiels d'une facture non soldée (0 pour une facture payée d'un coup). */
  amountPaid?: number;
  /** Montant réglé : le total pour une facture PAYÉE, sinon le cumul des paiements partiels. */
  montantRegle?: number;
  /** Reste dû : 0 pour une facture payée ou annulée. */
  resteDu?: number;
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
  /**
   * Prestataire assigné, ou `null`. Vu par le Gestionnaire (IssuesPage), le
   * carnet complet (toutes les colonnes de Vendor) ; vu par le Locataire
   * (TenantIssuesPage), seulement nom et métier — jamais les coordonnées
   * directes du prestataire (voir myIssues, issue.controller.ts).
   */
  vendor?: Pick<Vendor, "name" | "trade"> & Partial<Pick<Vendor, "id" | "phone" | "email" | "notes">> | null;
  /** Rendez-vous d'intervention pris avec le prestataire assigné, ou `null`/absent. */
  scheduledAt?: string | null;
}

export type NotificationType = "message" | "invoice" | "issue" | "contract_ending" | "lead";
export type NotificationSeverity = "info" | "warning" | "danger";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  description: string;
  link: string;
  createdAt: string;
  /** Version de la notification (identifiant + date) : sert à l'état « vu » côté serveur. */
  key?: string;
  /** Déjà vue par cette personne (badge) ; absent = non vue. */
  seen?: boolean;
  /** Écartée du panneau par cette personne (« Tout marquer comme lu ») ; absent = non lue. */
  read?: boolean;
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
  /** Reversements enregistrés au titre du mois. */
  reversements?: OwnerPayout[];
  totalReverseByCurrency?: Record<string, number>;
  /** Net moins ce qui a été reversé ; négatif si l'agence a versé plus que le net. */
  resteAReverserByCurrency?: Record<string, number>;
}

export type PayoutMethod = "BANK_TRANSFER" | "CASH" | "CHEQUE" | "MOBILE_MONEY" | "OTHER";

/** Argent versé par l'agence à un propriétaire au titre d'un mois de gestion. */
export interface OwnerPayout {
  id: string;
  currency: string;
  amount: number;
  paidAt: string;
  method: PayoutMethod;
  reference: string | null;
  note: string | null;
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
  // Modération par l'administration (voir listing.controller.ts) : renvoyés au
  // gestionnaire propriétaire, jamais dans les réponses publiques.
  hiddenByAdminAt?: string | null;
  moderationReason?: string | null;
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
    // Absent d'une réponse d'un serveur plus ancien (déploiement en cours).
    suspended?: number;
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
  durees: {
    journauxJours: number;
    ficheSansBailJours: number;
    apresFinDeBailJours: number;
    leadProspectionJours: number;
  };
  fichesSansBail: Tenant[];
  bauxClosDepuisLongtemps: Tenant[];
  leadsAnciens: ListingLead[];
  total: number;
}

/** Bail dont un impayé appelle une mise en demeure (GET /contracts/formal-notices-due). */
export interface FormalNoticeDue {
  contractId: string;
  propertyTitle: string;
  tenantName: string;
  currency: string;
  unpaidCount: number;
  alreadyClaimedCount: number;
  totalDue: number;
  oldestDueDate: string;
  daysLate: number;
  /** Faux quand la fiche de l'agence n'a ni téléphone ni email : le courrier ne dirait pas comment la joindre. */
  agencyReachable?: boolean;
}

/** Mise en demeure émise (POST /contracts/:id/formal-notices). */
export interface FormalNotice {
  id: string;
  contractId: string;
  reference: string;
  totalDue: number;
  currency: string;
  deadlineDays: number;
  emailSentAt: string | null;
  guarantorsNotified: number;
  createdAt: string;
  emailEnvoye?: boolean;
}
