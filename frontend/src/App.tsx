import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import ManagerLayout from "./components/ManagerLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import TenantLayout from "./components/TenantLayout";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import ContractsPage from "./pages/manager/ContractsPage";
import DashboardPage from "./pages/manager/DashboardPage";
import InvoicesPage from "./pages/manager/InvoicesPage";
import IssuesPage from "./pages/manager/IssuesPage";
import PropertiesPage from "./pages/manager/PropertiesPage";
import SubscriptionPage from "./pages/manager/SubscriptionPage";
import TenantsPage from "./pages/manager/TenantsPage";
import TenantDashboardPage from "./pages/tenant/TenantDashboardPage";
import TenantInvoicesPage from "./pages/tenant/TenantInvoicesPage";
import TenantIssuesPage from "./pages/tenant/TenantIssuesPage";

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "MANAGER" ? "/" : "/portail"} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute role="MANAGER">
            <ManagerLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/properties" element={<PropertiesPage />} />
        <Route path="/tenants" element={<TenantsPage />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/issues" element={<IssuesPage />} />
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
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}
