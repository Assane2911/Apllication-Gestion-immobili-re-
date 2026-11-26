import { Suspense } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import AdminLayout from "./components/AdminLayout";
import BandeauNouvelleVersion from "./components/BandeauNouvelleVersion";
import AnnonceChangementPage from "./components/AnnonceChangementPage";
import LienEvitement from "./components/LienEvitement";
import CookieConsentBanner from "./components/CookieConsentBanner";
import ErrorBoundary from "./components/ErrorBoundary";
import InactiviteSession from "./components/InactiviteSession";
import ManagerLayout from "./components/ManagerLayout";
import PorteMaintenance from "./components/PorteMaintenance";
import SynchroLangueUrl from "./components/SynchroLangueUrl";
import OwnerLayout from "./components/OwnerLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import TenantLayout from "./components/TenantLayout";
import { AuthProvider } from "./context/AuthContext";
import HistoriqueProvider from "./context/HistoriqueContext";
import { useAuth } from "./context/auth";
import { CurrencyProvider } from "./context/CurrencyContext";
import { lazyAvecZones } from "./utils/lazyAvecZones";
import { lazyWithReload } from "./utils/lazyWithReload";
import { LANGUES_PREFIXEES } from "./utils/langueUrl";
import { homePathForRole } from "./utils/roleHome";

const ForgotPasswordPage = lazyWithReload(() => import("./pages/ForgotPasswordPage"));
const LandingPage = lazyAvecZones(() => import("./pages/LandingPage"), ["landing", "partage"]);
const CGUPage = lazyWithReload(() => import("./pages/legal/CGUPage"));
const MentionsLegalesPage = lazyWithReload(() => import("./pages/legal/MentionsLegalesPage"));
const PolitiqueConfidentialitePage = lazyWithReload(() => import("./pages/legal/PolitiqueConfidentialitePage"));
const LoginPage = lazyWithReload(() => import("./pages/LoginPage"));
const RegisterPage = lazyWithReload(() => import("./pages/RegisterPage"));
const ChoisirPaysPage = lazyWithReload(() => import("./pages/ChoisirPaysPage"));
const ResetPasswordPage = lazyWithReload(() => import("./pages/ResetPasswordPage"));
const VerifyEmailPage = lazyWithReload(() => import("./pages/VerifyEmailPage"));
const ActivityLogPage = lazyAvecZones(() => import("./pages/manager/ActivityLogPage"), ["manager", "partage"]);
const GuidePage = lazyAvecZones(() => import("./pages/manager/GuidePage"), ["manager", "partage"]);
const AgencySettingsPage = lazyAvecZones(() => import("./pages/manager/AgencySettingsPage"), ["manager", "partage"]);
const ContractsPage = lazyAvecZones(() => import("./pages/manager/ContractsPage"), ["manager", "partage"]);
const CrgPage = lazyAvecZones(() => import("./pages/manager/CrgPage"), ["manager", "partage"]);
const DashboardPage = lazyAvecZones(() => import("./pages/manager/DashboardPage"), ["manager", "partage"]);
const ExpensesPage = lazyAvecZones(() => import("./pages/manager/ExpensesPage"), ["manager", "partage"]);
const ImportPage = lazyAvecZones(() => import("./pages/manager/ImportPage"), ["manager", "partage"]);
const FiscalPage = lazyAvecZones(() => import("./pages/manager/FiscalPage"), ["manager", "partage"]);
const InvoicesPage = lazyAvecZones(() => import("./pages/manager/InvoicesPage"), ["manager", "partage"]);
const IssuesPage = lazyAvecZones(() => import("./pages/manager/IssuesPage"), ["manager", "partage"]);
const VendorsPage = lazyAvecZones(() => import("./pages/manager/VendorsPage"), ["manager", "partage"]);
const ListingsPage = lazyAvecZones(() => import("./pages/manager/ListingsPage"), ["manager", "partage"]);
const ListingLeadsPage = lazyAvecZones(() => import("./pages/manager/ListingLeadsPage"), ["manager", "partage"]);
const MessagesPage = lazyAvecZones(() => import("./pages/manager/MessagesPage"), ["manager", "partage"]);
const PropertiesPage = lazyAvecZones(() => import("./pages/manager/PropertiesPage"), ["manager", "partage"]);
const SubscriptionPage = lazyAvecZones(() => import("./pages/manager/SubscriptionPage"), ["manager", "partage"]);
const ReferralPage = lazyAvecZones(() => import("./pages/manager/ReferralPage"), ["manager", "partage"]);
const TenantsPage = lazyAvecZones(() => import("./pages/manager/TenantsPage"), ["manager", "partage"]);
const OwnersPage = lazyAvecZones(() => import("./pages/manager/OwnersPage"), ["manager", "partage"]);
const InspectionsPage = lazyAvecZones(() => import("./pages/manager/InspectionsPage"), ["manager", "partage"]);
const DocumentsPage = lazyAvecZones(() => import("./pages/manager/DocumentsPage"), ["manager", "partage"]);
const AgendaPage = lazyAvecZones(() => import("./pages/manager/AgendaPage"), ["manager", "partage"]);
const InsurancePage = lazyAvecZones(() => import("./pages/manager/InsurancePage"), ["manager", "partage"]);
const TenantDashboardPage = lazyAvecZones(() => import("./pages/tenant/TenantDashboardPage"), ["tenant", "partage"]);
const TenantInvoicesPage = lazyAvecZones(() => import("./pages/tenant/TenantInvoicesPage"), ["tenant", "partage"]);
const TenantIssuesPage = lazyAvecZones(() => import("./pages/tenant/TenantIssuesPage"), ["tenant", "partage"]);
const TenantMessagesPage = lazyAvecZones(() => import("./pages/tenant/TenantMessagesPage"), ["tenant", "partage"]);
const OwnerDashboardPage = lazyAvecZones(() => import("./pages/owner/OwnerDashboardPage"), ["partage"]);
const OwnerMessagesPage = lazyAvecZones(() => import("./pages/owner/OwnerMessagesPage"), ["partage"]);
const GestionnaireOwnerMessagesPage = lazyAvecZones(() => import("./pages/manager/OwnerMessagesPage"), ["manager", "partage"]);
const OwnerCrgPage = lazyAvecZones(() => import("./pages/owner/OwnerCrgPage"), ["partage"]);
const OwnerAgendaPage = lazyAvecZones(() => import("./pages/owner/OwnerAgendaPage"), ["partage"]);
const AdminDashboardPage = lazyAvecZones(() => import("./pages/admin/AdminDashboardPage"), ["admin", "partage"]);
const AdminSettingsPage = lazyAvecZones(() => import("./pages/admin/AdminSettingsPage"), ["admin", "partage"]);
const AdminSuggestionsPage = lazyAvecZones(() => import("./pages/admin/AdminSuggestionsPage"), ["admin", "partage"]);
const AdminListingsPage = lazyAvecZones(() => import("./pages/admin/AdminListingsPage"), ["admin", "partage"]);
const AdminManagersPage = lazyAvecZones(() => import("./pages/admin/AdminManagersPage"), ["admin", "partage"]);
const AdminAuditPage = lazyAvecZones(() => import("./pages/admin/AdminAuditPage"), ["admin", "partage"]);
const AdminManagerDetailPage = lazyAvecZones(() => import("./pages/admin/AdminManagerDetailPage"), ["admin", "partage"]);
const VitrinePage = lazyAvecZones(() => import("./pages/VitrinePage"), ["partage"]);
const VitrineListingPage = lazyAvecZones(() => import("./pages/VitrineListingPage"), ["partage"]);

/** Indicateur de chargement affiché pendant le téléchargement du chunk d'une page (React.lazy). */
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <span className="w-8 h-8 border-[3px] border-contour-200 border-t-brand-500 rounded-full animate-spin" />
    </div>
  );
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <LandingPage />;
  return <Navigate to={homePathForRole(user.role)} replace />;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/landing" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/inscription" element={<RegisterPage />} />
        <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
        <Route path="/reinitialiser-mot-de-passe" element={<ResetPasswordPage />} />
        <Route path="/verifier-email" element={<VerifyEmailPage />} />
        <Route path="/mentions-legales" element={<MentionsLegalesPage />} />
        <Route path="/cgu" element={<CGUPage />} />
        <Route path="/confidentialite" element={<PolitiqueConfidentialitePage />} />
        {/* Vitrine publique des annonces : accessible sans authentification,
            volontairement hors de tout layout protégé (voir listing.routes.ts
            côté backend, dont les routes /public/... suivent la même logique). */}
        <Route path="/vitrine" element={<VitrinePage />} />
        <Route path="/vitrine/annonces/:id" element={<VitrineListingPage />} />

        {/* Choix du pays de l'agence : réservé au gestionnaire, hors du ManagerLayout (ni menu ni en-tête d'agence tant que
            le pays n'est pas choisi) ; ProtectedRoute y renvoie tout gestionnaire dont le pays est `null`. */}
        <Route
          path="/pays"
          element={
            <ProtectedRoute role="MANAGER">
              <ChoisirPaysPage />
            </ProtectedRoute>
          }
        />

        <Route
          element={
            <ProtectedRoute role="MANAGER">
              <ManagerLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/agenda" element={<AgendaPage />} />
          <Route path="/properties" element={<PropertiesPage />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="/proprietaires" element={<OwnersPage />} />
          <Route path="/proprietaires/:ownerId/crg" element={<CrgPage />} />
          <Route path="/contracts" element={<ContractsPage />} />
          <Route path="/etats-des-lieux" element={<InspectionsPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/annonces" element={<ListingsPage />} />
          <Route path="/leads" element={<ListingLeadsPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/assurances" element={<InsurancePage />} />
          <Route path="/bilan-fiscal" element={<FiscalPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/proprietaires" element={<GestionnaireOwnerMessagesPage />} />
          <Route path="/issues" element={<IssuesPage />} />
          <Route path="/prestataires" element={<VendorsPage />} />
          <Route path="/activity-log" element={<ActivityLogPage />} />
          <Route path="/guide-demarrage" element={<GuidePage />} />
          <Route path="/agency" element={<AgencySettingsPage />} />
          <Route path="/subscription" element={<SubscriptionPage />} />
          <Route path="/parrainage" element={<ReferralPage />} />
        </Route>

        <Route
          element={
            <ProtectedRoute role="TENANT">
              <TenantLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/portail" element={<TenantDashboardPage />} />
          <Route path="/portail/paiements" element={<TenantInvoicesPage />} />
          <Route path="/portail/messages" element={<TenantMessagesPage />} />
          <Route path="/portail/incidents" element={<TenantIssuesPage />} />
        </Route>

        <Route
          element={
            <ProtectedRoute role="OWNER">
              <OwnerLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/proprietaire" element={<OwnerDashboardPage />} />
          <Route path="/proprietaire/messages" element={<OwnerMessagesPage />} />
          <Route path="/proprietaire/crg" element={<OwnerCrgPage />} />
          <Route path="/proprietaire/agenda" element={<OwnerAgendaPage />} />
        </Route>

        <Route
          element={
            <ProtectedRoute role="ADMIN">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/gestionnaires" element={<AdminManagersPage />} />
          <Route path="/admin/gestionnaires/:id" element={<AdminManagerDetailPage />} />
          <Route path="/admin/journal" element={<AdminAuditPage />} />
          <Route path="/admin/parametres" element={<AdminSettingsPage />} />
          <Route path="/admin/suggestions" element={<AdminSuggestionsPage />} />
          <Route path="/admin/annonces" element={<AdminListingsPage />} />
        </Route>

        {/* Accueil et vitrine existent aussi en anglais, espagnol et portugais, à leur propre adresse (voir utils/langueUrl.ts). */}
        {LANGUES_PREFIXEES.flatMap((langue) => [
          <Route key={`${langue}-accueil`} path={`/${langue}`} element={<HomeRedirect />} />,
          <Route key={`${langue}-vitrine`} path={`/${langue}/vitrine`} element={<VitrinePage />} />,
        ])}

        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Router>
        <HistoriqueProvider>
          <AuthProvider>
            <CurrencyProvider>
              <LienEvitement />
              <AnnonceChangementPage />
              <SynchroLangueUrl />
              <BandeauNouvelleVersion />
              <PorteMaintenance>
                <AppRoutes />
              </PorteMaintenance>
              <InactiviteSession />
              <CookieConsentBanner />
            </CurrencyProvider>
          </AuthProvider>
        </HistoriqueProvider>
      </Router>
    </ErrorBoundary>
  );
}
