import { Building2, Landmark, LayoutDashboard, Lightbulb, Megaphone, ScrollText, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/auth";
import EnteteEspace from "./EnteteEspace";

const navItems = [
  { to: "/admin", key: "dashboard", icon: LayoutDashboard },
  { to: "/admin/gestionnaires", key: "managers", icon: Building2 },
  { to: "/admin/annonces", key: "listings", icon: Megaphone },
  { to: "/admin/virements", key: "transfers", icon: Landmark },
  { to: "/admin/journal", key: "audit", icon: ScrollText },
  { to: "/admin/suggestions", key: "suggestions", icon: Lightbulb },
  { to: "/admin/parametres", key: "settings", icon: Settings },
] as const;

/** Layout de l'espace administration de la plateforme (distinct du gestionnaire/locataire). */
export default function AdminLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Titre d'onglet propre à la page (React 19 remonte ce <title> dans <head>), comme dans l'espace gestionnaire :
  // sans lui, les sept pages d'administration s'appelaient pareil. L'entrée la plus précise gagne (la fiche d'un
  // gestionnaire, /admin/gestionnaires/:id, garde le libellé « Gestionnaires »).
  const { pathname } = useLocation();
  const chemin = pathname.replace(/\/+$/, "");
  const entree = [...navItems].sort((a, b) => b.to.length - a.to.length).find((item) => chemin === item.to || chemin.startsWith(`${item.to}/`));
  const libellePage = entree ? t(`admin.nav.${entree.key}`) : null;

  return (
    <div className="min-h-screen">
      {libellePage && <title>{`${libellePage} | ${t("common.appName")}`}</title>}
      <EnteteEspace
        largeur="5xl"
        titre={t("components.adminLayout.title")}
        sousTitre={user?.email}
        onglets={navItems.map((item) => ({ to: item.to, label: t(`admin.nav.${item.key}`), tip: t(`admin.nav.tips.${item.key}`), icon: item.icon, end: item.to === "/admin" }))}
      />
      <main data-surface="app" className="max-w-5xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
