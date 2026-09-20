import { lazy, Suspense } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import AdminLayout from "./components/AdminLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import ManagerLayout from "./components/ManagerLayout";
import OwnerLayout from "./components/OwnerLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import TenantLayout from "./components/TenantLayout";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/auth";
import { CurrencyProvider } from "./context/CurrencyContext";
import { ThemeProvider } from "./context/ThemeContext";
import { homePathForRole } from "./utils/roleHome";

const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const CGUPage = lazy(() => import("./pages/legal/CGUPage"));
const MentionsLegalesPage = lazy(() => import("./pages/legal/MentionsLegalesPage"));
const PolitiqueConfidentialitePage = lazy(() => import("./pages/legal/PolitiqueConfidentialitePage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage"));
const ActivityLogPage = lazy(() => import("./pages/manager/ActivityLogPage"));
const AgencySettingsPage = lazy(() => import("./pages/manager/AgencySettingsPage"));
const ContractsPage = lazy(() => import("./pages/manager/ContractsPage"));
const CrgPage = lazy(() => import("./pages/manager/CrgPage"));
const DashboardPage = lazy(() => import("./pages/manager/DashboardPage"));
const ExpensesPage = lazy(() => import("./pages/manager/ExpensesPage"));
const FiscalPage = lazy(() => import("./pages/manager/FiscalPage"));
const InvoicesPage = lazy(() => import("./pages/manager/InvoicesPage"));
const IssuesPage = lazy(() => import("./pages/manager/IssuesPage"));
const ListingsPage = lazy(() => import("./pages/manager/ListingsPage"));
const ListingLeadsPage = lazy(() => import("./pages/manager/ListingLeadsPage"));
const MessagesPage = lazy(() => import("./pages/manager/MessagesPage"));
const PropertiesPage = lazy(() => import("./pages/manager/PropertiesPage"));
const SubscriptionPage = lazy(() => import("./pages/manager/SubscriptionPage"));
const TenantsPage = lazy(() => import("./pages/manager/TenantsPage"));
const OwnersPage = lazy(() => import("./pages/manager/OwnersPage"));
const InspectionsPage = lazy(() => import("./pages/manager/InspectionsPage"));
const TenantDashboardPage = lazy(() => import("./pages/tenant/TenantDashboardPage"));
const TenantInvoicesPage = lazy(() => import("./pages/tenant/TenantInvoicesPage"));
const TenantIssuesPage = lazy(() => import("./pages/tenant/TenantIssuesPage"));
const TenantMessagesPage = lazy(() => import("./pages/tenant/TenantMessagesPage"));
const OwnerDashboardPage = lazy(() => import("./pages/owner/OwnerDashboardPage"));
const OwnerCrgPage = lazy(() => import("./pages/owner/OwnerCrgPage"));
const AdminDashboardPage = lazy(() => import("./pages/admin/AdminDashboardPage"));
const AdminSubscriptionsPage = lazy(() => import("./pages/admin/AdminSubscriptionsPage"));
const AdminSettingsPage = lazy(() => import("./pages/admin/AdminSettingsPage"));
const VitrinePage = lazy(() => import("./pages/VitrinePage"));

/** Indicateur de chargement affiché pendant le téléchargement du chunk d'une page (React.lazy). */
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <span className="w-8 h-8 border-[3px] border-slate-200 dark:border-slate-700 border-t-brand-500 rounded-full animate-spin" />
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

        <Route
          element={
            <ProtectedRoute role="MANAGER">
              <ManagerLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/properties" element={<PropertiesPage />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="/proprietaires" element={<OwnersPage />} />
          <Route path="/proprietaires/:ownerId/crg" element={<CrgPage />} />
          <Route path="/contracts" element={<ContractsPage />} />
          <Route path="/etats-des-lieux" element={<InspectionsPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/annonces" element={<ListingsPage />} />
          <Route path="/leads" element={<ListingLeadsPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/bilan-fiscal" element={<FiscalPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/issues" element={<IssuesPage />} />
          <Route path="/activity-log" element={<ActivityLogPage />} />
          <Route path="/agency" element={<AgencySettingsPage />} />
          <Route path="/subscription" element={<SubscriptionPage />} />
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
          <Route path="/proprietaire/crg" element={<OwnerCrgPage />} />
        </Route>

        <Route
          element={
            <ProtectedRoute role="ADMIN">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/virements" element={<AdminSubscriptionsPage />} />
          <Route path="/admin/parametres" element={<AdminSettingsPage />} />
        </Route>

        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Router>
        <ThemeProvider>
          <AuthProvider>
            <CurrencyProvider>
              <AppRoutes />
            </CurrencyProvider>
          </AuthProvider>
        </ThemeProvider>
      </Router>
    </ErrorBoundary>
  );
}
