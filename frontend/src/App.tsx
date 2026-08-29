import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import ManagerLayout from "./components/ManagerLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import TenantLayout from "./components/TenantLayout";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { CurrencyProvider } from "./context/CurrencyContext";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import ActivityLogPage from "./pages/manager/ActivityLogPage";
import AgencySettingsPage from "./pages/manager/AgencySettingsPage";
import ContractsPage from "./pages/manager/ContractsPage";
import DashboardPage from "./pages/manager/DashboardPage";
import ExpensesPage from "./pages/manager/ExpensesPage";
import InvoicesPage from "./pages/manager/InvoicesPage";
import IssuesPage from "./pages/manager/IssuesPage";
import MessagesPage from "./pages/manager/MessagesPage";
import PropertiesPage from "./pages/manager/PropertiesPage";
import SubscriptionPage from "./pages/manager/SubscriptionPage";
import TenantsPage from "./pages/manager/TenantsPage";
import TenantDashboardPage from "./pages/tenant/TenantDashboardPage";
import TenantInvoicesPage from "./pages/tenant/TenantInvoicesPage";
import TenantIssuesPage from "./pages/tenant/TenantIssuesPage";
import TenantMessagesPage from "./pages/tenant/TenantMessagesPage";

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <LandingPage />;
  return <Navigate to={user.role === "MANAGER" ? "/dashboard" : "/portail"} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/landing" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />

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
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
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

      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <CurrencyProvider>
          <AppRoutes />
        </CurrencyProvider>
      </AuthProvider>
    </Router>
  );
}
