import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/auth";
import type { Role } from "../types";
import { homePathForRole } from "../utils/roleHome";

export default function ProtectedRoute({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  // Le pays de l'agence fixe les règles de location qui lui sont appliquées (et la devise du compte, donc le prix de
  // l'abonnement) : un gestionnaire qui ne l'a pas encore choisi — compte créé par Google, ou d'avant ce champ — le
  // choisit avant tout autre écran. Seul `null` compte : `undefined` est un profil gardé en mémoire avant ce champ,
  // rafraîchi au chargement (voir AuthContext), pas un choix manquant.
  if (user.role === "MANAGER" && user.country === null && location.pathname !== "/pays") {
    return <Navigate to="/pays" replace />;
  }

  // Paywall pour les gestionnaires dont l'essai ou l'abonnement a expiré. Pas depuis « /pays » : un gestionnaire sans pays
  // et dont l'essai est expiré y est envoyé d'abord, et le paywall l'en renvoyait vers « /subscription », qui le
  // renvoyait à « /pays » : une boucle sans fin. Le pays se choisit d'abord ; le paywall s'applique ensuite.
  if (
    user.role === "MANAGER" &&
    user.subscription?.isExpired &&
    location.pathname !== "/subscription" &&
    location.pathname !== "/pays"
  ) {
    return <Navigate to="/subscription" replace />;
  }

  return <>{children}</>;
}
