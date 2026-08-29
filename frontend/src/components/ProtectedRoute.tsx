import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types";

export default function ProtectedRoute({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) {
    return <Navigate to={user.role === "MANAGER" ? "/" : "/portail"} replace />;
  }

  // Paywall pour les gestionnaires dont l'essai ou l'abonnement a expiré
  if (
    user.role === "MANAGER" &&
    user.subscription?.isExpired &&
    location.pathname !== "/subscription"
  ) {
    return <Navigate to="/subscription" replace />;
  }

  return <>{children}</>;
}
